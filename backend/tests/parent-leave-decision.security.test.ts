import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { afterEach, before, beforeEach, mock, test } from 'node:test';
import mongoose from 'mongoose';
import ApprovalRequest from '../src/models/approvalRequest';
import Branch from '../src/models/branch';
import { AcademicPeriod } from '../src/models/academicPeriod';
import {
  AttendanceCorrection,
  StudentLeave,
  ensureAttendanceAmendmentIndexes,
} from '../src/models/attendanceAmendment';
import {
  AttendanceSession,
  PeriodAttendanceRecord,
} from '../src/models/periodAttendance';
import {
  ParentLeaveApplication,
  ensureParentLeaveApplicationIndexes,
} from '../src/models/parentLeaveApplication';
import { ParentLeaveDecisionOperation } from '../src/models/parentLeaveDecisionOperation';
import { ParentLeaveOperation } from '../src/models/parentLeaveOperation';
import { ParentStudentLink } from '../src/models/parentStudentLink';
import { StudentEnrollment } from '../src/models/studentEnrollment';
import { Notification } from '../src/models/notification';
import {
  SubstituteAssignment,
  TimetableVersion,
} from '../src/models/timetable';
import TeacherAssignment from '../src/models/teacherAssignment';
import Session from '../src/models/session';
import User from '../src/models/user';
import { PERMISSIONS } from '../src/constants/permissions';
import { ROLE_PERMISSIONS } from '../src/constants/rolePermissions';
import { approvedLeaveForOccurrence } from '../src/services/attendance-parent-leave.service';
import { generateAccessToken } from '../src/services/jwt.service';
import { registerSession } from '../src/services/session.service';
import { addScheduleDays } from '../src/services/school-date.service';
import {
  oid,
  parentState,
  put,
  state,
} from './helpers/parent-workspace.fixture';
import { apiHttp } from './helpers/student-workspace.fixture';
import { seedOccurrence } from './helpers/parent-domain.fixture';
import type { DecisionWorkerInput } from './helpers/parent-leave-decision-worker';

const reviewPath = '/principal/parent-leave-reviews';
const privateReason =
  'Private family medical history for Principal review only';
const publicReason = 'The documentation does not cover these dates.';
const keys = [
  'PARENT_LEAVE_ROUTING_POLICY',
  'PRINCIPAL_APPROVAL_AUTHORITY',
] as const;
const initialEnvironment = keys.map(key => process.env[key]);
let token: string;

const routing = (version = 7) =>
  JSON.stringify({
    policy: 'shared_branch_principal',
    enabled: true,
    version,
    branchIds: [String(state.branch._id)],
  });
const grant = () =>
  JSON.stringify({
    [String(parentState.verifier._id)]: {
      branchId: String(state.branch._id),
      types: ['leave'],
    },
  });
const root = () =>
  `/parent/me/children/${state.student._id}/leave-applications`;
const body = (
  action: 'approve' | 'reject' | 'request_changes' = 'approve',
  clientOperationId = 'decision-op',
) => ({
  action,
  clientOperationId,
  applicationRevision: 1,
  approvalVersion: 0,
  ...(action !== 'approve' ? { decisionReason: publicReason } : {}),
});
const decide = (
  approvalId: string,
  payload: unknown = body(),
  reviewer = token,
) => apiHttp(`${reviewPath}/${approvalId}/decisions`, reviewer, payload);

before(async () => {
  await ensureParentLeaveApplicationIndexes();
  await ensureAttendanceAmendmentIndexes();
});
beforeEach(async () => {
  process.env[keys[0]] = routing();
  process.env[keys[1]] = grant();
  token = generateAccessToken(String(parentState.verifier._id), 'principal');
  await registerSession(String(parentState.verifier._id), token, 'principal');
  await AcademicPeriod.updateOne(
    { _id: state.period._id },
    {
      startDate: addScheduleDays(state.today, -30),
      endDate: addScheduleDays(state.today, 30),
    },
  );
});
afterEach(() => {
  mock.restoreAll();
  keys.forEach((key, index) => {
    const original = initialEnvironment[index];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  });
});

async function draft(
  startDate = state.today,
  endDate = addScheduleDays(state.today, 2),
) {
  const result = await apiHttp(root(), parentState.token, {
    clientOperationId: String(oid()),
    leaveType: 'Medical leave',
    reason: privateReason,
    startDate,
    endDate,
  });
  assert.equal(result.status, 200, JSON.stringify(result.json));
  return result.json.data.applicationId as string;
}
const submit = (id: string) =>
  apiHttp(`${root()}/${id}/submit`, parentState.token, {
    revision: 0,
    clientOperationId: String(oid()),
  });
async function pending(startDate?: string, endDate?: string) {
  const id = await draft(startDate, endDate);
  const response = await submit(id);
  assert.equal(response.status, 200, JSON.stringify(response.json));
  const approval = await ApprovalRequest.findOne({ entityId: id })
    .orFail()
    .lean();
  return { id, approvalId: String(approval._id) };
}
async function assertOutcome(id: string, approvalId: string, status: string) {
  const application = await ParentLeaveApplication.findById(id).orFail().lean();
  const approval = await ApprovalRequest.findById(approvalId).orFail().lean();
  assert.equal(application.state, status);
  assert.equal(approval.status, status);
  assert.equal(String(application.approvalRequestId), approvalId);
  assert.equal(String(approval.entityId), id);
  assert.equal(
    await StudentLeave.countDocuments({ origin: 'parent_application' }),
    status === 'approved' ? 1 : 0,
  );
  assert.equal(
    await ParentLeaveDecisionOperation.countDocuments(),
    ['approved', 'rejected'].includes(status) ? 1 : 0,
  );
  return { application, approval };
}

