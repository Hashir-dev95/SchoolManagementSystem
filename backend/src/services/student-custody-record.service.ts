import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import mongoose, { type ClientSession, type Document, Types } from 'mongoose';
import Branch from '../models/branch';
import User from '../models/user';
import Session from '../models/session';
import Student from '../models/student';
import { StudentEnrollment, activeEnrollmentFilter } from '../models/studentEnrollment';
import { AcademicPeriod } from '../models/academicPeriod';
import SchoolClass from '../models/schoolClass';
import Section from '../models/section';
import { StudentCustodyState } from '../models/gateFoundation';
import { ProtectedEvidence } from '../models/protectedEvidence';
import {
  StudentCustodyRecord,
  StudentCustodyRecordEvent,
  StudentCustodyRecordEvidence,
  StudentCustodyRecordOperation,
  type StudentCustodyRecordEventAction,
  type StudentCustodyRecordState,
} from '../models/studentCustodyRecord';
import type {
  EvidenceActor,
  EvidenceAuthorizationRequest,
  EvidenceDto,
} from './protected-evidence.service';
import { withAcademicCatalogLock } from './academic-catalog-lock.service';
import { communicationFence } from './teacher-communication-access.service';
import {
  authorizeStudentCustodyRecord,
  readStudentCustodyEvidence,
} from './student-custody-record.trusted-dependencies';

type CustodyWriteContext = {
  document: Document;
  modelName: string;
  session: ClientSession;
  consumed: boolean;
};
const custodyWriteContext = new AsyncLocalStorage<CustodyWriteContext>();
const custodyWriteModelNames = new Set([
  'StudentCustodyRecord',
  'StudentCustodyRecordEvent',
  'StudentCustodyRecordEvidence',
  'StudentCustodyRecordOperation',
]);

/** @internal Read-only predicate used by the model validation guard. */
export function hasCustodyWriteContext(
  document: Document,
  session: ClientSession | null,
) {
  const context = custodyWriteContext.getStore();
  return context?.document === document && context.session === session;
}

/** @internal Consumes an already-issued private service write context. */
export function consumeCustodyWriteContext(
  document: Document,
  session: ClientSession | null,
) {
  const context = custodyWriteContext.getStore();
  if (
    !context || context.consumed || context.document !== document ||
    context.session !== session || context.modelName !== documentModelName(document)
  ) return false;
  context.consumed = true;
  return true;
}

function documentModelName(document: Document) {
  return (document.constructor as { modelName?: string }).modelName ?? '';
}

/** Permit issuance stays private to this authorized custody service module. */
async function persistCustodyDocumentInTransaction<T extends Document>(
  document: T,
  session: ClientSession,
): Promise<T> {
  const modelName = documentModelName(document);
  const mustAppend = modelName !== 'StudentCustodyRecord';
  if (
    !custodyWriteModelNames.has(modelName) ||
    !session.inTransaction() ||
    document.$session() !== session ||
    (mustAppend && !document.isNew)
  ) {
    throw new Error('Custody persistence requires one transaction-scoped service write');
  }
  const context: CustodyWriteContext = { document, modelName, session, consumed: false };
  return custodyWriteContext.run(context, async () => {
    const result = await document.save({ session });
    return result as T;
  });
}

export class StudentCustodyRecordError extends Error {
  constructor(
    readonly code:
      | 'invalid_request'
      | 'not_found'
      | 'unauthorized'
      | 'conflict'
      | 'evidence_unavailable'
      | 'storage_unavailable',
  ) {
    super(code);
    this.name = 'StudentCustodyRecordError';
  }
}

export type CustodyRecordAction =
  | 'create'
  | 'read'
  | 'edit'
  | 'submit'
  | 'request_changes'
  | 'complete_review'
  | 'withdraw'
  | 'revoke'
  | 'invalidate'
  | 'attach_evidence';
type CustodyRecordMutationAction =
  | 'edit'
  | 'submit'
  | 'request_changes'
  | 'complete_review'
  | 'withdraw'
  | 'revoke'
  | 'invalidate';
