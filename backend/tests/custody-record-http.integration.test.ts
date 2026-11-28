import assert from 'node:assert/strict';
import { after, before, beforeEach, test, mock } from 'node:test';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createPrivateFilesystemEvidenceStorage } from '../src/services/protected-evidence-storage';
import { createProtectedEvidenceService } from '../src/services/protected-evidence.service';
import Branch from '../src/models/branch';
import User from '../src/models/user';
import Session from '../src/models/session';
import Student from '../src/models/student';
import { StudentEnrollment } from '../src/models/studentEnrollment';
import { AcademicPeriod } from '../src/models/academicPeriod';
import SchoolClass from '../src/models/schoolClass';
import Section from '../src/models/section';
import { ParentStudentLink } from '../src/models/parentStudentLink';
import { StudentCustodyState } from '../src/models/gateFoundation';
import { PickupPerson, PickupAuthorization, PickupSubmission, PickupCustodyPolicy, pickupDigest } from '../src/models/pickupAuthorization';
import ApprovalRequest from '../src/models/approvalRequest';
import { ProtectedEvidence, ensureProtectedEvidenceIndexes } from '../src/models/protectedEvidence';
import type * as StudentCustodyRecordModels from '../src/models/studentCustodyRecord';
import type * as CollectorVerificationRecordModels from '../src/models/collectorVerificationRecord';
import { generateAccessToken } from '../src/services/jwt.service';
import { pickupFingerprint } from '../src/services/pickup-authorization.policy';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'synthetic-integration-only-secret';
let evidenceRoot = '';
let scannerBarrier: { signalStarted: () => void; wait: Promise<void> } | null = null;

let replSet: MongoMemoryReplSet;
let server: Server;
let baseUrl = '';
let branch: mongoose.Types.ObjectId;
let parentId: mongoose.Types.ObjectId;
let principalId: mongoose.Types.ObjectId;
let studentId: mongoose.Types.ObjectId;
let enrollmentId: mongoose.Types.ObjectId;
let parentLinkId: mongoose.Types.ObjectId;
let authorizationId: mongoose.Types.ObjectId;
let pickupApprovalId: mongoose.Types.ObjectId;
let pickupPersonId: mongoose.Types.ObjectId;
let parentToken: string;
let principalToken: string;
let parentSessionId: mongoose.Types.ObjectId;
let periodId: mongoose.Types.ObjectId;
let classId: mongoose.Types.ObjectId;
let sectionId: mongoose.Types.ObjectId;
let ensureStudentCustodyRecordIndexes: typeof StudentCustodyRecordModels.ensureStudentCustodyRecordIndexes;
let StudentCustodyRecord: typeof StudentCustodyRecordModels.StudentCustodyRecord;
let StudentCustodyRecordEvent: typeof StudentCustodyRecordModels.StudentCustodyRecordEvent;
let StudentCustodyRecordEvidence: typeof StudentCustodyRecordModels.StudentCustodyRecordEvidence;
let StudentCustodyRecordOperation: typeof StudentCustodyRecordModels.StudentCustodyRecordOperation;
let ensureCollectorVerificationRecordIndexes: typeof CollectorVerificationRecordModels.ensureCollectorVerificationRecordIndexes;
let CollectorVerificationRecord: typeof CollectorVerificationRecordModels.CollectorVerificationRecord;
let CollectorVerificationRecordEvent: typeof CollectorVerificationRecordModels.CollectorVerificationRecordEvent;
let CollectorVerificationRecordEvidence: typeof CollectorVerificationRecordModels.CollectorVerificationRecordEvidence;
let CollectorVerificationRecordOperation: typeof CollectorVerificationRecordModels.CollectorVerificationRecordOperation;
const oid = () => new mongoose.Types.ObjectId();
const operation = (prefix: string) => `${prefix}-${randomUUID()}`;
const pdf = Buffer.from('%PDF-1.7\nsynthetic private evidence\n%%EOF\n', 'ascii');

async function insert(model: { collection: { name: string } }, data: Record<string, unknown>) {
  const row = { _id: oid(), ...data };
  await mongoose.connection.db!.collection(model.collection.name).insertOne(row);
  return row as any;
}
async function identity(userId: mongoose.Types.ObjectId, role: string) {
  const token = generateAccessToken(String(userId), role as any);
  const session = await Session.create({ token, userId, role, isRevoked: false });
  return { token, sessionId: session._id };
}
async function call(token: string | undefined, method: string, route: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body) } : {}),
  });
  return { status: response.status, json: await response.json() as any };
}
const custodyBase = () => `/api/parent/me/children/${studentId}/custody-records`;
const collectorBase = () => `/api/parent/me/pickup-authorizations/${authorizationId}/collector-verification-records`;

