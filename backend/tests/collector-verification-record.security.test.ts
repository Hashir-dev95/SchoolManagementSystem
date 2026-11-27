import { setCollectorVerificationTestDependencies } from './helpers/mock-collector-verification-dependencies';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import Branch from '../src/models/branch';
import User from '../src/models/user';
import Session from '../src/models/session';
import Student from '../src/models/student';
import { StudentEnrollment } from '../src/models/studentEnrollment';
import { AcademicPeriod } from '../src/models/academicPeriod';
import SchoolClass from '../src/models/schoolClass';
import Section from '../src/models/section';
import { ParentStudentLink } from '../src/models/parentStudentLink';
import { PickupPerson, PickupAuthorization, PickupSubmission, PickupCustodyPolicy, pickupDigest } from '../src/models/pickupAuthorization';
import ApprovalRequest from '../src/models/approvalRequest';
import { StudentCustodyState } from '../src/models/gateFoundation';
import { ProtectedEvidence, ensureProtectedEvidenceIndexes } from '../src/models/protectedEvidence';
import {
  CollectorVerificationRecord, CollectorVerificationRecordEvent,
  CollectorVerificationRecordEvidence, CollectorVerificationRecordOperation,
  ensureCollectorVerificationRecordIndexes,
} from '../src/models/collectorVerificationRecord';
import { CollectorVerificationRecordError, collectorVerificationRecordService } from '../src/services/collector-verification-record.service';
import type { CollectorVerificationRecordActor, CollectorVerificationRecordAuthorization } from '../src/services/collector-verification-record.service';
import type { EvidenceAuthorizationRequest, EvidenceDto } from '../src/services/protected-evidence.service';
import * as modelApi from '../src/models/collectorVerificationRecord';
import * as serviceApi from '../src/services/collector-verification-record.service';

let replSet: MongoMemoryReplSet;
let actor: CollectorVerificationRecordActor;
let branch: mongoose.Types.ObjectId, user: mongoose.Types.ObjectId, sessionId: mongoose.Types.ObjectId;
let student: mongoose.Types.ObjectId, enrollment: mongoose.Types.ObjectId, period: mongoose.Types.ObjectId;
let schoolClass: mongoose.Types.ObjectId, section: mongoose.Types.ObjectId, person: mongoose.Types.ObjectId;
let link: mongoose.Types.ObjectId, policy: mongoose.Types.ObjectId, authorizationId: mongoose.Types.ObjectId;
let submissionId: mongoose.Types.ObjectId, approvalId: mongoose.Types.ObjectId, reviewerId: mongoose.Types.ObjectId;
let allow = true;
let authorizeCalls = 0;
let denyAuthorizationAtCall: number | null = null;
const payload = { fullName: 'Synthetic Collector', relationship: 'guardian', phone: '+15551234567', validFromDate: '2026-01-01', validUntilDate: '2026-12-31', notes: '' };
const oid = () => new mongoose.Types.ObjectId();
const operationId = (prefix = 'op') => `${prefix}-${randomUUID()}`;
const evidenceBytes = Buffer.from('%PDF-1.7\nsynthetic evidence\n%%EOF\n', 'ascii');
const evidenceDigest = createHash('sha256').update(evidenceBytes).digest('hex');
async function insertFixture(model: { collection: { name: string } }, value: Record<string, unknown>) {
  const row = { _id: oid(), ...value };
  await mongoose.connection.db!.collection(model.collection.name).insertOne(row);
  return row as any;
}
const authorizer = async (request: CollectorVerificationRecordAuthorization) => {
  authorizeCalls++;
  if (denyAuthorizationAtCall !== null && authorizeCalls >= denyAuthorizationAtCall) return false;
  return allow && request.branchId === String(branch) && request.studentId === String(student) && request.enrollmentId === String(enrollment) && request.pickupPersonId === String(person) && request.pickupAuthorizationId === String(authorizationId) && request.requesterId === String(user) && ((request.actorRole === 'parent' && request.actorId === String(user) && ['create','read','edit','submit','withdraw','attach_evidence'].includes(request.action)) || (request.actorRole === 'principal' && request.actorId !== String(user) && ['read','request_changes','complete_review','revoke','invalidate'].includes(request.action)));
};
const evidenceReader = async ({ actor: evidenceActor, evidenceId, authorize }: { actor: CollectorVerificationRecordActor; evidenceId: string; authorize: (request: EvidenceAuthorizationRequest) => Promise<boolean> }) => {
  const row = await ProtectedEvidence.collection.findOne({ evidenceId });
  const request = { action: 'read' as const, actorId: evidenceActor.userId, branchId: String(row?.branchId), domain: 'custody' as const, purpose: 'verification' as const, ownerType: 'student' as const, ownerId: String(row?.ownerId), resourceId: String(row?.resourceId) };
  if (!row || !(await authorize(request))) throw new Error('evidence denied');
  return { metadata: { evidenceId, domain: 'custody', purpose: 'verification', status: row.status, contentType: row.detectedContentType, byteLength: row.byteLength, revision: row.revision, createdAt: row.createdAt, updatedAt: row.updatedAt } as EvidenceDto, content: Buffer.from(evidenceBytes), contentType: 'application/pdf' };
};