test('approval creates one exact coverage, acknowledges replay and preserves physical attendance', async () => {
  const { period, session } = await seedOccurrence();
  const correction = await put(AttendanceCorrection, {
    attendanceSessionId: session._id,
    state: 'approved',
  });
  const records = await PeriodAttendanceRecord.find().lean();
  const { id, approvalId } = await pending();
  await Session.updateMany(
    { userId: parentState.parent._id },
    { isRevoked: true },
  );
  const first = await decide(approvalId);
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.data.state, 'approved');
  const replay = await decide(approvalId);
  assert.equal(
    replay.status,
    200,
    JSON.stringify({
      response: replay.json,
      history: (await ApprovalRequest.findById(approvalId).lean())?.history,
      linkedHistory: (await ParentLeaveApplication.findById(id).lean())
        ?.history,
    }),
  );
  assert.deepEqual(replay.json.data, { ...first.json.data, replayed: true });
  assert.equal((await decide(approvalId, body('reject'))).status, 409);
  const { application, approval } = await assertOutcome(
    id,
    approvalId,
    'approved',
  );
  assert.equal(String(approval.reviewedBy), String(parentState.verifier._id));
  assert.equal(
    String(application.history.at(-1)!.actorId),
    String(parentState.verifier._id),
  );
  const leave = await StudentLeave.findOne({ parentApplicationId: id })
    .orFail()
    .lean();
  assert.equal(String(leave.enrollmentId), String(state.enrollment._id));
  assert.equal(String(leave.approvalRequestId), approvalId);
  assert.equal(leave.parentSubmissionRevision, 1);
  assert.equal(leave.attendanceSessionId, undefined);
  assert.equal(leave.reason, undefined);
  assert.equal(await AttendanceSession.countDocuments(), 1);
  assert.deepEqual(await PeriodAttendanceRecord.find().lean(), records);
  assert.deepEqual(
    await AttendanceCorrection.findById(correction._id).lean(),
    correction,
  );
  assert.equal(await Notification.countDocuments(), 0);
  const detail = await apiHttp(`${reviewPath}/${approvalId}`, token);
  assert.equal(detail.json.data.status, 'approved');
  assert.equal(detail.json.data.decisionVersion, null);
  const oversight = await apiHttp(
    `/principal/attendance/occurrences/${period._id}?date=${state.today}`,
    token,
  );
  assert.equal(oversight.status, 200, JSON.stringify(oversight.json));
  assert.doesNotMatch(
    JSON.stringify(oversight.json),
    /Private family medical|parentApplicationId|fingerprint/,
  );
  const occurrence = {
    classId: state.cls._id,
    sectionId: state.section._id,
    date: state.today,
  };
  assert.equal(
    String(
      (
        await approvedLeaveForOccurrence(
          String(state.branch._id),
          String(state.student._id),
          occurrence,
        )
      )?._id,
    ),
    String(leave._id),
  );
  assert.equal(
    await approvedLeaveForOccurrence(
      String(state.branch._id),
      String(state.student._id),
      { ...occurrence, sectionId: oid() },
    ),
    null,
  );
  assert.equal(
    await approvedLeaveForOccurrence(
      String(state.branch._id),
      String(state.student._id),
      { ...occurrence, date: addScheduleDays(state.today, 3) },
    ),
    null,
  );
  const { _id, ...duplicate } = leave;
  assert.ok(_id);
  await assert.rejects(
    StudentLeave.collection.insertOne({
      ...duplicate,
      clientOperationId: 'another',
    }),
    { code: 11000 },
  );
  process.env[keys[1]] = '{}';
  assert.equal((await decide(approvalId)).status, 404);
  process.env[keys[1]] = grant();
  await Session.updateMany({ token }, { isRevoked: true });
  assert.equal((await decide(approvalId)).status, 401);
});

test('rejection records a bounded applicant-visible reason and releases its reservation', async () => {
  const { id, approvalId } = await pending();
  assert.equal(
    (await decide(approvalId, { ...body('reject'), decisionReason: 'short' }))
      .status,
    400,
  );
  assert.equal(
    (
      await decide(approvalId, {
        ...body('reject'),
        decisionReason: 'e\u0301'.repeat(5),
      })
    ).status,
    400,
  );
  assert.equal(
    (await decide(approvalId, { ...body(), action: 'changes_requested' }))
      .status,
    400,
  );
  const rejected = await decide(approvalId, body('reject'));
  assert.equal(rejected.status, 200, JSON.stringify(rejected.json));
  await assertOutcome(id, approvalId, 'rejected');
  const detail = await apiHttp(`${root()}/${id}`, parentState.token);
  assert.equal(detail.json.data.state, 'rejected');
  assert.deepEqual(detail.json.data.history.at(-1), {
    action: 'rejected',
    revision: 2,
    at: rejected.json.data.decidedAt,
    decisionReason: publicReason,
  });
  assert.equal((await submit(await draft())).status, 200);
});

for (const [name, change, status] of [
  [
    'missing grant',
    () => {
      process.env[keys[1]] = '{}';
    },
    404,
  ],
  [
    'missing routing',
    () => {
      delete process.env[keys[0]];
    },
    404,
  ],
  [
    'incompatible routing',
    () => {
      process.env[keys[0]] = routing(8);
    },
    404,
  ],
  [
    'revoked session',
    () => Session.updateMany({ token }, { isRevoked: true }),
    401,
  ],
  [
    'changed role',
    () =>
      User.updateOne({ _id: parentState.verifier._id }, { role: 'teacher' }),
    401,
  ],
  [
    'changed Branch',
    () =>
      User.updateOne(
        { _id: parentState.verifier._id },
        { branchId: state.foreign._id },
      ),
    404,
  ],
  [
    'revoked relationship',
    () =>
      ParentStudentLink.updateOne(
        { _id: parentState.link._id },
        { status: 'revoked', isActive: false },
      ),
    404,
  ],
  [
    'invalid verifier',
    () =>
      ParentStudentLink.updateOne(
        { _id: parentState.link._id },
        { verifiedBy: parentState.parent._id },
      ),
    404,
  ],
  [
    'inactive Parent',
    () => User.updateOne({ _id: parentState.parent._id }, { isActive: false }),
    404,
  ],
  [
    'transferred enrollment',
    () =>
      StudentEnrollment.updateOne(
        { _id: state.enrollment._id },
        { status: 'transferred', effectiveTo: new Date() },
      ),
    404,
  ],
  [
    'period closed',
    () =>
      AcademicPeriod.updateOne({ _id: state.period._id }, { status: 'closed' }),
    404,
  ],
] as const) {
  test(`${name} blocks a Principal decision and preserves the reservation`, async () => {
    const { id, approvalId } = await pending();
    await change();
    assert.equal((await decide(approvalId)).status, status);
    await assertOutcome(id, approvalId, 'pending');
  });
}