before(async () => {
  evidenceRoot = await mkdtemp(path.join(tmpdir(), 'custody-http-'));
  const storage = await createPrivateFilesystemEvidenceStorage(evidenceRoot);
  const evidenceRuntime = createProtectedEvidenceService({
    storage, maxBytes: 10_000_000,
    scanner: { async scan({ sha256 }) {
      const barrier = scannerBarrier;
      if (barrier) { barrier.signalStarted(); await barrier.wait; }
      return { result: 'clean' as const, scannerId: 'synthetic-test-only', sha256 };
    } },
  });
  mock.module(pathToFileURL(path.resolve(process.cwd(), 'src/services/protected-evidence-runtime.ts')), {
    exports: { protectedEvidenceRuntime: evidenceRuntime },
  });
  // Install test storage before importing guarded models, because those
  // models load their fixed services during module initialization.
  const studentModels = await import('../src/models/studentCustodyRecord');
  ensureStudentCustodyRecordIndexes = studentModels.ensureStudentCustodyRecordIndexes;
  StudentCustodyRecord = studentModels.StudentCustodyRecord;
  StudentCustodyRecordEvent = studentModels.StudentCustodyRecordEvent;
  StudentCustodyRecordEvidence = studentModels.StudentCustodyRecordEvidence;
  StudentCustodyRecordOperation = studentModels.StudentCustodyRecordOperation;
  const collectorModels = await import('../src/models/collectorVerificationRecord');
  ensureCollectorVerificationRecordIndexes = collectorModels.ensureCollectorVerificationRecordIndexes;
  CollectorVerificationRecord = collectorModels.CollectorVerificationRecord;
  CollectorVerificationRecordEvent = collectorModels.CollectorVerificationRecordEvent;
  CollectorVerificationRecordEvidence = collectorModels.CollectorVerificationRecordEvidence;
  CollectorVerificationRecordOperation = collectorModels.CollectorVerificationRecordOperation;
  const { default: app } = await import('../src/app');
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'custody_record_http_integration', autoIndex: false });
  await Promise.all([
    ensureProtectedEvidenceIndexes(), ensureStudentCustodyRecordIndexes(), ensureCollectorVerificationRecordIndexes(),
  ]);
  await new Promise<void>(resolve => { server = createServer(app).listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test HTTP server did not bind');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
  scannerBarrier = null;
  process.env.CUSTODY_RECORD_REVIEW_AUTHORITY_JSON = '[]';
  process.env.CUSTODY_EVIDENCE_RETENTION_POLICY_REF = 'retention.synthetic-test.v1';
  for (const collection of await mongoose.connection.db!.collections()) await collection.deleteMany({});
  const branchDoc = await insert(Branch, { name: 'Synthetic review branch', code: `B${randomUUID().slice(0, 6).toUpperCase()}`, address: 'Synthetic', city: 'Synthetic', isActive: true }); branch = branchDoc._id;
  const parent = await insert(User, { fullName: 'Synthetic parent', email: `${randomUUID()}@example.invalid`, password: 'test-only', role: 'parent', branchId: branch, isActive: true }); parentId = parent._id;
  const principal = await insert(User, { fullName: 'Synthetic reviewer', email: `${randomUUID()}@example.invalid`, password: 'test-only', role: 'principal', branchId: branch, isActive: true }); principalId = principal._id;
  const p = await insert(AcademicPeriod, { branchId: branch, name: 'Test period', code: `P${randomUUID().slice(0, 5)}`, startDate: '2026-01-01', endDate: '2026-12-31', status: 'active', createdBy: principalId, updatedBy: principalId }); periodId = p._id;
  const c = await insert(SchoolClass, { branchId: branch, academicPeriodId: periodId, name: 'Test class', code: `C${randomUUID().slice(0, 5)}`, academicYear: '2026', isActive: true }); classId = c._id;
  const s = await insert(Section, { branchId: branch, classId, name: 'Test section', code: `S${randomUUID().slice(0, 5)}`, isActive: true }); sectionId = s._id;
  const studentUser = await insert(User, { fullName: 'Synthetic student', email: `${randomUUID()}@example.invalid`, password: 'test-only', role: 'student', branchId: branch, isActive: true });
  const student = await insert(Student, { userId: studentUser._id, branchId: branch, classId, sectionId, admissionNumber: `A${randomUUID().slice(0, 8)}`, isActive: true }); studentId = student._id;
  const enrollment = await StudentEnrollment.create({ studentId, branchId: branch, academicPeriodId: periodId, classId, sectionId, status: 'active', effectiveFrom: new Date(Date.now() - 60_000), reason: 'Synthetic test enrollment', createdBy: principalId, updatedBy: principalId }); enrollmentId = enrollment._id;
  const link = await insert(ParentStudentLink, { parentUserId: parentId, studentId, branchId: branch, relationship: 'guardian', status: 'verified', isActive: true, createdBy: principalId, verifiedBy: principalId, verifiedAt: new Date(Date.now() - 1000) }); parentLinkId = link._id;
  const parentIdentity = await identity(parentId, 'parent'); parentToken = parentIdentity.token; parentSessionId = parentIdentity.sessionId;
  principalToken = (await identity(principalId, 'principal')).token;

  const payload = { fullName: 'Synthetic collector', relationship: 'guardian', phone: '+15551234567', validFromDate: '2026-01-01', validUntilDate: '2026-12-31', notes: '' };
  const policy = await insert(PickupCustodyPolicy, { branchId: branch, revision: 1, status: 'unconfigured', activationEnabled: false });
  const person = await insert(PickupPerson, {
    requesterId: parentId, parentStudentLinkId: parentLinkId, studentId, branchId: branch, enrollmentId,
    academicPeriodId: periodId, classId, sectionId, ...payload, verificationState: 'proposed', revision: 0,
    history: [{ action: 'created', revision: 0, actorId: parentId, at: new Date(Date.now() - 2000), fingerprint: pickupDigest([payload.fullName, payload.relationship, payload.phone]) }],
  }); pickupPersonId = person._id;
  authorizationId = oid(); const approvalId = oid(); pickupApprovalId = approvalId; const submissionId = oid();
  await insert(PickupAuthorization, {
    _id: authorizationId, studentId, branchId: branch, requesterId: parentId, parentStudentLinkId: parentLinkId,
    enrollmentId, academicPeriodId: periodId, classId, sectionId, pickupPersonId, policyId: policy._id, policyRevision: 1,
    validFromDate: payload.validFromDate, validUntilDate: payload.validUntilDate, notes: '', state: 'pending', revision: 1,
    approvalRequestId: approvalId, submissionId, cycle: 1, operationalStatus: 'inactive',
    history: [
      { action: 'created', revision: 0, actorId: parentId, at: new Date(Date.now() - 4000), fingerprint: '0'.repeat(64) },
      { action: 'submitted', revision: 1, actorId: parentId, at: new Date(Date.now() - 3000), fingerprint: '1'.repeat(64) },
    ],
  });
  await insert(ApprovalRequest, { _id: approvalId, entityType: 'pickup_authorization', entityId: authorizationId, approvalType: 'pickup_authorization', requesterId: parentId, branchId: branch, reason: 'Synthetic proposal', status: 'pending', pickupRevision: 1, history: [{ action: 'submitted', performedBy: parentId, createdAt: new Date(Date.now() - 1000) }] });
  await insert(PickupSubmission, {
    _id: submissionId, authorizationId, pickupPersonId, branchId: branch, requesterId: parentId, studentId,
    applicationRevision: 1, personRevision: 0, cycle: 1, payload,
    fingerprint: pickupFingerprint(studentId, payload), routingVersion: 1, policyId: policy._id, policyRevision: 1,
    submittedAt: new Date(Date.now() - 1000),
  });
});