before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'collector_verification_isolated', autoIndex: false });
  await Promise.all([ensureProtectedEvidenceIndexes(), ensureCollectorVerificationRecordIndexes()]);
});
beforeEach(async () => {
  for (const collection of await mongoose.connection.db!.collections()) await collection.deleteMany({});
  allow = true;
  authorizeCalls = 0; denyAuthorizationAtCall = null;
  const branchDoc = await insertFixture(Branch, { name: 'Collector test branch', code: `CV${randomUUID().slice(0,6).toUpperCase()}`, address: 'Synthetic', city: 'Synthetic', isActive: true });
  branch = branchDoc._id;
  const parent = await insertFixture(User, { fullName: 'Synthetic Parent', email: `${randomUUID()}@example.invalid`, password: 'synthetic-password', role: 'parent', branchId: branch, isActive: true });
  user = parent._id;
  sessionId = (await Session.create({ token: `collector-${randomUUID()}`, userId: user, role: 'parent', isRevoked: false }))._id;
  actor = { userId: String(user), branchId: String(branch), sessionId: String(sessionId) };
  const reviewer = await insertFixture(User, { fullName: 'Synthetic Principal', email: `${randomUUID()}@example.invalid`, password: 'synthetic-password', role: 'principal', branchId: branch, isActive: true });
  reviewerId = reviewer._id;
  const p = await insertFixture(AcademicPeriod, { branchId: branch, name: 'Period', code: `P${randomUUID().slice(0,6)}`, startDate: '2026-01-01', endDate: '2026-12-31', status: 'active', createdBy: reviewerId, updatedBy: reviewerId }); period = p._id;
  const c = await insertFixture(SchoolClass, { branchId: branch, academicPeriodId: period, name: 'Class', code: `C${randomUUID().slice(0,6)}`, academicYear: '2026', isActive: true }); schoolClass = c._id;
  const s = await insertFixture(Section, { branchId: branch, classId: schoolClass, name: 'Section', code: `S${randomUUID().slice(0,6)}`, isActive: true }); section = s._id;
  const studentUser = await insertFixture(User, { fullName: 'Synthetic Student', email: `${randomUUID()}@example.invalid`, password: 'synthetic-password', role: 'student', branchId: branch, isActive: true });
  const st = await insertFixture(Student, { userId: studentUser._id, branchId: branch, classId: schoolClass, sectionId: section, admissionNumber: `A${randomUUID().slice(0,8)}`, isActive: true }); student = st._id;
  const e = await StudentEnrollment.create({ studentId: student, branchId: branch, academicPeriodId: period, classId: schoolClass, sectionId: section, status: 'active', effectiveFrom: new Date(Date.now()-60_000), reason: 'Synthetic fixture', createdBy: reviewerId, updatedBy: reviewerId }); enrollment = e._id;
  const l = await insertFixture(ParentStudentLink, { parentUserId: user, studentId: student, branchId: branch, relationship: 'guardian', status: 'verified', isActive: true, createdBy: reviewerId, verifiedBy: reviewerId, verifiedAt: new Date(Date.now()-1000) }); link = l._id;
  const pol = await insertFixture(PickupCustodyPolicy, { branchId: branch, revision: 1, status: 'unconfigured', activationEnabled: false }); policy = pol._id;
  const personDoc = await insertFixture(PickupPerson, { requesterId: user, parentStudentLinkId: link, studentId: student, branchId: branch, enrollmentId: enrollment, academicPeriodId: period, classId: schoolClass, sectionId: section, ...payload, verificationState: 'proposed', revision: 0, history: [] }); person = personDoc._id;
  authorizationId = oid(); submissionId = oid(); approvalId = oid();
  await insertFixture(PickupAuthorization, { _id: authorizationId, studentId: student, branchId: branch, requesterId: user, parentStudentLinkId: link, enrollmentId: enrollment, academicPeriodId: period, classId: schoolClass, sectionId: section, pickupPersonId: person, policyId: policy, policyRevision: 1, validFromDate: payload.validFromDate, validUntilDate: payload.validUntilDate, state: 'pending', revision: 1, approvalRequestId: approvalId, submissionId, cycle: 1, operationalStatus: 'inactive' });
  await insertFixture(ApprovalRequest, { _id: approvalId, entityType: 'pickup_authorization', entityId: authorizationId, approvalType: 'pickup_authorization', requesterId: user, branchId: branch, reason: 'Synthetic proposal', status: 'pending', pickupRevision: 1, history: [{ action: 'submitted', performedBy: user, createdAt: new Date(Date.now()-1000) }] });
  await insertFixture(PickupSubmission, { _id: submissionId, authorizationId, pickupPersonId: person, branchId: branch, requesterId: user, studentId: student, applicationRevision: 1, personRevision: 0, cycle: 1, payload, fingerprint: pickupDigest(['pickup_payload_v1', String(student), payload]), routingVersion: 1, policyId: policy, policyRevision: 1, submittedAt: new Date(Date.now()-1000) });
  setCollectorVerificationTestDependencies({ authorize: authorizer, readEvidence: evidenceReader });
});
after(async () => { await mongoose.disconnect(); await replSet.stop(); });

