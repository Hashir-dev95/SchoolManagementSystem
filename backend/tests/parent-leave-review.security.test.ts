import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, test } from 'node:test';
import { Types } from 'mongoose';
import { PERMISSIONS } from '../src/constants/permissions';
import { ROLE_PERMISSIONS } from '../src/constants/rolePermissions';
import ApprovalRequest from '../src/models/approvalRequest';
import {
  AttendanceCorrection,
  StudentLeave,
} from '../src/models/attendanceAmendment';
import {
  ParentLeaveApplication,
  ensureParentLeaveApplicationIndexes,
} from '../src/models/parentLeaveApplication';
import { ParentLeaveOperation } from '../src/models/parentLeaveOperation';
import { ParentStudentLink } from '../src/models/parentStudentLink';
import {
  AttendanceSession,
  PeriodAttendanceRecord,
} from '../src/models/periodAttendance';
import Session from '../src/models/session';
import { StudentEnrollment } from '../src/models/studentEnrollment';
import User from '../src/models/user';
import { generateAccessToken } from '../src/services/jwt.service';
import { registerSession } from '../src/services/session.service';
import {
  oid,
  parentState,
  put,
  state,
} from './helpers/parent-workspace.fixture';
import { apiHttp } from './helpers/student-workspace.fixture';

const reviewPath = '/principal/parent-leave-reviews';
const dashboardPath = '/principal/dashboard';
const privateReason = 'Private medical details for authorized review';
const routingKey = 'PARENT_LEAVE_ROUTING_POLICY';
const grantKey = 'PRINCIPAL_APPROVAL_AUTHORITY';
const previousEnv = new Map(
  [routingKey, grantKey].map(key => [key, process.env[key]]),
);
let token: string;
let applicationId: string;
let approvalId: string;
const objectId = (value: string) => new Types.ObjectId(value);

const routing = (version = 7) =>
  JSON.stringify({
    policy: 'shared_branch_principal',
    version,
    enabled: true,
    branchIds: [String(state.branch._id), String(state.foreign._id)],
  });
const grant = (
  actorId = parentState.verifier._id,
  branchId = state.branch._id,
) =>
  JSON.stringify({
    [String(actorId)]: { branchId: String(branchId), types: ['leave'] },
  });

