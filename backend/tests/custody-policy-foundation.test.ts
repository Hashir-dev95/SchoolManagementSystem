import assert from 'node:assert/strict';
import { test } from 'node:test';
import mongoose from 'mongoose';
import { parseCustodyPolicyConfiguration, evaluateCustodyVerifierGrant } from '../src/services/custody-policy-foundation.service';
import { CustodyPolicyRevision } from '../src/models/custodyPolicyRevision';
import { CustodyVerifierGrant, ensureCustodyVerifierIndexes } from '../src/models/custodyVerifierGrant';
import Session from '../src/models/session';
import { oid, put, state } from './helpers/student-workspace.fixture';

test('policy configuration accepts only explicit bounded product fields', () => {
  assert.deepEqual(parseCustodyPolicyConfiguration({separationOfDuties:'required', validityDays:30}), {separationOfDuties:'required', validityDays:30});
  assert.equal(parseCustodyPolicyConfiguration({separationOfDuties:'required', validityDays:null}), null);
});
for (const value of [null, [], {}, {separationOfDuties:'anything',validityDays:null}, {separationOfDuties:'required',validityDays:0}, {separationOfDuties:'required',validityDays:3651}, {separationOfDuties:'required',validityDays:30,approved:true}])
  test(`malformed policy configuration fails closed (${JSON.stringify(value)})`, () => assert.equal(parseCustodyPolicyConfiguration(value), null));

const policyConfiguration = { separationOfDuties: 'not_configured', validityDays: null };
const policyHistoryEvent = (actorId: mongoose.Types.ObjectId) => ({ revision: 1, actorId, action: 'draft_created', reason: 'Test fixture', at: new Date() });
const grantHistoryEvent = (actorId: mongoose.Types.ObjectId) => ({ revision: 1, actorId, action: 'created', reason: 'Test fixture', at: new Date() });

async function seedSession(userId: mongoose.Types.ObjectId, role = 'student') {
  return put(Session, { token: `custody-foundation-${oid().toHexString()}`, userId, role, isRevoked: false });
}

async function seedGrant(userId: mongoose.Types.ObjectId, branchId: mongoose.Types.ObjectId, overrides: Record<string, unknown> = {}) {
  return CustodyVerifierGrant.create({
    userId, branchId, scope: 'student_custody', revision: 1, status: 'active',
    validFrom: new Date(Date.now() - 60_000), validUntil: new Date(Date.now() + 60_000),
    createdBy: userId, history: [grantHistoryEvent(userId)], ...overrides,
  });
}

async function insertPolicy(branchId: mongoose.Types.ObjectId, configuration: unknown) {
  return CustodyPolicyRevision.collection.insertOne({
    _id: oid(), branchId, policyId: oid(), revision: 1, schemaVersion: 1,
    status: 'approved', configuration, createdBy: state.user._id,
    approvedBy: state.user._id, approvedAt: new Date(), history: [policyHistoryEvent(state.user._id)],
  });
}

test('persisted models reject approval and malformed grant state', async () => {
  const actorId = state.user._id as mongoose.Types.ObjectId;
  const policy = new CustodyPolicyRevision({
    branchId: state.branch._id, policyId: oid(), revision: 1, schemaVersion: 1,
    status: 'approved', configuration: policyConfiguration, createdBy: actorId,
    approvedBy: actorId, approvedAt: new Date(), history: [policyHistoryEvent(actorId)],
  });
  await assert.rejects(policy.validate());

  const grant = new CustodyVerifierGrant({
    userId: actorId, branchId: state.branch._id, scope: 'student_custody', revision: 1,
    status: 'active', validFrom: new Date(), validUntil: new Date(Date.now() - 1),
    createdBy: actorId, history: [grantHistoryEvent(actorId)],
  });
  await assert.rejects(grant.validate());
  assert.throws(() => new CustodyVerifierGrant({
    userId: actorId, branchId: state.branch._id, scope: 'student_custody', revision: 1,
    status: 'active', validFrom: new Date(Date.now() - 60_000), validUntil: new Date(Date.now() + 60_000),
    createdBy: actorId, history: [grantHistoryEvent(actorId)], unapprovedAuthority: true,
  }), error => error instanceof mongoose.Error.StrictModeError && /unapprovedAuthority/.test(error.message));
});

