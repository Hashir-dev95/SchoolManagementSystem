import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { resolve } from 'node:path';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import type { Server } from 'node:http';
import mongoose from 'mongoose';
import app from '../src/app';
import User from '../src/models/user';
import Session from '../src/models/session';
import ApprovalRequest from '../src/models/approvalRequest';
import { AcademicPeriod } from '../src/models/academicPeriod';
import { StudentEnrollment } from '../src/models/studentEnrollment';
import { ParentStudentLink } from '../src/models/parentStudentLink';
import { StudentCustodyState } from '../src/models/gateFoundation';
import {
  PickupAuthorization,
  PickupPerson,
  PickupSubmission,
  PickupOperation,
  PickupCustodyPolicy,
  ensurePickupAuthorizationIndexes,
} from '../src/models/pickupAuthorization';
import { generateAccessToken } from '../src/services/jwt.service';
import { registerSession } from '../src/services/session.service';
import { addScheduleDays } from '../src/services/school-date.service';
import {
  state,
  parentState,
  oid,
  put,
} from './helpers/parent-workspace.fixture';
import type { PickupWorkerInput } from './helpers/pickup-authorization-worker';
import { readPrincipalPickups } from '../src/services/pickup-authorization-review.service';
import { ParentLeaveApplication } from '../src/models/parentLeaveApplication';
import {
  AttendanceSession,
  PeriodAttendanceRecord,
} from '../src/models/periodAttendance';
import {
  StudentLeave,
  AttendanceCorrection,
} from '../src/models/attendanceAmendment';
import { Notification } from '../src/models/notification';

let server: Server, base: string, principalToken: string;
const envKeys = [
  'PICKUP_AUTHORIZATION_ROUTING_POLICY',
  'PRINCIPAL_APPROVAL_AUTHORITY',
] as const;
const initialEnvironment = envKeys.map(key => process.env[key]);
const routing = (version = 7) =>
  JSON.stringify({
    policy: 'shared_branch_principal',
    version,
    enabled: true,
    branchIds: [String(state.branch._id)],
  });
const root = (child = String(state.student._id)) =>
  `/parent/me/children/${child}/pickup-authorizations`;
const reviews = '/principal/pickup-authorizations';
const fields = (patch: Record<string, unknown> = {}) => ({
  fullName: 'Proposed Family Collector',
  relationship: 'Family friend',
  phone: '+92 300 1234567',
  validFromDate: state.today,
  validUntilDate: addScheduleDays(state.today, 5),
  notes: 'Private family collection proposal',
  ...patch,
});
const command = (id: string, body: Record<string, unknown> = {}) => ({
  clientOperationId: id,
  ...body,
});
const versions = (
  applicationRevision = 1,
  personRevision = 0,
  approvalVersion = 0,
) => ({ applicationRevision, personRevision, approvalVersion });
async function http(
  path: string,
  token = parentState.token,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
) {
  const response = await fetch(base + '/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    data: response.headers.get('content-type')?.includes('application/json')
      ? ((await response.json()) as any)
      : null,
  };
}
async function draft() {
  const result = await http(
    root(),
    parentState.token,
    command('create', fields()),
  );
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return {
    id: result.data.data.authorizationId as string,
    personId: result.data.data.pickupPersonId as string,
  };
}
async function pending() {
  const created = await draft();
  const result = await http(
    `${root()}/${created.id}/submit`,
    parentState.token,
    command('submit', { applicationRevision: 0, personRevision: 0 }),
  );
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return { ...created, approvalId: result.data.data.approvalId as string };
}
const decision = (
  approvalId: string,
  action = 'request_changes',
  operation = 'decision',
  current = versions(),
) =>
  http(
    `${reviews}/${approvalId}/decisions`,
    principalToken,
    command(operation, {
      ...current,
      action,
      ...(action !== 'approve'
        ? { decisionReason: 'Please correct the proposed collection details.' }
        : {}),
    }),
  );
