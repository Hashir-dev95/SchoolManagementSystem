import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import type { Server } from 'node:http';
import app from '../src/app';
import { after, before, beforeEach, test } from 'node:test';
import { AcademicPeriod } from '../src/models/academicPeriod';
import ApprovalRequest from '../src/models/approvalRequest';
import { StudentEnrollment } from '../src/models/studentEnrollment';
import {
  PickupCustodyPolicy,
  ensurePickupAuthorizationIndexes,
} from '../src/models/pickupAuthorization';
import { addScheduleDays } from '../src/services/school-date.service';
import { state, parentState, put } from './helpers/parent-workspace.fixture';
import User from '../src/models/user';
import Session from '../src/models/session';
import { ParentStudentLink } from '../src/models/parentStudentLink';
import { StudentCustodyState } from '../src/models/gateFoundation';
import {
  PickupPerson,
  PickupAuthorization,
  PickupSubmission,
  pickupDigest,
} from '../src/models/pickupAuthorization';
import { ensureEarlyExitIndexes } from '../src/models/earlyExitRequest';
import { generateAccessToken } from '../src/services/jwt.service';
import { registerSession } from '../src/services/session.service';
import { writeParentPickup } from '../src/services/pickup-authorization-write.service';
import {
  collectorIdentityBindingMatches,
  schoolCustodyPolicyContract,
  assessSchoolCustodyPolicy,
} from '../src/services/school-custody-contract';
import { Notification } from '../src/models/notification';
import {
  AttendanceSession,
  PeriodAttendanceRecord,
} from '../src/models/periodAttendance';
import {
  StudentLeave,
  AttendanceCorrection,
} from '../src/models/attendanceAmendment';

const root = () =>
  `/parent/me/children/${state.student._id}/pickup-authorizations`;
const envKeys = [
  'PICKUP_AUTHORIZATION_ROUTING_POLICY',
  'EARLY_EXIT_ROUTING_POLICY',
  'PRINCIPAL_APPROVAL_AUTHORITY',
  'GATE_ADMIN_BRANCH_IDS',
] as const;
const savedEnvironment = envKeys.map(key => process.env[key]);
let server: Server, base: string;
async function apiHttp(path: string, token: string, body?: unknown) {
  const response = await fetch(base + '/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    json: response.headers.get('content-type')?.includes('application/json')
      ? await response.json()
      : null,
  };
}

test('B1 real Principal decision fences retain submitted identity, policy binding and history', async () => {
  process.env.PICKUP_AUTHORIZATION_ROUTING_POLICY = JSON.stringify({
    policy: 'shared_branch_principal',
    version: 1,
    enabled: true,
    branchIds: [String(state.branch._id)],
  });
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify({
    [String(parentState.verifier._id)]: {
      branchId: String(state.branch._id),
      types: ['pickup_authorization'],
    },
  });
  const principalToken = generateAccessToken(
    String(parentState.verifier._id),
    'principal',
  );
  await registerSession(
    String(parentState.verifier._id),
    principalToken,
    'principal',
  );
  const path = await draft();
  const submitted = await apiHttp(`${path}/submit`, parentState.token, {
    clientOperationId: 'b1-submit',
    applicationRevision: 0,
    personRevision: 0,
  });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.json));
  const approvalId = submitted.json.data.approvalId;
  const original = await PickupPerson.findOne()
    .select('+phone +history')
    .lean()
    .orFail();
  const policy = await PickupCustodyPolicy.findOne().lean().orFail();
  const snapshots = await PickupSubmission.find()
    .select('+payload +fingerprint')
    .lean();
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].personRevision, original.revision);
  const approval = await ApprovalRequest.findById(approvalId).lean().orFail();
  const response = await apiHttp(
    `/principal/pickup-authorizations/${approvalId}/decisions`,
    principalToken,
    {
      clientOperationId: 'b1-request-changes',
      action: 'request_changes',
      applicationRevision: 1,
      personRevision: original.revision,
      approvalVersion: approval.__v,
      decisionReason: 'Please clarify the proposed collector details',
    },
  );
  assert.equal(response.status, 200, JSON.stringify(response.json));
  const current = await PickupPerson.findById(original._id)
    .select('+phone +history')
    .lean()
    .orFail();
  const fencedPolicy = await PickupCustodyPolicy.findById(policy._id)
    .lean()
    .orFail();
  assert.ok(current.__v! > original.__v!);
  assert.ok(fencedPolicy.__v! > policy.__v!);
  assert.equal(current.revision, original.revision);
  assert.deepEqual(current.history, original.history);
  for (const key of [
    'requesterId',
    'parentStudentLinkId',
    'studentId',
    'branchId',
    'enrollmentId',
    'academicPeriodId',
    'classId',
    'sectionId',
  ] as const)
    assert.equal(String(current[key]), String(original[key]));
  assert.deepEqual(
    await PickupSubmission.find().select('+payload +fingerprint').lean(),
    snapshots,
  );
  const decided = await ApprovalRequest.findById(approvalId).lean().orFail();
  assert.deepEqual(decided.history.slice(0, -1), approval.history);
  assert.equal(decided.history.at(-1)?.action, 'changes_requested');
  assert.deepEqual(
    schoolCustodyPolicyContract(fencedPolicy, String(state.branch._id)),
    schoolCustodyPolicyContract(policy, String(state.branch._id)),
  );
  const parentRead = await apiHttp(path, parentState.token);
  assert.equal(parentRead.status, 200);
  assert.equal(parentRead.json.data.eligibility.operationallyEligible, false);
  assert.equal(
    (
      await apiHttp(
        `/principal/pickup-authorizations/${approvalId}`,
        principalToken,
      )
    ).status,
    200,
  );
});

