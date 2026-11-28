import { Types, type ClientSession } from 'mongoose';
import Branch from '../models/branch';
import User from '../models/user';
import Student from '../models/student';
import { StudentEnrollment, activeEnrollmentFilter } from '../models/studentEnrollment';
import { ParentStudentLink } from '../models/parentStudentLink';
import { StudentCustodyRecord } from '../models/studentCustodyRecord';
import { CollectorVerificationRecord } from '../models/collectorVerificationRecord';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import { PERMISSIONS } from '../constants/permissions';
import { communicationFence } from './teacher-communication-access.service';
import type { CustodyRecordAuthorization } from './student-custody-record.service';
import type { CollectorVerificationRecordAuthorization } from './collector-verification-record.service';

type ReviewKind = 'studentCustody' | 'collectorVerification';
type ReviewAction = 'read' | 'request_changes' | 'complete_review' | 'revoke' | 'invalidate';
type ReviewConfiguration = Readonly<{
  principalUserId: string;
  branchId: string;
  studentCustody: readonly ReviewAction[];
  collectorVerification: readonly ReviewAction[];
}>;

const objectIdPattern = /^[a-f\d]{24}$/i;
const reviewActions = new Set<ReviewAction>(['read', 'request_changes', 'complete_review', 'revoke', 'invalidate']);
const requesterActions = new Set(['create', 'read', 'edit', 'submit', 'withdraw', 'attach_evidence']);
const validObjectId = (value: unknown): value is string => typeof value === 'string' && objectIdPattern.test(value) && new Types.ObjectId(value).toHexString() === value.toLowerCase();
const validRecordRequest = (request: { actorId: string; branchId: string; studentId: string; enrollmentId: string; recordId: string | null; session: ClientSession } | null | undefined) =>
  Boolean(request && request.session && typeof request.session.inTransaction === 'function' && request.session.inTransaction() &&
    [request.actorId, request.branchId, request.studentId, request.enrollmentId].every(validObjectId) &&
    (request.recordId === null || validObjectId(request.recordId)));

function parseReviewerPolicy(): readonly ReviewConfiguration[] {
  const raw = process.env.CUSTODY_RECORD_REVIEW_AUTHORITY_JSON;
  if (!raw || raw.length > 32_000) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > 500) return [];
    const result: ReviewConfiguration[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const row = item as Record<string, unknown>;
      const keys = Object.keys(row).sort().join(',');
      if (keys !== 'branchId,collectorVerification,principalUserId,studentCustody') return [];
      if (typeof row.principalUserId !== 'string' || !objectIdPattern.test(row.principalUserId) ||
        typeof row.branchId !== 'string' || !objectIdPattern.test(row.branchId) ||
        !Array.isArray(row.studentCustody) || !Array.isArray(row.collectorVerification)) return [];
      const actions = [row.studentCustody, row.collectorVerification];
      if (actions.some(list => list.some(action => typeof action !== 'string' || !reviewActions.has(action as ReviewAction)) || new Set(list).size !== list.length)) return [];
      result.push(Object.freeze({
        principalUserId: row.principalUserId.toLowerCase(), branchId: row.branchId.toLowerCase(),
        studentCustody: Object.freeze([...row.studentCustody] as ReviewAction[]),
        collectorVerification: Object.freeze([...row.collectorVerification] as ReviewAction[]),
      }));
    }
    if (new Set(result.map(row => `${row.principalUserId}:${row.branchId}`)).size !== result.length) return [];
    return result;
  } catch { return []; }
}

async function currentParentLink(input: {
  actorId: string; branchId: string; studentId: string; session: ClientSession; linkId?: string;
}) {
  for (const [collection, id] of [
    [Branch.collection.name, input.branchId], [Student.collection.name, input.studentId],
    [User.collection.name, input.actorId],
  ]) await communicationFence(input.session, collection, id);
  const linkQuery: Record<string, unknown> = {
    parentUserId: input.actorId, studentId: input.studentId, branchId: input.branchId,
    status: 'verified', isActive: true,
  };
  if (input.linkId) linkQuery._id = input.linkId;
  const link = await ParentStudentLink.findOne(linkQuery).session(input.session).read('primary').lean();
  if (link) await communicationFence(input.session, ParentStudentLink.collection.name, String(link._id));
  const [student, branch, parent] = await Promise.all([
    Student.findById(input.studentId).where('branchId').equals(input.branchId).where('isActive').equals(true).session(input.session).read('primary').lean(),
    Branch.findById(input.branchId).where('isActive').equals(true).session(input.session).read('primary').lean(),
    User.findById(input.actorId).where('role').equals('parent').where('branchId').equals(input.branchId).where('isActive').equals(true).session(input.session).read('primary').lean(),
  ]);
  if (!link || !student || !branch || !parent || !link.verifiedBy || !link.verifiedAt ||
    String(link.verifiedBy) === input.actorId || link.verifiedAt > new Date()) return null;
  return link;
}

