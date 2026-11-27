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
import { ParentStudentLink } from '../models/parentStudentLink';
import ApprovalRequest, { PICKUP_AUTHORIZATION_APPROVAL_ENTITY } from '../models/approvalRequest';
import { PickupPerson, PickupAuthorization, PickupSubmission, PickupCustodyPolicy, pickupDigest } from '../models/pickupAuthorization';
import { ProtectedEvidence } from '../models/protectedEvidence';
import {
  CollectorVerificationRecord,
  CollectorVerificationRecordEvent,
  CollectorVerificationRecordEvidence,
  CollectorVerificationRecordOperation,
  type CollectorVerificationRecordEventAction,
  type CollectorVerificationRecordState,
} from '../models/collectorVerificationRecord';
import type {
  EvidenceActor,
  EvidenceAuthorizationRequest,
  EvidenceDto,
} from './protected-evidence.service';
import { withAcademicCatalogLock } from './academic-catalog-lock.service';
import { communicationFence } from './teacher-communication-access.service';
import { collectorIdentityBindingMatches } from './school-custody-contract';
import { pickupFingerprint } from './pickup-authorization.policy';
import {
  authorizeCollectorVerificationRecord,
  readCollectorVerificationEvidence,
} from './collector-verification-record.trusted-dependencies';

type CollectorWriteContext = {
  document: Document;
  modelName: string;
  session: ClientSession;
  consumed: boolean;
};
const collectorWriteContext = new AsyncLocalStorage<CollectorWriteContext>();
const collectorWriteModelNames = new Set([
  'CollectorVerificationRecord',
  'CollectorVerificationRecordEvent',
  'CollectorVerificationRecordEvidence',
  'CollectorVerificationRecordOperation',
]);

/** @internal Read-only predicate used by the model validation guard. */
export function hasCollectorWriteContext(
  document: Document,
  session: ClientSession | null,
) {
  const context = collectorWriteContext.getStore();
  return context?.document === document && context.session === session;
}

/** @internal Consumes an already-issued private service write context. */
export function consumeCollectorWriteContext(
  document: Document,
  session: ClientSession | null,
) {
  const context = collectorWriteContext.getStore();
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

/** Permit issuance stays private to this authorized collector service module. */
async function persistCollectorDocumentInTransaction<T extends Document>(
  document: T,
  session: ClientSession,
): Promise<T> {
  const modelName = documentModelName(document);
  const mustAppend = modelName !== 'CollectorVerificationRecord';
  if (
    !collectorWriteModelNames.has(modelName) ||
    !session.inTransaction() ||
    document.$session() !== session ||
    (mustAppend && !document.isNew)
  ) {
    throw new Error('Collector persistence requires one transaction-scoped service write');
  }
  const context: CollectorWriteContext = { document, modelName, session, consumed: false };
  return collectorWriteContext.run(context, async () => {
    const result = await document.save({ session });
    return result as T;
  });
}

export class CollectorVerificationRecordError extends Error {
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
    this.name = 'CollectorVerificationRecordError';
  }
}

export type CollectorVerificationRecordAction =
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
type CollectorVerificationRecordMutationAction =
  | 'edit'
  | 'submit'
  | 'request_changes'
  | 'complete_review'
  | 'withdraw'
  | 'revoke'
  | 'invalidate';
const eventActionForMutation: Record<
  CollectorVerificationRecordMutationAction,
  CollectorVerificationRecordEventAction
> = {
  edit: 'draft_updated',
  submit: 'submitted',
  request_changes: 'changes_requested',
  complete_review: 'review_completed',
  withdraw: 'withdrawn',
  revoke: 'revoked',
  invalidate: 'invalidated',
};

