import { setStudentCustodyTestDependencies } from './helpers/mock-student-custody-dependencies';
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
import { StudentCustodyState } from '../src/models/gateFoundation';
import { ProtectedEvidence, ensureProtectedEvidenceIndexes } from '../src/models/protectedEvidence';
import {
  StudentCustodyRecord,
  StudentCustodyRecordEvent,
  StudentCustodyRecordEvidence,
  StudentCustodyRecordOperation,
  ensureStudentCustodyRecordIndexes,
} from '../src/models/studentCustodyRecord';
import { StudentCustodyRecordError, studentCustodyRecordService } from '../src/services/student-custody-record.service';
import type { CustodyRecordAuthorizer, CustodyRecordActor } from '../src/services/student-custody-record.service';
import type { EvidenceAuthorizationRequest, EvidenceDto } from '../src/services/protected-evidence.service';
import { evaluateCustodyVerifierGrant } from '../src/services/custody-policy-foundation.service';
import * as custodyRecordModelApi from '../src/models/studentCustodyRecord';
import * as custodyRecordServiceApi from '../src/services/student-custody-record.service';

let replSet: MongoMemoryReplSet;
let actor: CustodyRecordActor;
let branch: mongoose.Types.ObjectId;
let student: mongoose.Types.ObjectId;
let enrollment: mongoose.Types.ObjectId;
let user: mongoose.Types.ObjectId;
let sessionId: mongoose.Types.ObjectId;
let period: mongoose.Types.ObjectId;
let schoolClass: mongoose.Types.ObjectId;
let section: mongoose.Types.ObjectId;
let allowed = true;
let failFinalAuthorization = false;
let authorizeCalls = 0;
const content = Buffer.from('%PDF-1.7\nsynthetic custody evidence\n%%EOF\n', 'ascii');
const hash = createHash('sha256').update(content).digest('hex');
const oid = () => new mongoose.Types.ObjectId();
async function insertFixture(model: { collection: { name: string } }, value: Record<string, unknown>) {
  const row = { _id: oid(), ...value };
  await mongoose.connection.db!.collection(model.collection.name).insertOne(row);
  return row as any;
}
const authorizer: CustodyRecordAuthorizer = async request => {
  authorizeCalls++;
  if (failFinalAuthorization && authorizeCalls >= 3) return false;
  const requesterAction = ['create', 'read', 'edit', 'submit', 'withdraw', 'attach_evidence'].includes(request.action);
  const reviewerAction = ['read', 'request_changes', 'complete_review', 'revoke', 'invalidate'].includes(request.action);
  return allowed && request.branchId === String(branch) && request.studentId === String(student) && request.enrollmentId === String(enrollment) && ((request.actorRole === 'parent' && requesterAction) || (request.actorRole === 'principal' && reviewerAction));
};
const readEvidence = async ({ actor: evidenceActor, evidenceId, authorize }: { actor: CustodyRecordActor; evidenceId: string; authorize: (request: EvidenceAuthorizationRequest) => Promise<boolean> }) => {
  const evidence = await ProtectedEvidence.collection.findOne({ evidenceId });
  const request = {
    action: 'read' as const, actorId: evidenceActor.userId, branchId: String(evidence?.branchId), domain: 'custody' as const,
    purpose: 'verification' as const, ownerType: 'student' as const, ownerId: String(evidence?.ownerId), resourceId: String(evidence?.resourceId),
  };
  if (!evidence || !(await authorize(request))) throw new Error('evidence access denied');
  if (evidence.status !== 'available' || evidence.scanStatus !== 'clean' || evidence.scanDigest !== evidence.sha256 || evidence.sha256 !== hash || evidence.byteLength !== content.length) throw new Error('evidence unavailable');
  const metadata: EvidenceDto = {
    evidenceId, domain: evidence.domain as 'custody', purpose: evidence.purpose as 'verification', status: evidence.status as 'available',
    contentType: evidence.detectedContentType as 'application/pdf', byteLength: evidence.byteLength as number, revision: evidence.revision as number,
    createdAt: evidence.createdAt as Date, updatedAt: evidence.updatedAt as Date,
  };
  return { metadata, content: Buffer.from(content), contentType: 'application/pdf' };
};
const service = studentCustodyRecordService;

before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'student_custody_record_isolated', autoIndex: false });
  await Promise.all([ensureProtectedEvidenceIndexes(), ensureStudentCustodyRecordIndexes()]);
});

