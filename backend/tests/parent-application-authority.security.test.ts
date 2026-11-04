import assert from 'node:assert/strict';
import { afterEach, before, mock, test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import mongoose from 'mongoose';
import { state, parentState, oid } from './helpers/parent-workspace.fixture';
import { ParentLeaveApplication } from '../src/models/parentLeaveApplication';
import { ParentStudentLink } from '../src/models/parentStudentLink';
import { StudentEnrollment } from '../src/models/studentEnrollment';
import User from '../src/models/user';
import Student from '../src/models/student';
import Branch from '../src/models/branch';
import Section from '../src/models/section';
import SchoolClass from '../src/models/schoolClass';
import { AcademicPeriod } from '../src/models/academicPeriod';
import Session from '../src/models/session';
import ApprovalRequest from '../src/models/approvalRequest';
import {
  AttendanceSession,
  PeriodAttendanceRecord,
} from '../src/models/periodAttendance';
import {
  AttendanceCorrection,
  StudentLeave,
} from '../src/models/attendanceAmendment';
import { seedOccurrence } from './helpers/parent-domain.fixture';
import {
  authorizeParentApplication,
  createParentLeaveDraft,
  withParentApplicationWriteAuthority,
} from '../src/services/parent-application-access.service';
import { generateAccessToken } from '../src/services/jwt.service';
import { RequestContractError } from '../src/utils/request-validation';

before(async () => {
  await ParentLeaveApplication.createIndexes();
});
afterEach(() => mock.restoreAll());
const identity = () => ({
  userId: String(parentState.parent._id),
  role: 'parent' as const,
});
const input = () => ({
  leaveType: 'School supplied category',
  startDate: '2026-11-04',
  endDate: '2026-11-05',
  reason: 'Private medical reason never included in errors',
  clientOperationId: 'draft-operation-1',
});
const create = (patch = {}) =>
  createParentLeaveDraft(
    identity(),
    parentState.token,
    String(state.student._id),
    { ...input(), ...patch },
  );
const access = (id?: string) =>
  authorizeParentApplication(
    identity(),
    parentState.token,
    String(state.student._id),
    id,
  );
const denied = (status: number) => (error: unknown) =>
  error instanceof RequestContractError &&
  error.status === status &&
  !error.message.includes('Private medical');

test('verified Parent authority derives placement from enrollment, not profile strings', async () => {
  const ctx = await access();
  assert.equal(ctx.provenance.classId, String(state.cls._id));
  assert.notEqual(ctx.provenance.classId, String(state.student.classId));
  const result = await create();
  assert.deepEqual(Object.keys(result).sort(), ['applicationId', 'replayed']);
  const row = await ParentLeaveApplication.findById(
    result.applicationId,
  ).lean();
  assert.ok(row);
  assert.equal(row.state, 'draft');
  assert.equal(row.revision, 0);
  assert.equal(row.approvalRequestId, null);
  assert.equal(row.history[0].action, 'draft_created');
  assert.equal(String(row.history[0].actorId), identity().userId);
  assert.ok(row.createdAt && row.updatedAt);
  assert.equal(row.reason, undefined);
  assert.equal(row.fingerprint, undefined);
  assert.equal(row.clientOperationId, undefined);
  assert.equal(row.protectedAttachmentIds, undefined);
  await access(result.applicationId);
});

test('valid foreign Student ObjectId and nonexistent child have identical concealment', async () => {
  for (const id of [state.otherStudent._id, oid()])
    await assert.rejects(
      authorizeParentApplication(identity(), parentState.token, String(id)),
      denied(404),
    );
});

for (const change of [
  { status: 'pending' },
  { status: 'revoked' },
  { isActive: false },
  { revokedAt: new Date() },
  { verifiedBy: null },
  { verifiedAt: null },
  { createdBy: null },
]) {
  test(`changed relationship conceals stored draft and denies replay ${
    Object.keys(change)[0]
  } ${String(Object.values(change)[0])}`, async () => {
    const result = await create();
    await ParentStudentLink.collection.updateOne(
      { _id: parentState.link._id },
      { $set: change },
    );
    await assert.rejects(access(result.applicationId), denied(404));
    await assert.rejects(create(), denied(404));
    assert.equal(await ParentLeaveApplication.countDocuments(), 1);
  });
}

for (const change of [
  { status: 'transferred', effectiveTo: new Date() },
  { effectiveTo: new Date() },
  { sectionId: oid() },
  { branchId: oid() },
]) {
  test(`invalid enrollment denies access ${
    Object.keys(change)[0]
  }`, async () => {
    await StudentEnrollment.collection.updateOne(
      { _id: state.enrollment._id },
      { $set: change },
    );
    await assert.rejects(create(), denied(404));
    assert.equal(await ParentLeaveApplication.countDocuments(), 0);
  });
}

test('missing enrollment and inconsistent catalog fail closed', async () => {
  await StudentEnrollment.deleteMany({});
  await assert.rejects(create(), denied(404));
});
test('inactive Branch fails closed', async () => {
  await Branch.collection.updateOne(
    { _id: state.branch._id },
    { $set: { isActive: false } },
  );
  await assert.rejects(create(), denied(404));
});
test('invalid Section membership fails closed', async () => {
  await Section.collection.updateOne(
    { _id: state.section._id },
    { $set: { classId: oid() } },
  );
  await assert.rejects(create(), denied(404));
});
test('verification authority is current, not a historical flag', async () => {
  await User.collection.updateOne(
    { _id: parentState.verifier._id },
    { $set: { isActive: false } },
  );
  await assert.rejects(create(), denied(404));
});

test('Parent Branch transfer conceals originating draft even if link is moved', async () => {
  const result = await create();
  await User.collection.updateOne(
    { _id: parentState.parent._id },
    { $set: { branchId: state.foreign._id } },
  );
  await ParentStudentLink.collection.updateOne(
    { _id: parentState.link._id },
    { $set: { branchId: state.foreign._id } },
  );
  await assert.rejects(access(result.applicationId), denied(404));
  assert.equal(
    await ParentLeaveApplication.countDocuments({ branchId: state.branch._id }),
    1,
  );
});
test('Student Branch transfer cannot expose old application', async () => {
  const result = await create();
  await Student.collection.updateOne(
    { _id: state.student._id },
    { $set: { branchId: state.foreign._id } },
  );
  await assert.rejects(access(result.applicationId), denied(404));
});
test('valid new-Branch child authority still cannot read or replay an old-Branch application', async () => {
  const result = await create();
  const branchId = state.foreign._id;
  const academicPeriodId = oid(),
    classId = oid(),
    sectionId = oid();
  await AcademicPeriod.collection.insertOne({
    _id: academicPeriodId,
    branchId,
    name: 'New term',
    status: 'active',
  });
  await SchoolClass.collection.insertOne({
    _id: classId,
    branchId,
    academicPeriodId,
    name: 'New class',
    isActive: true,
  });
  await Section.collection.insertOne({
    _id: sectionId,
    branchId,
    classId,
    name: 'New section',
    isActive: true,
  });
  await User.collection.updateMany(
    {
      _id: {
        $in: [parentState.parent._id, parentState.verifier._id, state.user._id],
      },
    },
    { $set: { branchId } },
  );
  await Student.collection.updateOne(
    { _id: state.student._id },
    { $set: { branchId } },
  );
  await ParentStudentLink.collection.updateOne(
    { _id: parentState.link._id },
    { $set: { branchId } },
  );
  await StudentEnrollment.collection.updateOne(
    { _id: state.enrollment._id },
    { $set: { status: 'transferred', effectiveTo: new Date() } },
  );
  await StudentEnrollment.collection.insertOne({
    _id: oid(),
    studentId: state.student._id,
    branchId,
    academicPeriodId,
    classId,
    sectionId,
    status: 'active',
    effectiveFrom: new Date(Date.now() - 1000),
  });
  assert.equal((await access()).provenance.branchId, String(branchId));
  await assert.rejects(access(result.applicationId), denied(404));
  await assert.rejects(create(), denied(404));
  assert.equal(
    await ParentLeaveApplication.countDocuments({ branchId: state.branch._id }),
    1,
  );
});
test('new enrollment cannot silently retarget original request or replay', async () => {
  const result = await create();
  const original = await StudentEnrollment.findById(
    state.enrollment._id,
  ).lean();
  await StudentEnrollment.deleteMany({});
  await StudentEnrollment.collection.insertOne({ ...original!, _id: oid() });
  await assert.rejects(access(result.applicationId), denied(404));
  await assert.rejects(create(), denied(404));
});

test('current role change and inactive account deny access', async () => {
  await User.collection.updateOne(
    { _id: parentState.parent._id },
    { $set: { role: 'teacher' } },
  );
  await assert.rejects(create(), denied(401));
  await User.collection.updateOne(
    { _id: parentState.parent._id },
    { $set: { role: 'parent', isActive: false } },
  );
  await assert.rejects(create(), denied(401));
});
test('missing, revoked and unregistered session deny access; duplicate live row cannot revive first revoked session', async () => {
  await Session.updateOne(
    { token: parentState.token },
    { $set: { isRevoked: true } },
  );
  await assert.rejects(create(), denied(401));
  await Session.collection.insertOne({
    token: parentState.token,
    userId: parentState.parent._id,
    role: 'parent',
    isRevoked: false,
  });
  await assert.rejects(create(), denied(401));
  await Session.deleteMany({});
  await assert.rejects(create(), denied(401));
});
test('forged identity, mismatched token, invalid token and wrong-role token grant nothing', async () => {
  await assert.rejects(
    authorizeParentApplication(
      undefined,
      parentState.token,
      String(state.student._id),
    ),
    denied(401),
  );
  await assert.rejects(
    authorizeParentApplication(
      identity(),
      parentState.otherToken,
      String(state.student._id),
    ),
    denied(401),
  );
  await assert.rejects(
    authorizeParentApplication(
      identity(),
      'invalid',
      String(state.student._id),
    ),
    denied(401),
  );
  await assert.rejects(
    authorizeParentApplication(
      identity(),
      state.token,
      String(state.student._id),
    ),
    denied(401),
  );
  const unregistered = generateAccessToken(String(oid()), 'parent');
  await assert.rejects(
    authorizeParentApplication(
      { userId: String(oid()), role: 'parent' },
      unregistered,
      String(state.student._id),
    ),
    denied(401),
  );
});

test('requester ownership is required even when a second Parent verifies the same child', async () => {
  const result = await create();
  await ParentStudentLink.create({
    parentUserId: parentState.otherParent._id,
    studentId: state.student._id,
    branchId: state.branch._id,
    relationship: 'guardian',
    status: 'verified',
    isActive: true,
    createdBy: parentState.verifier._id,
    verifiedBy: parentState.verifier._id,
    verifiedAt: new Date(),
  });
  await assert.rejects(
    authorizeParentApplication(
      { userId: String(parentState.otherParent._id), role: 'parent' },
      parentState.otherToken,
      String(state.student._id),
      result.applicationId,
    ),
    denied(404),
  );
});

test('same normalized payload replays one draft and changed payload conflicts without leaking reason', async () => {
  const first = await create();
  const replay = await create({ reason: ` ${input().reason} ` });
  assert.equal(first.applicationId, replay.applicationId);
  assert.equal(replay.replayed, true);
  await assert.rejects(
    create({ reason: 'Different private evidence' }),
    denied(409),
  );
  const row = await ParentLeaveApplication.findById(first.applicationId);
  assert.equal(row!.history.length, 1);
  assert.equal(await ParentLeaveApplication.countDocuments(), 1);
});
test('unique owner-operation index rejects direct duplicate insertion', async () => {
  await create();
  const row = await ParentLeaveApplication.collection.findOne({});
  await assert.rejects(
    ParentLeaveApplication.collection.insertOne({ ...row!, _id: oid() }),
    (error: unknown) => (error as { code?: number }).code === 11000,
  );
});
test('concurrent duplicate operations converge; conflicting payload has one winner', async () => {
  const duplicate = await Promise.all([create(), create(), create()]);
  assert.equal(new Set(duplicate.map(r => r.applicationId)).size, 1);
  assert.equal(duplicate.filter(r => !r.replayed).length, 1);
  const results = await Promise.allSettled([
    create({ clientOperationId: 'racing-operation', reason: 'First reason' }),
    create({ clientOperationId: 'racing-operation', reason: 'Second reason' }),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const rejection = results.find(r => r.status === 'rejected');
  assert.ok(
    rejection &&
      rejection.status === 'rejected' &&
      denied(409)(rejection.reason),
  );
  assert.equal(await ParentLeaveApplication.countDocuments(), 2);
});

test(
  'two independent Node processes converge on the same draft receipt',
  { timeout: 30000 },
  async () => {
    const script = `
    const mongoose = require('mongoose');
    const { createParentLeaveDraft } = require('./src/services/parent-application-access.service.ts');
    (async () => {
      const data = JSON.parse(process.env.G1_WORKER_INPUT);
      await mongoose.connect(data.uri, { dbName: data.dbName, autoIndex: false });
      try { console.log(JSON.stringify(await createParentLeaveDraft(data.identity, data.token, data.studentId, data.input))); }
      finally { await mongoose.disconnect(); }
    })().catch(() => { console.error('Draft worker failed'); process.exitCode = 1; });
  `;
    const data = {
      uri: mongoose.connection
        .getClient()
        .options.hosts.map(host => String(host))
        .join(','),
      dbName: mongoose.connection.name,
      identity: identity(),
      token: parentState.token,
      studentId: String(state.student._id),
      input: input(),
    };
    // Fixture is an owned ephemeral replica set; never use an environment DB URI.
    data.uri =
      'mongodb://' +
      data.uri +
      '/?replicaSet=' +
      mongoose.connection.getClient().options.replicaSet;
    const run = () =>
      promisify(execFile)(
        process.execPath,
        ['--import', 'tsx', '--eval', script],
        {
          cwd: process.cwd(),
          env: { ...process.env, G1_WORKER_INPUT: JSON.stringify(data) },
          timeout: 25000,
        },
      );
    const outputs = await Promise.all([run(), run()]);
    const rows = outputs.map(output => JSON.parse(output.stdout.trim()));
    assert.equal(rows[0].applicationId, rows[1].applicationId);
    assert.equal(rows.filter(row => !row.replayed).length, 1);
    assert.equal(await ParentLeaveApplication.countDocuments(), 1);
  },
);

for (const kind of [
  'relationship',
  'session',
  'role',
  'enrollment',
  'branch',
] as const) {
  test(
    `real committed ${kind} change between initial authorization and transaction denies persistence`,
    { timeout: 15000 },
    async () => {
      const reached = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const original = Branch.collection.updateOne.bind(Branch.collection);
      let paused = false;
      mock.method(
        Branch.collection,
        'updateOne',
        async (...args: Parameters<typeof original>) => {
          if (!paused) {
            paused = true;
            reached.resolve();
            await release.promise;
          }
          return original(...args);
        },
      );
      const result = create();
      const rejected = assert.rejects(
        result,
        (error: unknown) =>
          error instanceof RequestContractError &&
          [401, 404].includes(error.status),
      );
      await reached.promise;
      try {
        if (kind === 'relationship')
          await ParentStudentLink.updateOne(
            { _id: parentState.link._id },
            { $set: { status: 'revoked' } },
          );
        if (kind === 'session')
          await Session.updateOne(
            { token: parentState.token },
            { $set: { isRevoked: true } },
          );
        if (kind === 'role')
          await User.updateOne(
            { _id: parentState.parent._id },
            { $set: { role: 'teacher' } },
          );
        if (kind === 'enrollment')
          await StudentEnrollment.updateOne(
            { _id: state.enrollment._id },
            { $set: { status: 'withdrawn', effectiveTo: new Date() } },
          );
        if (kind === 'branch')
          await User.updateOne(
            { _id: parentState.parent._id },
            { $set: { branchId: state.foreign._id } },
          );
      } finally {
        release.resolve();
      }
      await rejected;
      assert.equal(await ParentLeaveApplication.countDocuments(), 0);
    },
  );
}

test('transaction failure rolls back draft insertion and receipt so retry succeeds', async () => {
  await assert.rejects(
    withParentApplicationWriteAuthority(
      identity(),
      parentState.token,
      String(state.student._id),
      async session => {
        await ParentLeaveApplication.collection.insertOne(
          {
            requesterId: parentState.parent._id,
            clientOperationId: input().clientOperationId,
          },
          { session },
        );
        throw new RequestContractError(409, 'Injected transaction failure');
      },
    ),
    denied(409),
  );
  assert.equal(await ParentLeaveApplication.countDocuments(), 0);
  assert.equal((await create()).replayed, false);
});

test('model rejects non-draft lifecycle, malformed dates, revision and evidence references', async () => {
  await create();
  const raw = await ParentLeaveApplication.collection.findOne({});
  for (const patch of [
    { state: 'approved' },
    { state: 'pending' },
    { revision: 1 },
    { revision: -1 },
    { startDate: '2026-02-30' },
    { endDate: '2026-01-01' },
    { approvalRequestId: oid() },
    { protectedAttachmentIds: [oid()] },
    { history: [] },
    { reason: '' },
    { approved: true },
    { fileUrl: 'private' },
  ])
    await assert.rejects(async () =>
      new ParentLeaveApplication({
        ...raw,
        _id: oid(),
        clientOperationId: String(oid()),
        ...patch,
      }).validate(),
    );
});

test('drafts reserve no dates and cannot approve, create ApprovalRequest or mutate attendance', async () => {
  await seedOccurrence();
  const sessions = await AttendanceSession.find({}).lean();
  const records = await PeriodAttendanceRecord.find({}).lean();
  await create();
  await create({ clientOperationId: 'another-overlapping-draft' });
  await assert.rejects(create({ state: 'approved' }), denied(400));
  assert.equal(await ApprovalRequest.countDocuments(), 0);
  assert.equal(await AttendanceCorrection.countDocuments(), 0);
  assert.equal(await StudentLeave.countDocuments(), 0);
  assert.deepEqual(await AttendanceSession.find({}).lean(), sessions);
  assert.deepEqual(await PeriodAttendanceRecord.find({}).lean(), records);
  assert.equal(
    await ParentLeaveApplication.countDocuments({ state: 'draft' }),
    2,
  );
});