const create = (summary = 'Private synthetic review summary', operation = operationId('create')) => collectorVerificationRecordService.create({ actor, authorizationId: String(authorizationId), summary, operationId: operation });
async function expectCode(promise: Promise<unknown>, code: string) { await assert.rejects(promise, (error: unknown) => error instanceof CollectorVerificationRecordError && error.code === code); }
async function principalActor() {
  const session = await Session.create({ token: `principal-${randomUUID()}`, userId: reviewerId, role: 'principal', isRevoked: false });
  return { userId: String(reviewerId), branchId: String(branch), sessionId: String(session._id) };
}
async function makeAvailableEvidence(recordId: string, overrides: Record<string, unknown> = {}) {
  const evidenceId = randomUUID().replaceAll('-', '').slice(0,32);
  await insertFixture(ProtectedEvidence, { evidenceId, domain: 'custody', purpose: 'verification', branchId: branch, ownerType: 'student', ownerId: student, resourceId: new mongoose.Types.ObjectId(recordId), uploaderId: user, operationId: operationId('evidence'), payloadFingerprint: evidenceDigest, storageObjectKey: randomUUID().replaceAll('-', '').slice(0,32), declaredContentType: 'application/pdf', detectedContentType: 'application/pdf', byteLength: evidenceBytes.length, sha256: evidenceDigest, status: 'available', scanStatus: 'clean', scannerId: 'synthetic-test-scanner', scanDigest: evidenceDigest, scannedAt: new Date(), revision: 1, retentionPolicyRef: 'test-only', history: [{ revision: 1, action: 'scan_clean', actorType: 'system', occurredAt: new Date() }], ...overrides });
  return evidenceId;
}