async function returned() {
  const created = await pending();
  const result = await decision(created.approvalId);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return created;
}
before(async () => {
  await ensurePickupAuthorizationIndexes();
  await ensurePickupAuthorizationIndexes();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(done => server.once('listening', done));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
beforeEach(async () => {
  process.env[envKeys[0]] = routing();
  process.env[envKeys[1]] = JSON.stringify({
    [String(parentState.verifier._id)]: {
      branchId: String(state.branch._id),
      types: ['pickup_authorization', 'leave'],
    },
  });
  principalToken = generateAccessToken(
    String(parentState.verifier._id),
    'principal',
  );
  await registerSession(
    String(parentState.verifier._id),
    principalToken,
    'principal',
  );
  await AcademicPeriod.updateOne(
    { _id: state.period._id },
    {
      $set: {
        startDate: addScheduleDays(state.today, -30),
        endDate: addScheduleDays(state.today, 30),
      },
    },
  );
});
afterEach(() => {
  mock.restoreAll();
});
after(async () => {
  envKeys.forEach((key, index) => {
    const value = initialEnvironment[index];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
  await new Promise<void>(done => server.close(() => done()));
});

test('verified Parent creates a private scoped proposal while custody and pickup activation stay blocked', async () => {
  const created = await draft();
  const detail = (await http(`${root()}/${created.id}`)).data.data;
  assert.equal(detail.person.phone, fields().phone);
  assert.equal(detail.eligibility.operationallyEligible, false);
  assert.equal(detail.eligibility.custodyState, 'unknown');
  assert.equal(detail.eligibility.policyState, 'unconfigured');
  const list = (await http(root())).data.data;
  assert.equal(list.items.length, 1);
  for (const secret of [
    fields().phone,
    fields().notes,
    'fingerprint',
    'history',
    'payload',
  ])
    assert.ok(!JSON.stringify(list).includes(secret), secret);
  const person = await PickupPerson.findById(created.personId).orFail();
  assert.equal(person.verificationState, 'proposed');
  assert.equal(String(person.enrollmentId), String(state.enrollment._id));
  assert.equal(await ApprovalRequest.countDocuments(), 0);
});

test('draft edit and durable creation/edit replay preserve the current version and reject conflicting operations', async () => {
  const created = await draft();
  const body = command('edit', {
    ...fields({ fullName: 'Revised Collector' }),
    applicationRevision: 0,
    personRevision: 0,
  });
  const edited = await http(
    `${root()}/${created.id}`,
    parentState.token,
    body,
    'PATCH',
  );
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.data.operationRevision, 1);
  assert.equal(edited.data.data.authorization.personRevision, 1);
  assert.equal(
    (await http(`${root()}/${created.id}`, parentState.token, body, 'PATCH'))
      .data.data.replayed,
    true,
  );
  assert.equal(
    (await http(root(), parentState.token, command('create', fields()))).data
      .data.operationRevision,
    0,
  );
  assert.equal(
    (
      await http(
        `${root()}/${created.id}`,
        parentState.token,
        { ...body, fullName: 'Conflicting payload' },
        'PATCH',
      )
    ).status,
    409,
  );
  assert.equal(await PickupPerson.countDocuments(), 1);
  assert.equal(await PickupAuthorization.countDocuments(), 1);
});

test('durable replay projects only safe acknowledgment fields', async () => {
  await draft();
  await PickupOperation.collection.updateOne(
    { kind: 'create' },
    {
      $set: {
        'result.privateInternalEvidence': 'INTERNAL EVIDENCE MUST NOT LEAK',
      },
    },
  );
  const replay = await http(
    root(),
    parentState.token,
    command('create', fields()),
  );
  assert.equal(replay.status, 201);
  assert.equal(replay.data.data.replayed, true);
  assert.ok(!JSON.stringify(replay.data).includes('INTERNAL EVIDENCE'));
});

for (const changed of [
  { status: 'pending' },
  { status: 'revoked' },
  { isActive: false },
  { verifiedBy: null },
  { revokedAt: new Date() },
]) {
  test(`current relationship denies create, read and durable replay ${JSON.stringify(
    changed,
  )}`, async () => {
    const created = await draft();
    await ParentStudentLink.updateOne(
      { _id: parentState.link._id },
      { $set: changed },
    );
    assert.equal(
      (await http(root(), parentState.token, command('create', fields())))
        .status,
      404,
    );
    assert.equal((await http(`${root()}/${created.id}`)).status, 404);
    assert.equal(await PickupAuthorization.countDocuments(), 1);
  });
}

test('foreign children and a second verified guardian cannot read or edit the original private proposal', async () => {
  const created = await draft();
  assert.equal(
    (
      await http(
        root(String(state.otherStudent._id)),
        parentState.token,
        command('foreign', fields()),
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await http(
        root(String(oid())),
        parentState.token,
        command('unknown', fields()),
      )
    ).status,
    404,
  );
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
  assert.deepEqual(
    (await http(root(), parentState.otherToken)).data.data.items,
    [],
  );
  assert.equal(
    (await http(`${root()}/${created.id}`, parentState.otherToken)).status,
    404,
  );
  assert.equal(
    (
      await http(
        `${root()}/${created.id}`,
        parentState.otherToken,
        command('foreign-edit', {
          ...fields(),
          applicationRevision: 0,
          personRevision: 0,
        }),
        'PATCH',
      )
    ).status,
    404,
  );
});

test('missing or disabled routing leaves drafts usable and creates no linked approval', async () => {
  const created = await draft();
  delete process.env.PICKUP_AUTHORIZATION_ROUTING_POLICY;
  assert.equal(
    (await http(`${root()}/${created.id}`)).data.data.capabilities.canSubmit,
    false,
  );
  assert.equal(
    (
      await http(
        `${root()}/${created.id}/submit`,
        parentState.token,
        command('submit', { applicationRevision: 0, personRevision: 0 }),
      )
    ).status,
    503,
  );
  assert.equal(await ApprovalRequest.countDocuments(), 0);
});

test('typed queue and detail require a current explicit Principal pickup category grant', async () => {
  const created = await pending();
  const queue = await http(reviews, principalToken);
  assert.equal(queue.status, 200, JSON.stringify(queue.data));
  assert.equal(queue.data.data.items.length, 1);
  assert.ok(!JSON.stringify(queue.data).includes(fields().phone));
  assert.ok(!JSON.stringify(queue.data).includes(fields().notes));
  const detail = (
    await http(`${reviews}/${created.approvalId}`, principalToken)
  ).data.data;
  assert.deepEqual(detail.capabilities.allowedActions, [
    'reject',
    'request_changes',
  ]);
  assert.equal(detail.capabilities.canApprove, false);
  for (const token of [parentState.token, state.token])
    assert.equal(
      (await http(`${reviews}/${created.approvalId}`, token)).status,
      403,
    );
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify({
    [String(parentState.verifier._id)]: {
      branchId: String(state.branch._id),
      types: ['leave'],
    },
  });
  assert.equal((await http(reviews, principalToken)).status, 403);
  assert.equal((await decision(created.approvalId, 'reject')).status, 403);
});

test('a current foreign Branch Principal with an explicit grant cannot retrieve this Branch proposal', async () => {
  const created = await pending();
  const reviewer = await User.create({
    fullName: 'Other Branch Principal',
    email: 'foreign-principal@fixture.invalid',
    password: 'fixture-only',
    role: 'principal',
    branchId: state.foreign._id,
  });
  const token = generateAccessToken(String(reviewer._id), 'principal');
  await registerSession(String(reviewer._id), token, 'principal');
  process.env.PICKUP_AUTHORIZATION_ROUTING_POLICY = JSON.stringify({
    policy: 'shared_branch_principal',
    version: 7,
    enabled: true,
    branchIds: [String(state.branch._id), String(state.foreign._id)],
  });
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify({
    [String(reviewer._id)]: {
      branchId: String(state.foreign._id),
      types: ['pickup_authorization'],
    },
  });
  const response = await http(`${reviews}/${created.approvalId}`, token);
  assert.equal(response.status, 404);
  assert.ok(!JSON.stringify(response.data).includes(fields().phone));
});

test('Principal detail rechecks the original Parent relationship after a completed read snapshot', async () => {
  const created = await pending();
  const original = Session.findOne.bind(Session);
  let calls = 0;
  mock.method(Session, 'findOne', (...args: Parameters<typeof original>) => {
    const query = original(...args);
    if (++calls === 3) {
      const execute = query.exec.bind(query);
      query.exec = async () => {
        await ParentStudentLink.updateOne(
          { _id: parentState.link._id },
          { $set: { status: 'revoked', isActive: false } },
        );
        return execute();
      };
    }
    return query;
  });
  await assert.rejects(
    readPrincipalPickups(
      { userId: String(parentState.verifier._id), role: 'principal' },
      principalToken,
      created.approvalId,
    ),
    (error: unknown) => (error as { status: number }).status === 404,
  );
});

test('valid forged reciprocal IDs are rejected while original submitted records remain retained', async () => {
  const created = await pending();
  await ApprovalRequest.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(created.approvalId) },
    { $set: { entityId: state.student._id } },
  );
  assert.equal((await http(`${root()}/${created.id}`)).status, 409);
  assert.equal(
    (await http(`${reviews}/${created.approvalId}`, principalToken)).status,
    404,
  );
  assert.equal(await PickupSubmission.countDocuments(), 1);
});

for (const hold of [false, true]) {
  test(`approval never activates unverified person or unapproved custody policy, Hold ${hold}`, async () => {
    const created = await pending();
    if (hold)
      await put(StudentCustodyState, {
        studentId: state.student._id,
        branchId: state.branch._id,
        enrollmentId: state.enrollment._id,
        state: 'hold',
        authorityRevision: 1,
        revision: 1,
      });
    assert.equal((await decision(created.approvalId, 'approve')).status, 403);
    assert.equal(
      (await PickupAuthorization.findById(created.id).orFail()).state,
      'pending',
    );
    assert.equal(
      (await ApprovalRequest.findById(created.approvalId).orFail()).status,
      'pending',
    );
    assert.equal(
      (await PickupPerson.findById(created.personId).orFail())
        .verificationState,
      'proposed',
    );
    assert.equal(await PickupOperation.countDocuments({ kind: 'approve' }), 0);
  });
}

test('Request Changes and resubmission preserve both IDs and all prior private submitted evidence', async () => {
  const created = await returned();
  const original = await PickupSubmission.collection.findOne({});
  assert.ok(original);
  const body = command('resubmit', {
    ...fields({ fullName: 'Corrected Collector', phone: '+92 300 7654321' }),
    ...versions(2, 0, 1),
  });
  const resubmitted = await http(
    `${root()}/${created.id}/resubmit`,
    parentState.token,
    body,
  );
  assert.equal(resubmitted.status, 200, JSON.stringify(resubmitted.data));
  assert.equal(resubmitted.data.data.approvalId, created.approvalId);
  assert.equal(resubmitted.data.data.authorization.state, 'pending');
  assert.deepEqual(
    await PickupSubmission.collection.findOne({ _id: original._id }),
    original,
  );
  assert.equal(await ApprovalRequest.countDocuments(), 1);
  assert.equal(await PickupSubmission.countDocuments(), 2);
  assert.equal(
    (await http(`${root()}/${created.id}/resubmit`, parentState.token, body))
      .data.data.replayed,
    true,
  );
  const earlierDecision = await decision(created.approvalId);
  assert.equal(earlierDecision.status, 200);
  assert.equal(earlierDecision.data.data.replayed, true);
  assert.equal(earlierDecision.data.data.operationState, 'changes_requested');
  assert.equal(earlierDecision.data.data.authorization.state, 'pending');
  assert.equal(
    (
      await decision(
        created.approvalId,
        'reject',
        'reject-current',
        versions(3, 1, 2),
      )
    ).status,
    200,
  );
  const detail = (await http(`${root()}/${created.id}`)).data.data;
  assert.equal(detail.submissions.length, 2);
  assert.equal(detail.submissions[0].fullName, fields().fullName);
  assert.equal(detail.submissions[1].fullName, 'Corrected Collector');
  assert.equal(detail.state, 'rejected');
  assert.equal(detail.eligibility.operationallyEligible, false);
});

test('generic approval reads, decisions, delegation, resubmission and queues cannot bypass typed pickup authority', async () => {
  const created = await pending();
  for (const path of [
    `/approval-requests/${created.approvalId}`,
    `/approval-requests/${created.approvalId}/eligible-delegates`,
  ])
    assert.equal((await http(path, principalToken)).status, 403);
  assert.equal(
    (
      await http(
        `/approval-requests/${created.approvalId}`,
        principalToken,
        { action: 'approved' },
        'PATCH',
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await http(
        `/approval-requests/${created.approvalId}/resubmission`,
        parentState.token,
      )
    ).status,
    403,
  );
  const queue = await http('/approval-requests/pending', principalToken);
  assert.ok(!JSON.stringify(queue.data).includes(created.approvalId));
});

test('stale versions and unknown authority fields fail without lost revisions or partial records', async () => {
  const created = await pending();
  assert.equal(
    (await decision(created.approvalId, 'reject', 'stale', versions(0))).status,
    409,
  );
  for (const key of [
    'branchId',
    'requesterId',
    'reviewerId',
    'approved',
    'verified',
    'custodyVerified',
    'authorizationActive',
    'schoolVerifierId',
    'verifiedAt',
    'supportingFileUrl',
  ]) {
    assert.equal(
      (
        await http(
          root(),
          parentState.token,
          command(key, { ...fields(), [key]: String(oid()) }),
        )
      ).status,
      400,
      key,
    );
  }
  assert.equal((await http(`${root()}/not-an-id`)).status, 400);
  assert.equal((await decision(String(oid()), 'reject')).status, 404);
});

for (const revoked of [
  'enrollment',
  'session',
  'role',
  'branch',
  'policy',
] as const) {
  test(`persisted ${revoked} change denies stale transitions and replay`, async () => {
    const created = await pending();
    if (revoked === 'enrollment')
      await StudentEnrollment.updateOne(
        { _id: state.enrollment._id },
        { $set: { status: 'transferred', effectiveTo: new Date() } },
      );
    if (revoked === 'session')
      await Session.updateOne(
        { token: parentState.token },
        { $set: { isRevoked: true } },
      );
    if (revoked === 'role')
      await User.updateOne(
        { _id: parentState.parent._id },
        { $set: { role: 'teacher' } },
      );
    if (revoked === 'branch')
      await User.updateOne(
        { _id: parentState.parent._id },
        { $set: { branchId: state.foreign._id } },
      );
    if (revoked === 'policy')
      await PickupCustodyPolicy.collection.updateOne(
        { branchId: state.branch._id },
        { $inc: { revision: 1 } },
      );
    const response = await http(
      `${root()}/${created.id}/submit`,
      parentState.token,
      command('submit', { applicationRevision: 0, personRevision: 0 }),
    );
    assert.equal(
      response.status,
      revoked === 'policy'
        ? 409
        : ['session', 'role'].includes(revoked)
        ? 401
        : 404,
    );
    assert.equal(
      (await PickupAuthorization.findById(created.id).orFail()).revision,
      1,
    );
  });
}

test('repeated review cycles retain immutable snapshots and still permit pending withdrawal when routing is disabled', async () => {
  const created = await returned();
  const submitAgain = (cycle: number) =>
    http(
      `${root()}/${created.id}/resubmit`,
      parentState.token,
      command(`resubmit-${cycle}`, {
        ...fields({ fullName: `Collector cycle ${cycle}` }),
        ...versions(cycle * 2 - 2, cycle - 2, cycle * 2 - 3),
      }),
    );
  assert.equal((await submitAgain(2)).status, 200);
  assert.equal(
    (
      await decision(
        created.approvalId,
        'request_changes',
        'return-two',
        versions(3, 1, 2),
      )
    ).status,
    200,
  );
  assert.equal((await submitAgain(3)).status, 200);
  delete process.env.PICKUP_AUTHORIZATION_ROUTING_POLICY;
  assert.equal(
    (
      await http(
        `${root()}/${created.id}/withdraw`,
        parentState.token,
        command('withdraw', versions(5, 2, 4)),
      )
    ).status,
    200,
  );
  assert.equal(
    (await PickupAuthorization.findById(created.id).orFail()).state,
    'withdrawn',
  );
  assert.equal(await PickupSubmission.countDocuments(), 3);
  assert.equal(await ApprovalRequest.countDocuments(), 1);
});

test('altered submitted evidence is concealed and snapshots cannot be replaced through draft editing', async () => {
  const created = await pending();
  assert.equal(
    (
      await http(
        `${root()}/${created.id}`,
        parentState.token,
        command('edit-pending', {
          ...fields(),
          applicationRevision: 1,
          personRevision: 0,
        }),
        'PATCH',
      )
    ).status,
    409,
  );
  const snapshot = await PickupSubmission.findOne()
    .select('+payload +fingerprint')
    .orFail();
  await PickupSubmission.collection.updateOne(
    { _id: snapshot._id },
    { $set: { 'payload.phone': '+92 300 0000000' } },
  );
  assert.equal((await http(`${root()}/${created.id}`)).status, 409);
  assert.equal(
    (await http(`${reviews}/${created.approvalId}`, principalToken)).status,
    404,
  );
});

test('no physical event, attendance effect or notification is introduced by pickup proposals and safe decisions', async () => {
  const preserved = [
    ParentLeaveApplication,
    AttendanceSession,
    PeriodAttendanceRecord,
    StudentLeave,
    AttendanceCorrection,
    Notification,
  ];
  for (const model of preserved)
    await put(model, {
      branchId: state.branch._id,
      studentId: state.student._id,
      sentinel: 'preserved existing private record',
    });
  const beforeRecords = await Promise.all(
    preserved.map(model =>
      mongoose.connection.collection(model.collection.name).find().toArray(),
    ),
  );
  const created = await pending();
  assert.equal((await decision(created.approvalId, 'reject')).status, 200);
  assert.deepEqual(
    await Promise.all(
      preserved.map(model =>
        mongoose.connection.collection(model.collection.name).find().toArray(),
      ),
    ),
    beforeRecords,
  );
  const gateUser = await User.create({
    fullName: 'Gate fixture',
    email: 'gate@fixture.invalid',
    password: 'fixture-only',
    role: 'gate_staff',
    branchId: state.branch._id,
  });
  const gateToken = generateAccessToken(String(gateUser._id), 'gate_staff');
  await registerSession(String(gateUser._id), gateToken, 'gate_staff');
  for (const path of [
    '/gate/exits',
    '/gate/entries',
    '/gate/pickup-verifications',
    '/gate/challenges',
  ])
    assert.equal((await http(path, gateToken, {})).status, 404);
});

test('actual required unique indexes exist with autoIndex disabled', async () => {
  for (const [model, name] of [
    [PickupCustodyPolicy, 'pickup_policy_branch_unique'],
    [PickupAuthorization, 'pickup_reciprocal_approval_unique'],
    [PickupSubmission, 'pickup_submission_cycle_unique'],
    [PickupOperation, 'pickup_actor_operation_unique'],
    [ApprovalRequest, 'one_approval_per_pickup_authorization'],
  ] as const)
    assert.ok(
      (await model.collection.indexes()).some(
        index => index.name === name && index.unique,
      ),
    );
  await pending();
  for (const model of [PickupSubmission, PickupOperation]) {
    const record = await mongoose.connection
      .collection(model.collection.name)
      .findOne({});
    assert.ok(record);
    await assert.rejects(
      mongoose.connection
        .collection(model.collection.name)
        .insertOne({ ...record, _id: oid() }),
      (error: unknown) => (error as { code: number }).code === 11000,
    );
  }
});

function worker(
  input: Partial<PickupWorkerInput> & Pick<PickupWorkerInput, 'action'>,
) {
  const child = fork(
    resolve(__dirname, 'helpers/pickup-authorization-worker.ts'),
    { execArgv: ['--import', 'tsx'], silent: true },
  );
  let output = '';
  child.stderr?.on('data', part => {
    output += String(part);
  });
  const events: {
    event: string;
    status?: number;
    result?: { replayed?: boolean };
    message?: string;
  }[] = [];
  const listeners: (() => void)[] = [];
  child.on('message', message => {
    events.push(message as (typeof events)[number]);
    listeners.splice(0).forEach(done => done());
  });
  async function until(event: string) {
    const deadline = Date.now() + 20000;
    while (!events.some(message => message.event === event)) {
      assert.equal(child.exitCode, null, output);
      assert.ok(Date.now() < deadline, `Worker timed out ${event} ${output}`);
      await new Promise<void>(done => {
        const timer = setTimeout(done, 100);
        listeners.push(() => {
          clearTimeout(timer);
          done();
        });
      });
    }
    return events.find(message => message.event === event)!;
  }
  child.send({
    uri: `mongodb://${mongoose.connection.host}:${
      mongoose.connection.port
    }/?replicaSet=${mongoose.connection.getClient().options.replicaSet}`,
    dbName: mongoose.connection.name,
    identity: { userId: String(parentState.parent._id), role: 'parent' },
    token: parentState.token,
    branchId: String(state.branch._id),
    studentId: String(state.student._id),
    authorizationId: '',
    approvalId: '',
    hold: false,
    payload: {},
    ...input,
  });
  return {
    until,
    release: () => child.send({ release: true }),
    stop: () => child.kill(),
  };
}
const reviewerWorker = () => ({
  identity: {
    userId: String(parentState.verifier._id),
    role: 'principal' as const,
  },
  token: principalToken,
});
const decisionBody = (action: string, id: string) =>
  command(id, {
    ...versions(),
    action,
    ...(action === 'approve'
      ? {}
      : { decisionReason: 'Review requires corrected collection details.' }),
  });

for (const duplicate of [true, false]) {
  test(
    `independent Parent submissions commit one approval, identical receipt ${duplicate}`,
    { timeout: 45000 },
    async () => {
      const created = await draft();
      const payload = command('submit', {
        applicationRevision: 0,
        personRevision: 0,
      });
      const first = worker({
        action: 'submit',
        authorizationId: created.id,
        payload,
        hold: true,
      });
      let second: ReturnType<typeof worker> | undefined;
      try {
        await first.until('locked');
        second = worker({
          action: 'submit',
          authorizationId: created.id,
          payload: {
            ...payload,
            clientOperationId: duplicate ? 'submit' : 'second',
          },
        });
        await second.until('attempting');
        first.release();
        assert.equal((await first.until('result')).status, 200);
        assert.equal(
          (await second.until('result')).status,
          duplicate ? 200 : 409,
        );
        assert.equal(await ApprovalRequest.countDocuments(), 1);
        assert.equal(await PickupSubmission.countDocuments(), 1);
        assert.equal(
          await PickupOperation.countDocuments({ kind: 'submit' }),
          1,
        );
      } finally {
        first.stop();
        second?.stop();
      }
    },
  );
}

for (const withdrawalFirst of [true, false]) {
  test(
    `independent withdrawal and decision serialize, withdrawal first ${withdrawalFirst}`,
    { timeout: 45000 },
    async () => {
      const created = await pending();
      const withdraw: Partial<PickupWorkerInput> &
        Pick<PickupWorkerInput, 'action'> = {
        action: 'withdraw',
        authorizationId: created.id,
        payload: command('withdraw', versions()),
      };
      const reject: Partial<PickupWorkerInput> &
        Pick<PickupWorkerInput, 'action'> = {
        action: 'decide',
        ...reviewerWorker(),
        approvalId: created.approvalId,
        payload: decisionBody('reject', 'reject'),
      };
      const first = worker({
        ...(withdrawalFirst ? withdraw : reject),
        hold: true,
      });
      let second: ReturnType<typeof worker> | undefined;
      try {
        await first.until('locked');
        second = worker(withdrawalFirst ? reject : withdraw);
        await second.until('attempting');
        first.release();
        assert.equal((await first.until('result')).status, 200);
        assert.equal((await second.until('result')).status, 409);
        const row = await PickupAuthorization.findById(created.id).orFail();
        assert.equal(row.state, withdrawalFirst ? 'withdrawn' : 'rejected');
        assert.equal(
          (await ApprovalRequest.findById(created.approvalId).orFail()).status,
          row.state,
        );
      } finally {
        first.stop();
        second?.stop();
      }
    },
  );
}

test(
  'two independent Principal decisions produce one audited outcome',
  { timeout: 45000 },
  async () => {
    const created = await pending();
    const other = await User.create({
      fullName: 'Second Principal',
      email: 'second-principal@fixture.invalid',
      password: 'fixture-only',
      role: 'principal',
      branchId: state.branch._id,
    });
    const otherToken = generateAccessToken(String(other._id), 'principal');
    await registerSession(String(other._id), otherToken, 'principal');
    process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify({
      [String(parentState.verifier._id)]: {
        branchId: String(state.branch._id),
        types: ['pickup_authorization'],
      },
      [String(other._id)]: {
        branchId: String(state.branch._id),
        types: ['pickup_authorization'],
      },
    });
    const first = worker({
      action: 'decide',
      ...reviewerWorker(),
      approvalId: created.approvalId,
      payload: decisionBody('request_changes', 'first-decision'),
      hold: true,
    });
    let second: ReturnType<typeof worker> | undefined;
    try {
      await first.until('locked');
      second = worker({
        action: 'decide',
        identity: { userId: String(other._id), role: 'principal' },
        token: otherToken,
        approvalId: created.approvalId,
        payload: decisionBody('reject', 'other-decision'),
      });
      await second.until('attempting');
      first.release();
      assert.equal((await first.until('result')).status, 200);
      assert.equal((await second.until('result')).status, 409);
      assert.equal(
        (await ApprovalRequest.findById(created.approvalId).orFail()).history
          .length,
        2,
      );
    } finally {
      first.stop();
      second?.stop();
    }
  },
);

for (const changesFirst of [true, false]) {
  test(
    `Request Changes and resubmission preserve legal ordering, return first ${changesFirst}`,
    { timeout: 45000 },
    async () => {
      const created = await pending();
      const changes: Partial<PickupWorkerInput> &
        Pick<PickupWorkerInput, 'action'> = {
        action: 'decide',
        ...reviewerWorker(),
        approvalId: created.approvalId,
        payload: decisionBody('request_changes', 'return'),
      };
      const resubmit: Partial<PickupWorkerInput> &
        Pick<PickupWorkerInput, 'action'> = {
        action: 'resubmit',
        authorizationId: created.id,
        payload: command('resubmit', {
          ...fields({ fullName: 'Revised race collector' }),
          ...versions(2, 0, 1),
        }),
      };
      const first = worker({
        ...(changesFirst ? changes : resubmit),
        hold: true,
      });
      let second: ReturnType<typeof worker> | undefined;
      try {
        await first.until('locked');
        second = worker(changesFirst ? resubmit : changes);
        await second.until('attempting');
        first.release();
        assert.equal(
          (await first.until('result')).status,
          changesFirst ? 200 : 409,
        );
        assert.equal((await second.until('result')).status, 200);
        assert.equal(
          (await PickupAuthorization.findById(created.id).orFail()).state,
          changesFirst ? 'pending' : 'changes_requested',
        );
        assert.equal(await ApprovalRequest.countDocuments(), 1);
        assert.equal(
          await PickupSubmission.countDocuments(),
          changesFirst ? 2 : 1,
        );
      } finally {
        first.stop();
        second?.stop();
      }
    },
  );
}

for (const revoke of [
  'link',
  'enrollment',
  'principal_session',
  'principal_role',
] as const) {
  test(
    `independent write rejects committed ${revoke} revocation before its authority fences`,
    { timeout: 45000 },
    async () => {
      const review = revoke !== 'link';
      const created = review ? await pending() : await draft();
      const work = worker({
        action: review ? 'decide' : 'submit',
        ...(review ? reviewerWorker() : {}),
        authorizationId: created.id,
        approvalId: 'approvalId' in created ? created.approvalId : '',
        payload: review
          ? decisionBody('reject', 'review')
          : command('submit', { applicationRevision: 0, personRevision: 0 }),
        hold: true,
      });
      try {
        await work.until('locked');
        if (revoke === 'link')
          await ParentStudentLink.updateOne(
            { _id: parentState.link._id },
            { $set: { status: 'revoked', isActive: false } },
          );
        if (revoke === 'enrollment')
          await StudentEnrollment.updateOne(
            { _id: state.enrollment._id },
            { $set: { status: 'transferred', effectiveTo: new Date() } },
          );
        if (revoke === 'principal_session')
          await Session.updateOne(
            { token: principalToken },
            { $set: { isRevoked: true } },
          );
        if (revoke === 'principal_role')
          await User.updateOne(
            { _id: parentState.verifier._id },
            { $set: { role: 'teacher' } },
          );
        work.release();
        assert.equal(
          (await work.until('result')).status,
          revoke.startsWith('principal_') ? 401 : 404,
        );
        assert.equal(
          (await PickupAuthorization.findById(created.id).orFail()).state,
          review ? 'pending' : 'draft',
        );
      } finally {
        work.stop();
      }
    },
  );
}

for (const holdFirst of [true, false]) {
  test(
    `Custody Hold and approval serialize without activation, Hold first ${holdFirst}`,
    { timeout: 45000 },
    async () => {
      const created = await pending();
      const admin = await User.create({
        fullName: 'School administrator',
        email: 'admin@fixture.invalid',
        password: 'fixture-only',
        role: 'super_admin',
      });
      const token = generateAccessToken(String(admin._id), 'super_admin');
      await registerSession(String(admin._id), token, 'super_admin');
      const hold: Partial<PickupWorkerInput> &
        Pick<PickupWorkerInput, 'action'> = {
        action: 'hold',
        identity: { userId: String(admin._id), role: 'super_admin' },
        token,
        payload: command('hold', {
          revision: 0,
          state: 'hold',
          reason: 'School safety review requires a hold.',
        }),
      };
      const approve: Partial<PickupWorkerInput> &
        Pick<PickupWorkerInput, 'action'> = {
        action: 'decide',
        ...reviewerWorker(),
        approvalId: created.approvalId,
        payload: decisionBody('approve', 'approve'),
      };
      const first = worker({ ...(holdFirst ? hold : approve), hold: true });
      let second: ReturnType<typeof worker> | undefined;
      try {
        await first.until('locked');
        second = worker(holdFirst ? approve : hold);
        await second.until('attempting');
        first.release();
        assert.equal(
          (await first.until('result')).status,
          holdFirst ? 200 : 403,
        );
        assert.equal(
          (await second.until('result')).status,
          holdFirst ? 403 : 200,
        );
        assert.equal(
          (await StudentCustodyState.findOne().orFail()).state,
          'hold',
        );
        assert.equal(
          (await PickupAuthorization.findById(created.id).orFail())
            .operationalStatus,
          'inactive',
        );
        assert.equal(
          (await ApprovalRequest.findById(created.approvalId).orFail()).status,
          'pending',
        );
      } finally {
        first.stop();
        second?.stop();
      }
    },
  );
}

test('routing revision changed after staged submission rolls back application, approval and receipt', async () => {
  const created = await draft();
  const original = PickupOperation.collection.insertOne.bind(
    PickupOperation.collection,
  );
  mock.method(
    PickupOperation.collection,
    'insertOne',
    async (...args: Parameters<typeof original>) => {
      const result = await original(...args);
      process.env.PICKUP_AUTHORIZATION_ROUTING_POLICY = routing(8);
      return result;
    },
  );
  assert.equal(
    (
      await http(
        `${root()}/${created.id}/submit`,
        parentState.token,
        command('submit', { applicationRevision: 0, personRevision: 0 }),
      )
    ).status,
    409,
  );
  assert.equal(
    (await PickupAuthorization.findById(created.id).orFail()).state,
    'draft',
  );
  assert.equal(await ApprovalRequest.countDocuments(), 0);
  assert.equal(await PickupSubmission.countDocuments(), 0);
  assert.equal(await PickupOperation.countDocuments({ kind: 'submit' }), 0);
});

test('category grant revoked after staged decision rolls back both linked records and its receipt', async () => {
  const created = await pending();
  const original = PickupOperation.collection.insertOne.bind(
    PickupOperation.collection,
  );
  mock.method(
    PickupOperation.collection,
    'insertOne',
    async (...args: Parameters<typeof original>) => {
      const result = await original(...args);
      process.env.PRINCIPAL_APPROVAL_AUTHORITY = '{}';
      return result;
    },
  );
  assert.equal((await decision(created.approvalId, 'reject')).status, 403);
  assert.equal(
    (await PickupAuthorization.findById(created.id).orFail()).state,
    'pending',
  );
  assert.equal(
    (await ApprovalRequest.findById(created.approvalId).orFail()).history
      .length,
    1,
  );
  assert.equal(await PickupOperation.countDocuments({ kind: 'reject' }), 0);
});

for (const kind of ['create', 'submit', 'resubmit', 'decision'] as const) {
  const writes =
    kind === 'create'
      ? ['person', 'authorization', 'receipt']
      : kind === 'submit'
      ? ['approval', 'snapshot', 'authorization', 'receipt']
      : kind === 'resubmit'
      ? ['person', 'approval', 'snapshot', 'authorization', 'receipt']
      : ['authorization', 'approval', 'receipt'];
  for (const stage of writes)
    test(`${kind} rolls back every linked record on ${stage} failure`, async () => {
      const created =
        kind === 'create'
          ? undefined
          : kind === 'submit'
          ? await draft()
          : kind === 'resubmit'
          ? await returned()
          : await pending();
      const tracked = [
        PickupPerson,
        PickupAuthorization,
        PickupSubmission,
        PickupOperation,
        PickupCustodyPolicy,
        ApprovalRequest,
      ];
      const beforeRecords = await Promise.all(
        tracked.map(model =>
          mongoose.connection
            .collection(model.collection.name)
            .find()
            .sort({ _id: 1 })
            .toArray(),
        ),
      );
      const model =
        stage === 'person'
          ? PickupPerson
          : stage === 'authorization'
          ? PickupAuthorization
          : stage === 'snapshot'
          ? PickupSubmission
          : stage === 'receipt'
          ? PickupOperation
          : ApprovalRequest;
      const method =
        kind === 'create' ||
        stage === 'snapshot' ||
        stage === 'receipt' ||
        (stage === 'approval' && kind === 'submit')
          ? 'insertOne'
          : 'updateOne';
      const original = model.collection[method].bind(model.collection);
      mock.method(model.collection, method, async (...args: unknown[]) => {
        await Reflect.apply(original, model.collection, args);
        throw new Error('Injected private transaction failure');
      });
      const result =
        kind === 'create'
          ? await http(
              root(),
              parentState.token,
              command('create-failure', fields()),
            )
          : kind === 'submit'
          ? await http(
              `${root()}/${created!.id}/submit`,
              parentState.token,
              command('submit-failure', {
                applicationRevision: 0,
                personRevision: 0,
              }),
            )
          : kind === 'resubmit'
          ? await http(
              `${root()}/${created!.id}/resubmit`,
              parentState.token,
              command('resubmit-failure', {
                ...fields({ fullName: 'Failed revised person' }),
                ...versions(2, 0, 1),
              }),
            )
          : await decision(
              (created as Awaited<ReturnType<typeof pending>>).approvalId,
              'reject',
            );
      assert.equal(result.status, 500, JSON.stringify(result.data));
      assert.ok(!JSON.stringify(result.data).includes('Injected'));
      mock.restoreAll();
      assert.deepEqual(
        await Promise.all(
          tracked.map(current =>
            mongoose.connection
              .collection(current.collection.name)
              .find()
              .sort({ _id: 1 })
              .toArray(),
          ),
        ),
        beforeRecords,
      );
    });
}