beforeEach(async () => {
  for (const collection of await mongoose.connection.db!.collections()) await collection.deleteMany({});
  allowed = true;
  failFinalAuthorization = false;
  authorizeCalls = 0;
  const branchDoc = await insertFixture(Branch, { name: 'Custody Test Branch', code: `SC${randomUUID().slice(0, 6).toUpperCase()}`, address: 'Synthetic', city: 'Synthetic', isActive: true });
  branch = branchDoc._id;
  const userDoc = await insertFixture(User, { fullName: 'Synthetic custody actor', email: `${randomUUID()}@example.invalid`, password: 'synthetic-only', role: 'parent', branchId: branch, isActive: true });
  user = userDoc._id;
  const sessionDoc = await Session.create({ token: `session-${randomUUID()}`, userId: user, role: 'parent', isRevoked: false });
  sessionId = sessionDoc._id;
  actor = { userId: String(user), branchId: String(branch), sessionId: String(sessionId) };
  const principal = await insertFixture(User, { fullName: 'Synthetic reviewer', email: `${randomUUID()}@example.invalid`, password: 'synthetic-only', role: 'principal', branchId: branch, isActive: true });
  const periodDoc = await insertFixture(AcademicPeriod, { branchId: branch, name: 'Synthetic period', code: `P${randomUUID().slice(0, 6)}`, startDate: '2026-01-01', endDate: '2026-12-31', status: 'active', createdBy: principal._id, updatedBy: principal._id });
  period = periodDoc._id;
  const classDoc = await insertFixture(SchoolClass, { branchId: branch, academicPeriodId: period, name: 'Synthetic class', code: `C${randomUUID().slice(0, 6)}`, academicYear: '2026', isActive: true });
  schoolClass = classDoc._id;
  const sectionDoc = await insertFixture(Section, { branchId: branch, classId: schoolClass, name: 'Synthetic section', code: `S${randomUUID().slice(0, 6)}`, isActive: true });
  section = sectionDoc._id;
  const studentUser = await insertFixture(User, { fullName: 'Synthetic student', email: `${randomUUID()}@example.invalid`, password: 'synthetic-only', role: 'student', branchId: branch, isActive: true });
  const studentDoc = await insertFixture(Student, { userId: studentUser._id, branchId: branch, classId: schoolClass, sectionId: section, admissionNumber: `A${randomUUID().slice(0, 8)}`, isActive: true });
  student = studentDoc._id;
  const enrollmentDoc = await StudentEnrollment.create({ studentId: student, branchId: branch, academicPeriodId: period, classId: schoolClass, sectionId: section, status: 'active', effectiveFrom: new Date(Date.now() - 60_000), reason: 'Synthetic fixture', createdBy: principal._id, updatedBy: principal._id });
  enrollment = enrollmentDoc._id;
  setStudentCustodyTestDependencies({ authorize: authorizer, readEvidence });
});

test('production interface has no replaceable authorization or persistence construction capability', async () => {
  assert.deepEqual(Object.keys(custodyRecordModelApi).sort(), [
    'STUDENT_CUSTODY_RECORD_EVENT_ACTIONS',
    'STUDENT_CUSTODY_RECORD_STATES',
    'StudentCustodyRecord',
    'StudentCustodyRecordEvent',
    'StudentCustodyRecordEvidence',
    'StudentCustodyRecordOperation',
    'ensureStudentCustodyRecordIndexes',
  ].sort());
  assert.deepEqual(Object.keys(custodyRecordServiceApi).sort(), [
    'StudentCustodyRecordError',
    'consumeCustodyWriteContext',
    'hasCustodyWriteContext',
    'studentCustodyRecordService',
  ].sort());
  for (const api of [custodyRecordModelApi, custodyRecordServiceApi]) {
    assert.equal('persistStudentCustodyDocumentInTransaction' in api, false);
    assert.equal('persistCustodyDocumentInTransaction' in api, false);
    assert.equal('issueCustodyWritePermit' in api, false);
  }
  assert.equal('createStudentCustodyRecordService' in custodyRecordServiceApi, false);
  assert.equal(typeof custodyRecordServiceApi.studentCustodyRecordService.create, 'function');
  assert.equal(typeof custodyRecordServiceApi.hasCustodyWriteContext, 'function');
  assert.equal(typeof custodyRecordServiceApi.consumeCustodyWriteContext, 'function');

  allowed = false;
  const beforePersistence = await custodyPersistenceSnapshot();
  await assert.rejects(
    service.create({ ...createInput(), authorize: async () => true } as ReturnType<typeof createInput> & { authorize: () => Promise<boolean> }),
    (error: unknown) => error instanceof StudentCustodyRecordError && error.code === 'unauthorized',
  );
  assert.deepEqual(await custodyPersistenceSnapshot(), beforePersistence);
});