async function currentEnrollment(input: {
  branchId: string; studentId: string; enrollmentId: string; session: ClientSession;
}) {
  await communicationFence(input.session, StudentEnrollment.collection.name, input.enrollmentId);
  return StudentEnrollment.findOne({
    _id: input.enrollmentId, studentId: input.studentId, branchId: input.branchId,
    ...activeEnrollmentFilter(), effectiveTo: null,
  }).session(input.session).read('primary').lean();
}

async function reviewerAllowed(input: {
  actorId: string; actorRole: string; branchId: string; action: string;
  kind: ReviewKind; requesterId: string; session: ClientSession;
}) {
  if (input.actorRole !== 'principal' || input.actorId === input.requesterId || !reviewActions.has(input.action as ReviewAction)) return false;
  const permission = ROLE_PERMISSIONS.principal.includes(PERMISSIONS.PRINCIPAL_CUSTODY_RECORDS_REVIEW);
  if (!permission) return false;
  const current = await User.findById(input.actorId).where('role').equals('principal').where('branchId').equals(input.branchId).where('isActive').equals(true)
    .session(input.session).read('primary').lean();
  if (!current) return false;
  const policies = parseReviewerPolicy();
  const policy = policies.find(row => row.principalUserId === input.actorId.toLowerCase() && row.branchId === input.branchId.toLowerCase());
  return Boolean(policy?.[input.kind].includes(input.action as ReviewAction));
}

export async function authorizeStudentCustodyRecord(request: CustodyRecordAuthorization): Promise<boolean> {
  if (!validRecordRequest(request)) return false;
  const enrollment = await currentEnrollment(request);
  if (!enrollment) return false;
  if (request.actorRole === 'parent' && requesterActions.has(request.action)) {
    const link = await currentParentLink(request);
    if (!link) return false;
    if (request.recordId === null) return request.action === 'create' || request.action === 'read';
    await communicationFence(request.session, StudentCustodyRecord.collection.name, request.recordId);
    const record = await StudentCustodyRecord.findOne({
      _id: request.recordId, branchId: request.branchId, studentId: request.studentId,
      enrollmentId: request.enrollmentId, createdBy: request.actorId,
    }).session(request.session).read('primary').lean();
    return Boolean(record);
  }
  if (request.actorRole !== 'principal') return false;
  if (!request.recordId) return reviewerAllowed({
    actorId: request.actorId, actorRole: request.actorRole, branchId: request.branchId,
    action: request.action, kind: 'studentCustody', requesterId: '', session: request.session,
  });
  await communicationFence(request.session, StudentCustodyRecord.collection.name, request.recordId);
  const record = await StudentCustodyRecord.findOne({
    _id: request.recordId, branchId: request.branchId, studentId: request.studentId,
    enrollmentId: request.enrollmentId,
  }).session(request.session).read('primary').lean();
  if (!record) return false;
  const currentLink = await currentParentLink({
    actorId: String(record.createdBy), branchId: request.branchId,
    studentId: request.studentId, session: request.session,
  });
  return Boolean(currentLink && await reviewerAllowed({
    actorId: request.actorId, actorRole: request.actorRole, branchId: request.branchId,
    action: request.action, kind: 'studentCustody', requesterId: String(record.createdBy), session: request.session,
  }));
}

export async function authorizeCollectorVerificationRecord(request: CollectorVerificationRecordAuthorization): Promise<boolean> {
  if (!validRecordRequest(request) ||
    ![request.pickupPersonId, request.pickupAuthorizationId, request.pickupSubmissionId, request.requesterId, request.parentStudentLinkId].every(validObjectId) ||
    !Number.isSafeInteger(request.personRevision) || request.personRevision < 0 || !/^[a-f0-9]{64}$/.test(request.identityFingerprint)) return false;
  const enrollment = await currentEnrollment(request);
  if (!enrollment) return false;
  if (request.actorRole === 'parent' && requesterActions.has(request.action)) {
    if (request.actorId !== request.requesterId) return false;
    const link = await currentParentLink({
      actorId: request.actorId, branchId: request.branchId, studentId: request.studentId,
      linkId: request.parentStudentLinkId, session: request.session,
    });
    return Boolean(link);
  }
  if (request.actorRole !== 'principal') return false;
  if (request.recordId) {
    await communicationFence(request.session, CollectorVerificationRecord.collection.name, request.recordId);
    const record = await CollectorVerificationRecord.findOne({
      _id: request.recordId, branchId: request.branchId, studentId: request.studentId,
      enrollmentId: request.enrollmentId, pickupPersonId: request.pickupPersonId,
      pickupAuthorizationId: request.pickupAuthorizationId, pickupSubmissionId: request.pickupSubmissionId,
      requesterId: request.requesterId, parentStudentLinkId: request.parentStudentLinkId,
      personRevision: request.personRevision, identityFingerprint: request.identityFingerprint,
    }).session(request.session).read('primary').lean();
    if (!record) return false;
  }
  const link = await currentParentLink({
    actorId: request.requesterId, branchId: request.branchId, studentId: request.studentId,
    linkId: request.parentStudentLinkId, session: request.session,
  });
  return Boolean(link && await reviewerAllowed({
    actorId: request.actorId, actorRole: request.actorRole, branchId: request.branchId,
    action: request.action, kind: 'collectorVerification', requesterId: request.requesterId, session: request.session,
  }));
}