test('B1 document transaction version cannot replace the collector identity revision in edits', async () => {
  await draft();
  const row = await PickupAuthorization.findOne().orFail();
  // Fixture-only transaction metadata perturbation, not a verification writer.
  await PickupPerson.collection.updateOne(
    { _id: row.pickupPersonId },
    { $set: { __v: 9 } },
  );
  const original = await PickupPerson.findById(row.pickupPersonId)
    .select('+phone +history')
    .lean()
    .orFail();
  await assert.rejects(
    () =>
      writeParentPickup(
        'edit',
        {
          userId: String(parentState.parent._id),
          role: 'parent',
        },
        parentState.token,
        String(state.student._id),
        String(row._id),
        {
          clientOperationId: 'b1-wrong-revision',
          applicationRevision: 0,
          personRevision: original.__v,
          fullName: original.fullName,
          relationship: original.relationship,
          phone: original.phone,
          validFromDate: state.today,
          validUntilDate: addScheduleDays(state.today, 2),
          notes: '',
        },
      ),
    (error: unknown) =>
      error instanceof Error && 'status' in error && error.status === 409,
  );
  assert.deepEqual(
    await PickupPerson.findById(original._id).select('+phone +history').lean(),
    original,
  );
  assert.equal(
    (await PickupAuthorization.findById(row._id).orFail()).revision,
    0,
  );
});