const eventActionForMutation: Record<
  CustodyRecordMutationAction,
  StudentCustodyRecordEventAction
> = {
  edit: 'draft_updated',
  submit: 'submitted',
  request_changes: 'changes_requested',
  complete_review: 'review_completed',
  withdraw: 'withdrawn',
  revoke: 'revoked',
  invalidate: 'invalidated',
};

export type CustodyRecordActor = EvidenceActor;
export type CustodyRecordAuthorization = Readonly<{
  action: CustodyRecordAction;
  actorId: string;
  actorRole: string;
  branchId: string;
  studentId: string;
  enrollmentId: string;
  recordId: string | null;
  session: ClientSession;
}>;
export type CustodyRecordAuthorizer = (
  input: CustodyRecordAuthorization,
) => Promise<boolean>;
type EvidenceReader = (input: {
  actor: EvidenceActor;
  evidenceId: string;
  authorize: (request: EvidenceAuthorizationRequest) => Promise<boolean>;
}) => Promise<{ metadata: EvidenceDto; content: Buffer; contentType: string }>;

const validId = (value: string) =>
  Types.ObjectId.isValid(value) &&
  new Types.ObjectId(value).toHexString() === value.toLowerCase();
const fail = (code: ConstructorParameters<typeof StudentCustodyRecordError>[0]) =>
  new StudentCustodyRecordError(code);
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const operationPattern = /^[A-Za-z0-9._:-]{12,128}$/;
const allowedTransitions: Partial<
  Record<StudentCustodyRecordState, StudentCustodyRecordState[]>
> = {
  draft: ['draft', 'submitted', 'withdrawn', 'invalidated'],
  submitted: [
    'changes_requested',
    'review_completed',
    'withdrawn',
    'revoked',
    'invalidated',
  ],
  changes_requested: ['draft', 'submitted', 'withdrawn', 'invalidated'],
};

function safeRecord(record: any, evidence: any[] = []) {
  return Object.freeze({
    id: String(record._id),
    branchId: String(record.branchId),
    studentId: String(record.studentId),
    enrollmentId: String(record.enrollmentId),
    academicPeriodId: String(record.academicPeriodId),
    classId: String(record.classId),
    sectionId: String(record.sectionId),
    state: record.state as StudentCustodyRecordState,
    revision: record.revision as number,
    summary: record.summary as string,
    createdAt: record.createdAt as Date,
    updatedAt: record.updatedAt as Date,
    evidence: evidence.map(item => ({
      evidenceId: item.evidenceId as string,
      revision: item.evidenceRevision as number,
      contentType: item.contentType as string,
      byteLength: item.byteLength as number,
      attachedAt: item.attachedAt as Date,
    })),
  });
}

/**
 * Internal record-management foundation. The mandatory authorizer is the
 * domain-specific Parent/reviewer boundary; no HTTP route wires one by default.
 * review_completed records administrative completeness only and has no legal or
 * operational meaning. This service never changes StudentCustodyState.
 */