test('stale revisions, foreign identity and forged reciprocal links fail closed', async () => {
  const { id, approvalId } = await pending();
  assert.equal((await decide(String(oid()))).status, 404);
  assert.equal(
    (await decide(approvalId, body(), parentState.token)).status,
    403,
  );
  assert.equal(
    (
      await decide(approvalId, {
        ...body(),
        branchId: String(state.branch._id),
      })
    ).status,
    400,
  );
  assert.equal(
    (await decide(approvalId, { ...body(), approvalVersion: 1 })).status,
    409,
  );
  assert.equal(
    (await decide(approvalId, { ...body(), applicationRevision: 2 })).status,
    409,
  );
  await ApprovalRequest.updateOne({ _id: approvalId }, { entityId: oid() });
  assert.equal((await decide(approvalId)).status, 404);
  assert.equal(
    (await ParentLeaveApplication.findById(id).lean())!.state,
    'pending',
  );
  assert.equal(await ParentLeaveDecisionOperation.countDocuments(), 0);
});

for (const permission of [
  PERMISSIONS.PRINCIPAL_APPROVALS_VIEW,
  PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE,
]) {
  test(`removing ${permission} blocks decision independently of the leave grant`, async () => {
    const { id, approvalId } = await pending();
    const permissions = ROLE_PERMISSIONS.principal;
    const index = permissions.indexOf(permission);
    assert.notEqual(index, -1);
    permissions.splice(index, 1);
    try {
      assert.equal((await decide(approvalId)).status, 403);
    } finally {
      permissions.splice(index, 0, permission);
    }
    await assertOutcome(id, approvalId, 'pending');
  });
}

test('approval refuses dates outside the exact enrollment or period and never fabricates attendance', async () => {
  const early = await pending(addScheduleDays(state.today, -2), state.today);
  assert.equal((await decide(early.approvalId)).status, 409);
  assert.equal((await decide(early.approvalId, body('reject'))).status, 409);
  await assertOutcome(early.id, early.approvalId, 'pending');
  const far = await pending(
    addScheduleDays(state.today, 29),
    addScheduleDays(state.today, 31),
  );
  assert.equal((await decide(far.approvalId)).status, 409);
  await assertOutcome(far.id, far.approvalId, 'pending');
  assert.equal(await AttendanceSession.countDocuments(), 0);
});

async function teacherOccurrence() {
  const { period, session } = await seedOccurrence();
  await SubstituteAssignment.deleteMany({});
  await put(TeacherAssignment, {
    teacherId: period.teacherId,
    branchId: state.branch._id,
    classId: period.classId,
    sectionId: period.sectionId,
    subjectId: period.subjectId,
    isActive: true,
    validFrom: new Date(Date.now() - 86_400_000),
  });
  await AttendanceSession.collection.updateOne(
    { _id: session._id },
    {
      $set: {
        subjectId: period.subjectId,
        responsibleTeacherId: period.teacherId,
        submittedBy: period.teacherId,
        submittedAt: new Date(),
        rosterVersion: 'test-roster',
      },
    },
  );
  const teacher = generateAccessToken(String(period.teacherId), 'teacher');
  await registerSession(String(period.teacherId), teacher, 'teacher');
  const attendance = `/teacher/attendance/sessions/${session._id}/students/${state.student._id}`;
  return {
    teacher,
    teacherId: String(period.teacherId),
    sessionId: String(session._id),
    attendance,
    create: () =>
      apiHttp(`${attendance}/leaves`, teacher, {
        fromDate: state.today,
        untilDate: state.today,
        category: 'other',
        reason: 'Teacher verified this leave request',
        clientOperationId: String(oid()),
      }),
  };
}

test('Teacher-origin pending and approved leave block Parent submission atomically', async () => {
  const { create } = await teacherOccurrence();
  const teacherLeave = await create();
  assert.equal(teacherLeave.status, 200, JSON.stringify(teacherLeave.json));
  const draftId = await draft();
  assert.equal((await submit(draftId)).status, 409);
  const reviewed = await apiHttp(
    `/attendance-review/${teacherLeave.json.data.approvalId}/decision`,
    token,
    {
      action: 'approved',
      reviewNote: '',
      revision: 0,
      clientOperationId: String(oid()),
    },
  );
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.json));
  assert.equal((await submit(draftId)).status, 409);
  assert.equal(
    (await ParentLeaveApplication.findById(draftId).lean())!.state,
    'draft',
  );
});

test('pending Parent reservation blocks Teacher leave but not an unrelated attendance correction', async () => {
  const { create, attendance, teacher } = await teacherOccurrence();
  await pending();
  assert.equal((await create()).status, 409);
  const correction = await apiHttp(`${attendance}/corrections`, teacher, {
    requestedStatus: 'late',
    reason: 'Teacher confirmed a late arrival',
    submittedRevision: 1,
    effectiveRevision: 0,
    clientOperationId: String(oid()),
  });
  assert.equal(correction.status, 200, JSON.stringify(correction.json));
});

test('both reviewers block a pre-existing conflict without changing either pending decision', async () => {
  const { create } = await teacherOccurrence();
  const teacherLeave = await create();
  assert.equal(teacherLeave.status, 200, JSON.stringify(teacherLeave.json));
  const tomorrow = addScheduleDays(state.today, 1);
  const { id, approvalId } = await pending(tomorrow, tomorrow);
  await StudentLeave.collection.updateOne(
    { origin: 'teacher_occurrence' },
    { $set: { untilDate: tomorrow } },
  );
  assert.equal((await decide(approvalId)).status, 409);
  const review = await apiHttp(
    `/attendance-review/${teacherLeave.json.data.approvalId}/decision`,
    token,
    {
      action: 'approved',
      reviewNote: '',
      revision: 0,
      clientOperationId: String(oid()),
    },
  );
  assert.equal(review.status, 409);
  await assertOutcome(id, approvalId, 'pending');
  assert.equal(
    await StudentLeave.countDocuments({
      origin: 'teacher_occurrence',
      state: 'pending',
    }),
    1,
  );
});