test('B1 an authorized custody Hold remains effective despite a matching collector identity', async () => {
  const path = await draft();
  const original = await PickupPerson.findOne()
    .select('+phone +history')
    .lean()
    .orFail();
  const admin = await User.create({
    fullName: 'Fictional Custody Administrator',
    email: 'b1-admin@fixture.invalid',
    password: 'fixture-only',
    role: 'super_admin',
  });
  const token = generateAccessToken(String(admin._id), 'super_admin');
  await registerSession(String(admin._id), token, 'super_admin');
  process.env.GATE_ADMIN_BRANCH_IDS = JSON.stringify([
    String(state.branch._id),
  ]);
  const custodyPath = `/gate-admin/branches/${state.branch._id}/students/${state.student._id}/custody`;
  const hold = await apiHttp(custodyPath, token, {
    clientOperationId: 'b1-hold',
    reason: 'School fixture safeguarding restriction',
    state: 'hold',
    revision: 0,
  });
  assert.equal(hold.status, 200, JSON.stringify(hold.json));
  const record = await StudentCustodyState.findOne()
    .select('+history')
    .lean()
    .orFail();
  const current = await PickupPerson.findById(original._id)
    .select('+phone +history')
    .lean()
    .orFail();
  const binding = {
    pickupPersonId: String(original._id),
    personRevision: original.revision,
    identityFingerprint: pickupDigest([
      original.fullName,
      original.relationship,
      original.phone,
    ]),
    provenance: Object.fromEntries(
      [
        'requesterId',
        'parentStudentLinkId',
        'studentId',
        'branchId',
        'enrollmentId',
        'academicPeriodId',
        'classId',
        'sectionId',
      ].map(key => [key, String(original[key as keyof typeof original])]),
    ),
  };
  assert.equal(collectorIdentityBindingMatches(binding, current), true);
  const read = await apiHttp(path, parentState.token);
  assert.equal(read.status, 200);
  assert.equal(read.json.data.eligibility.custodyState, 'hold');
  assert.equal(read.json.data.eligibility.operationallyEligible, false);
  const denied = await apiHttp(custodyPath, parentState.token, {
    clientOperationId: 'b1-forged-clear',
    reason: 'Parent cannot clear school custody restriction',
    state: 'unknown',
    revision: 1,
  });
  assert.equal(denied.status, 403);
  assert.deepEqual(
    await StudentCustodyState.findById(record._id).select('+history').lean(),
    record,
  );
  assert.equal(String(record.enrollmentId), String(state.enrollment._id));
});

test('B1 replacement enrollment cannot inherit an old proposal or retarget its provenance', async () => {
  const path = await draft();
  const original = await PickupAuthorization.findOne()
    .select('+history')
    .lean()
    .orFail();
  const personBefore = await PickupPerson.findOne()
    .select('+phone +history')
    .lean()
    .orFail();
  await StudentEnrollment.updateOne(
    { _id: state.enrollment._id },
    { $set: { status: 'transferred', effectiveTo: new Date() } },
  );
  await put(StudentEnrollment, {
    studentId: state.student._id,
    branchId: state.branch._id,
    academicPeriodId: state.period._id,
    classId: state.cls._id,
    sectionId: state.section._id,
    status: 'active',
    effectiveFrom: new Date(Date.now() - 1000),
    previousEnrollmentId: state.enrollment._id,
  });
  const detail = await apiHttp(path, parentState.token);
  assert.equal(detail.status, 404);
  assert.ok(!JSON.stringify(detail.json).includes('PRIVATE_FIXTURE_ONLY'));
  const list = await apiHttp(root(), parentState.token);
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.data.items, []);
  const replay = await apiHttp(root(), parentState.token, {
    clientOperationId: 'foundation-create',
    fullName: 'Fictional Collector',
    relationship: 'Family friend',
    phone: '+92 300 0000000',
    validFromDate: state.today,
    validUntilDate: addScheduleDays(state.today, 2),
    notes: 'PRIVATE_FIXTURE_ONLY',
  });
  assert.equal(replay.status, 404);
  assert.equal(await PickupAuthorization.countDocuments(), 1);
  assert.deepEqual(
    await PickupAuthorization.findById(original._id).select('+history').lean(),
    original,
  );
  assert.deepEqual(
    await PickupPerson.findById(personBefore._id)
      .select('+phone +history')
      .lean(),
    personBefore,
  );
});