function assertDuplicateIndex(error: unknown, expectedKeyPattern: Record<string, number>) {
  assert.ok(error instanceof Error);
  assert.equal((error as Error & { code?: number }).code, 11000);
  assert.deepEqual((error as Error & { keyPattern?: Record<string, number> }).keyPattern, expectedKeyPattern);
  return true;
}

test('database indexes reject duplicate policy and verifier revisions', async () => {
  await ensureCustodyVerifierIndexes();
  const actorId = state.user._id as mongoose.Types.ObjectId;
  const policyData = {
    branchId: state.branch._id, policyId: oid(), revision: 1, schemaVersion: 1,
    status: 'draft', configuration: policyConfiguration, createdBy: actorId,
    history: [policyHistoryEvent(actorId)],
  };
  const firstPolicy = await CustodyPolicyRevision.create(policyData);
  assert.equal(await CustodyPolicyRevision.countDocuments({ _id: firstPolicy._id }), 1);
  await assert.rejects(
    CustodyPolicyRevision.create({ ...policyData, policyId: oid() }),
    error => assertDuplicateIndex(error, { branchId: 1, revision: 1 }),
  );

  const grantData = {
    userId: actorId, branchId: state.branch._id, scope: 'student_custody', revision: 1,
    status: 'active', validFrom: new Date(Date.now() - 60_000), validUntil: new Date(Date.now() + 60_000),
    createdBy: actorId, history: [grantHistoryEvent(actorId)],
  };
  const firstGrant = await CustodyVerifierGrant.create(grantData);
  assert.equal(await CustodyVerifierGrant.countDocuments({ _id: firstGrant._id }), 1);
  await assert.rejects(
    CustodyVerifierGrant.create(grantData),
    error => assertDuplicateIndex(error, { userId: 1, branchId: 1, scope: 1, revision: 1 }),
  );
});

test('malformed user, Branch and session identifiers are denied before lookup', async () => {
  const base = { userId: String(state.user._id), branchId: String(state.branch._id), scope: 'student_custody' as const, sessionId: String(oid()) };
  for (const input of [
    { ...base, userId: 'not-an-object-id' },
    { ...base, branchId: '00000000000000000000000Z' },
    { ...base, sessionId: 'not-an-object-id' },
  ]) assert.deepEqual(await evaluateCustodyVerifierGrant(input), { allowed: false, reason: 'actor_unavailable' });
});

test('verifier grants and actor data cannot cross Branch boundaries', async () => {
  const session = await seedSession(state.user._id);
  assert.deepEqual(await evaluateCustodyVerifierGrant({
    userId: String(state.user._id), branchId: String(state.foreign._id), scope: 'student_custody', sessionId: String(session._id),
  }), { allowed: false, reason: 'actor_unavailable' });

  await seedGrant(state.user._id, state.foreign._id);
  assert.deepEqual(await evaluateCustodyVerifierGrant({
    userId: String(state.user._id), branchId: String(state.branch._id), scope: 'student_custody', sessionId: String(session._id),
  }), { allowed: false, reason: 'grant_unavailable' });
});

test('expired verifier grants are denied', async () => {
  const session = await seedSession(state.user._id);
  await seedGrant(state.user._id, state.branch._id, { validUntil: new Date(Date.now() - 1) });
  assert.deepEqual(await evaluateCustodyVerifierGrant({
    userId: String(state.user._id), branchId: String(state.branch._id), scope: 'student_custody', sessionId: String(session._id),
  }), { allowed: false, reason: 'grant_expired' });
});

