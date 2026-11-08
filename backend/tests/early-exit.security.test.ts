import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { resolve } from 'node:path';
import {
  before as beforeSuite,
  beforeEach,
  after,
  afterEach,
  test,
  mock,
} from 'node:test';
import type { Server } from 'node:http';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import User from '../src/models/user';
import Session from '../src/models/session';
import ApprovalRequest from '../src/models/approvalRequest';
import { AcademicPeriod } from '../src/models/academicPeriod';
import { ParentStudentLink } from '../src/models/parentStudentLink';
import { StudentEnrollment } from '../src/models/studentEnrollment';
import {
  EarlyExitRequest,
  EarlyExitSubmission,
  EarlyExitOperation,
  ensureEarlyExitIndexes,
} from '../src/models/earlyExitRequest';
import { StudentCustodyState } from '../src/models/gateFoundation';
import {
  PickupPerson,
  PickupAuthorization,
} from '../src/models/pickupAuthorization';
import {
  StudentLeave,
  AttendanceCorrection,
} from '../src/models/attendanceAmendment';
import {
  AttendanceSession,
  PeriodAttendanceRecord,
} from '../src/models/periodAttendance';
import { Notification } from '../src/models/notification';
import { ParentLeaveApplication } from '../src/models/parentLeaveApplication';
import {
  state,
  parentState,
  oid,
  put,
} from './helpers/parent-workspace.fixture';
import { generateAccessToken } from '../src/services/jwt.service';
import { registerSession } from '../src/services/session.service';
import { ROLE_PERMISSIONS } from '../src/constants/rolePermissions';
import { PERMISSIONS } from '../src/constants/permissions';
import { addScheduleDays } from '../src/services/school-date.service';
import { readPrincipalExits } from '../src/services/early-exit-read.service';
import type { EarlyExitWorkerInput } from './helpers/early-exit-worker';

let server: Server, base: string, principalToken: string;
const keys = [
  'EARLY_EXIT_ROUTING_POLICY',
  'PRINCIPAL_APPROVAL_AUTHORITY',
] as const;
const originalEnv = keys.map(key => process.env[key]);
const routing = (version = 1) =>
  JSON.stringify({
    policy: 'shared_branch_principal',
    version,
    enabled: true,
    branchIds: [String(state.branch._id)],
  });
const root = (student = String(state.student._id)) =>
  `/parent/me/children/${student}/early-exit-requests`;
const reviews = '/principal/early-exit-requests';
const fields = () => ({
  exitDate: state.today as string,
  reason: 'PRIVATE: proposed early departure for a family appointment',
});
const operation = (
  clientOperationId: string,
  body: Record<string, unknown> = {},
) => ({ clientOperationId, ...body });
const versions = (applicationRevision = 1, approvalVersion = 0) => ({
  applicationRevision,
  approvalVersion,
});
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
    data: await response.json(),
    headers: response.headers,
  };
}
async function draft() {
  const response = await http(
    root(),
    parentState.token,
    operation('create', fields()),
  );
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return response.data.data.requestId as string;
}
async function pending() {
  const id = await draft();
  const response = await http(
    `${root()}/${id}/submit`,
    parentState.token,
    operation('submit', { applicationRevision: 0 }),
  );
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return { id, approvalId: response.data.data.approvalId as string };
}
const decide = (
  id: string,
  action = 'request_changes',
  nonce = 'decision',
  version = versions(),
) =>
  http(
    `${reviews}/${id}/decisions`,
    principalToken,
    operation(nonce, {
      action,
      ...version,
      ...(action === 'approve'
        ? {}
        : {
            decisionReason:
              'Please correct the proposed departure information.',
          }),
    }),
  );