after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await mongoose.disconnect();
  await replSet.stop();
  if (evidenceRoot) await rm(evidenceRoot, { recursive: true, force: true });
  delete process.env.CUSTODY_RECORD_REVIEW_AUTHORITY_JSON;
  delete process.env.CUSTODY_EVIDENCE_RETENTION_POLICY_REF;
});

test('authenticated Parent custody workflow is owner-scoped and Principal review is explicitly configured and non-operational', async () => {
  const createOperation = operation('custody-create');
  const create = await call(parentToken, 'POST', custodyBase(), { enrollmentId: String(enrollmentId), summary: 'Private custody record', operationId: createOperation });
  assert.equal(create.status, 201, JSON.stringify(create.json)); assert.equal(create.json.data.state, 'draft');
  const recordId = create.json.data.id as string;
  const replay = await call(parentToken, 'POST', custodyBase(), { enrollmentId: String(enrollmentId), summary: 'Private custody record', operationId: createOperation });
  assert.equal(replay.status, 201); assert.equal(replay.json.data.id, recordId);

  const otherParent = await insert(User, { fullName: 'Second guardian', email: `${randomUUID()}@example.invalid`, password: 'test-only', role: 'parent', branchId: branch, isActive: true });
  await insert(ParentStudentLink, { parentUserId: otherParent._id, studentId, branchId: branch, relationship: 'guardian', status: 'verified', isActive: true, createdBy: principalId, verifiedBy: principalId, verifiedAt: new Date(Date.now() - 1000) });
  const otherToken = (await identity(otherParent._id, 'parent')).token;
  const otherCreate = await call(otherToken, 'POST', custodyBase(), { enrollmentId: String(enrollmentId), summary: 'Other private record', operationId: operation('custody-create') });
  assert.equal(otherCreate.status, 201);
  const ownSecond = await call(parentToken, 'POST', custodyBase(), { enrollmentId: String(enrollmentId), summary: 'Second owned custody record', operationId: operation('custody-create') });
  assert.equal(ownSecond.status, 201);
  const ownList = await call(parentToken, 'GET', `${custodyBase()}?enrollmentId=${enrollmentId}&limit=1`);
  assert.equal(ownList.status, 200); assert.equal(ownList.json.data.items.length, 1); assert.ok(ownList.json.data.nextCursor);
  const nextPage = await call(parentToken, 'GET', `${custodyBase()}?enrollmentId=${enrollmentId}&limit=1&cursor=${encodeURIComponent(ownList.json.data.nextCursor)}`);
  assert.equal(nextPage.status, 200); assert.equal(nextPage.json.data.items.length, 1); assert.equal(nextPage.json.data.nextCursor, null);
  assert.deepEqual(new Set([...ownList.json.data.items, ...nextPage.json.data.items].map((row: any) => row.id)), new Set([recordId, ownSecond.json.data.id]));
  assert.equal((await call(parentToken, 'GET', `${custodyBase()}/${otherCreate.json.data.id}`)).status, 404);
  assert.equal((await call(parentToken, 'POST', custodyBase(), { enrollmentId: String(enrollmentId), summary: 'Forged', operationId: operation('forged'), branchId: String(oid()), requesterId: String(oid()) })).status, 400);

  const upload = await call(parentToken, 'POST', `${custodyBase()}/${recordId}/evidence`, pdf, { 'Content-Type': 'application/pdf', 'Idempotency-Key': operation('custody-evidence') });
  assert.equal(upload.status, 201); assert.equal(upload.json.data.status, 'available');
  assert.equal('storageObjectKey' in upload.json.data, false); assert.equal('content' in upload.json.data, false);
  const attached = await call(parentToken, 'POST', `${custodyBase()}/${recordId}/evidence-associations`, { evidenceId: upload.json.data.evidenceId, expectedRevision: 1, operationId: operation('custody-attach') });
  assert.equal(attached.status, 201, JSON.stringify(attached.json)); assert.equal(attached.json.data.revision, 2);
  const submitted = await call(parentToken, 'POST', `${custodyBase()}/${recordId}/actions/submit`, { expectedRevision: 2, operationId: operation('custody-submit'), reason: 'Submit for administrative completeness' });
  assert.equal(submitted.status, 200); assert.equal(submitted.json.data.state, 'submitted');

  assert.equal((await call(principalToken, 'GET', `/api/principal/custody-records/${recordId}`)).status, 404, 'Principal role and permission alone must not grant detail access');
  process.env.CUSTODY_RECORD_REVIEW_AUTHORITY_JSON = JSON.stringify([{ principalUserId: String(principalId), branchId: String(branch), studentCustody: ['read'], collectorVerification: [] }]);
  const ungrantedAction = await call(principalToken, 'POST', `/api/principal/custody-records/${recordId}/actions/complete_review`, { expectedRevision: 3, operationId: operation('ungranted-review'), reason: 'Not configured' });
  assert.equal(ungrantedAction.status, 403, 'Read permission/configuration does not grant the complete_review action');
  assert.equal((await StudentCustodyRecord.findById(recordId).lean())?.state, 'submitted');
  assert.equal((await StudentCustodyRecord.findById(recordId).lean())?.revision, 3);
  process.env.CUSTODY_RECORD_REVIEW_AUTHORITY_JSON = JSON.stringify([{ principalUserId: String(principalId), branchId: String(branch), studentCustody: ['read', 'complete_review'], collectorVerification: [] }]);
  const detail = await call(principalToken, 'GET', `/api/principal/custody-records/${recordId}`);
  assert.equal(detail.status, 200); assert.equal(detail.json.data.record.state, 'submitted');
  const complete = await call(principalToken, 'POST', `/api/principal/custody-records/${recordId}/actions/complete_review`, { expectedRevision: 3, operationId: operation('custody-review'), reason: 'Administrative record completeness reviewed' });
  assert.equal(complete.status, 200); assert.equal(complete.json.data.state, 'review_completed');
  assert.equal(await StudentCustodyState.countDocuments(), 0, 'Administrative completion does not create custody state');
  assert.equal(await StudentCustodyRecordEvent.countDocuments({ recordId }), 4);
  const parentReceipts = await StudentCustodyRecordOperation.find({ actorId: parentId }).select('+fingerprint +result').lean();
  assert.equal(parentReceipts.length, 4, JSON.stringify(parentReceipts.map(row => row.clientOperationId)));
  assert.equal(await StudentCustodyRecordOperation.countDocuments(), 6, 'Other guardian and Principal each have a separate receipt; create replay adds none');
  assert.equal(await StudentCustodyRecordOperation.countDocuments({ actorId: principalId }), 1);
  assert.equal(await StudentCustodyRecordOperation.countDocuments({ actorId: otherParent._id }), 1);
  assert.equal((await ProtectedEvidence.findOne({ evidenceId: upload.json.data.evidenceId }).lean())?.status, 'available');

  const revocationTarget = await call(parentToken, 'POST', custodyBase(), { enrollmentId: String(enrollmentId), summary: 'Revocation race draft', operationId: operation('custody-create') });
  assert.equal(revocationTarget.status, 201);
  let signalScanner!: () => void;
  let releaseScanner!: () => void;
  const scannerStarted = new Promise<void>(resolve => { signalScanner = resolve; });
  const scannerRelease = new Promise<void>(resolve => { releaseScanner = resolve; });
  scannerBarrier = { signalStarted: signalScanner, wait: scannerRelease };
  const pendingUpload = call(parentToken, 'POST', `${custodyBase()}/${revocationTarget.json.data.id}/evidence`, pdf, { 'Content-Type': 'application/pdf', 'Idempotency-Key': operation('revoked-upload') });
  await scannerStarted;
  await ParentStudentLink.collection.updateOne({ _id: parentLinkId }, { $set: { status: 'revoked', isActive: false } });
  releaseScanner(); scannerBarrier = null;
  assert.equal((await pendingUpload).status, 404);
  const unchangedDuringUpload = await StudentCustodyRecord.findById(revocationTarget.json.data.id).lean();
  assert.equal(unchangedDuringUpload?.state, 'draft'); assert.equal(unchangedDuringUpload?.revision, 1);
  assert.equal(await StudentCustodyRecordEvent.countDocuments({ recordId: revocationTarget.json.data.id }), 1);
  assert.equal(await StudentCustodyRecordEvidence.countDocuments({ recordId: revocationTarget.json.data.id }), 0);
  assert.equal((await ProtectedEvidence.findOne({ resourceId: revocationTarget.json.data.id }).lean())?.status, 'failed');

  assert.equal((await call(parentToken, 'GET', `${custodyBase()}/${recordId}`)).status, 404);
  assert.equal((await call(principalToken, 'GET', `/api/principal/custody-records/${recordId}`)).status, 404, 'Revoked requester relationship also conceals reviewer access');
  assert.equal(await StudentCustodyRecord.countDocuments({ _id: recordId }), 1, 'Revocation conceals access but retains records');
  await Session.collection.updateOne({ _id: parentSessionId }, { $set: { isRevoked: true } });
  assert.equal((await call(parentToken, 'GET', `${custodyBase()}/${recordId}`)).status, 401);
  await Session.collection.updateOne({ userId: parentId }, { $set: { isRevoked: true } });
  assert.equal((await call(parentToken, 'GET', `${custodyBase()}/${recordId}`)).status, 401);
});