function buildStudentCustodyRecordService(config: Readonly<{
  authorize: CustodyRecordAuthorizer;
  readEvidence: EvidenceReader;
}>) {
  if (typeof config.authorize !== 'function' || typeof config.readEvidence !== 'function')
    throw fail('invalid_request');

  async function actorContext(actor: CustodyRecordActor, session: ClientSession) {
    if (!validId(actor.userId) || !validId(actor.branchId) || !validId(actor.sessionId))
      throw fail('unauthorized');
    for (const [collection, id] of [
      [User.collection.name, actor.userId],
      [Session.collection.name, actor.sessionId],
      [Branch.collection.name, actor.branchId],
    ]) await communicationFence(session, collection, id);
    const [user, login, branch] = await Promise.all([
      User.findById(actor.userId).session(session).read('primary').lean(),
      Session.findById(actor.sessionId).session(session).read('primary').lean(),
      Branch.findOne({ _id: actor.branchId, isActive: true }).session(session).read('primary').lean(),
    ]);
    if (
      !user || !user.isActive || String(user.branchId ?? '') !== actor.branchId ||
      !login || login.isRevoked || String(login.userId) !== actor.userId || login.role !== user.role || !branch
    ) throw fail('unauthorized');
    return { user, login, branch };
  }

  async function enrollmentContext(
    actor: CustodyRecordActor,
    studentId: string,
    enrollmentId: string,
    session: ClientSession,
  ) {
    if (!validId(studentId) || !validId(enrollmentId)) throw fail('not_found');
    await communicationFence(session, Student.collection.name, studentId);
    await communicationFence(session, StudentEnrollment.collection.name, enrollmentId);
    const [student, enrollment] = await Promise.all([
      Student.findById(studentId).where('branchId').equals(actor.branchId).where('isActive').equals(true).session(session).read('primary').lean(),
      StudentEnrollment.findOne({
        _id: enrollmentId,
        studentId,
        branchId: actor.branchId,
        ...activeEnrollmentFilter(),
        effectiveTo: null,
      }).session(session).read('primary').lean(),
    ]);
    if (!student || !enrollment) throw fail('not_found');
    const [period, schoolClass, section] = await Promise.all([
      AcademicPeriod.findOne({ _id: enrollment.academicPeriodId, branchId: actor.branchId }).session(session).lean(),
      SchoolClass.findById(enrollment.classId).where('branchId').equals(actor.branchId).where('isActive').equals(true).session(session).lean(),
      Section.findById(enrollment.sectionId).where('classId').equals(enrollment.classId).where('branchId').equals(actor.branchId).where('isActive').equals(true).session(session).lean(),
    ]);
    if (!period || !schoolClass || !section || String(schoolClass.academicPeriodId) !== String(period._id))
      throw fail('not_found');
    return { student, enrollment, period, schoolClass, section };
  }

  async function authorize(
    action: CustodyRecordAction,
    actor: CustodyRecordActor,
    user: { role: string },
    scope: { studentId: string; enrollmentId: string },
    recordId: string | null,
    session: ClientSession,
  ) {
    const requesterActions: CustodyRecordAction[] = ['create', 'edit', 'submit', 'withdraw', 'attach_evidence'];
    const reviewActions: CustodyRecordAction[] = ['request_changes', 'complete_review', 'revoke', 'invalidate'];
    if ((requesterActions.includes(action) && user.role !== 'parent') ||
      (reviewActions.includes(action) && user.role !== 'principal') ||
      (action === 'read' && !['parent', 'principal'].includes(user.role))) throw fail('unauthorized');
    let allowed = false;
    try {
      allowed = await config.authorize({
        action,
        actorId: actor.userId,
        actorRole: user.role,
        branchId: actor.branchId,
        studentId: scope.studentId,
        enrollmentId: scope.enrollmentId,
        recordId,
        session,
      }) === true;
    } catch { /* deny without surfacing private authority details */ }
    if (!allowed) throw fail('unauthorized');
  }

  async function requireCurrentRecord(
    actor: CustodyRecordActor,
    recordId: string,
    session: ClientSession,
  ) {
    if (!validId(recordId)) throw fail('not_found');
    const record = await StudentCustodyRecord.findOne({ _id: recordId, branchId: actor.branchId })
      .session(session).read('primary').lean();
    if (!record) throw fail('not_found');
    const scope = await enrollmentContext(actor, String(record.studentId), String(record.enrollmentId), session);
    if (String(scope.enrollment._id) !== String(record.enrollmentId)) throw fail('not_found');
    return { record, scope };
  }

  async function writeEvent(
    record: any,
    actorId: string,
    action: StudentCustodyRecordEventAction,
    reason: string,
    session: ClientSession,
  ) {
    const event = new StudentCustodyRecordEvent({
      recordId: record._id,
      revision: record.revision,
      branchId: record.branchId,
      studentId: record.studentId,
      enrollmentId: record.enrollmentId,
      actorId,
      action,
      state: record.state,
      summary: record.summary,
      reason,
      at: new Date(),
    });
    event.$session(session);
    await persistCustodyDocumentInTransaction(event, session);
  }

  async function checkReplay(
    actorId: string,
    operationId: string,
    fingerprint: string,
    session: ClientSession,
  ) {
    const receipt = await StudentCustodyRecordOperation.findOne({ actorId, clientOperationId: operationId })
      .select('+fingerprint +result').session(session).lean();
    if (!receipt) return null;
    if (receipt.fingerprint !== fingerprint) throw fail('conflict');
    const recordId = (receipt.result as { recordId?: unknown })?.recordId;
    if (typeof recordId !== 'string' || !validId(recordId)) throw fail('conflict');
    return recordId;
  }

  async function saveReceipt(
    actorId: string,
    branchId: string,
    operationId: string,
    fingerprint: string,
    recordId: string,
    session: ClientSession,
  ) {
    const receipt = new StudentCustodyRecordOperation({
      actorId, branchId, clientOperationId: operationId, fingerprint, result: { recordId },
    });
    receipt.$session(session);
    await persistCustodyDocumentInTransaction(receipt, session);
  }

  async function create(input: Readonly<{
    actor: CustodyRecordActor;
    studentId: string;
    enrollmentId: string;
    summary: string;
    operationId: string;
  }>) {
    if (!input.actor || !validId(input.actor.branchId)) throw fail('unauthorized');
    const summary = input.summary.trim();
    if (!summary || summary.length > 1000 || !operationPattern.test(input.operationId)) throw fail('invalid_request');
    const fingerprint = digest({ action: 'create', studentId: input.studentId, enrollmentId: input.enrollmentId, summary });
    return withAcademicCatalogLock(input.actor.branchId, async session => {
      const { user } = await actorContext(input.actor, session);
      const scope = await enrollmentContext(input.actor, input.studentId, input.enrollmentId, session);
      await authorize('create', input.actor, user, { studentId: input.studentId, enrollmentId: input.enrollmentId }, null, session);
      const replay = await checkReplay(input.actor.userId, input.operationId, fingerprint, session);
      if (replay) {
        const { record } = await requireCurrentRecord(input.actor, replay, session);
        await authorize('create', input.actor, user, { studentId: String(record.studentId), enrollmentId: String(record.enrollmentId) }, replay, session);
        return safeRecord(record, await StudentCustodyRecordEvidence.find({ recordId: replay }).session(session).lean());
      }
      const record = new StudentCustodyRecord({
        branchId: input.actor.branchId,
        studentId: input.studentId,
        enrollmentId: input.enrollmentId,
        academicPeriodId: scope.enrollment.academicPeriodId,
        classId: scope.enrollment.classId,
        sectionId: scope.enrollment.sectionId,
        createdBy: input.actor.userId,
        state: 'draft', revision: 1, summary,
      });
      record.$session(session);
      await persistCustodyDocumentInTransaction(record, session);
      await writeEvent(record, input.actor.userId, 'created', 'Draft created', session);
      await saveReceipt(input.actor.userId, input.actor.branchId, input.operationId, fingerprint, String(record._id), session);
      const finalActor = await actorContext(input.actor, session);
      await authorize('create', input.actor, finalActor.user, { studentId: input.studentId, enrollmentId: input.enrollmentId }, String(record._id), session);
      return safeRecord(record);
    });
  }

  async function read(input: Readonly<{ actor: CustodyRecordActor; recordId: string }>) {
    const session = await mongoose.startSession();
    try {
      return await session.withTransaction(async () => {
        const { user } = await actorContext(input.actor, session);
        const { record } = await requireCurrentRecord(input.actor, input.recordId, session);
        await authorize('read', input.actor, user, { studentId: String(record.studentId), enrollmentId: String(record.enrollmentId) }, String(record._id), session);
        const [evidence, events] = await Promise.all([
          StudentCustodyRecordEvidence.find({ recordId: record._id }).sort({ attachedAt: 1 }).session(session).lean(),
          StudentCustodyRecordEvent.find({ recordId: record._id }).sort({ revision: 1 }).session(session).lean(),
        ]);
        return { record: safeRecord(record, evidence), history: events.map(event => ({ revision: event.revision, action: event.action, state: event.state, reason: event.reason, at: event.at })) };
      }, { readPreference: 'primary', readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } finally { await session.endSession(); }
  }

  async function mutate(input: Readonly<{
    actor: CustodyRecordActor;
    recordId: string;
    expectedRevision: number;
    operationId: string;
      action: CustodyRecordMutationAction;
    summary?: string;
    reason: string;
  }>) {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || !operationPattern.test(input.operationId)) throw fail('invalid_request');
    if (!input.actor || !validId(input.actor.branchId)) throw fail('unauthorized');
    const reason = input.reason.trim();
    const summary = input.summary?.trim();
    if (!reason || reason.length > 500 || (summary !== undefined && (!summary || summary.length > 1000))) throw fail('invalid_request');
    const fingerprint = digest({ action: input.action, recordId: input.recordId, expectedRevision: input.expectedRevision, summary: summary ?? null, reason });
    return withAcademicCatalogLock(input.actor.branchId, async session => {
      const { user } = await actorContext(input.actor, session);
      const { record: initial } = await requireCurrentRecord(input.actor, input.recordId, session);
      await communicationFence(session, StudentCustodyRecord.collection.name, input.recordId);
      await authorize(input.action, input.actor, user, { studentId: String(initial.studentId), enrollmentId: String(initial.enrollmentId) }, input.recordId, session);
      const replay = await checkReplay(input.actor.userId, input.operationId, fingerprint, session);
      if (replay) {
        const { record } = await requireCurrentRecord(input.actor, replay, session);
        await authorize(input.action, input.actor, user, { studentId: String(record.studentId), enrollmentId: String(record.enrollmentId) }, replay, session);
        return safeRecord(record, await StudentCustodyRecordEvidence.find({ recordId: replay }).session(session).lean());
      }
      const { record, scope } = await requireCurrentRecord(input.actor, input.recordId, session);
      await authorize(input.action, input.actor, user, { studentId: String(record.studentId), enrollmentId: String(record.enrollmentId) }, input.recordId, session);
      if (record.revision !== input.expectedRevision || initial.revision !== record.revision) throw fail('conflict');
      const target: StudentCustodyRecordState = input.action === 'edit' ? (record.state === 'changes_requested' ? 'draft' : record.state) : input.action === 'submit' ? 'submitted' : input.action === 'request_changes' ? 'changes_requested' : input.action === 'complete_review' ? 'review_completed' : input.action === 'withdraw' ? 'withdrawn' : input.action === 'revoke' ? 'revoked' : 'invalidated';
      if (input.action === 'edit' && !['draft', 'changes_requested'].includes(record.state)) throw fail('conflict');
      if (!allowedTransitions[record.state]?.includes(target)) throw fail('conflict');
      if (['request_changes', 'complete_review', 'revoke'].includes(input.action) && String(record.createdBy) === input.actor.userId) throw fail('unauthorized');
      if (['submit', 'request_changes', 'complete_review'].includes(input.action)) {
        const custody = await StudentCustodyState.findOne({ studentId: record.studentId, branchId: record.branchId }).session(session).lean();
        if (custody && (custody.state !== 'unknown' || String(custody.enrollmentId) !== String(record.enrollmentId))) throw fail('conflict');
        if (input.action === 'submit' || input.action === 'complete_review') await assertEvidenceCurrent(record, input.actor, session);
      }
      if (input.action === 'edit' && summary === undefined) throw fail('invalid_request');
      if (input.action !== 'edit' && summary !== undefined) throw fail('invalid_request');
      const nextSummary = summary ?? record.summary;
      const updatedDocument = await StudentCustodyRecord.findById(record._id).session(session).orFail();
      if (updatedDocument.revision !== input.expectedRevision || updatedDocument.state !== record.state) throw fail('conflict');
      updatedDocument.state = target;
      updatedDocument.summary = nextSummary;
      updatedDocument.revision++;
      await persistCustodyDocumentInTransaction(updatedDocument, session);
      const updated = updatedDocument.toObject();
      const eventAction = eventActionForMutation[input.action];
      await writeEvent(updated, input.actor.userId, eventAction, reason, session);
      await saveReceipt(input.actor.userId, input.actor.branchId, input.operationId, fingerprint, String(updated._id), session);
      // Repeat the persisted actor/session and domain authorization checks before
      // transaction commit. Callback implementers must fence their authority data.
      const finalActor = await actorContext(input.actor, session);
      await authorize(input.action, input.actor, finalActor.user, { studentId: String(scope.student._id), enrollmentId: String(scope.enrollment._id) }, input.recordId, session);
      return safeRecord(updated, await StudentCustodyRecordEvidence.find({ recordId: updated._id }).session(session).lean());
    });
  }

  async function assertEvidenceCurrent(record: any, actor: CustodyRecordActor, session: ClientSession) {
    const associations = await StudentCustodyRecordEvidence.find({ recordId: record._id }).session(session).lean();
    if (!associations.length) throw fail('evidence_unavailable');
    for (const association of associations) {
      await communicationFence(session, ProtectedEvidence.collection.name, String(association.evidenceObjectId));
      const evidence = await ProtectedEvidence.findOne({
        _id: association.evidenceObjectId,
        evidenceId: association.evidenceId,
        domain: 'custody', purpose: 'verification', ownerType: 'student',
        ownerId: record.studentId, branchId: record.branchId, resourceId: record._id,
        status: 'available', scanStatus: 'clean',
        revision: association.evidenceRevision,
        sha256: association.evidenceDigest, scanDigest: association.evidenceDigest,
      }).session(session).lean();
      if (!evidence) throw fail('evidence_unavailable');
      const result = await config.readEvidence({
        actor,
        evidenceId: association.evidenceId,
        authorize: async request => request.action === 'read' && request.domain === 'custody' && request.purpose === 'verification' && request.branchId === String(record.branchId) && request.ownerType === 'student' && request.ownerId === String(record.studentId) && request.resourceId === String(record._id),
      });
      const observedLength = result.content.length;
      const digestNow = createHash('sha256').update(result.content).digest('hex');
      result.content.fill(0);
      if (result.metadata.revision !== association.evidenceRevision || digestNow !== association.evidenceDigest || result.metadata.status !== 'available' || result.metadata.byteLength !== association.byteLength || result.metadata.contentType !== association.contentType || observedLength !== association.byteLength) throw fail('evidence_unavailable');
    }
  }

  async function attachEvidence(input: Readonly<{
    actor: CustodyRecordActor;
    recordId: string;
    evidenceId: string;
    expectedRevision: number;
    operationId: string;
  }>) {
    if (!operationPattern.test(input.operationId) || !Number.isSafeInteger(input.expectedRevision)) throw fail('invalid_request');
    // Establish record authority before allowing the evidence reader to return
    // any bytes. The reader callback rechecks that same scoped authority.
    const preflight = await mongoose.startSession();
    try {
      await preflight.withTransaction(async () => {
        const { user } = await actorContext(input.actor, preflight);
        const { record } = await requireCurrentRecord(input.actor, input.recordId, preflight);
        await authorize('attach_evidence', input.actor, user, { studentId: String(record.studentId), enrollmentId: String(record.enrollmentId) }, input.recordId, preflight);
      }, { readPreference: 'primary', readConcern: { level: 'snapshot' } });
    } finally { await preflight.endSession(); }
    // The B2-2 reader verifies current session, storage bytes and digest. Its
    // callback repeats domain authorization without exposing content first.
    const evidenceResult = await config.readEvidence({
      actor: input.actor,
      evidenceId: input.evidenceId,
      authorize: async request => {
        if (request.action !== 'read' || request.domain !== 'custody' || request.purpose !== 'verification' || request.branchId !== input.actor.branchId || request.ownerType !== 'student') return false;
        const verify = await mongoose.startSession();
        try {
          return await verify.withTransaction(async () => {
            const { user } = await actorContext(input.actor, verify);
            const { record } = await requireCurrentRecord(input.actor, input.recordId, verify);
            if (request.ownerId !== String(record.studentId) || request.resourceId !== input.recordId) return false;
            await authorize('attach_evidence', input.actor, user, { studentId: String(record.studentId), enrollmentId: String(record.enrollmentId) }, input.recordId, verify);
            return true;
          }, { readPreference: 'primary', readConcern: { level: 'snapshot' } });
        } catch { return false; }
        finally { await verify.endSession(); }
      },
    });
    const observedLength = evidenceResult.content.length;
    const contentDigest = createHash('sha256').update(evidenceResult.content).digest('hex');
    evidenceResult.content.fill(0);
    if (evidenceResult.metadata.status !== 'available' || evidenceResult.metadata.domain !== 'custody' || evidenceResult.metadata.purpose !== 'verification' || observedLength !== evidenceResult.metadata.byteLength || evidenceResult.contentType !== evidenceResult.metadata.contentType) throw fail('evidence_unavailable');
    const fingerprint = digest({ action: 'attach_evidence', recordId: input.recordId, evidenceId: input.evidenceId, expectedRevision: input.expectedRevision, evidenceRevision: evidenceResult.metadata.revision, contentDigest });
    return withAcademicCatalogLock(input.actor.branchId, async session => {
      const { user } = await actorContext(input.actor, session);
      const { record } = await requireCurrentRecord(input.actor, input.recordId, session);
      await authorize('attach_evidence', input.actor, user, { studentId: String(record.studentId), enrollmentId: String(record.enrollmentId) }, input.recordId, session);
      const replay = await checkReplay(input.actor.userId, input.operationId, fingerprint, session);
      if (replay) return safeRecord((await requireCurrentRecord(input.actor, replay, session)).record, await StudentCustodyRecordEvidence.find({ recordId: replay }).session(session).lean());
      if (record.state !== 'draft' || record.revision !== input.expectedRevision) throw fail('conflict');
      const evidence = await ProtectedEvidence.findOne({ evidenceId: input.evidenceId, branchId: input.actor.branchId }).session(session).lean();
      if (evidence) await communicationFence(session, ProtectedEvidence.collection.name, String(evidence._id));
      const currentEvidence = evidence ? await ProtectedEvidence.findById(evidence._id).session(session).lean() : null;
      if (!currentEvidence || currentEvidence.domain !== 'custody' || currentEvidence.purpose !== 'verification' || currentEvidence.ownerType !== 'student' || String(currentEvidence.ownerId) !== String(record.studentId) || String(currentEvidence.resourceId) !== String(record._id) || String(currentEvidence.uploaderId) !== input.actor.userId || currentEvidence.status !== 'available' || currentEvidence.scanStatus !== 'clean' || currentEvidence.revision !== evidenceResult.metadata.revision || currentEvidence.sha256 !== contentDigest || currentEvidence.scanDigest !== contentDigest) throw fail('evidence_unavailable');
      const nextDocument = await StudentCustodyRecord.findById(record._id).session(session).orFail();
      if (nextDocument.revision !== input.expectedRevision || nextDocument.state !== 'draft') throw fail('conflict');
      nextDocument.revision++;
      await persistCustodyDocumentInTransaction(nextDocument, session);
      const next = nextDocument.toObject();
      const association = new StudentCustodyRecordEvidence({
        recordId: record._id, branchId: record.branchId, studentId: record.studentId, enrollmentId: record.enrollmentId,
        evidenceId: currentEvidence.evidenceId, evidenceObjectId: currentEvidence._id, evidenceRevision: currentEvidence.revision,
        evidenceDigest: currentEvidence.sha256, contentType: currentEvidence.detectedContentType, byteLength: currentEvidence.byteLength,
        attachedBy: input.actor.userId, attachedAt: new Date(),
      });
      association.$session(session);
      await persistCustodyDocumentInTransaction(association, session);
      await writeEvent(next, input.actor.userId, 'evidence_attached', 'Evidence attached', session);
      await saveReceipt(input.actor.userId, input.actor.branchId, input.operationId, fingerprint, String(next._id), session);
      const finalActor = await actorContext(input.actor, session);
      await authorize('attach_evidence', input.actor, finalActor.user, { studentId: String(record.studentId), enrollmentId: String(record.enrollmentId) }, input.recordId, session);
      return safeRecord(next, await StudentCustodyRecordEvidence.find({ recordId: next._id }).session(session).lean());
    });
  }

  async function listPageForStudent(input: Readonly<{
    actor: CustodyRecordActor; studentId: string; enrollmentId: string; limit?: number;
    before?: Readonly<{ createdAt: Date; id: string }>;
  }>) {
    const limit = input.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (input.before && (!Number.isFinite(input.before.createdAt.getTime()) || !validId(input.before.id)))) throw fail('invalid_request');
    const session = await mongoose.startSession();
    try {
      return await session.withTransaction(async () => {
        const { user } = await actorContext(input.actor, session);
        await enrollmentContext(input.actor, input.studentId, input.enrollmentId, session);
        await authorize('read', input.actor, user, input, null, session);
        const listScope: Record<string, unknown> = { branchId: input.actor.branchId, studentId: input.studentId, enrollmentId: input.enrollmentId };
        if (user.role === 'parent') listScope.createdBy = input.actor.userId;
        if (input.before) listScope.$or = [
          { createdAt: { $lt: input.before.createdAt } },
          { createdAt: input.before.createdAt, _id: { $lt: new Types.ObjectId(input.before.id) } },
        ];
        const records = await StudentCustodyRecord.find(listScope).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).session(session).lean();
        const page = records.slice(0, limit);
        const visible = [];
        for (const record of page) {
          if (user.role === 'principal') {
            try {
              await authorize('read', input.actor, user, { studentId: input.studentId, enrollmentId: input.enrollmentId }, String(record._id), session);
            } catch (error) {
              if (error instanceof StudentCustodyRecordError && error.code === 'unauthorized') continue;
              throw error;
            }
          }
          visible.push(record);
        }
        const last = page.at(-1);
        return {
          items: visible.map(record => safeRecord(record)),
          nextCursor: records.length > limit && last ? { createdAt: last.createdAt, id: String(last._id) } : null,
        };
      }, { readPreference: 'primary', readConcern: { level: 'snapshot' } });
    } finally { await session.endSession(); }
  }

  async function listForStudent(input: Readonly<{ actor: CustodyRecordActor; studentId: string; enrollmentId: string }>) {
    return (await listPageForStudent(input)).items;
  }

  async function authorizeEvidenceUpload(input: Readonly<{ actor: CustodyRecordActor; recordId: string }>) {
    const session = await mongoose.startSession();
    try {
      return await session.withTransaction(async () => {
        const { user } = await actorContext(input.actor, session);
        const { record } = await requireCurrentRecord(input.actor, input.recordId, session);
        await authorize('attach_evidence', input.actor, user, { studentId: String(record.studentId), enrollmentId: String(record.enrollmentId) }, input.recordId, session);
        return record.state === 'draft';
      }, { readPreference: 'primary', readConcern: { level: 'snapshot' } });
    } catch { return false; }
    finally { await session.endSession(); }
  }

  return Object.freeze({ create, read, mutate, attachEvidence, listForStudent, listPageForStudent, authorizeEvidenceUpload });
}

/** Supported production operations use fixed, fail-closed dependencies. */
export const studentCustodyRecordService = buildStudentCustodyRecordService({
  authorize: authorizeStudentCustodyRecord,
  readEvidence: readStudentCustodyEvidence,
});