async function returned() {
  const request = await pending();
  assert.equal((await decide(request.approvalId)).status, 200);
  return request;
}
beforeSuite(async () => {
  await ensureEarlyExitIndexes();
  await ensureEarlyExitIndexes();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(done => server.once('listening', done));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
beforeEach(async () => {
  process.env.EARLY_EXIT_ROUTING_POLICY = routing();
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify({
    [String(parentState.verifier._id)]: {
      branchId: String(state.branch._id),
      types: ['early_exit_request', 'leave', 'pickup_authorization'],
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
afterEach(() => mock.restoreAll());
after(async () => {
  keys.forEach((key, index) => {
    const value = originalEnv[index];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
  if (server) await new Promise<void>(done => server.close(() => done()));
});

test('owned Draft DTOs, privacy, revisioned edit and durable create/edit receipts', async () => {
  const id = await draft();
  const detail = await http(`${root()}/${id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.data.reason, fields().reason);
  assert.equal(detail.headers.get('cache-control'), 'no-store');
  assert.equal(detail.data.data.eligibility.operationallyEligible, false);
  assert.equal(detail.data.data.eligibility.physicalReleaseAllowed, false);
  const list = await http(root());
  assert.equal(list.data.data.items.length, 1);
  assert.ok(!JSON.stringify(list.data).includes('PRIVATE'));
  const edit = operation('edit', {
    ...fields(),
    reason: 'Corrected private departure reason',
    applicationRevision: 0,
  });
  assert.equal(
    (await http(`${root()}/${id}`, parentState.token, edit, 'PATCH')).status,
    200,
  );
  const replay = await http(
    root(),
    parentState.token,
    operation('create', fields()),
  );
  assert.equal(replay.status, 201);
  assert.equal(replay.data.data.replayed, true);
  assert.equal(replay.data.data.operationRevision, 0);
  assert.equal(replay.data.data.request.revision, 1);
  assert.equal(
    (await http(`${root()}/${id}`, parentState.token, edit, 'PATCH')).data.data
      .replayed,
    true,
  );
  assert.equal(
    (
      await http(
        `${root()}/${id}`,
        parentState.token,
        { ...edit, reason: 'Conflicting contents' },
        'PATCH',
      )
    ).status,
    409,
  );
  assert.equal(await EarlyExitRequest.countDocuments(), 1);
  assert.equal(await EarlyExitOperation.countDocuments(), 2);
});
test('immutable original provenance cannot be reassigned through model save or HTTP', async () => {
  const id = await draft();
  const row = await EarlyExitRequest.findById(id)
    .select('+reason +history')
    .orFail();
  const before = String(row.studentId);
  row.set('studentId', oid());
  await assert.rejects(row.save(), /immutable/);
  assert.equal(
    String((await EarlyExitRequest.findById(id).orFail()).studentId),
    before,
  );
  assert.equal(
    (
      await http(
        `${root()}/${id}`,
        parentState.token,
        operation('forge', {
          ...fields(),
          applicationRevision: 0,
          studentId: String(state.otherStudent._id),
        }),
        'PATCH',
      )
    ).status,
    400,
  );
});
for (const patch of [
  { exitDate: '2026-02-30' },
  { reason: '' },
  { reason: 'x'.repeat(501) },
  { verified: true },
  { state: 'approved' },
  { branchId: 'foreign' },
  { requesterId: 'foreign' },
  { pickupAuthorizationId: 'foreign' },
  { releaseToken: 'fake' },
])
  test(`strict payload rejects ${Object.keys(patch).join()}`, async () => {
    assert.equal(
      (
        await http(
          root(),
          parentState.token,
          operation('bad', { ...fields(), ...patch }),
        )
      ).status,
      400,
    );
    assert.equal(await EarlyExitRequest.countDocuments(), 0);
  });
test('academic-period and enrollment date boundaries are canonical, not a physical exit mark', async () => {
  assert.equal(
    (
      await http(
        root(),
        parentState.token,
        operation('outside', {
          ...fields(),
          exitDate: addScheduleDays(state.today, 31),
        }),
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await http(
        root(),
        parentState.token,
        operation('before-enrollment', {
          ...fields(),
          exitDate: addScheduleDays(state.today, -3),
        }),
      )
    ).status,
    409,
  );
});
test('foreign Student/Branch IDs and another verified guardian cannot access original requests', async () => {
  const id = await draft();
  assert.equal(
    (await http(`${root(String(state.otherStudent._id))}/${id}`)).status,
    404,
  );
  assert.equal((await http(root(String(state.otherStudent._id)))).status, 404);
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
  const otherGuardianHistory = await http(root(), parentState.otherToken);
  assert.equal(otherGuardianHistory.status, 200);
  assert.deepEqual(otherGuardianHistory.data.data.items, []);
  assert.equal(
    (await http(`${root()}/${id}`, parentState.otherToken)).status,
    404,
  );
  assert.equal((await http(`${root()}/${oid()}`)).status, 404);
  assert.equal(
    (
      await http(
        `${root()}/${id}`,
        parentState.otherToken,
        operation('foreign', { ...fields(), applicationRevision: 0 }),
        'PATCH',
      )
    ).status,
    404,
  );
});
for (const revoke of [
  'unverified',
  'revoked',
  'self_verified',
  'enrollment',
  'branch',
  'role',
  'session',
  'verifier',
] as const)
  test(`current ${revoke} change conceals owned data and rejects receipt replay without deleting records`, async () => {
    const id = await draft();
    if (revoke === 'unverified')
      await ParentStudentLink.updateOne(
        { _id: parentState.link._id },
        { $set: { status: 'pending' } },
      );
    if (revoke === 'revoked')
      await ParentStudentLink.updateOne(
        { _id: parentState.link._id },
        { $set: { isActive: false, revokedAt: new Date() } },
      );
    if (revoke === 'self_verified')
      await ParentStudentLink.updateOne(
        { _id: parentState.link._id },
        { $set: { verifiedBy: parentState.parent._id } },
      );
    if (revoke === 'enrollment')
      await StudentEnrollment.updateOne(
        { _id: state.enrollment._id },
        { $set: { status: 'transferred', effectiveTo: new Date() } },
      );
    if (revoke === 'branch')
      await User.updateOne(
        { _id: parentState.parent._id },
        { $set: { branchId: state.foreign._id } },
      );
    if (revoke === 'role')
      await User.updateOne(
        { _id: parentState.parent._id },
        { $set: { role: 'student' } },
      );
    if (revoke === 'session')
      await Session.updateOne(
        { token: parentState.token },
        { $set: { isRevoked: true } },
      );
    if (revoke === 'verifier')
      await User.updateOne(
        { _id: parentState.verifier._id },
        { $set: { isActive: false } },
      );
    for (const response of [
      await http(`${root()}/${id}`),
      await http(root(), parentState.token, operation('create', fields())),
    ]) {
      assert.ok(
        [401, 403, 404].includes(response.status),
        JSON.stringify(response),
      );
      assert.ok(!JSON.stringify(response.data).includes('PRIVATE'));
    }
    assert.equal(await EarlyExitRequest.countDocuments(), 1);
  });
test('expired, unregistered and wrong-role JWTs fail every endpoint without any mutation', async () => {
  const id = await draft();
  // A distinct old JWT with valid signature is still expired even if registered.
  const expired = jwt.sign(
    { userId: String(parentState.parent._id), role: 'parent', exp: 1 },
    process.env.JWT_SECRET!,
  );
  const unknown = jwt.sign(
    {
      userId: String(parentState.parent._id),
      role: 'parent',
      nonce: 'unregistered',
    },
    process.env.JWT_SECRET!,
  );
  await registerSession(String(parentState.parent._id), expired, 'parent');
  for (const token of ['', expired, unknown, state.token]) {
    for (const [path, body, method] of [
      [root(), undefined, 'GET'],
      [`${root()}/${id}`, undefined, 'GET'],
      [root(), operation('denied', fields()), 'POST'],
      [
        `${root()}/${id}`,
        operation('denied', { ...fields(), applicationRevision: 0 }),
        'PATCH',
      ],
      [
        `${root()}/${id}/submit`,
        operation('denied', { applicationRevision: 0 }),
        'POST',
      ],
      [`${root()}/${id}/withdraw`, operation('denied', versions()), 'POST'],
      [
        `${root()}/${id}/resubmit`,
        operation('denied', { ...fields(), ...versions() }),
        'POST',
      ],
    ] as const)
      assert.ok(
        [401, 403].includes((await http(path, token, body, method)).status),
      );
    for (const [path, body] of [
      [reviews, undefined],
      [`${reviews}/${oid()}`, undefined],
      [
        `${reviews}/${oid()}/decisions`,
        operation('deny', {
          action: 'reject',
          ...versions(),
          decisionReason: 'No authority to review',
        }),
      ],
    ] as const)
      assert.ok([401, 403].includes((await http(path, token, body)).status));
  }
  assert.equal(await EarlyExitOperation.countDocuments(), 1);
});
test('routing and category grants are explicit, separate from role and pickup permission', async () => {
  const id = await draft();
  delete process.env.EARLY_EXIT_ROUTING_POLICY;
  assert.equal((await http(`${root()}/${id}`)).status, 200);
  assert.equal(
    (
      await http(
        `${root()}/${id}/submit`,
        parentState.token,
        operation('submit', { applicationRevision: 0 }),
      )
    ).status,
    503,
  );
  assert.equal((await http(reviews, principalToken)).status, 503);
  process.env.EARLY_EXIT_ROUTING_POLICY = routing();
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify({
    [String(parentState.verifier._id)]: {
      branchId: String(state.branch._id),
      types: ['pickup_authorization', 'leave'],
    },
  });
  assert.equal((await http(reviews, principalToken)).status, 403);
  assert.equal(
    (
      await http(
        `${root()}/${id}/submit`,
        parentState.token,
        operation('submit', { applicationRevision: 0 }),
      )
    ).status,
    503,
  );
  assert.equal(await ApprovalRequest.countDocuments(), 0);
});
test('canonical typed queue approvalId resolves and safe explicit list DTOs omit private payloads', async () => {
  const request = await pending(),
    queue = await http(reviews, principalToken);
  assert.equal(queue.status, 200);
  const row = queue.data.data.items[0];
  assert.equal(row.approvalId, request.approvalId);
  assert.ok(!JSON.stringify(queue.data).includes('PRIVATE'));
  assert.ok(!('reason' in row));
  assert.ok(!('history' in row));
  const detail = await http(`${reviews}/${row.approvalId}`, principalToken);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.data.requestId, request.id);
  assert.equal(detail.data.data.reason, fields().reason);
  assert.equal(detail.data.data.capabilities.canApprove, false);
});

for (const revoke of [
  'inactive',
  'role',
  'session',
  'branch',
  'grant',
  'routing',
] as const)
  test(`current Principal ${revoke} revocation conceals reads and denies decision receipt replay`, async () => {
    const request = await returned();
    const retained = await EarlyExitRequest.collection.findOne({
      _id: new mongoose.Types.ObjectId(request.id),
    });
    if (revoke === 'inactive')
      await User.updateOne(
        { _id: parentState.verifier._id },
        { $set: { isActive: false } },
      );
    if (revoke === 'role')
      await User.updateOne(
        { _id: parentState.verifier._id },
        { $set: { role: 'teacher' } },
      );
    if (revoke === 'session')
      await Session.updateOne(
        { token: principalToken },
        { $set: { isRevoked: true } },
      );
    if (revoke === 'branch')
      await User.updateOne(
        { _id: parentState.verifier._id },
        { $set: { branchId: state.foreign._id } },
      );
    if (revoke === 'grant') process.env.PRINCIPAL_APPROVAL_AUTHORITY = '{}';
    if (revoke === 'routing') delete process.env.EARLY_EXIT_ROUTING_POLICY;
    for (const response of [
      await http(reviews, principalToken),
      await http(`${reviews}/${request.approvalId}`, principalToken),
      await decide(request.approvalId),
    ]) {
      assert.ok(
        [401, 403, 404, 503].includes(response.status),
        JSON.stringify(response.data),
      );
      assert.ok(!JSON.stringify(response.data).includes('PRIVATE'));
    }
    assert.deepEqual(
      await EarlyExitRequest.collection.findOne({
        _id: new mongoose.Types.ObjectId(request.id),
      }),
      retained,
    );
    assert.equal(await EarlyExitOperation.countDocuments(), 3);
  });

for (const permission of [
  PERMISSIONS.PRINCIPAL_APPROVALS_VIEW,
  PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE,
])
  test(`current ${permission} permission is required and cannot be supplied by a client`, async () => {
    const request = await pending();
    const prior = ROLE_PERMISSIONS.principal;
    try {
      ROLE_PERMISSIONS.principal = prior.filter(value => value !== permission);
      assert.equal((await decide(request.approvalId, 'reject')).status, 403);
      const detail = await http(
        `${reviews}/${request.approvalId}`,
        principalToken,
      );
      assert.equal(
        detail.status,
        permission === PERMISSIONS.PRINCIPAL_APPROVALS_VIEW ? 403 : 200,
      );
      if (detail.status === 200)
        assert.deepEqual(detail.data.data.capabilities.allowedActions, []);
      assert.equal(
        (await EarlyExitRequest.findById(request.id).orFail()).state,
        'pending',
      );
      assert.equal(await EarlyExitOperation.countDocuments(), 2);
    } finally {
      ROLE_PERMISSIONS.principal = prior;
    }
  });

test('Principal receipt replay projects only safe acknowledgements and conflicting decision payloads fail', async () => {
  const request = await returned();
  await EarlyExitOperation.collection.updateOne(
    { kind: 'request_changes' },
    {
      $set: {
        'result.privateMedicalEvidence': 'NEVER-RETURN',
        'result.internalAuthority': { grant: true },
      },
    },
  );
  const replay = await decide(request.approvalId);
  assert.equal(replay.status, 200);
  assert.equal(replay.data.data.replayed, true);
  assert.ok(!JSON.stringify(replay.data).includes('NEVER-RETURN'));
  assert.ok(!('internalAuthority' in replay.data.data));
  assert.equal((await decide(request.approvalId, 'reject')).status, 409);
  assert.equal(await EarlyExitOperation.countDocuments(), 3);
});
test('a foreign Principal with its own explicit grant cannot list or read this Branch request', async () => {
  const request = await pending();
  const reviewer = await put(User, {
    role: 'principal',
    isActive: true,
    fullName: 'Foreign reviewer',
    branchId: state.foreign._id,
  });
  const token = generateAccessToken(String(reviewer._id), 'principal');
  await registerSession(String(reviewer._id), token, 'principal');
  process.env.EARLY_EXIT_ROUTING_POLICY = JSON.stringify({
    policy: 'shared_branch_principal',
    version: 1,
    enabled: true,
    branchIds: [String(state.branch._id), String(state.foreign._id)],
  });
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify({
    [String(reviewer._id)]: {
      branchId: String(state.foreign._id),
      types: ['early_exit_request'],
    },
  });
  assert.deepEqual((await http(reviews, token)).data.data.items, []);
  assert.equal(
    (await http(`${reviews}/${request.approvalId}`, token)).status,
    404,
  );
  assert.equal(
    (
      await http(
        `${reviews}/${request.approvalId}/decisions`,
        token,
        operation('foreign', {
          action: 'reject',
          ...versions(),
          decisionReason: 'Foreign request not authorized',
        }),
      )
    ).status,
    404,
  );
});
test('request changes, revised snapshots, resubmission and terminal rejection preserve one original approval', async () => {
  const request = await returned();
  const original = await EarlyExitSubmission.collection.findOne({});
  assert.ok(original);
  const body = operation('resubmit', {
    ...fields(),
    reason: 'Revised private departure reason',
    ...versions(2, 1),
  });
  const response = await http(
    `${root()}/${request.id}/resubmit`,
    parentState.token,
    body,
  );
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.equal(response.data.data.approvalId, request.approvalId);
  assert.equal(
    (await http(`${root()}/${request.id}/resubmit`, parentState.token, body))
      .data.data.replayed,
    true,
  );
  assert.equal(
    (await decide(request.approvalId)).data.data.request.state,
    'pending',
  );
  assert.deepEqual(
    await EarlyExitSubmission.collection.findOne({ _id: original._id }),
    original,
  );
  assert.equal(await ApprovalRequest.countDocuments(), 1);
  assert.equal(await EarlyExitSubmission.countDocuments(), 2);
  assert.equal(
    (await decide(request.approvalId, 'reject', 'reject', versions(3, 2)))
      .status,
    200,
  );
  assert.equal(
    (
      await http(
        `${root()}/${request.id}/withdraw`,
        parentState.token,
        operation('late', versions(4, 3)),
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await http(
        `${root()}/${request.id}`,
        parentState.token,
        operation('late-edit', { ...fields(), applicationRevision: 4 }),
        'PATCH',
      )
    ).status,
    409,
  );
});
test('pending withdrawal is auditable, replayable and available when only review routing is disabled', async () => {
  const request = await pending();
  delete process.env.EARLY_EXIT_ROUTING_POLICY;
  const body = operation('withdraw', versions());
  const response = await http(
    `${root()}/${request.id}/withdraw`,
    parentState.token,
    body,
  );
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.equal(response.data.data.request.state, 'withdrawn');
  assert.equal(
    (await http(`${root()}/${request.id}/withdraw`, parentState.token, body))
      .data.data.replayed,
    true,
  );
  assert.equal(
    (await ApprovalRequest.findById(request.approvalId).orFail()).status,
    'withdrawn',
  );
  assert.equal(await EarlyExitSubmission.countDocuments(), 1);
});
test('generic reads, queues, decisions, delegation and requester resubmission never bypass Early Exit', async () => {
  const request = await pending();
  for (const path of [
    `/approval-requests/${request.approvalId}`,
    `/approval-requests/${request.approvalId}/eligible-delegates`,
  ])
    assert.equal((await http(path, principalToken)).status, 403);
  for (const action of [
    'approved',
    'rejected',
    'changes_requested',
    'delegated',
  ])
    assert.equal(
      (
        await http(
          `/approval-requests/${request.approvalId}`,
          principalToken,
          {
            action,
            reason: 'Generic bypass attempt',
            ...(action === 'delegated'
              ? {
                  delegatedTo: String(parentState.verifier._id),
                  delegationExpiresAt: new Date(
                    Date.now() + 3_600_000,
                  ).toISOString(),
                }
              : {}),
          },
          'PATCH',
        )
      ).status,
      403,
    );
  assert.ok(
    !JSON.stringify(
      (await http('/approval-requests/pending', principalToken)).data,
    ).includes(request.approvalId),
  );
  assert.ok(
    [401, 403].includes(
      (
        await http(
          `/approval-requests/${request.approvalId}/resubmit`,
          parentState.token,
          { reason: 'Generic bypass attempt', revision: 0 },
          'PATCH',
        )
      ).status,
    ),
  );
});
for (const hold of [false, true])
  test(`missing independently approved policy blocks approval, custody Hold ${hold}, without Gate/attendance/notification effects`, async () => {
    const request = await pending();
    if (hold)
      await put(StudentCustodyState, {
        studentId: state.student._id,
        branchId: state.branch._id,
        enrollmentId: state.enrollment._id,
        state: 'hold',
      });
    const before = await EarlyExitRequest.collection.findOne({
      _id: new mongoose.Types.ObjectId(request.id),
    });
    const response = await decide(request.approvalId, 'approve');
    assert.equal(response.status, 403);
    assert.ok(!JSON.stringify(response.data).includes('PRIVATE'));
    assert.deepEqual(
      await EarlyExitRequest.collection.findOne({
        _id: new mongoose.Types.ObjectId(request.id),
      }),
      before,
    );
    assert.equal(
      (await http(`${root()}/${request.id}`)).data.data.eligibility
        .custodyState,
      hold ? 'hold' : 'unknown',
    );
    for (const model of [
      PickupPerson,
      PickupAuthorization,
      StudentLeave,
      AttendanceCorrection,
      AttendanceSession,
      PeriodAttendanceRecord,
      Notification,
      ParentLeaveApplication,
    ])
      assert.equal(await model.collection.countDocuments(), 0);
    assert.equal(await EarlyExitOperation.countDocuments(), 2); // create + submit, no approval receipt
  });
test('stale revisions, malformed dates, forged reciprocal links and snapshot corruption fail closed', async () => {
  const request = await pending();
  assert.equal(
    (await decide(request.approvalId, 'reject', 'stale', versions(0, 0)))
      .status,
    409,
  );
  assert.equal(
    (
      await http(
        `${root()}/${request.id}/withdraw`,
        parentState.token,
        operation('stale', versions(1, 4)),
      )
    ).status,
    409,
  );
  await ApprovalRequest.updateOne(
    { _id: request.approvalId },
    { $set: { entityId: oid() } },
  );
  assert.equal(
    (await http(`${reviews}/${request.approvalId}`, principalToken)).status,
    404,
  );
  await ApprovalRequest.updateOne(
    { _id: request.approvalId },
    { $set: { entityId: new mongoose.Types.ObjectId(request.id) } },
  );
  await EarlyExitSubmission.collection.updateOne(
    { requestId: new mongoose.Types.ObjectId(request.id) },
    { $set: { reason: 'Tampered snapshot' } },
  );
  assert.equal((await http(`${root()}/${request.id}`)).status, 409);
  assert.equal((await decide(request.approvalId, 'reject')).status, 409);
});
test('Principal reads recheck Parent authority after the completed snapshot', async () => {
  const request = await pending(),
    original = Session.findOne.bind(Session);
  let calls = 0;
  mock.method(Session, 'findOne', (...args: Parameters<typeof original>) => {
    const query = original(...args),
      lean = query.lean.bind(query);
    query.lean = (async () => {
      const value = await lean();
      if (++calls === 3)
        await ParentStudentLink.updateOne(
          { _id: parentState.link._id },
          { $set: { isActive: false } },
        );
      return value;
    }) as typeof query.lean;
    return query;
  });
  await assert.rejects(
    () =>
      readPrincipalExits(
        { userId: String(parentState.verifier._id), role: 'principal' },
        principalToken,
        request.approvalId,
      ),
    (error: unknown) =>
      error instanceof Error && 'status' in error && error.status === 404,
  );
});
test('required unique indexes are initialized idempotently with autoIndex disabled', async () => {
  for (const [model, indexName] of [
    [EarlyExitRequest, 'early_exit_reciprocal_approval_unique'],
    [EarlyExitSubmission, 'early_exit_submission_cycle_unique'],
    [EarlyExitSubmission, 'early_exit_submission_revision_unique'],
    [EarlyExitOperation, 'early_exit_actor_operation_unique'],
    [ApprovalRequest, 'one_approval_per_early_exit'],
  ] as const)
    assert.ok(
      (await model.collection.indexes()).some(
        index => index.name === indexName && index.unique,
      ),
    );
});

function worker(
  input: Partial<EarlyExitWorkerInput> & Pick<EarlyExitWorkerInput, 'action'>,
) {
  const child = fork(resolve(__dirname, 'helpers/early-exit-worker.ts'), {
    execArgv: ['--import', 'tsx'],
    silent: true,
  });
  const events: {
    event: string;
    status?: number;
    result?: { replayed?: boolean };
  }[] = [];
  let stderr = '';
  child.stderr?.on('data', part => {
    stderr += String(part);
  });
  child.on('message', message =>
    events.push(message as (typeof events)[number]),
  );
  const until = async (event: string) => {
    const deadline = Date.now() + 20000;
    while (!events.some(message => message.event === event)) {
      assert.equal(child.exitCode, null, stderr);
      assert.ok(Date.now() < deadline, `Worker timed out: ${event} ${stderr}`);
      await new Promise(done => setTimeout(done, 50));
    }
    return events.find(message => message.event === event)!;
  };
  child.send({
    uri: `mongodb://${mongoose.connection.host}:${
      mongoose.connection.port
    }/?replicaSet=${mongoose.connection.getClient().options.replicaSet}`,
    dbName: mongoose.connection.name,
    identity: { userId: String(parentState.parent._id), role: 'parent' },
    token: parentState.token,
    branchId: String(state.branch._id),
    studentId: String(state.student._id),
    requestId: '',
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
const reviewer = () => ({
  identity: {
    userId: String(parentState.verifier._id),
    role: 'principal' as const,
  },
  token: principalToken,
});
const decisionPayload = (
  nonce: string,
  action = 'reject',
  version = versions(),
) =>
  operation(nonce, {
    ...version,
    action,
    decisionReason: 'Independent reviewed departure reason',
  });
for (const same of [true, false])
  test(`independent duplicate submissions serialize, identical receipt ${same}`, async () => {
    const id = await draft(),
      first = worker({
        action: 'submit',
        requestId: id,
        hold: true,
        payload: operation('submit', { applicationRevision: 0 }),
      });
    let second: ReturnType<typeof worker> | undefined;
    try {
      await first.until('locked');
      second = worker({
        action: 'submit',
        requestId: id,
        payload: operation(same ? 'submit' : 'competing', {
          applicationRevision: 0,
        }),
      });
      await second.until('attempting');
      first.release();
      assert.equal((await first.until('result')).status, 200);
      const result = await second.until('result');
      assert.equal(result.status, same ? 200 : 409);
      if (same) assert.equal(result.result?.replayed, true);
      assert.equal(await ApprovalRequest.countDocuments(), 1);
      assert.equal(await EarlyExitSubmission.countDocuments(), 1);
    } finally {
      first.stop();
      second?.stop();
    }
  });
for (const withdrawFirst of [true, false])
  test(`independent withdrawal versus Principal decision, withdraw first ${withdrawFirst}`, async () => {
    const request = await pending(),
      withdraw = {
        action: 'withdraw' as const,
        requestId: request.id,
        payload: operation('withdraw', versions()),
      },
      review = {
        action: 'decide' as const,
        approvalId: request.approvalId,
        ...reviewer(),
        payload: decisionPayload('reject'),
      };
    const first = worker({
      ...(withdrawFirst ? withdraw : review),
      hold: true,
    });
    let second: ReturnType<typeof worker> | undefined;
    try {
      await first.until('locked');
      second = worker(withdrawFirst ? review : withdraw);
      await second.until('attempting');
      first.release();
      assert.equal((await first.until('result')).status, 200);
      assert.equal((await second.until('result')).status, 409);
      const row = await EarlyExitRequest.findById(request.id).orFail();
      assert.equal(row.state, withdrawFirst ? 'withdrawn' : 'rejected');
      assert.equal(
        (await ApprovalRequest.findById(request.approvalId).orFail()).status,
        row.state,
      );
    } finally {
      first.stop();
      second?.stop();
    }
  });
test('two independent current Principals cannot both decide a pending request', async () => {
  const request = await pending();
  const other = await put(User, {
      role: 'principal',
      branchId: state.branch._id,
      isActive: true,
      fullName: 'Second Principal',
    }),
    token = generateAccessToken(String(other._id), 'principal');
  await registerSession(String(other._id), token, 'principal');
  const grants = JSON.parse(process.env.PRINCIPAL_APPROVAL_AUTHORITY!);
  grants[String(other._id)] = {
    branchId: String(state.branch._id),
    types: ['early_exit_request'],
  };
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify(grants);
  const first = worker({
    action: 'decide',
    ...reviewer(),
    approvalId: request.approvalId,
    payload: decisionPayload('first'),
    hold: true,
  });
  let second: ReturnType<typeof worker> | undefined;
  try {
    await first.until('locked');
    second = worker({
      action: 'decide',
      identity: { userId: String(other._id), role: 'principal' },
      token,
      approvalId: request.approvalId,
      payload: decisionPayload('second', 'request_changes'),
    });
    await second.until('attempting');
    first.release();
    assert.equal((await first.until('result')).status, 200);
    assert.equal((await second.until('result')).status, 409);
    assert.equal(await EarlyExitOperation.countDocuments(), 3);
  } finally {
    first.stop();
    second?.stop();
  }
});
for (const resubmitFirst of [true, false])
  test(`independent Request Changes versus resubmission retains valid serial order, resubmit first ${resubmitFirst}`, async () => {
    const request = await pending(),
      changes = {
        action: 'decide' as const,
        ...reviewer(),
        approvalId: request.approvalId,
        payload: decisionPayload('changes', 'request_changes'),
      },
      resubmit = {
        action: 'resubmit' as const,
        requestId: request.id,
        payload: operation('resubmit', { ...fields(), ...versions(2, 1) }),
      };
    const first = worker({
      ...(resubmitFirst ? resubmit : changes),
      hold: true,
    });
    let second: ReturnType<typeof worker> | undefined;
    try {
      await first.until('locked');
      second = worker(resubmitFirst ? changes : resubmit);
      await second.until('attempting');
      first.release();
      assert.equal(
        (await first.until('result')).status,
        resubmitFirst ? 409 : 200,
      );
      assert.equal((await second.until('result')).status, 200);
      assert.equal(
        (await EarlyExitRequest.findById(request.id).orFail()).state,
        resubmitFirst ? 'changes_requested' : 'pending',
      );
      assert.equal(await ApprovalRequest.countDocuments(), 1);
    } finally {
      first.stop();
      second?.stop();
    }
  });
for (const revoke of ['link', 'enrollment', 'session', 'role'] as const)
  test(`independent write detects committed ${revoke} revocation before dependency fences`, async () => {
    const id = await draft(),
      work = worker({
        action: 'submit',
        requestId: id,
        payload: operation('submit', { applicationRevision: 0 }),
        hold: true,
      });
    try {
      await work.until('locked');
      if (revoke === 'link')
        await ParentStudentLink.updateOne(
          { _id: parentState.link._id },
          { $set: { isActive: false } },
        );
      if (revoke === 'enrollment')
        await StudentEnrollment.updateOne(
          { _id: state.enrollment._id },
          { $set: { status: 'transferred', effectiveTo: new Date() } },
        );
      if (revoke === 'session')
        await Session.updateOne(
          { token: parentState.token },
          { $set: { isRevoked: true } },
        );
      if (revoke === 'role')
        await User.updateOne(
          { _id: parentState.parent._id },
          { $set: { role: 'student' } },
        );
      work.release();
      assert.ok([401, 403, 404].includes((await work.until('result')).status!));
      assert.equal(await ApprovalRequest.countDocuments(), 0);
      assert.equal(
        (await EarlyExitRequest.findById(id).orFail()).state,
        'draft',
      );
    } finally {
      work.stop();
    }
  });
for (const scenario of ['submit-routing', 'decision-grant'] as const)
  test(`${scenario} changed after staged writes rolls back the transaction`, async () => {
    const request =
      scenario === 'submit-routing'
        ? { id: await draft(), approvalId: '' }
        : await pending();
    const before = await EarlyExitRequest.collection.findOne({
        _id: new mongoose.Types.ObjectId(request.id),
      }),
      create = EarlyExitOperation.create.bind(EarlyExitOperation);
    mock.method(
      EarlyExitOperation,
      'create',
      async (...args: Parameters<typeof create>) => {
        const result = await create(...args);
        if (scenario === 'submit-routing')
          process.env.EARLY_EXIT_ROUTING_POLICY = routing(2);
        else process.env.PRINCIPAL_APPROVAL_AUTHORITY = '{}';
        return result;
      },
    );
    const response =
      scenario === 'submit-routing'
        ? await http(
            `${root()}/${request.id}/submit`,
            parentState.token,
            operation('submit', { applicationRevision: 0 }),
          )
        : await decide(request.approvalId, 'reject');
    assert.ok([403, 409, 503].includes(response.status));
    assert.deepEqual(
      await EarlyExitRequest.collection.findOne({
        _id: new mongoose.Types.ObjectId(request.id),
      }),
      before,
    );
    assert.equal(
      await EarlyExitOperation.countDocuments(),
      scenario === 'submit-routing' ? 1 : 2,
    );
  });
for (const kind of ['create', 'submit', 'resubmit', 'decision'] as const)
  for (const stage of kind === 'create'
    ? ['request', 'receipt']
    : kind === 'decision'
    ? ['request', 'approval', 'receipt']
    : ['approval', 'snapshot', 'request', 'receipt'])
    test(`${kind} failure after ${stage} write rolls back every linked record`, async () => {
      const request =
        kind === 'create'
          ? null
          : kind === 'resubmit'
          ? await returned()
          : kind === 'decision'
          ? await pending()
          : { id: await draft(), approvalId: '' };
      const models = [
        EarlyExitRequest,
        EarlyExitSubmission,
        EarlyExitOperation,
        ApprovalRequest,
      ];
      const before = await Promise.all(
        models.map(model =>
          model.collection.find({}).sort({ _id: 1 }).toArray(),
        ),
      );
      const fail = () => {
        throw new Error('Injected internal failure that must be sanitized');
      };
      if (stage === 'request') {
        const save = EarlyExitRequest.prototype.save;
        mock.method(
          EarlyExitRequest.prototype,
          'save',
          async function (...args: Parameters<typeof save>) {
            const result = await save.apply(this, args);
            fail();
            return result;
          },
        );
      }
      if (stage === 'receipt') {
        const create = EarlyExitOperation.create.bind(EarlyExitOperation);
        mock.method(
          EarlyExitOperation,
          'create',
          async (...args: Parameters<typeof create>) => {
            const result = await create(...args);
            fail();
            return result;
          },
        );
      }
      if (stage === 'snapshot') {
        const create = EarlyExitSubmission.create.bind(EarlyExitSubmission);
        mock.method(
          EarlyExitSubmission,
          'create',
          async (...args: Parameters<typeof create>) => {
            const result = await create(...args);
            fail();
            return result;
          },
        );
      }
      if (stage === 'approval') {
        if (kind === 'submit') {
          const create = ApprovalRequest.create.bind(ApprovalRequest);
          mock.method(
            ApprovalRequest,
            'create',
            async (...args: Parameters<typeof create>) => {
              const result = await create(...args);
              fail();
              return result;
            },
          );
        } else {
          const update = ApprovalRequest.collection.updateOne.bind(
            ApprovalRequest.collection,
          );
          mock.method(
            ApprovalRequest.collection,
            'updateOne',
            async (...args: Parameters<typeof update>) => {
              const result = await update(...args);
              fail();
              return result;
            },
          );
        }
      }
      const response =
        kind === 'create'
          ? await http(
              root(),
              parentState.token,
              operation('failure', fields()),
            )
          : kind === 'submit'
          ? await http(
              `${root()}/${request!.id}/submit`,
              parentState.token,
              operation('failure', { applicationRevision: 0 }),
            )
          : kind === 'resubmit'
          ? await http(
              `${root()}/${request!.id}/resubmit`,
              parentState.token,
              operation('failure', { ...fields(), ...versions(2, 1) }),
            )
          : await decide(request!.approvalId, 'reject', 'failure');
      assert.equal(response.status, 500, JSON.stringify(response.data));
      assert.ok(!JSON.stringify(response.data).includes('Injected'));
      assert.deepEqual(
        await Promise.all(
          models.map(model =>
            model.collection.find({}).sort({ _id: 1 }).toArray(),
          ),
        ),
        before,
      );
    });