test('authenticated collector workflow preserves proposed identity and explicit reviewer scope', async () => {
  const created = await call(parentToken, 'POST', collectorBase(), { summary: 'Private collector record', operationId: operation('collector-create') });
  assert.equal(created.status, 201, JSON.stringify(created.json)); assert.equal(created.json.data.state, 'draft');
  assert.equal(created.json.data.pickupPersonId, String(pickupPersonId));
  const recordId = created.json.data.id as string;
  const upload = await call(parentToken, 'POST', `${collectorBase()}/${recordId}/evidence`, pdf, { 'Content-Type': 'application/pdf', 'Idempotency-Key': operation('collector-evidence') });
  assert.equal(upload.status, 201, JSON.stringify(upload.json)); assert.equal(upload.json.data.status, 'available');
  const attached = await call(parentToken, 'POST', `${collectorBase()}/${recordId}/evidence-associations`, { evidenceId: upload.json.data.evidenceId, expectedRevision: 1, operationId: operation('collector-attach') });
  assert.equal(attached.status, 201, JSON.stringify(attached.json)); assert.equal(attached.json.data.revision, 2);
  const submitted = await call(parentToken, 'POST', `${collectorBase()}/${recordId}/actions/submit`, { expectedRevision: 2, operationId: operation('collector-submit'), reason: 'Submit for administrative completeness' });
  assert.equal(submitted.status, 200); assert.equal(submitted.json.data.state, 'submitted');
  const unrelatedCustody = await call(parentToken, 'POST', custodyBase(), { enrollmentId: String(enrollmentId), summary: 'Independent custody category fixture', operationId: operation('custody-create') });
  assert.equal(unrelatedCustody.status, 201, JSON.stringify(unrelatedCustody.json));
  assert.equal((await call(principalToken, 'GET', `/api/principal/collector-verification-records/${recordId}`)).status, 404);
  process.env.CUSTODY_RECORD_REVIEW_AUTHORITY_JSON = JSON.stringify([{ principalUserId: String(principalId), branchId: String(branch), studentCustody: [], collectorVerification: ['read', 'request_changes'] }]);
  const queue = await call(principalToken, 'GET', `/api/principal/collector-verification-records?authorizationId=${authorizationId}&limit=1`);
  assert.equal(queue.status, 200); assert.deepEqual(queue.json.data.items.map((row: any) => row.id), [recordId]);
  const detail = await call(principalToken, 'GET', `/api/principal/collector-verification-records/${recordId}`);
  assert.equal(detail.status, 200); assert.equal(detail.json.data.record.state, 'submitted');
  assert.equal((await call(principalToken, 'GET', `/api/principal/custody-records/${unrelatedCustody.json.data.id}`)).status, 404, 'Collector review configuration does not grant Student custody review');
  const genericAttempt = await call(principalToken, 'PATCH', `/api/approval-requests/${pickupApprovalId}`, { action: 'approved', reason: 'attempt generic bypass' });
  assert.notEqual(genericAttempt.status, 200);
  assert.equal((await ApprovalRequest.findById(pickupApprovalId).lean())?.status, 'pending');
  const decision = await call(principalToken, 'POST', `/api/principal/collector-verification-records/${recordId}/actions/request_changes`, { expectedRevision: 3, operationId: operation('collector-review'), reason: 'Provide a current identity document for review' });
  assert.equal(decision.status, 200); assert.equal(decision.json.data.state, 'changes_requested');
  const persistedPerson = await PickupPerson.findById(pickupPersonId).lean();
  assert.equal(persistedPerson?.verificationState, 'proposed');
  assert.equal((await PickupAuthorization.findById(authorizationId).lean())?.operationalStatus, 'inactive');
  assert.equal(await StudentCustodyState.countDocuments(), 0);
  assert.equal(await CollectorVerificationRecordEvent.countDocuments({ recordId }), 4);
  assert.equal(await CollectorVerificationRecordOperation.countDocuments(), 4);
  assert.equal(await CollectorVerificationRecord.countDocuments({ _id: recordId }), 1);
  await PickupPerson.collection.updateOne({ _id: pickupPersonId }, { $inc: { revision: 1 } });
  assert.equal((await call(parentToken, 'GET', `${collectorBase()}/${recordId}`)).status, 404);
  assert.equal(await CollectorVerificationRecord.countDocuments({ _id: recordId }), 1, 'Stale identity conceals access without deleting the administrative record');
  assert.equal(await CollectorVerificationRecord.countDocuments({ _id: recordId }), 1);
});