test('exact Parent coverage is visible in Teacher review and usable by the canonical correction path', async () => {
  const { create, attendance, teacher } = await teacherOccurrence();
  const record = await pending();
  assert.equal((await decide(record.approvalId)).status, 200);
  assert.equal((await create()).status, 409);
  const coverage = await StudentLeave.findOne({ origin: 'parent_application' })
    .orFail()
    .lean();
  const review = await apiHttp(`${attendance}/review`, teacher);
  assert.equal(review.status, 200, JSON.stringify(review.json));
  assert.equal(review.json.data.approvedLeaveId, String(coverage._id));
  assert.doesNotMatch(
    JSON.stringify(review.json),
    /Private family medical|parentApplicationId|fingerprint/,
  );
  const correction = await apiHttp(`${attendance}/corrections`, teacher, {
    requestedStatus: 'leave',
    reason: 'Leave correction requested after review',
    submittedRevision: 1,
    effectiveRevision: review.json.data.effective.effectiveRevision,
    leaveId: String(coverage._id),
    clientOperationId: String(oid()),
  });
  assert.equal(correction.status, 200, JSON.stringify(correction.json));
  assert.equal(
    await PeriodAttendanceRecord.countDocuments({ status: 'leave' }),
    0,
  );
});

test('future scheduled occurrence displays coverage and leaves its roster unmarked', async () => {
  await teacherOccurrence();
  const source = await AttendanceSession.findOne().orFail().lean();
  const futureDate = addScheduleDays(state.today, 7);
  const record = await pending(state.today, futureDate);
  assert.equal((await decide(record.approvalId)).status, 200);
  const view = await apiHttp(
    `/principal/attendance/occurrences/${source.periodId}?date=${futureDate}`,
    token,
  );
  assert.equal(view.status, 200, JSON.stringify(view.json));
  const row = view.json.data.students.find(
    (student: { studentId: string }) =>
      student.studentId === String(state.student._id),
  );
  assert.ok(row, JSON.stringify(view.json));
  assert.equal(row.approvedLeave, true);
  assert.equal(row.status, null);
  assert.deepEqual(view.json.data.amendments, []);
  assert.equal(await AttendanceSession.countDocuments({ date: futureDate }), 0);
});

test('historical submitted coverage stays pinned to its old enrollment after a same-tuple transfer', async () => {
  await teacherOccurrence();
  const source = await AttendanceSession.findOne().orFail().lean();
  const historical = addScheduleDays(state.today, -7);
  await TimetableVersion.collection.updateOne(
    { _id: source.timetableVersionId },
    { $set: { effectiveFrom: historical } },
  );
  await AttendanceSession.collection.updateOne(
    { _id: source._id },
    { $set: { date: historical } },
  );
  await StudentEnrollment.collection.updateOne(
    { _id: state.enrollment._id },
    { $set: { effectiveFrom: new Date(Date.now() - 10 * 86_400_000) } },
  );
  const record = await pending(historical, state.today);
  assert.equal((await decide(record.approvalId)).status, 200);
  await StudentEnrollment.updateOne(
    { _id: state.enrollment._id },
    { status: 'transferred', effectiveTo: new Date() },
  );
  await put(StudentEnrollment, {
    ...state.enrollment,
    _id: oid(),
    effectiveFrom: new Date(Date.now() - 1),
  });
  for (const [date, covered, expectedMark] of [
    [historical, true, 'present'],
    [state.today, false, null],
  ] as const) {
    const view = await apiHttp(
      `/principal/attendance/occurrences/${source.periodId}?date=${date}`,
      token,
    );
    assert.equal(view.status, 200, JSON.stringify(view.json));
    const row = view.json.data.students.find(
      (student: { studentId: string }) =>
        student.studentId === String(state.student._id),
    );
    assert.ok(row, JSON.stringify(view.json));
    assert.equal(row.approvedLeave, covered);
    assert.equal(row.status, expectedMark);
  }
});