before(ensureParentLeaveApplicationIndexes);
beforeEach(async () => {
  process.env[routingKey] = routing();
  process.env[grantKey] = grant();
  token = generateAccessToken(String(parentState.verifier._id), 'principal');
  await registerSession(String(parentState.verifier._id), token, 'principal');
  const path = `/parent/me/children/${state.student._id}/leave-applications`;
  const draft = await apiHttp(path, parentState.token, {
    leaveType: 'Medical leave',
    startDate: '2026-11-04',
    endDate: '2026-11-06',
    reason: privateReason,
    clientOperationId: 'g3a-draft',
  });
  assert.equal(draft.status, 200);
  applicationId = draft.json.data.applicationId;
  const submission = await apiHttp(
    `${path}/${applicationId}/submit`,
    parentState.token,
    {
      revision: 0,
      clientOperationId: 'g3a-submit',
    },
  );
  assert.equal(submission.status, 200);
  const approval = await ApprovalRequest.findOne({ entityId: applicationId })
    .orFail()
    .lean();
  approvalId = String(approval._id);
});
afterEach(() => {
  for (const [key, value] of previousEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function concealed(reader = token) {
  const queue = await apiHttp(reviewPath, reader);
  assert.equal(queue.status, 200);
  assert.deepEqual(queue.json.data.requests, []);
  const detail = await apiHttp(`${reviewPath}/${approvalId}`, reader);
  assert.equal(detail.status, 404);
  assert.equal(detail.json.data, undefined);
  const dashboard = await apiHttp(dashboardPath, reader);
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.json.data.pendingApprovals.byType.leave, 0);
  assert.equal(dashboard.json.data.pendingApprovals.total, 0);
  assert.equal(dashboard.json.data.pendingParentLeaveCount, 0);
}

test('authorized pending queue, detail and dashboard agree with private allowlists and no writes', async () => {
  const beforeApplication = await ParentLeaveApplication.collection.findOne({
    _id: objectId(applicationId),
  });
  const beforeApproval = await ApprovalRequest.collection.findOne({
    _id: objectId(approvalId),
  });
  assert.equal(
    (await apiHttp(`${reviewPath}/${approvalId}`, parentState.token)).status,
    403,
  );
  // School review depends on the persisted relationship, even when the owner is signed out.
  await Session.updateMany(
    { userId: parentState.parent._id },
    { isRevoked: true },
  );
  const queue = await apiHttp(reviewPath, token);
  const dashboard = await apiHttp(dashboardPath, token);
  const detail = await apiHttp(`${reviewPath}/${approvalId}`, token);
  assert.equal(queue.status, 200);
  assert.equal(detail.status, 200);
  assert.equal(dashboard.status, 200);
  const [summary] = queue.json.data.requests;
  assert.equal(queue.json.data.requests.length, 1);
  assert.deepEqual(summary, {
    approvalId,
    source: 'parent_leave_application',
    studentName: 'Student One',
    startDate: '2026-11-04',
    endDate: '2026-11-06',
    status: 'pending',
    submittedAt: summary.submittedAt,
  });
  assert.deepEqual(detail.json.data, {
    ...summary,
    leaveType: 'Medical leave',
    reason: privateReason,
    history: [
      {
        action: 'draft_created',
        revision: 0,
        at: beforeApplication!.history[0].at.toISOString(),
      },
      { action: 'submitted', revision: 1, at: summary.submittedAt },
    ],
  });
  assert.equal(dashboard.json.data.pendingApprovals.byType.leave, 1);
  assert.equal(dashboard.json.data.pendingApprovals.total, 1);
  assert.equal(dashboard.json.data.pendingParentLeaveCount, 1);
  assert.doesNotMatch(
    JSON.stringify([queue.json, dashboard.json]),
    /Private medical|fingerprint|supportingFileUrl|parentStudentLinkId/,
  );
  assert.equal(
    (await apiHttp(`${reviewPath}/${approvalId}`, parentState.token)).status,
    401,
  );
  assert.equal(
    (
      await apiHttp(
        `${reviewPath}/${approvalId}` + '?branchId=' + state.foreign._id,
        token,
      )
    ).status,
    200,
  );
  assert.equal(
    (await apiHttp(`/approval-requests/${approvalId}`, token)).status,
    403,
  );
  assert.equal(
    (
      await apiHttp(
        `/approval-requests/${approvalId}/eligible-delegates`,
        token,
      )
    ).status,
    403,
  );
  const generic = await apiHttp('/approval-requests/pending', token);
  assert.deepEqual(generic.json.data.requests, []);
  assert.deepEqual(
    await ParentLeaveApplication.collection.findOne({
      _id: beforeApplication!._id,
    }),
    beforeApplication,
  );
  assert.deepEqual(
    await ApprovalRequest.collection.findOne({ _id: beforeApproval!._id }),
    beforeApproval,
  );
  assert.equal(await ParentLeaveOperation.countDocuments(), 1);
  for (const model of [
    AttendanceSession,
    PeriodAttendanceRecord,
    StudentLeave,
    AttendanceCorrection,
  ]) {
    assert.equal(await model.collection.countDocuments(), 0);
  }
});

test('approval view permission is required independently of the leave grant', async () => {
  const permissions = ROLE_PERMISSIONS.principal;
  const index = permissions.indexOf(PERMISSIONS.PRINCIPAL_APPROVALS_VIEW);
  assert.notEqual(index, -1);
  permissions.splice(index, 1);
  try {
    assert.equal((await apiHttp(reviewPath, token)).status, 403);
    assert.equal(
      (await apiHttp(`${reviewPath}/${approvalId}`, token)).status,
      403,
    );
    const dashboard = await apiHttp(dashboardPath, token);
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.json.data.pendingApprovals.total, 0);
    assert.equal(dashboard.json.data.pendingParentLeaveCount, 0);
  } finally {
    permissions.splice(index, 0, PERMISSIONS.PRINCIPAL_APPROVALS_VIEW);
  }
});

test('view-only Principal can read pending leave without approval manage permission', async () => {
  const permissions = ROLE_PERMISSIONS.principal;
  const index = permissions.indexOf(PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE);
  assert.notEqual(index, -1);
  permissions.splice(index, 1);
  try {
    assert.equal(
      (await apiHttp(reviewPath, token)).json.data.requests.length,
      1,
    );
    assert.equal(
      (await apiHttp(`${reviewPath}/${approvalId}`, token)).status,
      200,
    );
    assert.equal(
      (await apiHttp(dashboardPath, token)).json.data.pendingParentLeaveCount,
      1,
    );
  } finally {
    permissions.splice(index, 0, PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE);
  }
});

test('foreign Principal and valid foreign or unrelated approval IDs are concealed', async () => {
  const foreign = await put(User, {
    role: 'principal',
    branchId: state.foreign._id,
    isActive: true,
  });
  const foreignToken = generateAccessToken(String(foreign._id), 'principal');
  await registerSession(String(foreign._id), foreignToken, 'principal');
  process.env[grantKey] = grant(foreign._id, state.foreign._id);
  await concealed(foreignToken);
  process.env[grantKey] = grant();
  const unrelated = await put(ApprovalRequest, {
    branchId: state.branch._id,
    approvalType: 'leave',
    entityType: 'student_leave',
    status: 'pending',
  });
  assert.equal(
    (await apiHttp(`${reviewPath}/${unrelated._id}`, token)).status,
    404,
  );
  assert.equal((await apiHttp(`${reviewPath}/${oid()}`, token)).status, 404);
  assert.equal((await apiHttp(`${reviewPath}/invalid`, token)).status, 404);
});

for (const [name, change] of [
  ['revoked session', () => Session.updateOne({ token }, { isRevoked: true })],
  ['missing session', () => Session.deleteOne({ token })],
  [
    'changed role',
    () =>
      User.updateOne({ _id: parentState.verifier._id }, { role: 'teacher' }),
  ],
] as const) {
  test(`${name} rejects all three review reads`, async () => {
    await change();
    for (const url of [
      reviewPath,
      `${reviewPath}/${approvalId}`,
      dashboardPath,
    ]) {
      assert.equal((await apiHttp(url, token)).status, 401);
    }
  });
}

for (const [name, change] of [
  [
    'missing leave grant',
    () => {
      process.env[grantKey] = '{}';
    },
  ],
  [
    'missing routing policy',
    () => {
      delete process.env[routingKey];
    },
  ],
  [
    'invalid routing policy',
    () => {
      process.env[routingKey] = '{';
    },
  ],
  [
    'incompatible routing version',
    () => {
      process.env[routingKey] = routing(8);
    },
  ],
  [
    'changed Principal Branch',
    async () => {
      await User.updateOne(
        { _id: parentState.verifier._id },
        { branchId: state.foreign._id },
      );
      process.env[grantKey] = grant(
        parentState.verifier._id,
        state.foreign._id,
      );
    },
  ],
  [
    'revoked Parent link',
    () =>
      ParentStudentLink.updateOne(
        { _id: parentState.link._id },
        { status: 'revoked', isActive: false },
      ),
  ],
  [
    'unverified Parent link',
    () =>
      ParentStudentLink.updateOne(
        { _id: parentState.link._id },
        { status: 'pending' },
      ),
  ],
  [
    'replaced enrollment with the same academic tuple',
    async () => {
      const current = await StudentEnrollment.findOne({
        studentId: state.student._id,
      })
        .orFail()
        .lean();
      await StudentEnrollment.updateOne(
        { _id: current._id },
        { status: 'transferred', effectiveTo: new Date() },
      );
      await put(StudentEnrollment, {
        ...current,
        _id: oid(),
        effectiveTo: null,
      });
    },
  ],
  [
    'broken approval backlink',
    () => ApprovalRequest.updateOne({ _id: approvalId }, { entityId: oid() }),
  ],
  [
    'broken application backlink',
    () =>
      ParentLeaveApplication.collection.updateOne(
        { _id: objectId(applicationId) },
        { $set: { approvalRequestId: oid() } },
      ),
  ],
  [
    'invalid submitted revision',
    () =>
      ApprovalRequest.updateOne(
        { _id: approvalId },
        { parentLeaveRevision: 2 },
      ),
  ],
  [
    'changed submitted payload',
    () =>
      ParentLeaveApplication.collection.updateOne(
        { _id: objectId(applicationId) },
        { $set: { reason: 'Changed after submission' } },
      ),
  ],
  [
    'self-review',
    () =>
      ApprovalRequest.updateOne(
        { _id: approvalId },
        { requesterId: parentState.verifier._id },
      ),
  ],
  [
    'terminal approval',
    () =>
      ApprovalRequest.updateOne({ _id: approvalId }, { status: 'withdrawn' }),
  ],
] as const) {
  test(`${name} hides the application from queue, detail and count`, async () => {
    await change();
    await concealed();
  });
}