test('collector identity revision change during evidence scan prevents availability and leaves record history untouched', async () => {
  const created = await call(parentToken, 'POST', collectorBase(), { summary: 'Identity-race collector record', operationId: operation('collector-create') });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  let signalScanner!: () => void;
  let releaseScanner!: () => void;
  const scannerStarted = new Promise<void>(resolve => { signalScanner = resolve; });
  const scannerRelease = new Promise<void>(resolve => { releaseScanner = resolve; });
  scannerBarrier = { signalStarted: signalScanner, wait: scannerRelease };
  const recordId = created.json.data.id as string;
  const pendingUpload = call(parentToken, 'POST', `${collectorBase()}/${recordId}/evidence`, pdf, { 'Content-Type': 'application/pdf', 'Idempotency-Key': operation('stale-collector-upload') });
  await scannerStarted;
  await PickupPerson.collection.updateOne({ _id: pickupPersonId }, { $inc: { revision: 1 } });
  releaseScanner(); scannerBarrier = null;
  assert.equal((await pendingUpload).status, 404);
  const stored = await CollectorVerificationRecord.findById(recordId).lean();
  assert.equal(stored?.state, 'draft'); assert.equal(stored?.revision, 1);
  assert.equal(await CollectorVerificationRecordEvent.countDocuments({ recordId }), 1);
  assert.equal(await CollectorVerificationRecordEvidence.countDocuments({ recordId }), 0);
  assert.equal((await ProtectedEvidence.findOne({ resourceId: recordId }).lean())?.status, 'failed');
});