test('concurrent Parent submission and Teacher reservation produce one winner under the Branch lock', async () => {
  const { create } = await teacherOccurrence();
  const id = await draft();
  const results = await Promise.all([submit(id), create()]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(
    (await ParentLeaveApplication.countDocuments({ state: 'pending' })) +
      (await StudentLeave.countDocuments({ state: 'pending' })),
    1,
  );
});

test('policy revocation before transaction completion rolls back all linked effects', async () => {
  const { id, approvalId } = await pending();
  const insert = ParentLeaveDecisionOperation.collection.insertOne.bind(
    ParentLeaveDecisionOperation.collection,
  );
  mock.method(
    ParentLeaveDecisionOperation.collection,
    'insertOne',
    async (...args: Parameters<typeof insert>) => {
      const result = await insert(...args);
      process.env[keys[1]] = '{}';
      return result;
    },
  );
  assert.equal((await decide(approvalId)).status, 404);
  await assertOutcome(id, approvalId, 'pending');
});

for (const dependency of ['session', 'enrollment'] as const) {
  test(`${dependency} revocation after Branch lock prevents stale commit`, async () => {
    const { id, approvalId } = await pending();
    const update = Branch.collection.updateOne.bind(Branch.collection);
    let observed = false;
    mock.method(
      Branch.collection,
      'updateOne',
      async (...args: Parameters<typeof update>) => {
        const result = await update(...args);
        if (
          !observed &&
          args[2]?.session?.inTransaction() &&
          result.matchedCount
        ) {
          observed = true;
          if (dependency === 'session')
            await Session.updateMany({ token }, { isRevoked: true });
          else
            await StudentEnrollment.updateOne(
              { _id: state.enrollment._id },
              { status: 'transferred', effectiveTo: new Date() },
            );
        }
        return result;
      },
    );
    assert.equal(
      (await decide(approvalId)).status,
      dependency === 'session' ? 401 : 404,
    );
    assert.ok(observed);
    await assertOutcome(id, approvalId, 'pending');
  });
}

for (const model of [
  ParentLeaveApplication,
  ApprovalRequest,
  StudentLeave,
  ParentLeaveDecisionOperation,
]) {
  test(`failure at ${model.collection.name} rolls back the whole decision`, async () => {
    const { id, approvalId } = await pending();
    if (model === ParentLeaveApplication || model === ApprovalRequest) {
      mock.method(model.collection, 'updateOne', async () => {
        throw new Error('Injected linked failure');
      });
    } else {
      mock.method(model.collection, 'insertOne', async () => {
        throw new Error('Injected linked failure');
      });
    }
    assert.equal((await decide(approvalId)).status, 500);
    mock.restoreAll();
    await assertOutcome(id, approvalId, 'pending');
    assert.equal((await decide(approvalId)).status, 200);
    await assertOutcome(id, approvalId, 'approved');
  });
}

type WorkerResult = {
  event: 'result';
  status: number;
  replayed?: boolean;
  message?: string;
};

function worker(
  record: { id: string; approvalId: string },
  action: DecisionWorkerInput['action'],
  operationId: string,
  hold: boolean,
  reviewer = { userId: String(parentState.verifier._id), token },
  payload?: Record<string, unknown>,
) {
  const client = mongoose.connection.getClient();
  const input: DecisionWorkerInput = {
    uri: `mongodb://${client.options.hosts.join(',')}/?replicaSet=${
      client.options.replicaSet
    }`,
    dbName: mongoose.connection.name,
    applicationId: record.id,
    approvalId: record.approvalId,
    studentId: String(state.student._id),
    branchId: String(state.branch._id),
    action,
    operationId,
    hold,
    payload: payload ?? (action === 'resubmit' ? revisionFields() : undefined),
    ...(action === 'withdraw' || action === 'resubmit'
      ? { userId: String(parentState.parent._id), token: parentState.token }
      : reviewer),
  };
  const processWorker = fork(
    fileURLToPath(
      new URL('./helpers/parent-leave-decision-worker.ts', import.meta.url),
    ),
    [],
    {
      execArgv: ['--import', 'tsx'],
      env: { ...process.env, G3B_WORKER_INPUT: JSON.stringify(input) },
    },
  );
  const seen = new Set<string>();
  let result: WorkerResult | undefined;
  processWorker.on('message', (event: { event?: string }) => {
    if (event.event) seen.add(event.event);
    if (event.event === 'result') result = event as WorkerResult;
  });
  const until = async (event: string) => {
    while (!seen.has(event)) {
      if (processWorker.exitCode !== null || processWorker.signalCode)
        throw new Error(`Worker exited before ${event}`);
      await Promise.race([
        once(processWorker, 'message'),
        once(processWorker, 'exit').then(() => {
          throw new Error(`Worker exited before ${event}`);
        }),
      ]);
    }
  };
  const complete = once(processWorker, 'exit').then(([code]) => {
    assert.equal(code, 0);
    assert.ok(result);
    return result;
  });
  complete.catch(() => undefined);
  return {
    until,
    complete,
    release: () => processWorker.send('release'),
    terminate: () => processWorker.kill(),
  };
}

async function orderedRace(
  record: { id: string; approvalId: string },
  firstAction: DecisionWorkerInput['action'],
  secondAction: DecisionWorkerInput['action'],
  sameOperation = false,
  secondReviewer?: { userId: string; token: string },
) {
  const first = worker(record, firstAction, 'first-race', true);
  let second: ReturnType<typeof worker> | undefined;
  try {
    await first.until('locked');
    second = worker(
      record,
      secondAction,
      sameOperation ? 'first-race' : 'second-race',
      false,
      secondReviewer,
    );
    await second.until('attempting');
    first.release();
    return await Promise.all([first.complete, second.complete]);
  } finally {
    first.terminate();
    second?.terminate();
  }
}

for (const action of ['approve', 'reject'] as const) {
  for (const withdrawFirst of [true, false]) {
    test(
      `independent processes ${action} versus withdrawal, ${
        withdrawFirst ? 'withdrawal' : 'decision'
      } owns Branch lock first`,
      { timeout: 30000 },
      async () => {
        const record = await pending();
        const [winner, loser] = await orderedRace(
          record,
          withdrawFirst ? 'withdraw' : action,
          withdrawFirst ? action : 'withdraw',
        );
        assert.equal(winner.status, 200, winner.message);
        assert.equal(loser.status, 409, loser.message);
        const expected = withdrawFirst
          ? 'withdrawn'
          : action === 'approve'
          ? 'approved'
          : 'rejected';
        const { application, approval } = await assertOutcome(
          record.id,
          record.approvalId,
          expected,
        );
        assert.equal(application.history.length, 3);
        assert.equal(approval.history.length, 2);
        assert.equal(await AttendanceSession.countDocuments(), 0);
      },
    );
  }
}

test(
  'simultaneous approvals in independent processes acknowledge exactly one persisted receipt',
  { timeout: 30000 },
  async () => {
    const record = await pending();
    const results = await orderedRace(record, 'approve', 'approve', true);
    assert.deepEqual(
      results.map(item => [item.status, item.replayed]),
      [
        [200, false],
        [200, true],
      ],
    );
    await assertOutcome(record.id, record.approvalId, 'approved');
  },
);

test('G3c protects existing physical attendance and fails closed on generic access or invalid revised dates', async () => {
  await teacherOccurrence();
  const marks = await PeriodAttendanceRecord.find().sort({ _id: 1 }).lean();
  const sessions = await AttendanceSession.find().sort({ _id: 1 }).lean();
  const record = await returned();
  assert.equal(
    (await apiHttp(`/approval-requests/${record.approvalId}`, token)).status,
    403,
  );
  assert.equal(
    (
      await apiHttp(
        `/approval-requests/${record.approvalId}/eligible-delegates`,
        token,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await apiHttp(
        `/approval-requests/${record.approvalId}/resubmission`,
        parentState.token,
      )
    ).status,
    403,
  );
  assert.equal((await resubmit(record.id, revisionFields(-5))).status, 409);
  assert.equal(
    (await ParentLeaveApplication.findById(record.id).orFail()).startDate,
    state.today,
  );
  assert.equal((await resubmit(record.id)).status, 200);
  assert.deepEqual(
    await PeriodAttendanceRecord.find().sort({ _id: 1 }).lean(),
    marks,
  );
  assert.deepEqual(
    await AttendanceSession.find().sort({ _id: 1 }).lean(),
    sessions,
  );
  assert.equal(await StudentLeave.countDocuments(), 0);
  assert.equal(await Notification.countDocuments(), 0);
});

for (const opponent of [
  'approve',
  'reject',
  'withdraw',
  'request_changes',
] as const) {
  for (const returnFirst of opponent === 'request_changes'
    ? [true]
    : [true, false]) {
    test(
      `G3c independent request-changes versus ${opponent}, return first: ${returnFirst}`,
      { timeout: 30000 },
      async () => {
        const record = await pending();
        const [winner, loser] = await orderedRace(
          record,
          returnFirst ? 'request_changes' : opponent,
          returnFirst ? opponent : 'request_changes',
        );
        assert.equal(winner.status, 200, winner.message);
        assert.equal(loser.status, 409, loser.message);
        const expected = returnFirst
          ? 'changes_requested'
          : {
              approve: 'approved',
              reject: 'rejected',
              withdraw: 'withdrawn',
              request_changes: 'changes_requested',
            }[opponent];
        const approval = await ApprovalRequest.findById(record.approvalId)
          .orFail()
          .lean();
        const application = await ParentLeaveApplication.findById(record.id)
          .orFail()
          .lean();
        assert.equal(approval.status, expected);
        assert.equal(application.state, expected);
        assert.equal(approval.history.length, 2);
        assert.equal(application.history.length, 3);
        assert.equal(
          await StudentLeave.countDocuments(),
          expected === 'approved' ? 1 : 0,
        );
      },
    );
  }
}

for (const duplicate of [true, false]) {
  test(
    `G3c independent Parent resubmissions, identical operation: ${duplicate}`,
    { timeout: 30000 },
    async () => {
      const record = await returned();
      const [winner, loser] = await orderedRace(
        record,
        'resubmit',
        'resubmit',
        duplicate,
      );
      assert.equal(winner.status, 200, winner.message);
      assert.equal(loser.status, duplicate ? 200 : 409, loser.message);
      if (duplicate) assert.equal(loser.replayed, true);
      assert.equal(
        await ParentLeaveOperation.countDocuments({ kind: 'resubmit' }),
        1,
      );
      const latest = await ParentLeaveApplication.findById(record.id)
        .select('+priorSubmissions')
        .orFail()
        .lean();
      assert.equal(latest.revision, 3);
      assert.equal(latest.priorSubmissions?.length, 1);
    },
  );
}

async function waitForOverlap(
  first: ReturnType<typeof worker>,
  next: () => ReturnType<typeof worker>,
) {
  let second: ReturnType<typeof worker> | undefined;
  try {
    await first.until('locked');
    second = next();
    await second.until('attempting');
    first.release();
    const [winner, loser] = await Promise.all([
      first.complete,
      second.complete,
    ]);
    assert.equal(winner.status, 200, winner.message);
    assert.equal(loser.status, 409, loser.message);
  } finally {
    first.terminate();
    second?.terminate();
  }
}

for (const resubmitFirst of [true, false]) {
  test(
    `G3c resubmission versus another verified guardian's submission, resubmit first: ${resubmitFirst}`,
    { timeout: 30000 },
    async () => {
      const record = await returned();
      await ParentStudentLink.create({
        branchId: state.branch._id,
        studentId: state.student._id,
        parentUserId: parentState.otherParent._id,
        relationship: 'guardian',
        status: 'verified',
        isActive: true,
        verifiedBy: parentState.verifier._id,
        createdBy: parentState.verifier._id,
        verifiedAt: new Date(),
      });
      assert.equal(
        (await resubmit(record.id, revisionFields(), parentState.otherToken))
          .status,
        404,
      );
      const revised = revisionFields();
      const other = await apiHttp(root(), parentState.otherToken, {
        leaveType: revised.leaveType,
        startDate: revised.startDate,
        endDate: revised.endDate,
        reason: 'Another guardian applies for the same dates',
        clientOperationId: 'other-guardian-draft',
      });
      assert.equal(other.status, 200);
      const guardian = (hold: boolean) =>
        worker(
          { id: other.json.data.applicationId, approvalId: '' },
          'submit',
          'other-guardian-submit',
          hold,
          {
            userId: String(parentState.otherParent._id),
            token: parentState.otherToken,
          },
        );
      const parent = (hold: boolean) =>
        worker(record, 'resubmit', 'replace-reservation', hold);
      await waitForOverlap(resubmitFirst ? parent(true) : guardian(true), () =>
        resubmitFirst ? guardian(false) : parent(false),
      );
      const current = await ParentLeaveApplication.findById(record.id)
        .orFail()
        .lean();
      assert.equal(
        current.state,
        resubmitFirst ? 'pending' : 'changes_requested',
      );
      assert.equal(
        current.startDate,
        resubmitFirst ? revised.startDate : state.today,
      );
    },
  );

  test(
    `G3c resubmission versus Teacher leave creation, resubmit first: ${resubmitFirst}`,
    { timeout: 30000 },
    async () => {
      const occurrence = await teacherOccurrence();
      const originalStart = addScheduleDays(state.today, 4);
      const record = await returned(
        originalStart,
        addScheduleDays(originalStart, 1),
      );
      const teacher = (hold: boolean) =>
        worker(
          { id: occurrence.sessionId, approvalId: '' },
          'teacher_leave',
          String(oid()),
          hold,
          { userId: occurrence.teacherId, token: occurrence.teacher },
          {
            fromDate: state.today,
            untilDate: state.today,
            reason: 'Teacher requested leave for the student',
            category: 'other',
          },
        );
      const parent = (hold: boolean) =>
        worker(
          record,
          'resubmit',
          'replace-reservation',
          hold,
          undefined,
          revisionFields(0),
        );
      await waitForOverlap(resubmitFirst ? parent(true) : teacher(true), () =>
        resubmitFirst ? teacher(false) : parent(false),
      );
      const current = await ParentLeaveApplication.findById(record.id)
        .orFail()
        .lean();
      assert.equal(
        current.startDate,
        resubmitFirst ? state.today : originalStart,
      );
      assert.equal(
        await StudentLeave.countDocuments({ origin: 'teacher_occurrence' }),
        resubmitFirst ? 0 : 1,
      );
      assert.equal(
        await StudentLeave.countDocuments({ origin: 'parent_application' }),
        0,
      );
    },
  );
}

for (const revoke of ['enrollment', 'link'] as const) {
  test(
    `G3c resubmission fails on committed ${revoke} revocation during the Branch-locked attempt`,
    { timeout: 30000 },
    async () => {
      const record = await returned();
      const child = worker(record, 'resubmit', 'revocation-race', true);
      try {
        await child.until('locked');
        if (revoke === 'link')
          await ParentStudentLink.updateOne(
            { _id: parentState.link._id },
            { status: 'revoked', isActive: false },
          );
        else
          await StudentEnrollment.updateOne(
            { _id: state.enrollment._id },
            { status: 'transferred', effectiveTo: new Date() },
          );
        child.release();
        const result = await child.complete;
        assert.equal(result.status, 404, result.message);
        assert.equal(
          (await ApprovalRequest.findById(record.approvalId).orFail()).status,
          'changes_requested',
        );
        assert.equal(
          (await ParentLeaveApplication.findById(record.id).orFail()).startDate,
          state.today,
        );
        assert.equal(
          await ParentLeaveOperation.countDocuments({ kind: 'resubmit' }),
          0,
        );
      } finally {
        child.terminate();
      }
    },
  );
}

for (const kind of ['request_changes', 'resubmit'] as const) {
  for (const write of ['application', 'approval', 'receipt'] as const) {
    test(`G3c ${kind} rolls back linked writes and reservation when ${write} fails`, async () => {
      const record = kind === 'resubmit' ? await returned() : await pending();
      const collection =
        write === 'application'
          ? ParentLeaveApplication.collection
          : write === 'approval'
          ? ApprovalRequest.collection
          : kind === 'resubmit'
          ? ParentLeaveOperation.collection
          : ParentLeaveDecisionOperation.collection;
      mock.method(
        collection,
        write === 'receipt' ? 'insertOne' : 'updateOne',
        async () => {
          throw new Error('injected linked write failure');
        },
      );
      const result =
        kind === 'resubmit'
          ? await resubmit(record.id)
          : await decide(record.approvalId, body('request_changes'));
      assert.equal(result.status, 500);
      const expected = kind === 'resubmit' ? 'changes_requested' : 'pending';
      const application = await ParentLeaveApplication.findById(record.id)
        .select('+priorSubmissions')
        .orFail()
        .lean();
      assert.equal(application.state, expected);
      assert.equal(application.startDate, state.today);
      assert.equal(application.priorSubmissions?.length ?? 0, 0);
      const approval = await ApprovalRequest.findById(record.approvalId)
        .orFail()
        .lean();
      assert.equal(approval.status, expected);
      assert.equal(approval.history.length, kind === 'resubmit' ? 2 : 1);
      assert.equal(
        await ParentLeaveOperation.countDocuments({ kind: 'resubmit' }),
        0,
      );
      assert.equal(
        await ParentLeaveDecisionOperation.countDocuments(),
        kind === 'resubmit' ? 1 : 0,
      );
      assert.equal(await StudentLeave.countDocuments(), 0);
    });
  }
}

test('G3c pinned routing version blocks resubmit, and revoked ownership blocks later receipt replay', async () => {
  const record = await returned();
  process.env[keys[0]] = routing(8);
  assert.equal((await resubmit(record.id)).status, 409);
  assert.equal(
    (await ParentLeaveApplication.findById(record.id).orFail()).state,
    'changes_requested',
  );
  process.env[keys[0]] = routing();
  assert.equal((await resubmit(record.id)).status, 200);
  await ParentStudentLink.updateOne(
    { _id: parentState.link._id },
    { status: 'revoked', isActive: false },
  );
  assert.equal((await resubmit(record.id)).status, 404);
  assert.equal(
    (await decide(record.approvalId, body('request_changes', 'return-first')))
      .status,
    404,
  );
});

const revisionFields = (
  offset = 4,
  revision = 2,
  operation = 'parent-resubmit',
) => ({
  leaveType: 'Revised family leave',
  startDate: addScheduleDays(state.today, offset),
  endDate: addScheduleDays(state.today, offset + 1),
  reason: 'Revised private submitted evidence',
  applicationRevision: revision,
  approvalVersion: revision - 1,
  clientOperationId: operation,
});
const resubmit = (
  id: string,
  fields: unknown = revisionFields(),
  parent = parentState.token,
) => apiHttp(`${root()}/${id}/resubmit`, parent, fields);
async function returned(startDate?: string, endDate?: string) {
  const record = await pending(startDate, endDate);
  const result = await decide(
    record.approvalId,
    body('request_changes', 'return-first'),
  );
  assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.equal(result.json.data.state, 'changes_requested');
  return record;
}

for (const finalAction of ['approve', 'reject'] as const) {
  test(`G3c retains both IDs and immutable evidence through resubmission and ${finalAction}`, async () => {
    const { id, approvalId } = await returned();
    const detail = await apiHttp(`${root()}/${id}`, parentState.token);
    assert.deepEqual(detail.json.data.resubmitVersion, {
      applicationRevision: 2,
      approvalVersion: 1,
    });
    assert.equal(detail.json.data.history.at(-1).decisionReason, publicReason);
    const principal = await apiHttp(`${reviewPath}/${approvalId}`, token);
    assert.equal(principal.json.data.status, 'changes_requested');
    assert.equal(principal.json.data.decisionVersion, null);
    assert.equal(
      (await apiHttp('/principal/dashboard', token)).json.data
        .pendingParentLeaveCount,
      0,
    );
    assert.equal(await StudentLeave.countDocuments(), 0);
    assert.equal((await submit(await draft())).status, 409);
    assert.equal(
      (await resubmit(id, { ...revisionFields(), reviewerId: oid() })).status,
      400,
    );
    assert.equal(
      (await resubmit(id, revisionFields(), parentState.otherToken)).status,
      404,
    );
    const result = await resubmit(id);
    assert.equal(result.status, 200, JSON.stringify(result.json));
    assert.equal(result.json.data.application.applicationId, id);
    assert.equal(result.json.data.operationCycle, 2);
    assert.equal(result.json.data.operationRevision, 3);
    assert.equal(result.json.data.application.state, 'pending');
    const [cycle] = result.json.data.application.priorCycles;
    assert.equal(cycle.reason, privateReason);
    assert.equal(cycle.decisionReason, publicReason);
    assert.equal(cycle.revision, 1);
    assert.ok(!('fingerprint' in cycle));
    assert.equal((await submit(await draft())).status, 200);
    const list = await apiHttp(reviewPath, token);
    assert.ok(
      list.json.data.requests.some(
        (item: { approvalId: string }) => item.approvalId === approvalId,
      ),
    );
    assert.doesNotMatch(
      JSON.stringify(list.json),
      /Private family medical|Revised private submitted evidence/,
    );
    const oldDecision = await decide(
      approvalId,
      body('request_changes', 'return-first'),
    );
    assert.equal(oldDecision.json.data.state, 'changes_requested');
    assert.equal(oldDecision.json.data.replayed, true);
    assert.equal((await decide(approvalId, body(finalAction))).status, 409);
    const oldReceipt = await resubmit(id);
    assert.equal(oldReceipt.json.data.operationRevision, 3);
    assert.equal(oldReceipt.json.data.replayed, true);
    assert.equal(
      (
        await resubmit(id, {
          ...revisionFields(),
          reason: 'Different private payload',
        })
      ).status,
      409,
    );
    const actual = await decide(approvalId, {
      ...body(finalAction),
      applicationRevision: 3,
      approvalVersion: 2,
    });
    assert.equal(actual.status, 200, JSON.stringify(actual.json));
    const approval = await ApprovalRequest.findById(approvalId).orFail().lean();
    assert.equal(String(approval.entityId), id);
    assert.equal(approval.parentLeaveRevision, 3);
    assert.deepEqual(
      approval.history.map(event => event.action),
      [
        'submitted',
        'changes_requested',
        'resubmitted',
        finalAction === 'approve' ? 'approved' : 'rejected',
      ],
    );
    assert.doesNotMatch(
      JSON.stringify(approval),
      /Private family medical|Revised private submitted evidence/,
    );
    assert.equal(
      await StudentLeave.countDocuments({ parentApplicationId: id }),
      finalAction === 'approve' ? 1 : 0,
    );
    assert.equal(await PeriodAttendanceRecord.countDocuments(), 0);
    assert.equal(await Notification.countDocuments(), 0);
  });
}

test('G3c repeated returns preserve earlier cycles, receipts, and G2b withdrawal', async () => {
  const { id, approvalId } = await returned();
  assert.equal((await resubmit(id)).status, 200);
  assert.equal(
    (
      await decide(approvalId, {
        ...body('request_changes', 'return-second'),
        applicationRevision: 3,
        approvalVersion: 2,
      })
    ).status,
    200,
  );
  const later = await resubmit(
    id,
    revisionFields(8, 4, 'parent-resubmit-second'),
  );
  assert.equal(later.status, 200, JSON.stringify(later.json));
  assert.equal(later.json.data.operationCycle, 3);
  assert.deepEqual(
    later.json.data.application.priorCycles.map(
      (entry: { revision: number }) => entry.revision,
    ),
    [1, 3],
  );
  const replay = await resubmit(id);
  assert.equal(replay.status, 200);
  assert.equal(replay.json.data.operationCycle, 2);
  assert.equal(replay.json.data.application.revision, 5);
  const withdrawn = await apiHttp(
    `${root()}/${id}/withdraw`,
    parentState.token,
    { revision: 5, clientOperationId: 'cycle-three-withdraw' },
  );
  assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.json));
  assert.equal(withdrawn.json.data.application.state, 'withdrawn');
  assert.equal(await ApprovalRequest.countDocuments(), 1);
  assert.equal(await StudentLeave.countDocuments(), 0);
  const archive = await ParentLeaveApplication.findById(id)
    .select('+priorSubmissions +submission +reason')
    .orFail();
  archive.priorSubmissions![0].reason = 'attempted rewrite';
  await assert.rejects(archive.validate(), /immutable|history/);
});

test(
  'two different Principals cannot commit competing decisions',
  { timeout: 30000 },
  async () => {
    const record = await pending();
    const second = await put(User, {
      role: 'principal',
      isActive: true,
      branchId: state.branch._id,
    });
    const secondToken = generateAccessToken(String(second._id), 'principal');
    await registerSession(String(second._id), secondToken, 'principal');
    process.env[keys[1]] = JSON.stringify({
      ...JSON.parse(grant()),
      [String(second._id)]: {
        branchId: String(state.branch._id),
        types: ['leave'],
      },
    });
    const results = await orderedRace(record, 'approve', 'reject', false, {
      userId: String(second._id),
      token: secondToken,
    });
    assert.deepEqual(
      results.map(item => item.status),
      [200, 409],
    );
    await assertOutcome(record.id, record.approvalId, 'approved');
  },
);