export type CollectorVerificationRecordActor = EvidenceActor;
export type CollectorVerificationRecordAuthorization = Readonly<{
  action: CollectorVerificationRecordAction;
  actorId: string;
  actorRole: string;
  branchId: string;
  studentId: string;
  enrollmentId: string;
  recordId: string | null;
  pickupPersonId: string;
  pickupAuthorizationId: string;
  pickupSubmissionId: string;
  requesterId: string;
  parentStudentLinkId: string;
  personRevision: number;
  identityFingerprint: string;
  session: ClientSession;
}>;
export type CollectorVerificationRecordAuthorizer = (
  input: CollectorVerificationRecordAuthorization,
) => Promise<boolean>;
type EvidenceReader = (input: {
  actor: EvidenceActor;
  evidenceId: string;
  authorize: (request: EvidenceAuthorizationRequest) => Promise<boolean>;
}) => Promise<{ metadata: EvidenceDto; content: Buffer; contentType: string }>;

const validId = (value: string) =>
  Types.ObjectId.isValid(value) &&
  new Types.ObjectId(value).toHexString() === value.toLowerCase();
const fail = (code: ConstructorParameters<typeof CollectorVerificationRecordError>[0]) =>
  new CollectorVerificationRecordError(code);
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const operationPattern = /^[A-Za-z0-9._:-]{12,128}$/;
const allowedTransitions: Partial<
  Record<CollectorVerificationRecordState, CollectorVerificationRecordState[]>
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
    pickupPersonId: String(record.pickupPersonId),
    pickupAuthorizationId: String(record.pickupAuthorizationId),
    submissionCycle: record.submissionCycle as number,
    branchId: String(record.branchId),
    studentId: String(record.studentId),
    enrollmentId: String(record.enrollmentId),
    academicPeriodId: String(record.academicPeriodId),
    classId: String(record.classId),
    sectionId: String(record.sectionId),
    state: record.state as CollectorVerificationRecordState,
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
function buildCollectorVerificationRecordService(config: Readonly<{
  authorize: CollectorVerificationRecordAuthorizer;
  readEvidence: EvidenceReader;
}>) {
  if (typeof config.authorize !== 'function' || typeof config.readEvidence !== 'function')
    throw fail('invalid_request');

  async function readEvidenceSafely(input: Parameters<EvidenceReader>[0]) {
    try { return await config.readEvidence(input); }
    catch { throw fail('evidence_unavailable'); }
  }

  async function actorContext(actor: CollectorVerificationRecordActor, session: ClientSession) {
    if (!actor || typeof actor.userId !== 'string' || typeof actor.branchId !== 'string' || typeof actor.sessionId !== 'string' ||
      !validId(actor.userId) || !validId(actor.branchId) || !validId(actor.sessionId))
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
    actor: CollectorVerificationRecordActor,
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
    action: CollectorVerificationRecordAction,
    actor: CollectorVerificationRecordActor,
    user: { role: string },
    scope: {
      studentId: string; enrollmentId: string; pickupPersonId: string;
      pickupAuthorizationId: string; pickupSubmissionId: string;
      requesterId: string; parentStudentLinkId: string; personRevision: number;
      identityFingerprint: string;
    },
    recordId: string | null,
    session: ClientSession,
  ) {
    const requesterActions: CollectorVerificationRecordAction[] = ['create', 'edit', 'submit', 'withdraw', 'attach_evidence'];
    const reviewActions: CollectorVerificationRecordAction[] = ['request_changes', 'complete_review', 'revoke', 'invalidate'];
    if ((requesterActions.includes(action) && user.role !== 'parent') ||
      (reviewActions.includes(action) && user.role !== 'principal') ||
      (action === 'read' && !['parent', 'principal'].includes(user.role))) throw fail('unauthorized');
    if (requesterActions.includes(action) && actor.userId !== scope.requesterId) throw fail('unauthorized');
    if (reviewActions.includes(action) && actor.userId === scope.requesterId) throw fail('unauthorized');
    if (action === 'read' && user.role === 'parent' && actor.userId !== scope.requesterId) throw fail('unauthorized');
    if (action === 'read' && user.role === 'principal' && actor.userId === scope.requesterId) throw fail('unauthorized');
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
        pickupPersonId: scope.pickupPersonId,
        pickupAuthorizationId: scope.pickupAuthorizationId,
        pickupSubmissionId: scope.pickupSubmissionId,
        requesterId: scope.requesterId,
        parentStudentLinkId: scope.parentStudentLinkId,
        personRevision: scope.personRevision,
        identityFingerprint: scope.identityFingerprint,
        session,
      }) === true;
    } catch { /* deny without surfacing private authority details */ }
    if (!allowed) throw fail('unauthorized');
  }

  async function proposalContext(
    actor: CollectorVerificationRecordActor,
    authorizationId: string,
    session: ClientSession,
  ) {
    if (!validId(authorizationId)) throw fail('not_found');
    const proposal = await PickupAuthorization.findOne({
      _id: authorizationId, branchId: actor.branchId, state: 'pending',
      operationalStatus: 'inactive', cycle: { $gte: 1 },
    }).session(session).read('primary').lean();
    if (!proposal?.submissionId || !proposal.approvalRequestId) throw fail('not_found');
    await communicationFence(session, PickupAuthorization.collection.name, authorizationId);
    const approval = await ApprovalRequest.findOne({
      _id: proposal.approvalRequestId, entityId: proposal._id,
      entityType: PICKUP_AUTHORIZATION_APPROVAL_ENTITY,
      approvalType: 'pickup_authorization', branchId: proposal.branchId,
      requesterId: proposal.requesterId, status: 'pending', pickupRevision: { $gte: 1 },
    }).session(session).read('primary').lean();
    if (!approval) throw fail('not_found');
    const person = await PickupPerson.findOne({ _id: proposal.pickupPersonId, branchId: actor.branchId })
      .select('+phone +history').session(session).read('primary').lean();
    if (!person || person.verificationState !== 'proposed') throw fail('not_found');
    await communicationFence(session, PickupPerson.collection.name, String(person._id));
    const submission = await PickupSubmission.findOne({
      _id: proposal.submissionId, authorizationId: proposal._id,
      pickupPersonId: proposal.pickupPersonId, branchId: proposal.branchId,
      requesterId: proposal.requesterId, studentId: proposal.studentId,
      cycle: proposal.cycle, personRevision: person.revision,
    }).select('+payload +fingerprint').session(session).read('primary').lean();
    if (submission) await communicationFence(session, PickupSubmission.collection.name, String(submission._id));
    if (!submission || proposal.revision !== submission.applicationRevision ||
      approval.pickupRevision !== submission.applicationRevision ||
      submission.fingerprint !== pickupFingerprint(proposal.studentId, submission.payload as any) ||
      submission.personRevision !== person.revision ||
      submission.payload.fullName !== person.fullName ||
      submission.payload.relationship !== person.relationship ||
      submission.payload.phone !== person.phone) throw fail('not_found');
    const binding = {
      pickupPersonId: String(person._id), personRevision: submission.personRevision,
      identityFingerprint: pickupDigest([person.fullName, person.relationship, person.phone]),
      provenance: {
        requesterId: String(proposal.requesterId), parentStudentLinkId: String(proposal.parentStudentLinkId),
        studentId: String(proposal.studentId), branchId: String(proposal.branchId),
        enrollmentId: String(proposal.enrollmentId), academicPeriodId: String(proposal.academicPeriodId),
        classId: String(proposal.classId), sectionId: String(proposal.sectionId),
      },
    };
    if (!collectorIdentityBindingMatches(binding, person)) throw fail('not_found');
    const link = await ParentStudentLink.findOne({
      _id: proposal.parentStudentLinkId, parentUserId: proposal.requesterId,
      studentId: proposal.studentId, branchId: proposal.branchId,
      status: 'verified', isActive: true,
    }).session(session).read('primary').lean();
    if (!link) throw fail('not_found');
    const scope = await enrollmentContext(actor, String(proposal.studentId), String(proposal.enrollmentId), session);
    if (String(scope.enrollment.academicPeriodId) !== String(proposal.academicPeriodId) ||
      String(scope.enrollment.classId) !== String(proposal.classId) ||
      String(scope.enrollment.sectionId) !== String(proposal.sectionId)) throw fail('not_found');
    const policy = await PickupCustodyPolicy.findOne({ _id: proposal.policyId, branchId: actor.branchId }).session(session).read('primary').lean();
    if (!policy || policy.status !== 'unconfigured' || policy.activationEnabled ||
      policy.revision !== proposal.policyRevision || String(submission.policyId) !== String(policy._id) ||
      submission.policyRevision !== policy.revision) throw fail('not_found');
    const custody = await StudentCustodyState.findOne({ branchId: actor.branchId, studentId: proposal.studentId }).session(session).lean();
    if (custody && (custody.state !== 'unknown' || String(custody.enrollmentId) !== String(proposal.enrollmentId))) throw fail('not_found');
    return { proposal, person, submission, link, policy, scope, binding };
  }

  function recordAuthority(record: any) {
    return {
      studentId: String(record.studentId), enrollmentId: String(record.enrollmentId),
      pickupPersonId: String(record.pickupPersonId), pickupAuthorizationId: String(record.pickupAuthorizationId),
      pickupSubmissionId: String(record.pickupSubmissionId), requesterId: String(record.requesterId),
      parentStudentLinkId: String(record.parentStudentLinkId), personRevision: record.personRevision as number,
      identityFingerprint: String(record.identityFingerprint),
    };
  }

  function bindingMismatch(record: any, bound: Awaited<ReturnType<typeof proposalContext>>) {
    const { proposal, person, submission, link, policy } = bound;
    return String(record.pickupPersonId) !== String(person._id) ||
      String(record.pickupAuthorizationId) !== String(proposal._id) ||
      String(record.pickupSubmissionId) !== String(submission._id) ||
      record.submissionCycle !== proposal.cycle || record.personRevision !== person.revision ||
      record.identityFingerprint !== bound.binding.identityFingerprint ||
      String(record.requesterId) !== String(proposal.requesterId) ||
      String(record.parentStudentLinkId) !== String(link._id) ||
      String(record.studentId) !== String(proposal.studentId) ||
      String(record.branchId) !== String(proposal.branchId) ||
      String(record.enrollmentId) !== String(proposal.enrollmentId) ||
      String(record.academicPeriodId) !== String(proposal.academicPeriodId) ||
      String(record.classId) !== String(proposal.classId) ||
      String(record.sectionId) !== String(proposal.sectionId) ||
      String(record.policyId) !== String(policy._id) || record.policyRevision !== policy.revision;
  }

  async function requireCurrentRecord(
    actor: CollectorVerificationRecordActor,
    recordId: string,
    session: ClientSession,
  ) {
    if (!validId(recordId)) throw fail('not_found');
    const record = await CollectorVerificationRecord.findOne({ _id: recordId, branchId: actor.branchId })
      .session(session).read('primary').lean();
    if (!record) throw fail('not_found');
    const bound = await proposalContext(actor, String(record.pickupAuthorizationId), session);
    if (String(bound.person._id) !== String(record.pickupPersonId) ||
      String(bound.proposal.submissionId) !== String(record.pickupSubmissionId) ||
      bound.proposal.cycle !== record.submissionCycle || bound.person.revision !== record.personRevision ||
      bindingMismatch(record, bound)) throw fail('not_found');
    return { record, scope: bound.scope, bound };
  }

  async function writeEvent(
    record: any,
    actorId: string,
    action: CollectorVerificationRecordEventAction,
    reason: string,
    session: ClientSession,
  ) {
    const event = new CollectorVerificationRecordEvent({
      recordId: record._id,
      pickupPersonId: record.pickupPersonId,
      pickupAuthorizationId: record.pickupAuthorizationId,
      pickupSubmissionId: record.pickupSubmissionId,
      submissionCycle: record.submissionCycle,
      personRevision: record.personRevision,
      identityFingerprint: record.identityFingerprint,
      requesterId: record.requesterId,
      parentStudentLinkId: record.parentStudentLinkId,
      revision: record.revision,
      branchId: record.branchId,
      studentId: record.studentId,
      enrollmentId: record.enrollmentId,
      academicPeriodId: record.academicPeriodId,
      classId: record.classId,
      sectionId: record.sectionId,
      policyId: record.policyId,
      policyRevision: record.policyRevision,
      actorId,
      action,
      state: record.state,
      summary: record.summary,
      reason,
      at: new Date(),
    });
    event.$session(session);
    await persistCollectorDocumentInTransaction(event, session);
  }

  async function checkReplay(
    actorId: string,
    operationId: string,
    fingerprint: string,
    session: ClientSession,
  ) {
    const receipt = await CollectorVerificationRecordOperation.findOne({ actorId, clientOperationId: operationId })
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
    record: any,
    session: ClientSession,
  ) {
    const receipt = new CollectorVerificationRecordOperation({
      actorId, branchId, pickupPersonId: record.pickupPersonId,
      pickupAuthorizationId: record.pickupAuthorizationId,
      pickupSubmissionId: record.pickupSubmissionId,
      submissionCycle: record.submissionCycle,
      personRevision: record.personRevision,
      recordId: record._id,
      clientOperationId: operationId, fingerprint, result: { recordId: String(record._id) },
    });
    receipt.$session(session);
    await persistCollectorDocumentInTransaction(receipt, session);
  }

  async function create(input: Readonly<{
    actor: CollectorVerificationRecordActor;
    authorizationId: string;
    summary: string;
    operationId: string;
  }>) {
    if (!input.actor || !validId(input.actor.branchId)) throw fail('unauthorized');
    if (typeof input.summary !== 'string' || typeof input.operationId !== 'string' || typeof input.authorizationId !== 'string') throw fail('invalid_request');
    const summary = input.summary.trim();
    if (!summary || summary.length > 1000 || !operationPattern.test(input.operationId)) throw fail('invalid_request');
    const fingerprint = digest({ action: 'create', authorizationId: input.authorizationId, summary });
    return withAcademicCatalogLock(input.actor.branchId, async session => {
      const { user } = await actorContext(input.actor, session);
      const bound = await proposalContext(input.actor, input.authorizationId, session);
      if (input.actor.userId !== String(bound.proposal.requesterId)) throw fail('unauthorized');
      const authority = {
        studentId: String(bound.proposal.studentId), enrollmentId: String(bound.proposal.enrollmentId),
        pickupPersonId: String(bound.person._id), pickupAuthorizationId: String(bound.proposal._id),
        pickupSubmissionId: String(bound.submission._id), requesterId: String(bound.proposal.requesterId),
        parentStudentLinkId: String(bound.link._id), personRevision: bound.person.revision,
        identityFingerprint: bound.binding.identityFingerprint,
      };
      await authorize('create', input.actor, user, authority, null, session);
      const replay = await checkReplay(input.actor.userId, input.operationId, fingerprint, session);
      if (replay) {
        const { record } = await requireCurrentRecord(input.actor, replay, session);
        if (bindingMismatch(record, bound)) throw fail('not_found');
        await authorize('create', input.actor, user, recordAuthority(record), replay, session);
        return safeRecord(record, await CollectorVerificationRecordEvidence.find({ recordId: replay }).session(session).lean());
      }
      const record = new CollectorVerificationRecord({
        pickupPersonId: bound.person._id,
        pickupAuthorizationId: bound.proposal._id,
        pickupSubmissionId: bound.submission._id,
        submissionCycle: bound.proposal.cycle,
        personRevision: bound.person.revision,
        identityFingerprint: bound.binding.identityFingerprint,
        requesterId: bound.proposal.requesterId,
        parentStudentLinkId: bound.link._id,
        branchId: bound.proposal.branchId,
        studentId: bound.proposal.studentId,
        enrollmentId: bound.proposal.enrollmentId,
        academicPeriodId: bound.proposal.academicPeriodId,
        classId: bound.proposal.classId,
        sectionId: bound.proposal.sectionId,
        policyId: bound.policy._id,
        policyRevision: bound.policy.revision,
        createdBy: input.actor.userId,
        state: 'draft', revision: 1, summary,
      });
      record.$session(session);
      await persistCollectorDocumentInTransaction(record, session);
      await writeEvent(record, input.actor.userId, 'created', 'Draft created', session);
      await saveReceipt(input.actor.userId, input.actor.branchId, input.operationId, fingerprint, record, session);
      const finalActor = await actorContext(input.actor, session);
      const finalBound = await proposalContext(input.actor, input.authorizationId, session);
      if (bindingMismatch(record, finalBound)) throw fail('conflict');
      await authorize('create', input.actor, finalActor.user, recordAuthority(record), String(record._id), session);
      return safeRecord(record);
    });
  }

  async function read(input: Readonly<{ actor: CollectorVerificationRecordActor; recordId: string }>) {
    const session = await mongoose.startSession();
    try {
      return await session.withTransaction(async () => {
        const { user } = await actorContext(input.actor, session);
        const { record } = await requireCurrentRecord(input.actor, input.recordId, session);
        await authorize('read', input.actor, user, recordAuthority(record), String(record._id), session);
        const [evidence, events] = await Promise.all([
          CollectorVerificationRecordEvidence.find({ recordId: record._id }).sort({ attachedAt: 1 }).session(session).lean(),
          CollectorVerificationRecordEvent.find({ recordId: record._id }).sort({ revision: 1 }).session(session).lean(),
        ]);
        return { record: safeRecord(record, evidence), history: events.map(event => ({ revision: event.revision, action: event.action, state: event.state, reason: event.reason, at: event.at })) };
      }, { readPreference: 'primary', readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } finally { await session.endSession(); }
  }

  async function mutate(input: Readonly<{
    actor: CollectorVerificationRecordActor;
    recordId: string;
    expectedRevision: number;
    operationId: string;
      action: CollectorVerificationRecordMutationAction;
    summary?: string;
    reason: string;
  }>) {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || !operationPattern.test(input.operationId)) throw fail('invalid_request');
    if (!input.actor || !validId(input.actor.branchId)) throw fail('unauthorized');
    if (!Object.prototype.hasOwnProperty.call(eventActionForMutation, input.action) || typeof input.reason !== 'string' || (input.summary !== undefined && typeof input.summary !== 'string')) throw fail('invalid_request');
    const reason = input.reason.trim();
    const summary = input.summary?.trim();
    if (!reason || reason.length > 500 || (summary !== undefined && (!summary || summary.length > 1000))) throw fail('invalid_request');
    const fingerprint = digest({ action: input.action, recordId: input.recordId, expectedRevision: input.expectedRevision, summary: summary ?? null, reason });
    return withAcademicCatalogLock(input.actor.branchId, async session => {
      const { user } = await actorContext(input.actor, session);
      const { record: initial } = await requireCurrentRecord(input.actor, input.recordId, session);
      await communicationFence(session, CollectorVerificationRecord.collection.name, input.recordId);
      await authorize(input.action, input.actor, user, recordAuthority(initial), input.recordId, session);
      const replay = await checkReplay(input.actor.userId, input.operationId, fingerprint, session);
      if (replay) {
        const { record } = await requireCurrentRecord(input.actor, replay, session);
        await authorize(input.action, input.actor, user, recordAuthority(record), replay, session);
        return safeRecord(record, await CollectorVerificationRecordEvidence.find({ recordId: replay }).session(session).lean());
      }
      const { record } = await requireCurrentRecord(input.actor, input.recordId, session);
      await authorize(input.action, input.actor, user, recordAuthority(record), input.recordId, session);
      if (record.revision !== input.expectedRevision || initial.revision !== record.revision) throw fail('conflict');
      const target: CollectorVerificationRecordState = input.action === 'edit' ? (record.state === 'changes_requested' ? 'draft' : record.state) : input.action === 'submit' ? 'submitted' : input.action === 'request_changes' ? 'changes_requested' : input.action === 'complete_review' ? 'review_completed' : input.action === 'withdraw' ? 'withdrawn' : input.action === 'revoke' ? 'revoked' : 'invalidated';
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
      const updatedDocument = await CollectorVerificationRecord.findById(record._id).session(session).orFail();
      if (updatedDocument.revision !== input.expectedRevision || updatedDocument.state !== record.state) throw fail('conflict');
      updatedDocument.state = target;
      updatedDocument.summary = nextSummary;
      updatedDocument.revision++;
      await persistCollectorDocumentInTransaction(updatedDocument, session);
      const updated = updatedDocument.toObject();
      const eventAction = eventActionForMutation[input.action];
      await writeEvent(updated, input.actor.userId, eventAction, reason, session);
      await saveReceipt(input.actor.userId, input.actor.branchId, input.operationId, fingerprint, updated, session);
      // Repeat the persisted actor/session and domain authorization checks before
      // transaction commit. Callback implementers must fence their authority data.
      const finalActor = await actorContext(input.actor, session);
      const finalRecord = await requireCurrentRecord(input.actor, input.recordId, session);
      await authorize(input.action, input.actor, finalActor.user, recordAuthority(finalRecord.record), input.recordId, session);
      return safeRecord(updated, await CollectorVerificationRecordEvidence.find({ recordId: updated._id }).session(session).lean());
    });
  }

  async function assertEvidenceCurrent(record: any, actor: CollectorVerificationRecordActor, session: ClientSession) {
    const associations = await CollectorVerificationRecordEvidence.find({ recordId: record._id }).session(session).lean();
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
      const result = await readEvidenceSafely({
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
    actor: CollectorVerificationRecordActor;
    recordId: string;
    evidenceId: string;
    expectedRevision: number;
    operationId: string;
  }>) {
    if (!operationPattern.test(input.operationId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || typeof input.evidenceId !== 'string') throw fail('invalid_request');
    // Establish record authority before allowing the evidence reader to return
    // any bytes. The reader callback rechecks that same scoped authority.
    const preflight = await mongoose.startSession();
    try {
      await preflight.withTransaction(async () => {
        const { user } = await actorContext(input.actor, preflight);
        const { record } = await requireCurrentRecord(input.actor, input.recordId, preflight);
        await authorize('attach_evidence', input.actor, user, recordAuthority(record), input.recordId, preflight);
      }, { readPreference: 'primary', readConcern: { level: 'snapshot' } });
    } finally { await preflight.endSession(); }
    // The B2-2 reader verifies current session, storage bytes and digest. Its
    // callback repeats domain authorization without exposing content first.
    const evidenceResult = await readEvidenceSafely({
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
            await authorize('attach_evidence', input.actor, user, recordAuthority(record), input.recordId, verify);
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
      await authorize('attach_evidence', input.actor, user, recordAuthority(record), input.recordId, session);
      const replay = await checkReplay(input.actor.userId, input.operationId, fingerprint, session);
      if (replay) {
        const replayedRecord = (await requireCurrentRecord(input.actor, replay, session)).record;
        await authorize('attach_evidence', input.actor, user, recordAuthority(replayedRecord), replay, session);
        return safeRecord(replayedRecord, await CollectorVerificationRecordEvidence.find({ recordId: replay }).session(session).lean());
      }
      if (record.state !== 'draft' || record.revision !== input.expectedRevision) throw fail('conflict');
      const evidence = await ProtectedEvidence.findOne({ evidenceId: input.evidenceId, branchId: input.actor.branchId }).session(session).lean();
      if (evidence) await communicationFence(session, ProtectedEvidence.collection.name, String(evidence._id));
      const currentEvidence = evidence ? await ProtectedEvidence.findById(evidence._id).session(session).lean() : null;
      if (!currentEvidence || currentEvidence.domain !== 'custody' || currentEvidence.purpose !== 'verification' || currentEvidence.ownerType !== 'student' || String(currentEvidence.ownerId) !== String(record.studentId) || String(currentEvidence.resourceId) !== String(record._id) || String(currentEvidence.uploaderId) !== input.actor.userId || currentEvidence.status !== 'available' || currentEvidence.scanStatus !== 'clean' || currentEvidence.revision !== evidenceResult.metadata.revision || currentEvidence.sha256 !== contentDigest || currentEvidence.scanDigest !== contentDigest) throw fail('evidence_unavailable');
      const nextDocument = await CollectorVerificationRecord.findById(record._id).session(session).orFail();
      if (nextDocument.revision !== input.expectedRevision || nextDocument.state !== 'draft') throw fail('conflict');
      nextDocument.revision++;
      await persistCollectorDocumentInTransaction(nextDocument, session);
      const next = nextDocument.toObject();
      const association = new CollectorVerificationRecordEvidence({
        recordId: record._id, pickupPersonId: record.pickupPersonId,
        pickupAuthorizationId: record.pickupAuthorizationId, pickupSubmissionId: record.pickupSubmissionId,
        submissionCycle: record.submissionCycle, personRevision: record.personRevision,
        requesterId: record.requesterId, parentStudentLinkId: record.parentStudentLinkId,
        branchId: record.branchId, studentId: record.studentId, enrollmentId: record.enrollmentId,
        evidenceId: currentEvidence.evidenceId, evidenceObjectId: currentEvidence._id, evidenceRevision: currentEvidence.revision,
        evidenceDigest: currentEvidence.sha256, contentType: currentEvidence.detectedContentType, byteLength: currentEvidence.byteLength,
        attachedBy: input.actor.userId, attachedAt: new Date(),
      });
      association.$session(session);
      await persistCollectorDocumentInTransaction(association, session);
      await writeEvent(next, input.actor.userId, 'evidence_attached', 'Evidence attached', session);
      await saveReceipt(input.actor.userId, input.actor.branchId, input.operationId, fingerprint, next, session);
      const finalActor = await actorContext(input.actor, session);
      const finalRecord = await requireCurrentRecord(input.actor, input.recordId, session);
      await authorize('attach_evidence', input.actor, finalActor.user, recordAuthority(finalRecord.record), input.recordId, session);
      return safeRecord(next, await CollectorVerificationRecordEvidence.find({ recordId: next._id }).session(session).lean());
    });
  }

  async function listForStudent(input: Readonly<{ actor: CollectorVerificationRecordActor; authorizationId: string }>) {
    const session = await mongoose.startSession();
    try {
      return await session.withTransaction(async () => {
        const { user } = await actorContext(input.actor, session);
        const bound = await proposalContext(input.actor, input.authorizationId, session);
        const authority = {
          studentId: String(bound.proposal.studentId), enrollmentId: String(bound.proposal.enrollmentId),
          pickupPersonId: String(bound.person._id), pickupAuthorizationId: String(bound.proposal._id),
          pickupSubmissionId: String(bound.submission._id), requesterId: String(bound.proposal.requesterId),
          parentStudentLinkId: String(bound.link._id), personRevision: bound.person.revision,
          identityFingerprint: bound.binding.identityFingerprint,
        };
        await authorize('read', input.actor, user, authority, null, session);
        const records = await CollectorVerificationRecord.find({
          branchId: input.actor.branchId, studentId: bound.proposal.studentId,
          enrollmentId: bound.proposal.enrollmentId, pickupAuthorizationId: bound.proposal._id,
        }).sort({ createdAt: -1, _id: -1 }).limit(100).session(session).lean();
        const current = [];
        for (const record of records) {
          if (bindingMismatch(record, bound)) continue;
          current.push(safeRecord(record, await CollectorVerificationRecordEvidence.find({ recordId: record._id }).session(session).lean()));
        }
        return current;
      }, { readPreference: 'primary', readConcern: { level: 'snapshot' } });
    } finally { await session.endSession(); }
  }

  return Object.freeze({ create, read, mutate, attachEvidence, listForStudent });
}

/** Supported production operations use fixed, fail-closed dependencies. */
export const collectorVerificationRecordService = buildCollectorVerificationRecordService({
  authorize: authorizeCollectorVerificationRecord,
  readEvidence: readCollectorVerificationEvidence,
});