test('revoked verifier grants are denied', async () => {
  const session = await seedSession(state.user._id);
  await seedGrant(state.user._id, state.branch._id, {
    status: 'revoked', revokedBy: state.user._id, revokedAt: new Date(),
    history: [grantHistoryEvent(state.user._id), { revision: 2, actorId: state.user._id, action: 'revoked', reason: 'Access removed', at: new Date() }],
  });
  assert.deepEqual(await evaluateCustodyVerifierGrant({
    userId: String(state.user._id), branchId: String(state.branch._id), scope: 'student_custody', sessionId: String(session._id),
  }), { allowed: false, reason: 'grant_unavailable' });
});

test('corrupted approved policy configuration fails closed', async () => {
  const session = await seedSession(state.user._id);
  await seedGrant(state.user._id, state.branch._id);
  await insertPolicy(state.branch._id, { ...policyConfiguration, approved: true });
  assert.deepEqual(await evaluateCustodyVerifierGrant({
    userId: String(state.user._id), branchId: String(state.branch._id), scope: 'student_custody', sessionId: String(session._id),
  }), { allowed: false, reason: 'policy_unapproved' });
});

test('grant identity edits are rejected and original persisted identities remain unchanged', async () => {
  const actorId = state.user._id as mongoose.Types.ObjectId;
  const grant = await seedGrant(actorId, state.branch._id);
  const originalGrant = { userId: String(grant.userId), branchId: String(grant.branchId), scope: grant.scope, createdBy: String(grant.createdBy) };
  grant.userId = oid(); grant.branchId = state.foreign._id; grant.scope = 'collector_identity'; grant.createdBy = state.foreign._id;
  await assert.rejects(grant.save(), error => {
    assert.ok(error instanceof mongoose.Error.ValidationError);
    for (const path of ['userId', 'branchId', 'scope', 'createdBy']) assert.equal(error.errors[path]?.name, 'StrictModeError');
    return true;
  });
  const storedGrant = await CustodyVerifierGrant.findById(grant._id).select('+history').orFail();
  assert.deepEqual({ userId: String(storedGrant.userId), branchId: String(storedGrant.branchId), scope: storedGrant.scope, createdBy: String(storedGrant.createdBy) }, originalGrant);
});

test('policy identity edits are rejected and original persisted identities remain unchanged', async () => {
  const actorId = state.user._id as mongoose.Types.ObjectId;
  const policy = await CustodyPolicyRevision.create({
    branchId: state.branch._id, policyId: oid(), revision: 1, schemaVersion: 1,
    status: 'draft', configuration: policyConfiguration, createdBy: actorId, history: [policyHistoryEvent(actorId)],
  });
  const originalPolicy = { branchId: String(policy.branchId), policyId: String(policy.policyId), revision: policy.revision, schemaVersion: policy.schemaVersion, createdBy: String(policy.createdBy) };
  policy.branchId = state.foreign._id; policy.policyId = oid(); policy.revision = 2; policy.schemaVersion = 2; policy.createdBy = state.foreign._id;
  await assert.rejects(policy.save(), error => {
    assert.ok(error instanceof mongoose.Error.ValidationError);
    for (const path of ['branchId', 'policyId', 'revision', 'schemaVersion', 'createdBy']) assert.equal(error.errors[path]?.name, 'StrictModeError');
    return true;
  });
  const storedPolicy = await CustodyPolicyRevision.findById(policy._id).select('+history').orFail();
  assert.deepEqual({ branchId: String(storedPolicy.branchId), policyId: String(storedPolicy.policyId), revision: storedPolicy.revision, schemaVersion: storedPolicy.schemaVersion, createdBy: String(storedPolicy.createdBy) }, originalPolicy);
});

test('even valid persisted grant and policy data can never authorize verification', async () => {
  const session = await seedSession(state.user._id);
  await seedGrant(state.user._id, state.branch._id);
  await insertPolicy(state.branch._id, policyConfiguration);
  assert.deepEqual(await evaluateCustodyVerifierGrant({
    userId: String(state.user._id), branchId: String(state.branch._id), scope: 'student_custody', sessionId: String(session._id),
  }), { allowed: false, reason: 'verification_not_implemented' });
});