test('B1 revision and invalidation diagnostics are rejected as Parent authority claims', async () => {
  for (const claim of [
    { verificationRevision: 1 },
    { documentVersions: { pickupPerson: 1, policy: 1 } },
    { __v: 1 },
    { invalidationReason: 'custody_hold' },
  ]) {
    const response = await apiHttp(root(), parentState.token, {
      clientOperationId: 'b1-forged-diagnostic',
      fullName: 'Fictional Collector',
      relationship: 'Friend',
      phone: '+92 300 0000000',
      validFromDate: state.today,
      validUntilDate: state.today,
      ...claim,
    });
    assert.equal(response.status, 400);
  }
  assert.equal(await PickupPerson.countDocuments(), 0);
  assert.equal(await PickupAuthorization.countDocuments(), 0);
  assert.equal(await PickupCustodyPolicy.countDocuments(), 0);
});
before(async () => {
  await ensurePickupAuthorizationIndexes();
  await ensureEarlyExitIndexes();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(done => server.once('listening', done));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
beforeEach(async () => {
  delete process.env.PICKUP_AUTHORIZATION_ROUTING_POLICY;
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
after(async () => {
  envKeys.forEach((key, index) => {
    if (savedEnvironment[index] === undefined) delete process.env[key];
    else process.env[key] = savedEnvironment[index];
  });
  await new Promise<void>(done => server.close(() => done()));
});
async function draft() {
  const response = await apiHttp(root(), parentState.token, {
    clientOperationId: 'foundation-create',
    fullName: 'Fictional Collector',
    relationship: 'Family friend',
    phone: '+92 300 0000000',
    validFromDate: state.today,
    validUntilDate: addScheduleDays(state.today, 2),
    notes: 'PRIVATE_FIXTURE_ONLY',
  });
  assert.equal(response.status, 201, JSON.stringify(response.json));
  return `${root()}/${response.json.data.authorizationId}`;
}

test('valid legacy sentinel preserves private Draft API contract and remains ineligible', async () => {
  const path = await draft();
  const response = await apiHttp(path, parentState.token);
  assert.equal(response.status, 200);
  assert.equal(
    (await PickupPerson.findOne().orFail()).verificationState,
    'proposed',
  );
  assert.equal(response.json.data.eligibility.operationallyEligible, false);
  assert.equal(response.json.data.eligibility.policyState, 'unconfigured');
  assert.ok(!JSON.stringify(response.json).includes('evidenceReference'));
});
test('missing canonical policy remains a concealed policy conflict without recreating read state', async () => {
  const path = await draft();
  await PickupCustodyPolicy.deleteMany({});
  assert.equal((await apiHttp(path, parentState.token)).status, 409);
  assert.equal(await PickupCustodyPolicy.countDocuments(), 0);
});
test('foreign Branch policy and foreign Student cannot widen original proposal scope', async () => {
  const path = await draft();
  assert.equal(
    (
      await apiHttp(
        path.replace(String(state.student._id), String(state.otherStudent._id)),
        parentState.token,
      )
    ).status,
    404,
  );
  await PickupCustodyPolicy.collection.updateOne(
    { branchId: state.branch._id },
    { $set: { branchId: state.foreign._id } },
  );
  assert.equal((await apiHttp(path, parentState.token)).status, 409);
});
for (const change of [
  'revoked_session',
  'missing_session',
  'expired_token',
  'inactive_actor',
  'changed_role',
  'revoked_link',
] as const)
  test(`current ${change} cannot access the foundation or replay original create`, async () => {
    const path = await draft();
    let token = parentState.token;
    if (change === 'revoked_session')
      await Session.updateOne({ token }, { $set: { isRevoked: true } });
    if (change === 'missing_session') await Session.deleteMany({ token });
    if (change === 'expired_token')
      token = jwt.sign(
        { userId: String(parentState.parent._id), role: 'parent', exp: 1 },
        process.env.JWT_SECRET!,
      );
    if (change === 'inactive_actor')
      await User.updateOne(
        { _id: parentState.parent._id },
        { $set: { isActive: false } },
      );
    if (change === 'changed_role')
      await User.updateOne(
        { _id: parentState.parent._id },
        { $set: { role: 'student' } },
      );
    if (change === 'revoked_link')
      await ParentStudentLink.updateOne(
        { _id: parentState.link._id },
        { $set: { status: 'revoked', revokedAt: new Date() } },
      );
    const response = await apiHttp(path, token);
    assert.equal(response.status, change === 'revoked_link' ? 404 : 401);
    assert.ok(!JSON.stringify(response.json).includes('PRIVATE'));
    assert.equal(
      (
        await apiHttp(root(), token, {
          clientOperationId: 'foundation-create',
          fullName: 'Fictional Collector',
          relationship: 'Family friend',
          phone: '+92 300 0000000',
          validFromDate: state.today,
          validUntilDate: addScheduleDays(state.today, 2),
          notes: 'PRIVATE_FIXTURE_ONLY',
        })
      ).status,
      change === 'revoked_link' ? 404 : 401,
    );
    assert.equal(await PickupAuthorization.countDocuments(), 1);
  });

test('Parent cannot supply school verification or authoritative fields', async () => {
  const claims = [
    { verified: true },
    { approved: true },
    { isAuthorized: true },
    { branchId: String(state.foreign._id) },
    { verificationState: 'verified' },
    { policyId: String(state.branch._id) },
    { schoolApproval: { evidenceReference: 'PRIVATE_FORGERY' } },
  ];
  for (const claim of claims) {
    const response = await apiHttp(root(), parentState.token, {
      clientOperationId: 'forged',
      fullName: 'Fictional Collector',
      relationship: 'Friend',
      phone: '+92 300 0000000',
      validFromDate: state.today,
      validUntilDate: state.today,
      ...claim,
    });
    assert.equal(response.status, 400);
    assert.ok(!JSON.stringify(response.json).includes('PRIVATE_FORGERY'));
  }
  assert.equal(await PickupPerson.countDocuments(), 0);
  assert.equal(await PickupCustodyPolicy.countDocuments(), 0);
});
for (const custody of ['unknown', 'hold', 'verified'])
  test(`custody ${custody} cannot become release authority even via a native record`, async () => {
    const path = await draft();
    await put(StudentCustodyState, {
      studentId: state.student._id,
      branchId: state.branch._id,
      enrollmentId: state.enrollment._id,
      state: custody,
    });
    const response = await apiHttp(path, parentState.token);
    assert.equal(response.status, 200);
    assert.equal(response.json.data.eligibility.operationallyEligible, false);
    assert.equal(
      response.json.data.eligibility.custodyState,
      custody === 'hold' ? 'hold' : 'unknown',
    );
  });

test('real revisioned collector edit invalidates old binding while history/provenance remain intact', async () => {
  const path = await draft();
  const row = await PickupAuthorization.findOne().orFail();
  const original = await PickupPerson.findById(row.pickupPersonId)
    .select('+phone +history')
    .lean()
    .orFail();
  const provenance = {
    requesterId: String(original.requesterId),
    parentStudentLinkId: String(original.parentStudentLinkId),
    studentId: String(original.studentId),
    branchId: String(original.branchId),
    enrollmentId: String(original.enrollmentId),
    academicPeriodId: String(original.academicPeriodId),
    classId: String(original.classId),
    sectionId: String(original.sectionId),
  };
  const binding = {
    pickupPersonId: String(original._id),
    personRevision: original.revision,
    identityFingerprint: pickupDigest([
      original.fullName,
      original.relationship,
      original.phone,
    ]),
    provenance,
  };
  assert.equal(collectorIdentityBindingMatches(binding, original), true);
  await writeParentPickup(
    'edit',
    { userId: String(parentState.parent._id), role: 'parent' },
    parentState.token,
    String(state.student._id),
    String(row._id),
    {
      clientOperationId: 'edit-identity',
      applicationRevision: 0,
      personRevision: 0,
      fullName: 'Changed Fictional Collector',
      relationship: original.relationship,
      phone: original.phone,
      validFromDate: state.today,
      validUntilDate: addScheduleDays(state.today, 2),
      notes: '',
    },
  );
  const changed = await PickupPerson.findById(original._id)
    .select('+phone +history')
    .lean()
    .orFail();
  assert.equal(collectorIdentityBindingMatches(binding, changed), false);
  assert.equal(changed.verificationState, 'proposed');
  assert.equal(changed.revision, 1);
  assert.deepEqual(changed.history.slice(0, -1), original.history);
  for (const [key, value] of Object.entries(provenance))
    assert.equal(String(changed[key as keyof typeof changed]), value);
  const response = await apiHttp(path, parentState.token);
  assert.equal(response.json.data.eligibility.operationallyEligible, false);
});

test('typed approvals and operational routes stay blocked with no downstream effects', async () => {
  const routing = JSON.stringify({
    policy: 'shared_branch_principal',
    version: 1,
    enabled: true,
    branchIds: [String(state.branch._id)],
  });
  process.env.PICKUP_AUTHORIZATION_ROUTING_POLICY = routing;
  process.env.EARLY_EXIT_ROUTING_POLICY = routing;
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify({
    [String(parentState.verifier._id)]: {
      branchId: String(state.branch._id),
      types: ['pickup_authorization', 'early_exit_request'],
    },
  });
  const principalToken = generateAccessToken(
    String(parentState.verifier._id),
    'principal',
  );
  await registerSession(
    String(parentState.verifier._id),
    principalToken,
    'principal',
  );
  const path = await draft();
  const pickup = (
    await apiHttp(`${path}/submit`, parentState.token, {
      clientOperationId: 'submit',
      applicationRevision: 0,
      personRevision: 0,
    })
  ).json.data;
  const exitRoot = `/parent/me/children/${state.student._id}/early-exit-requests`;
  const exit = await apiHttp(exitRoot, parentState.token, {
    clientOperationId: 'exit-create',
    exitDate: state.today,
    reason: 'PRIVATE_EXIT_FIXTURE',
  });
  assert.equal(exit.status, 201);
  const pendingExit = await apiHttp(
    `${exitRoot}/${exit.json.data.requestId}/submit`,
    parentState.token,
    { clientOperationId: 'exit-submit', applicationRevision: 0 },
  );
  assert.equal(pendingExit.status, 200);
  const collections = await Session.db.db!.collections();
  const snapshot = async () =>
    Promise.all(
      collections.map(async collection => ({
        name: collection.collectionName,
        rows: await collection.find({}).sort({ _id: 1 }).toArray(),
      })),
    );
  const beforeRecords = await snapshot();
  assert.equal(
    (
      await apiHttp(
        `/principal/pickup-authorizations/${pickup.approvalId}/decisions`,
        principalToken,
        {
          clientOperationId: 'forbidden-approve',
          action: 'approve',
          applicationRevision: 1,
          personRevision: 0,
          approvalVersion: 0,
        },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await apiHttp(
        `/principal/early-exit-requests/${pendingExit.json.data.approvalId}/decisions`,
        principalToken,
        {
          clientOperationId: 'forbidden-exit-approve',
          action: 'approve',
          applicationRevision: 1,
          approvalVersion: 0,
        },
      )
    ).status,
    403,
  );
  assert.deepEqual(await snapshot(), beforeRecords);
  for (const model of [
    Notification,
    AttendanceSession,
    PeriodAttendanceRecord,
    StudentLeave,
    AttendanceCorrection,
  ])
    assert.equal(await model.countDocuments(), 0);
  const gateUser = await User.create({
    fullName: 'Fictional Gate Operator',
    email: 'gate-foundation@fixture.invalid',
    password: 'fixture-only',
    role: 'gate_staff',
    branchId: state.branch._id,
  });
  const gateToken = generateAccessToken(String(gateUser._id), 'gate_staff');
  await registerSession(String(gateUser._id), gateToken, 'gate_staff');
  for (const route of [
    '/gate/exits',
    '/gate/entries',
    '/gate/pickup-verifications',
    '/gate/challenges',
  ])
    assert.equal((await apiHttp(route, gateToken, {})).status, 404);
  const contract = schoolCustodyPolicyContract(
    await PickupCustodyPolicy.findOne().lean(),
    String(state.branch._id),
  );
  assert.equal(
    assessSchoolCustodyPolicy(contract, String(state.branch._id))
      .operationallyEligible,
    false,
  );
});

for (const patch of [
  { activationEnabled: true },
  { status: 'approved' },
  { schemaVersion: 999 },
  {
    schoolApproval: {
      state: 'approved',
      evidenceReference: 'FABRICATED_PRIVATE_EVIDENCE',
    },
  },
]) {
  test(`native policy claim ${Object.keys(
    patch,
  ).join()} cannot become a usable policy`, async () => {
    const path = await draft();
    await PickupCustodyPolicy.collection.updateOne(
      { branchId: state.branch._id },
      { $set: patch },
    );
    const response = await apiHttp(path, parentState.token);
    assert.equal(response.status, 409);
    assert.ok(!JSON.stringify(response.json).includes('PRIVATE'));
  });
}