// The tests below use isolated replica-set transactions and test-runner-only module mocks.
test('production exports expose fixed service and models, with no factory or writer permit issuer', async () => {
  assert.deepEqual(Object.keys(modelApi).sort(), ['COLLECTOR_VERIFICATION_RECORD_EVENT_ACTIONS','COLLECTOR_VERIFICATION_RECORD_STATES','CollectorVerificationRecord','CollectorVerificationRecordEvent','CollectorVerificationRecordEvidence','CollectorVerificationRecordOperation','ensureCollectorVerificationRecordIndexes'].sort());
  assert.deepEqual(Object.keys(serviceApi).sort(), ['CollectorVerificationRecordError','collectorVerificationRecordService','consumeCollectorWriteContext','hasCollectorWriteContext'].sort());
  for (const api of [modelApi, serviceApi]) for (const key of ['buildCollectorVerificationRecordService','persistCollectorDocumentInTransaction','issueCollectorWritePermit','setCollectorVerificationTestDependencies','createCollectorVerificationRecordService']) assert.equal(key in api, false, key);
});
test('strict model schemas reject forged authority and operational fields', async () => {
  for (const field of ['verifiedBy','operationalStatus','branchOverride','requesterOverride']) {
    assert.throws(() => new CollectorVerificationRecord({ pickupPersonId: person, pickupAuthorizationId: authorizationId, pickupSubmissionId: submissionId, submissionCycle: 1, personRevision: 0, identityFingerprint: 'a'.repeat(64), requesterId: user, parentStudentLinkId: link, branchId: branch, studentId: student, enrollmentId: enrollment, academicPeriodId: period, classId: schoolClass, sectionId: section, policyId: policy, policyRevision: 1, createdBy: user, summary: 'x', [field]: user }), /not in schema/);
  }
});
test('authorized parent creates a proposal-bound draft without client authority identifiers', async () => {
  const result = await create();
  assert.equal(result.state, 'draft'); assert.equal(result.revision, 1);
  assert.equal(result.pickupPersonId, String(person)); assert.equal(result.pickupAuthorizationId, String(authorizationId));
  assert.equal((await CollectorVerificationRecord.findById(result.id).lean())?.requesterId.toString(), String(user));
  assert.equal(await CollectorVerificationRecordEvent.countDocuments({ recordId: result.id }), 1);
});
test('untrusted client student, Branch and requester fields cannot change server-derived scope', async () => {
  const input = { actor, authorizationId: String(authorizationId), summary: 'private', operationId: operationId(), studentId: String(oid()), branchId: String(oid()), requesterId: String(oid()), enrollmentId: String(oid()) };
  const result = await collectorVerificationRecordService.create(input as any);
  assert.equal(result.studentId, String(student)); assert.equal(result.branchId, String(branch)); assert.equal(result.enrollmentId, String(enrollment));
});
test('foreign pickup authorization is concealed and creates no records', async () => {
  await expectCode(collectorVerificationRecordService.create({ actor, authorizationId: String(oid()), summary: 'x', operationId: operationId() }), 'not_found');
  assert.equal(await CollectorVerificationRecord.countDocuments(), 0);
});
test('caller-supplied authorization callback cannot replace fixed trusted authority', async () => {
  allow = false;
  const input = { actor, authorizationId: String(authorizationId), summary: 'forged caller authorization', operationId: operationId(), authorize: async () => true };
  await expectCode(collectorVerificationRecordService.create(input as any), 'unauthorized');
  assert.equal(await CollectorVerificationRecord.countDocuments(), 0); assert.equal(await CollectorVerificationRecordOperation.countDocuments(), 0);
});
test('cross-Branch actor cannot create or read a local proposal', async () => {
  const foreignBranch = await insertFixture(Branch, { name: 'Foreign', code: `F${randomUUID().slice(0,6)}`, address: 'Synthetic', city: 'Synthetic', isActive: true });
  const foreignUser = await insertFixture(User, { fullName: 'Foreign parent', email: `${randomUUID()}@example.invalid`, password: 'synthetic-password', role: 'parent', branchId: foreignBranch._id, isActive: true });
  const foreignSession = await Session.create({ token: `foreign-${randomUUID()}`, userId: foreignUser._id, role: 'parent', isRevoked: false });
  await expectCode(collectorVerificationRecordService.create({ actor: { userId: String(foreignUser._id), branchId: String(foreignBranch._id), sessionId: String(foreignSession._id) }, authorizationId: String(authorizationId), summary: 'x', operationId: operationId() }), 'not_found');
  assert.equal(await CollectorVerificationRecord.countDocuments(), 0);
});
test('ParentStudentLink revocation blocks new records and conceals existing details', async () => {
  const created = await create(); await ParentStudentLink.collection.updateOne({ _id: link }, { $set: { status: 'revoked', isActive: false } });
  await expectCode(collectorVerificationRecordService.read({ actor, recordId: created.id }), 'not_found');
});
test('inactive or unverified ParentStudentLink cannot authorize creation', async () => {
  await ParentStudentLink.collection.updateOne({ _id: link }, { $set: { status: 'pending', isActive: false } });
  await expectCode(create(), 'not_found'); assert.equal(await CollectorVerificationRecord.countDocuments(), 0);
});
test('persisted role change invalidates the actor even when session role is unchanged', async () => {
  await User.collection.updateOne({ _id: user }, { $set: { role: 'student' } });
  await expectCode(create(), 'unauthorized'); assert.equal(await CollectorVerificationRecord.countDocuments(), 0);
});
test('revoked session blocks access and leaves records unchanged', async () => {
  const created = await create(); await Session.collection.updateOne({ _id: sessionId }, { $set: { isRevoked: true } });
  await expectCode(collectorVerificationRecordService.read({ actor, recordId: created.id }), 'unauthorized');
});
test('current Principal reviewer is Branch-scoped and cannot self-review requester records', async () => {
  const created = await create();
  const principal = await principalActor();
  allow = false; await expectCode(collectorVerificationRecordService.read({ actor: principal, recordId: created.id }), 'unauthorized');
  await expectCode(collectorVerificationRecordService.mutate({ actor: await (async()=>{const x=await Session.create({token:`self-${randomUUID()}`,userId:user,role:'parent',isRevoked:false}); return {userId:String(user),branchId:String(branch),sessionId:String(x._id)}})(), recordId: created.id, action:'request_changes', expectedRevision:1, operationId:operationId(), reason:'no self review' }), 'unauthorized');
});
test('foreign Branch Principal cannot read a local Branch record', async () => {
  const created = await create();
  const foreignBranch = await insertFixture(Branch, { name: 'Other principal branch', code: `B${randomUUID().slice(0,6)}`, address: 'Synthetic', city: 'Synthetic', isActive: true });
  await User.collection.updateOne({ _id: reviewerId }, { $set: { branchId: foreignBranch._id } });
  const foreignSession = await Session.create({ token: `other-principal-${randomUUID()}`, userId: reviewerId, role: 'principal', isRevoked: false });
  await expectCode(collectorVerificationRecordService.read({ actor: { userId: String(reviewerId), branchId: String(foreignBranch._id), sessionId: String(foreignSession._id) }, recordId: created.id }), 'not_found');
});
test('identity revision and exact B1 identity fingerprint bind the record', async () => {
  const created = await create();
  await PickupPerson.collection.updateOne({ _id: person }, { $set: { revision: 1, phone: '+15550000000' } });
  await expectCode(collectorVerificationRecordService.read({ actor, recordId: created.id }), 'not_found');
  const stored = await CollectorVerificationRecord.findById(created.id).lean(); assert.equal(stored?.personRevision, 0);
});
test('reverting identity fields does not restore stale revision authority', async () => {
  const created = await create();
  await PickupPerson.collection.updateOne({ _id: person }, { $set: { revision: 2, phone: '+15550000000' } });
  await PickupPerson.collection.updateOne({ _id: person }, { $set: { revision: 3, phone: payload.phone } });
  await expectCode(collectorVerificationRecordService.read({ actor, recordId: created.id }), 'not_found');
});
test('replacement enrollment cannot inherit an earlier collector record', async () => {
  const created = await create();
  await StudentEnrollment.collection.updateOne({ _id: enrollment }, { $set: { status: 'transferred', effectiveTo: new Date() } });
  await expectCode(collectorVerificationRecordService.read({ actor, recordId: created.id }), 'not_found');
});
test('changed proposal submission cycle cannot inherit a prior record', async () => {
  const created = await create(); await PickupAuthorization.collection.updateOne({ _id: authorizationId }, { $inc: { cycle: 1 } });
  await expectCode(collectorVerificationRecordService.read({ actor, recordId: created.id }), 'not_found');
});
test('new canonical proposal cycle gets its own immutable record while the old cycle stays concealed', async () => {
  const old = await create(); const nextSubmission = oid();
  await insertFixture(PickupSubmission, { _id: nextSubmission, authorizationId, pickupPersonId: person, branchId: branch, requesterId: user, studentId: student, applicationRevision: 2, personRevision: 0, cycle: 2, payload, fingerprint: pickupDigest(['pickup_payload_v1', String(student), payload]), routingVersion: 1, policyId: policy, policyRevision: 1, submittedAt: new Date() });
  await PickupAuthorization.collection.updateOne({ _id: authorizationId }, { $set: { submissionId: nextSubmission, revision: 2, cycle: 2 } });
  await ApprovalRequest.collection.updateOne({ _id: approvalId }, { $set: { pickupRevision: 2 } });
  const current = await create('Cycle two record');
  assert.notEqual(current.id, old.id); assert.equal(await CollectorVerificationRecord.countDocuments(), 2);
  await expectCode(collectorVerificationRecordService.read({ actor, recordId: old.id }), 'not_found');
  assert.deepEqual((await collectorVerificationRecordService.listForStudent({ actor, authorizationId: String(authorizationId) })).map(record => record.id), [current.id]);
});
test('missing or activated policy fails closed', async () => {
  await PickupCustodyPolicy.collection.deleteOne({ _id: policy }); await expectCode(create(), 'not_found');
  await insertFixture(PickupCustodyPolicy, { _id: policy, branchId: branch, revision: 1, status: 'unconfigured', activationEnabled: true });
  await expectCode(create(), 'not_found'); assert.equal(await CollectorVerificationRecord.countDocuments(), 0);
});
test('Custody Hold takes precedence and no custody state is mutated', async () => {
  await insertFixture(StudentCustodyState, { branchId: branch, studentId: student, enrollmentId: enrollment, state: 'hold', revision: 1, updatedBy: reviewerId, history: [] });
  await expectCode(create(), 'not_found');
  assert.equal((await StudentCustodyState.collection.findOne({ studentId: student }))?.state, 'hold');
});
test('same operation replay returns the same record and conflicting payload is rejected', async () => {
  const id = operationId(); const first = await create('first', id); const replay = await create('first', id);
  assert.equal(replay.id, first.id); await expectCode(create('different', id), 'conflict');
  assert.equal(await CollectorVerificationRecord.countDocuments(), 1); assert.equal(await CollectorVerificationRecordOperation.countDocuments(), 1);
});
test('operation replay after Parent relationship revocation is denied and retains persisted history', async () => {
  const id = operationId(); const created = await create('original', id);
  await ParentStudentLink.collection.updateOne({ _id: link }, { $set: { status: 'revoked', isActive: false } });
  await expectCode(create('original', id), 'not_found');
  assert.equal(await CollectorVerificationRecord.countDocuments({ _id: new mongoose.Types.ObjectId(created.id) }), 1);
  assert.equal(await CollectorVerificationRecordEvent.countDocuments({ recordId: created.id }), 1);
});
test('draft edit uses expected revision and records immutable events', async () => {
  const row = await create(); const edited = await collectorVerificationRecordService.mutate({ actor, recordId: row.id, action: 'edit', expectedRevision: 1, operationId: operationId(), summary: 'updated private summary', reason: 'Parent draft edit' });
  assert.equal(edited.revision, 2); assert.equal(edited.summary, 'updated private summary');
  assert.deepEqual((await CollectorVerificationRecordEvent.find({ recordId: row.id }).sort({ revision: 1 }).lean()).map(e => e.action), ['created','draft_updated']);
});
test('stale revision loses concurrent compare-and-set competition', async () => {
  const row = await create(); const outcomes = await Promise.allSettled([1,2].map(() => collectorVerificationRecordService.mutate({ actor, recordId: row.id, action: 'edit', expectedRevision: 1, operationId: operationId(), summary: 'competing edit', reason: 'Concurrent edit' })));
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1); assert.equal(await CollectorVerificationRecordEvent.countDocuments({ recordId: row.id }), 2);
});
test('submission requires current evidence and never changes pickup operational state', async () => {
  const row = await create(); await expectCode(collectorVerificationRecordService.mutate({ actor, recordId: row.id, action: 'submit', expectedRevision: 1, operationId: operationId(), reason: 'Submit for review' }), 'evidence_unavailable');
  const storedProposal = await PickupAuthorization.findById(authorizationId).lean(); assert.equal(storedProposal?.operationalStatus, 'inactive');
});
test('protected evidence attach validates owner, resource, digest and current scan state', async () => {
  const row = await create(); const evidenceId = await makeAvailableEvidence(row.id);
  const attached = await collectorVerificationRecordService.attachEvidence({ actor, recordId: row.id, evidenceId, expectedRevision: 1, operationId: operationId() });
  assert.equal(attached.revision, 2); assert.equal(attached.evidence.length, 1);
  assert.equal(await CollectorVerificationRecordEvidence.countDocuments({ recordId: row.id }), 1);
  assert.equal('storageObjectKey' in attached.evidence[0], false); assert.equal('evidenceDigest' in attached.evidence[0], false);
});
test('mismatched evidence resource is rejected without association or revision change', async () => {
  const row = await create(); const evidenceId = await makeAvailableEvidence(row.id, { resourceId: oid() });
  await expectCode(collectorVerificationRecordService.attachEvidence({ actor, recordId: row.id, evidenceId, expectedRevision: 1, operationId: operationId() }), 'evidence_unavailable');
  assert.equal((await CollectorVerificationRecord.findById(row.id).lean())?.revision, 1); assert.equal(await CollectorVerificationRecordEvidence.countDocuments(), 0);
});
test('revoked or unavailable evidence cannot be associated', async () => {
  const row = await create(); const evidenceId = await makeAvailableEvidence(row.id, { status: 'failed', scanStatus: 'failed', scanDigest: undefined, scannerId: undefined });
  await expectCode(collectorVerificationRecordService.attachEvidence({ actor, recordId: row.id, evidenceId, expectedRevision: 1, operationId: operationId() }), 'evidence_unavailable');
  assert.equal((await CollectorVerificationRecord.findById(row.id).lean())?.revision, 1);
  assert.equal(await CollectorVerificationRecordEvidence.countDocuments(), 0);
});
test('request changes, resubmission and review completion remain administrative only', async () => {
  const row = await create(); const evidenceId = await makeAvailableEvidence(row.id);
  const withEvidence = await collectorVerificationRecordService.attachEvidence({ actor, recordId: row.id, evidenceId, expectedRevision: 1, operationId: operationId() });
  const submitted = await collectorVerificationRecordService.mutate({ actor, recordId: row.id, action: 'submit', expectedRevision: withEvidence.revision, operationId: operationId(), reason: 'Submit for administrative review' });
  const principal = await principalActor();
  const changes = await collectorVerificationRecordService.mutate({ actor: principal, recordId: row.id, action: 'request_changes', expectedRevision: submitted.revision, operationId: operationId(), reason: 'Please provide a clearer document' });
  const draft = await collectorVerificationRecordService.mutate({ actor, recordId: row.id, action: 'edit', expectedRevision: changes.revision, operationId: operationId(), summary: 'Updated request details', reason: 'Parent resubmission' });
  const resubmitted = await collectorVerificationRecordService.mutate({ actor, recordId: row.id, action: 'submit', expectedRevision: draft.revision, operationId: operationId(), reason: 'Resubmitted for review' });
  const completed = await collectorVerificationRecordService.mutate({ actor: principal, recordId: row.id, action: 'complete_review', expectedRevision: resubmitted.revision, operationId: operationId(), reason: 'Administrative review completed' });
  assert.equal(completed.state, 'review_completed');
  assert.equal((await PickupPerson.findById(person).lean())?.verificationState, 'proposed');
  assert.equal((await PickupAuthorization.findById(authorizationId).lean())?.operationalStatus, 'inactive');
  assert.equal(await StudentCustodyState.countDocuments(), 0);
});
test('terminal and invalid lifecycle transitions are denied without state changes', async () => {
  const row = await create(); const rejected = await collectorVerificationRecordService.mutate({ actor, recordId: row.id, action: 'withdraw', expectedRevision: 1, operationId: operationId(), reason: 'Withdraw draft' });
  await expectCode(collectorVerificationRecordService.mutate({ actor, recordId: row.id, action: 'submit', expectedRevision: rejected.revision, operationId: operationId(), reason: 'Invalid terminal submit' }), 'conflict');
  assert.equal((await CollectorVerificationRecord.findById(row.id).lean())?.state, 'withdrawn');
});
test('unknown runtime commands are rejected before any lifecycle mutation', async () => {
  const row = await create();
  await expectCode(collectorVerificationRecordService.mutate({ actor, recordId: row.id, action: 'verify_collector' as any, expectedRevision: 1, operationId: operationId(), reason: 'Unsupported command' }), 'invalid_request');
  assert.equal((await CollectorVerificationRecord.findById(row.id).lean())?.state, 'draft');
  assert.equal((await CollectorVerificationRecord.findById(row.id).lean())?.revision, 1);
});
test('unauthorized model mutations and document saves are blocked with persisted snapshot unchanged', async () => {
  const row = await create(); const snapshot = await CollectorVerificationRecord.collection.findOne({ _id: new mongoose.Types.ObjectId(row.id) });
  assert.throws(() => CollectorVerificationRecord.updateOne({ _id: row.id }, { $set: { state: 'review_completed' } }), /restricted|retained/);
  const doc = await CollectorVerificationRecord.findById(row.id); doc!.summary = 'forged'; assert.throws(() => doc!.save(), /exact scoped service permit/);
  assert.deepEqual(await CollectorVerificationRecord.collection.findOne({ _id: new mongoose.Types.ObjectId(row.id) }), snapshot);
});
test('denied final domain authorization rolls back record, event and operation receipt', async () => {
  const row = await create(); const snapshotBefore = { record: await CollectorVerificationRecord.collection.findOne({ _id: new mongoose.Types.ObjectId(row.id) }), events: await CollectorVerificationRecordEvent.countDocuments(), receipts: await CollectorVerificationRecordOperation.countDocuments() };
  authorizeCalls = 0; denyAuthorizationAtCall = 3;
  await expectCode(collectorVerificationRecordService.mutate({ actor, recordId: row.id, action: 'edit', expectedRevision: 1, operationId: operationId(), summary: 'not committed', reason: 'Authority revoked during final fence' }), 'unauthorized');
  assert.deepEqual(await CollectorVerificationRecord.collection.findOne({ _id: new mongoose.Types.ObjectId(row.id) }), snapshotBefore.record);
  assert.equal(await CollectorVerificationRecordEvent.countDocuments(), snapshotBefore.events); assert.equal(await CollectorVerificationRecordOperation.countDocuments(), snapshotBefore.receipts);
});
test('detail and list return whitelisted DTOs without identity or evidence internals', async () => {
  const row = await create(); const detail = await collectorVerificationRecordService.read({ actor, recordId: row.id });
  assert.deepEqual(Object.keys(detail.record).sort(), ['id','pickupPersonId','pickupAuthorizationId','submissionCycle','branchId','studentId','enrollmentId','academicPeriodId','classId','sectionId','state','revision','summary','createdAt','updatedAt','evidence'].sort());
  assert.deepEqual((await collectorVerificationRecordService.listForStudent({ actor, authorizationId: String(authorizationId) })).map(x => x.id), [row.id]);
  for (const key of ['identityFingerprint','requesterId','parentStudentLinkId','policyId','policyRevision','phone','storageObjectKey','sha256']) assert.equal(key in detail.record, false);
});