after(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

function createInput(operationId = `create-${randomUUID()}`) {
  return { actor, studentId: String(student), enrollmentId: String(enrollment), summary: 'Private synthetic record summary', operationId };
}
function synchronizedStart(participants: number) {
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  return async () => {
    arrived++;
    if (arrived === participants) release();
    await gate;
  };
}
function mutateInput(recordId: string, action: 'edit' | 'submit' | 'request_changes' | 'complete_review' | 'withdraw' | 'revoke' | 'invalidate', expectedRevision: number, operationId = `operation-${randomUUID()}`, selectedActor = actor) {
  return { actor: selectedActor, recordId, action, expectedRevision, operationId, reason: 'Synthetic test action', ...(action === 'edit' ? { summary: 'Updated private summary' } : {}) };
}
async function principalActor(): Promise<CustodyRecordActor> {
  const reviewer = await insertFixture(User, { fullName: 'Synthetic Principal reviewer', email: `${randomUUID()}@example.invalid`, password: 'synthetic-only', role: 'principal', branchId: branch, isActive: true });
  const reviewerSession = await Session.create({ token: `review-session-${randomUUID()}`, userId: reviewer._id, role: 'principal', isRevoked: false });
  return { userId: String(reviewer._id), branchId: String(branch), sessionId: String(reviewerSession._id) };
}
async function availableEvidence(recordId: string, overrides: Record<string, unknown> = {}) {
  const evidenceId = randomUUID().replaceAll('-', '');
  await ProtectedEvidence.create({
    evidenceId, domain: 'custody', purpose: 'verification', branchId: branch,
    ownerType: 'student', ownerId: student, resourceId: new mongoose.Types.ObjectId(recordId),
    uploaderId: user, operationId: `custody-evidence-${randomUUID()}`.slice(0, 128),
    payloadFingerprint: 'a'.repeat(64), storageObjectKey: randomUUID().replaceAll('-', ''),
    declaredContentType: 'application/pdf', detectedContentType: 'application/pdf', byteLength: content.length,
    sha256: hash, status: 'available', scanStatus: 'clean', scannerId: 'synthetic-test-scanner',
    scanDigest: hash, scannedAt: new Date(), revision: 3, retentionPolicyRef: 'retention.test.v1',
    history: [
      { revision: 1, action: 'intent_created', actorType: 'user', actorId: user, occurredAt: new Date() },
      { revision: 2, action: 'content_quarantined', actorType: 'user', actorId: user, occurredAt: new Date() },
      { revision: 3, action: 'scan_clean', actorType: 'system', occurredAt: new Date() },
    ],
    ...overrides,
  });
  return evidenceId;
}
const custodyPersistenceModels = [
  StudentCustodyRecord,
  StudentCustodyRecordEvent,
  StudentCustodyRecordEvidence,
  StudentCustodyRecordOperation,
] as const;
async function custodyPersistenceSnapshot() {
  const snapshots = await Promise.all(custodyPersistenceModels.map(async model => ({
    name: model.collection.name,
    rows: await mongoose.connection.db!.collection(model.collection.name).find({}).sort({ _id: 1 }).toArray(),
  })));
  return snapshots;
}

test('strict record schemas reject forged authority and operational fields', async () => {
  const base = { branchId: branch, studentId: student, enrollmentId: enrollment, academicPeriodId: period, classId: schoolClass, sectionId: section, createdBy: user, summary: 'Synthetic', state: 'draft' as const, revision: 1 };
  assert.throws(() => new StudentCustodyRecord({ ...base, forgedRole: 'principal' }), /forgedRole/);
  await assert.rejects(new StudentCustodyRecord({ ...base, state: 'verified' }).validate());
  await assert.rejects(StudentCustodyRecord.create(base), /exact scoped service permit/);
});

test('missing domain authorization denies record creation and storage', async () => {
  allowed = false;
  await assert.rejects(service.create(createInput()), (error: unknown) => error instanceof StudentCustodyRecordError && error.code === 'unauthorized');
  assert.equal(await StudentCustodyRecord.countDocuments(), 0);
  assert.equal(await StudentCustodyRecordEvent.countDocuments(), 0);
});

test('create replay returns the same draft and conflicting payload is rejected', async () => {
  const input = createInput('create-operation-0001');
  const first = await service.create(input);
  const replay = await service.create(input);
  assert.equal(replay.id, first.id);
  assert.equal(await StudentCustodyRecord.countDocuments(), 1);
  assert.equal(await StudentCustodyRecordEvent.countDocuments(), 1);
  await assert.rejects(service.create({ ...input, summary: 'Different payload' }), (error: unknown) => error instanceof StudentCustodyRecordError && error.code === 'conflict');
});

test('edit replay is idempotent and conflicting edit payload cannot replace its receipt', async () => {
  const record = await service.create(createInput());
  const operationId = 'edit-replay-operation-0001';
  const edit = mutateInput(record.id, 'edit', 1, operationId);
  const first = await service.mutate(edit);
  const replay = await service.mutate(edit);
  assert.equal(replay.revision, first.revision);
  assert.equal(replay.summary, 'Updated private summary');
  assert.equal(await StudentCustodyRecordEvent.countDocuments({ recordId: record.id }), 2);
  await assert.rejects(service.mutate({ ...edit, summary: 'Different valid summary' }), (error: unknown) => error instanceof StudentCustodyRecordError && error.code === 'conflict');
});

test('current persisted session and Branch scope are required', async () => {
  const record = await service.create(createInput());
  await Session.updateOne({ _id: sessionId }, { $set: { isRevoked: true } });
  await assert.rejects(service.read({ actor, recordId: record.id }), (error: unknown) => error instanceof StudentCustodyRecordError && error.code === 'unauthorized');
  const otherActor = { ...actor, branchId: String(oid()) };
  await assert.rejects(service.create({ ...createInput(), actor: otherActor }), (error: unknown) => error instanceof Error);
  assert.equal(await StudentCustodyRecord.countDocuments(), 1);
});

test('foreign Branch reads, malformed identifiers and changed persisted roles are denied', async () => {
  const record = await service.create(createInput());
  const foreignBranch = await insertFixture(Branch, { name: 'Foreign Branch', code: `F${randomUUID().slice(0, 7)}`, address: 'Synthetic', city: 'Synthetic', isActive: true });
  const foreignUser = await insertFixture(User, { fullName: 'Foreign Parent', email: `${randomUUID()}@example.invalid`, password: 'synthetic-only', role: 'parent', branchId: foreignBranch._id, isActive: true });
  const foreignSession = await Session.create({ token: `foreign-session-${randomUUID()}`, userId: foreignUser._id, role: 'parent', isRevoked: false });
  await assert.rejects(service.read({ actor: { userId: String(foreignUser._id), branchId: String(foreignBranch._id), sessionId: String(foreignSession._id) }, recordId: record.id }), (error: unknown) => error instanceof StudentCustodyRecordError && error.code === 'not_found');
  await assert.rejects(service.read({ actor, recordId: 'not-an-object-id' }), (error: unknown) => error instanceof StudentCustodyRecordError && error.code === 'not_found');
  await User.updateOne({ _id: user }, { $set: { role: 'student' } });
  await assert.rejects(service.read({ actor, recordId: record.id }), (error: unknown) => error instanceof StudentCustodyRecordError && error.code === 'unauthorized');
});

test('enrollment replacement conceals old record while retaining record and events', async () => {
  const record = await service.create(createInput());
  await StudentEnrollment.updateOne({ _id: enrollment }, { $set: { status: 'transferred', effectiveTo: new Date() } });
  const newEnrollment = await StudentEnrollment.create({ studentId: student, branchId: branch, academicPeriodId: period, classId: schoolClass, sectionId: section, status: 'active', effectiveFrom: new Date(), reason: 'Synthetic transfer', createdBy: user, updatedBy: user });
  assert.notEqual(String(newEnrollment._id), String(enrollment));
  await assert.rejects(service.read({ actor, recordId: record.id }), (error: unknown) => error instanceof StudentCustodyRecordError && error.code === 'not_found');
  assert.equal(await StudentCustodyRecord.countDocuments({ _id: record.id }), 1);
  assert.equal(await StudentCustodyRecordEvent.countDocuments({ recordId: record.id }), 1);
});

test('evidence must be current custody verification evidence bound to this record and student', async () => {
  const record = await service.create(createInput());
  const evidenceId = await availableEvidence(record.id);
  const attached = await service.attachEvidence({ actor, recordId: record.id, evidenceId, expectedRevision: 1, operationId: 'attach-evidence-operation-01' });
  assert.equal(attached.revision, 2);
  assert.equal(attached.evidence.length, 1);
  assert.equal('content' in attached, false);
  assert.equal('evidenceDigest' in attached.evidence[0], false);
  assert.equal(await StudentCustodyRecordEvidence.countDocuments({ recordId: record.id }), 1);
  const association = await StudentCustodyRecordEvidence.findOne({ recordId: record.id }).lean();
  assert.equal(association?.evidenceDigest, hash);
  const wrongOwnerId = randomUUID().replaceAll('-', '');
  const mismatched = await availableEvidence(record.id, { evidenceId: wrongOwnerId, ownerId: oid() });
  await assert.rejects(service.attachEvidence({ actor, recordId: record.id, evidenceId: mismatched, expectedRevision: 2, operationId: 'attach-evidence-operation-02' }), (error: unknown) => error instanceof Error);
  const failedEvidenceId = await availableEvidence(record.id, { status: 'failed', scanStatus: 'failed' });
  await assert.rejects(service.attachEvidence({ actor, recordId: record.id, evidenceId: failedEvidenceId, expectedRevision: 2, operationId: 'attach-evidence-operation-03' }), (error: unknown) => error instanceof Error);
});

test('evidence revoked after association blocks later submission without deleting history', async () => {
  const record = await service.create(createInput());
  const evidenceId = await availableEvidence(record.id);
  await service.attachEvidence({ actor, recordId: record.id, evidenceId, expectedRevision: 1, operationId: 'revoked-evidence-attach-01' });
  await ProtectedEvidence.updateOne({ evidenceId }, { $set: { status: 'failed', scanStatus: 'failed' }, $inc: { revision: 1 } });
  await assert.rejects(service.mutate(mutateInput(record.id, 'submit', 2, 'revoked-evidence-submit-01')), (error: unknown) => error instanceof StudentCustodyRecordError && error.code === 'evidence_unavailable');
  assert.equal(await StudentCustodyRecordEvidence.countDocuments({ recordId: record.id }), 1);
  assert.equal(await StudentCustodyRecordEvent.countDocuments({ recordId: record.id }), 2);
  assert.equal((await StudentCustodyRecord.findById(record.id).lean())?.state, 'draft');
});

test('separate reviewer can complete administrative review but cannot establish operational custody', async () => {
  const record = await service.create(createInput());
  const evidenceId = await availableEvidence(record.id);
  await service.attachEvidence({ actor, recordId: record.id, evidenceId, expectedRevision: 1, operationId: 'review-evidence-operation-01' });
  const submitted = await service.mutate(mutateInput(record.id, 'submit', 2, 'review-submit-operation-01'));
  const reviewer = await principalActor();
  const completed = await service.mutate(mutateInput(record.id, 'complete_review', submitted.revision, 'review-complete-operation-01', reviewer));
  assert.equal(completed.state, 'review_completed');
  assert.equal(await StudentCustodyState.countDocuments({ studentId: student, branchId: branch }), 0);
  const history = await service.read({ actor: reviewer, recordId: record.id });
  assert.deepEqual(history.history.map(event => event.action), ['created', 'evidence_attached', 'submitted', 'review_completed']);
});

test('all supported request and reviewer commands map to strict lifecycle event actions', async () => {
  const reviewer = await principalActor();
  const first = await service.create(createInput());
  const firstEvidence = await availableEvidence(first.id);
  const attached = await service.attachEvidence({ actor, recordId: first.id, evidenceId: firstEvidence, expectedRevision: 1, operationId: 'event-map-attach-first-01' });
  const submitted = await service.mutate(mutateInput(first.id, 'submit', attached.revision, 'event-map-submit-first-01'));
  const changes = await service.mutate(mutateInput(first.id, 'request_changes', submitted.revision, 'event-map-changes-first-01', reviewer));
  const edited = await service.mutate(mutateInput(first.id, 'edit', changes.revision, 'event-map-edit-first-01'));
  const resubmitted = await service.mutate(mutateInput(first.id, 'submit', edited.revision, 'event-map-submit-second-01'));
  await service.mutate(mutateInput(first.id, 'withdraw', resubmitted.revision, 'event-map-withdraw-first-01'));
  const firstHistory = await service.read({ actor: reviewer, recordId: first.id });
  assert.deepEqual(firstHistory.history.map(event => event.action), ['created', 'evidence_attached', 'submitted', 'changes_requested', 'draft_updated', 'submitted', 'withdrawn']);

  const second = await service.create(createInput());
  const secondEvidence = await availableEvidence(second.id);
  const secondAttach = await service.attachEvidence({ actor, recordId: second.id, evidenceId: secondEvidence, expectedRevision: 1, operationId: 'event-map-attach-second-01' });
  const secondSubmit = await service.mutate(mutateInput(second.id, 'submit', secondAttach.revision, 'event-map-submit-third-01'));
  await service.mutate(mutateInput(second.id, 'revoke', secondSubmit.revision, 'event-map-revoke-first-01', reviewer));
  const secondHistory = await service.read({ actor: reviewer, recordId: second.id });
  assert.equal(secondHistory.history.at(-1)?.action, 'revoked');

  const third = await service.create(createInput());
  const thirdEvidence = await availableEvidence(third.id);
  const thirdAttach = await service.attachEvidence({ actor, recordId: third.id, evidenceId: thirdEvidence, expectedRevision: 1, operationId: 'event-map-attach-third-01' });
  const thirdSubmit = await service.mutate(mutateInput(third.id, 'submit', thirdAttach.revision, 'event-map-submit-fourth-01'));
  await service.mutate(mutateInput(third.id, 'invalidate', thirdSubmit.revision, 'event-map-invalidate-first-01', reviewer));
  const thirdHistory = await service.read({ actor: reviewer, recordId: third.id });
  assert.equal(thirdHistory.history.at(-1)?.action, 'invalidated');
});

test('Hold prevents submission and record preparation never mutates custody state', async () => {
  const record = await service.create(createInput());
  await availableEvidence(record.id).then(evidenceId => service.attachEvidence({ actor, recordId: record.id, evidenceId, expectedRevision: 1, operationId: 'hold-evidence-operation-01' }));
  const custodyBefore = await StudentCustodyState.collection.findOne({ studentId: student, branchId: branch });
  await StudentCustodyState.create({
    branchId: branch, studentId: student, enrollmentId: enrollment, academicPeriodId: period, classId: schoolClass, sectionId: section,
    state: 'hold', revision: 1, authorityRevision: 1, createdBy: user, updatedBy: user,
    history: [{ revision: 1, actorId: user, at: new Date(), action: 'created', reason: 'Synthetic hold', snapshot: { state: 'hold', authorityRevision: 1 } }],
  });
  await assert.rejects(service.mutate(mutateInput(record.id, 'submit', 2, 'submit-hold-operation-01', actor)), (error: unknown) => error instanceof StudentCustodyRecordError && error.code === 'conflict');
  const custodyAfter = await StudentCustodyState.collection.findOne({ studentId: student, branchId: branch });
  assert.equal(custodyBefore, null);
  assert.equal(custodyAfter?.state, 'hold');
  assert.equal((await StudentCustodyRecord.findById(record.id).lean())?.state, 'draft');
});

test('competing revision updates permit one winner and append exactly one event', async () => {
  const record = await service.create(createInput());
  const start = synchronizedStart(2);
  const requests = [
    mutateInput(record.id, 'edit', 1, 'edit-race-operation-001'),
    mutateInput(record.id, 'edit', 1, 'edit-race-operation-002'),
  ];
  const results = await Promise.allSettled(requests.map(async request => { await start(); return service.mutate(request); }));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  const loser = results.find(result => result.status === 'rejected');
  assert.ok(loser?.status === 'rejected' && loser.reason instanceof StudentCustodyRecordError && loser.reason.code === 'conflict');
  assert.equal(await StudentCustodyRecordEvent.countDocuments({ recordId: record.id }), 2);
  assert.equal((await StudentCustodyRecord.findById(record.id).lean())?.revision, 2);
});

test('authorization loss at the final fence rolls back record, event and receipt writes', async () => {
  const record = await service.create(createInput());
  authorizeCalls = 0;
  failFinalAuthorization = true;
  await assert.rejects(service.mutate(mutateInput(record.id, 'edit', 1, 'rollback-operation-0001')), (error: unknown) => error instanceof StudentCustodyRecordError && error.code === 'unauthorized');
  const persisted = await StudentCustodyRecord.findById(record.id).lean();
  assert.equal(persisted?.revision, 1);
  assert.equal(persisted?.summary, 'Private synthetic record summary');
  assert.equal(await StudentCustodyRecordEvent.countDocuments({ recordId: record.id }), 1);
  assert.equal(await StudentCustodyRecordEvidence.countDocuments({ recordId: record.id }), 0);
  assert.equal(await StudentCustodyRecordOperation.countDocuments({ actorId: user, clientOperationId: 'rollback-operation-0001' }), 0);
});

test('event and evidence association query mutation is rejected', async () => {
  const record = await service.create(createInput());
  const evidenceId = await availableEvidence(record.id);
  await service.attachEvidence({ actor, recordId: record.id, evidenceId, expectedRevision: 1, operationId: 'append-only-evidence-001' });
  const baselineRows = await custodyPersistenceSnapshot();
  assert.throws(() => StudentCustodyRecord.updateOne({ _id: record.id }, { $set: { studentId: oid() } }), /Custody persistence mutation is restricted/);
  assert.throws(() => StudentCustodyRecord.deleteOne({ _id: record.id }), /Custody persistence mutation is restricted/);
  assert.throws(() => StudentCustodyRecordEvent.updateOne({ recordId: record.id }, { $set: { reason: 'rewrite' } }), /Custody persistence mutation is restricted/);
  assert.throws(() => StudentCustodyRecordEvent.deleteMany({ recordId: record.id }), /Custody persistence mutation is restricted/);
  assert.throws(() => StudentCustodyRecordEvidence.deleteMany({ recordId: record.id }), /Custody persistence mutation is restricted/);
  assert.throws(() => StudentCustodyRecordOperation.deleteMany({ actorId: user }), /Custody persistence mutation is restricted/);
  assert.deepEqual(await custodyPersistenceSnapshot(), baselineRows);
});

test('model, query, bulk and connection mutation entry points reject middleware bypass options', async () => {
  const record = await service.create(createInput('persistence-boundary-create-001'));
  const evidenceId = await availableEvidence(record.id);
  await service.attachEvidence({ actor, recordId: record.id, evidenceId, expectedRevision: 1, operationId: 'persistence-boundary-evidence-001' });
  const baselineRows = await custodyPersistenceSnapshot();
  const targets = [
    { model: StudentCustodyRecord, id: record.id },
    { model: StudentCustodyRecordEvent, id: (await StudentCustodyRecordEvent.findOne({ recordId: record.id }).lean())!._id },
    { model: StudentCustodyRecordEvidence, id: (await StudentCustodyRecordEvidence.findOne({ recordId: record.id }).lean())!._id },
    { model: StudentCustodyRecordOperation, id: (await StudentCustodyRecordOperation.findOne({ actorId: user }).lean())!._id },
  ];
  type MutationTarget = {
    modelName: string;
    model: Record<string, (...args: unknown[]) => unknown>;
    modelConstructor: unknown;
    id: mongoose.Types.ObjectId;
  };
  const mutationTargets = targets.map(target => ({
    modelName: target.model.modelName,
    model: target.model as unknown as Record<string, (...args: unknown[]) => unknown>,
    modelConstructor: target.model,
    id: target.id,
  })) as MutationTarget[];

  for (const { model, modelConstructor, modelName, id } of mutationTargets) {
    const update = { $set: { reason: 'forged rewrite', summary: 'forged rewrite' } };
    const assertDenied = (operation: () => unknown) => assert.rejects(
      Promise.resolve().then(operation),
      /Custody persistence mutation is restricted|Custody connection bulk writes are not supported|Custody aggregation is unavailable/,
    );
    await assertDenied(() => Reflect.apply(model.bulkWrite, model, [[{ updateOne: { filter: { _id: id }, update } }], { middleware: false }]));
    await assertDenied(() => Reflect.apply(model.insertMany, model, [[{ _id: oid() }], { middleware: false }]));
    await assertDenied(() => Reflect.apply(model.updateOne, model, [{ _id: id }, update, { middleware: false }]));
    const query = Reflect.apply(model.findOne, model, [{ _id: id }]) as {
      updateOne: (...args: unknown[]) => { setOptions: (options: object) => unknown };
      deleteOne: (...args: unknown[]) => { setOptions: (options: object) => unknown };
    };
    await assertDenied(() => query.updateOne(update).setOptions({ middleware: false }));
    await assertDenied(() => query.deleteOne().setOptions({ middleware: false }));
    const connectionBulkWrite = mongoose.connection.bulkWrite as unknown as (...args: unknown[]) => unknown;
    await assertDenied(() => Reflect.apply(connectionBulkWrite, mongoose.connection, [[
      { model: modelConstructor, name: 'updateOne', updateOne: { filter: { _id: id }, update } },
    ]]));
    await assertDenied(() => Reflect.apply(connectionBulkWrite, mongoose.connection, [[
      { model: modelName, name: 'updateOne', updateOne: { filter: { _id: id }, update } },
    ]]));
    assert.throws(
      () => Reflect.apply(model.aggregate, model, [[{ $out: 'custody_boundary_unexpected_output' }]]),
      /Custody aggregation is unavailable on protected persistence models/,
    );
  }

  assert.deepEqual(await custodyPersistenceSnapshot(), baselineRows);
  assert.equal(await mongoose.connection.db!.collection('custody_boundary_unexpected_output').countDocuments(), 0);
});

test('document save and deletion methods cannot bypass scoped transaction persistence', async () => {
  const record = await service.create(createInput('document-boundary-create-0001'));
  const evidenceId = await availableEvidence(record.id);
  await service.attachEvidence({ actor, recordId: record.id, evidenceId, expectedRevision: 1, operationId: 'document-boundary-evidence-001' });
  const invalidLifecycleRecord = await StudentCustodyRecord.findById(record.id);
  assert.ok(invalidLifecycleRecord);
  invalidLifecycleRecord.state = 'submitted';
  await assert.rejects(invalidLifecycleRecord.validate(), (error: unknown) =>
    error instanceof mongoose.Error.ValidationError &&
    error.errors.state?.message === 'Custody lifecycle writes require the scoped domain service' &&
    error.errors.revision?.message === 'Custody lifecycle changes require the next business revision and an allowed transition',
  );
  const docs = [
    await StudentCustodyRecord.findById(record.id),
    await StudentCustodyRecordEvent.findOne({ recordId: record.id }),
    await StudentCustodyRecordEvidence.findOne({ recordId: record.id }),
    await StudentCustodyRecordOperation.findOne({ actorId: user }),
  ];
  type MutableDocument = {
    toObject: () => unknown;
    deleteOne: (...args: unknown[]) => unknown;
    updateOne: (...args: unknown[]) => unknown;
    replaceOne: (...args: unknown[]) => unknown;
    save: (...args: unknown[]) => unknown;
    $save: (...args: unknown[]) => unknown;
  };
  const mutableDocs = docs as unknown as MutableDocument[];
  const baselineRows = await custodyPersistenceSnapshot();
  for (const doc of mutableDocs) {
    assert.ok(doc);
    const expectedWriteDenial = (error: unknown) => error instanceof Error && [
      'Custody records are retained and lifecycle writes require the service',
      'Custody persistence mutation is restricted to the scoped service writer',
    ].includes(error.message);
    await assert.rejects(Promise.resolve().then(() => doc.deleteOne({ middleware: false })), expectedWriteDenial);
    await assert.rejects(Promise.resolve().then(() => doc.updateOne({ $set: { summary: 'forged rewrite' } }, { middleware: false })), expectedWriteDenial);
    await assert.rejects(Promise.resolve().then(() => doc.replaceOne(doc.toObject(), { middleware: false })), expectedWriteDenial);
    await assert.rejects(Promise.resolve().then(() => doc.save({ middleware: false })), /exact scoped service permit/);
    await assert.rejects(Promise.resolve().then(() => doc.$save({ middleware: false })), /exact scoped service permit/);
  }
  const insertOne = StudentCustodyRecord.insertOne as unknown as (...args: unknown[]) => unknown;
  await assert.rejects(Promise.resolve().then(() => Reflect.apply(insertOne, StudentCustodyRecord, [{
    branchId: branch, studentId: student, enrollmentId: enrollment, academicPeriodId: period,
    classId: schoolClass, sectionId: section, createdBy: user, state: 'draft', revision: 1,
    summary: 'direct insertion bypass',
  }, { middleware: false }])), /exact scoped service permit/);
  assert.deepEqual(await custodyPersistenceSnapshot(), baselineRows);
});

test('events, evidence associations and operation receipts stay immutable while service writes succeed', async () => {
  const record = await service.create(createInput('immutable-boundary-create-001'));
  const evidenceId = await availableEvidence(record.id);
  const attached = await service.attachEvidence({ actor, recordId: record.id, evidenceId, expectedRevision: 1, operationId: 'immutable-boundary-evidence-001' });
  assert.equal(attached.revision, 2);
  const baselineRows = await custodyPersistenceSnapshot();
  const event = await StudentCustodyRecordEvent.findOne({ recordId: record.id });
  const association = await StudentCustodyRecordEvidence.findOne({ recordId: record.id });
  const receipt = await StudentCustodyRecordOperation.findOne({ actorId: user });
  assert.ok(event && association && receipt);
  const immutableAssignmentCases = [
    { doc: event, path: 'reason', value: 'forged history' },
    { doc: association, path: 'evidenceDigest', value: 'f'.repeat(64) },
    { doc: receipt, path: 'clientOperationId', value: 'replacement-operation-0001' },
  ];
  for (const { doc, path, value } of immutableAssignmentCases) {
    doc.set(path, value);
    await assert.rejects(doc.validate(), (error: unknown) =>
      error instanceof mongoose.Error.ValidationError &&
      error.errors[path]?.message.includes('immutable') === true,
    );
  }
  const untouchedDocs = [
    await StudentCustodyRecordEvent.findOne({ recordId: record.id }),
    await StudentCustodyRecordEvidence.findOne({ recordId: record.id }),
    await StudentCustodyRecordOperation.findOne({ actorId: user }),
  ];
  const assertPersistencePermitDenied = (operation: () => unknown) => assert.rejects(
    Promise.resolve().then(operation),
    /exact scoped service permit/,
  );
  for (const doc of untouchedDocs) {
    assert.ok(doc);
    await assertPersistencePermitDenied(() => doc.save());
    await assert.rejects(Promise.resolve().then(() => doc.deleteOne()), /Custody persistence mutation is restricted/);
    await assert.rejects(Promise.resolve().then(() => doc.updateOne({ $set: { state: 'withdrawn' } })), /Custody persistence mutation is restricted/);
  }
  assert.deepEqual(await custodyPersistenceSnapshot(), baselineRows);
  const edited = await service.mutate(mutateInput(record.id, 'edit', 2, 'immutable-boundary-edit-001'));
  assert.equal(edited.revision, 3);
  assert.equal((await StudentCustodyRecordEvent.countDocuments({ recordId: record.id })), 3);
  assert.equal((await StudentCustodyRecordEvidence.countDocuments({ recordId: record.id })), 1);
  assert.equal((await StudentCustodyRecordOperation.countDocuments({ actorId: user })), 3);
});

test('record and evidence preparation do not make the verifier evaluator authorize anyone', async () => {
  const record = await service.create(createInput());
  const evidenceId = await availableEvidence(record.id);
  await service.attachEvidence({ actor, recordId: record.id, evidenceId, expectedRevision: 1, operationId: 'non-authorizing-evidence-001' });
  const decision = await evaluateCustodyVerifierGrant({ userId: String(user), branchId: String(branch), scope: 'student_custody', sessionId: String(sessionId) });
  assert.equal(decision.allowed, false);
  assert.equal(await StudentCustodyState.countDocuments({ studentId: student, branchId: branch }), 0);
});