test('authentication, policy parsing, Branch scope, evidence availability and malformed revisions fail closed', async () => {
  assert.equal((await call(undefined, 'GET', `${custodyBase()}?enrollmentId=${enrollmentId}`)).status, 401);
  const invalidToken = await fetch(`${baseUrl}${custodyBase()}?enrollmentId=${enrollmentId}`, { headers: { Authorization: 'Bearer invalid-token' } });
  assert.equal(invalidToken.status, 401);
  const created = await call(parentToken, 'POST', custodyBase(), { enrollmentId: String(enrollmentId), summary: 'Policy test', operationId: operation('custody-create') });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  await User.collection.updateOne({ _id: parentId }, { $set: { role: 'student' } });
  assert.equal((await call(parentToken, 'GET', `${custodyBase()}/${created.json.data.id}`)).status, 401);
  await User.collection.updateOne({ _id: parentId }, { $set: { role: 'parent' } });
  process.env.CUSTODY_RECORD_REVIEW_AUTHORITY_JSON = '{malformed';
  assert.equal((await call(principalToken, 'GET', `/api/principal/custody-records/${created.json.data.id}`)).status, 404);
  const foreignBranch = await insert(Branch, { name: 'Foreign branch', code: `F${randomUUID().slice(0, 5)}`, address: 'Synthetic', city: 'Synthetic', isActive: true });
  const foreignPrincipal = await insert(User, { fullName: 'Foreign Principal', email: `${randomUUID()}@example.invalid`, password: 'test-only', role: 'principal', branchId: foreignBranch._id, isActive: true });
  const foreignToken = (await identity(foreignPrincipal._id, 'principal')).token;
  process.env.CUSTODY_RECORD_REVIEW_AUTHORITY_JSON = JSON.stringify([{ principalUserId: String(foreignPrincipal._id), branchId: String(foreignBranch._id), studentCustody: ['read'], collectorVerification: [] }]);
  assert.equal((await call(foreignToken, 'GET', `/api/principal/custody-records/${created.json.data.id}`)).status, 404);
  assert.equal((await call(parentToken, 'PATCH', `${custodyBase()}/${created.json.data.id}`, { expectedRevision: 999, operationId: operation('bad-rev'), summary: 'Changed', reason: 'Update' })).status, 409);
  await StudentEnrollment.collection.updateOne({ _id: enrollmentId }, { $set: { status: 'transferred', effectiveTo: new Date() } });
  assert.equal((await call(parentToken, 'GET', `${custodyBase()}/${created.json.data.id}`)).status, 404);
  assert.equal(await StudentCustodyRecord.countDocuments({ _id: created.json.data.id }), 1);
});

