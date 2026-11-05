import mongoose, { Types, type ClientSession } from 'mongoose';
import { PERMISSIONS } from '../constants/permissions';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import ApprovalRequest, {
  PARENT_LEAVE_APPROVAL_ENTITY,
  type IApprovalRequest,
} from '../models/approvalRequest';
import { ParentLeaveApplication } from '../models/parentLeaveApplication';
import Session from '../models/session';
import User from '../models/user';
import { RequestContractError } from '../utils/request-validation';
import {
  ApprovalAccessError,
  assertApprovalAuthority,
} from './approval-authority.policy';
import { verifyAccessToken } from './jwt.service';
import { parentLeaveFingerprint } from './parent-leave-application.policy';
import { readParentLeaveRouting } from './parent-leave-routing.policy';
import { resolveVerifiedParentChild } from './parent-scope.service';
import {
  currentAcademicActor,
  requireActiveAcademicBranch,
} from './teacher-scope.service';

type ReviewReader = { actorId: string; branchId: string; token: string };
type Routing = ReturnType<typeof readParentLeaveRouting>;

const unavailable = () =>
  new ApprovalAccessError(404, 'Parent leave review is unavailable');
const invalidSession = () =>
  new ApprovalAccessError(401, 'Session is unavailable');

function routingFor(reader: ReviewReader) {
  try {
    assertApprovalAuthority(reader.actorId, reader.branchId, {
      approvalType: 'leave',
    });
    return readParentLeaveRouting(reader.branchId);
  } catch (error) {
    if (
      error instanceof ApprovalAccessError ||
      error instanceof RequestContractError
    )
      return null;
    throw error;
  }
}

function principalIdentity(reader: ReviewReader) {
  let identity;
  try {
    identity = verifyAccessToken(reader.token);
  } catch {
    throw invalidSession();
  }
  if (identity.userId !== reader.actorId || identity.role !== 'principal')
    throw invalidSession();
  return identity;
}

async function assertReader(reader: ReviewReader, session?: ClientSession) {
  const identity = principalIdentity(reader);
  const login = await Session.findOne({ token: reader.token })
    .select('isRevoked userId role')
    .session(session ?? null)
    .read('primary')
    .lean();
  if (
    !login ||
    login.isRevoked ||
    String(login.userId) !== reader.actorId ||
    login.role !== 'principal'
  ) {
    throw invalidSession();
  }
  const actor = await currentAcademicActor(identity, session);
  if (
    String(actor.branchId) !== reader.branchId ||
    !ROLE_PERMISSIONS.principal.includes(PERMISSIONS.PRINCIPAL_APPROVALS_VIEW)
  ) {
    throw new ApprovalAccessError(
      403,
      'Principal approval visibility is unavailable',
    );
  }
  await requireActiveAcademicBranch(reader.branchId, session);
}

// G3a exposes only the live pending inbox. The same candidate selection and
// record proof govern queue, detail and count. Configuration must match exactly.
async function readPendingReviews(
  reader: ReviewReader,
  approvalId?: Types.ObjectId,
) {
  const session = await mongoose.startSession();
  try {
    const result = await session.withTransaction(
      async () => {
        await assertReader(reader, session);
        const routing = routingFor(reader);
        const visible = [];
        if (routing) {
          const approvals = await ApprovalRequest.find({
            branchId: reader.branchId,
            entityType: PARENT_LEAVE_APPROVAL_ENTITY,
            approvalType: 'leave',
            status: 'pending',
            requesterId: { $ne: reader.actorId },
            ...(approvalId ? { _id: approvalId } : {}),
          })
            .sort({ createdAt: -1, _id: -1 })
            .session(session)
            .lean();
          for (const approval of approvals) {
            const review = await visibleReview(
              reader.branchId,
              routing,
              approval,
              session,
              Boolean(approvalId),
            );
            if (review) visible.push(review);
          }
        }
        return { visible, routing };
      },
      { readPreference: 'primary', readConcern: { level: 'snapshot' } },
    );

    // Recheck the reader after the snapshot so a concurrent session or reviewer
    // revocation during a queue scan cannot release its result.
    await assertReader(reader);
    const current = routingFor(reader);
    return current &&
      result.routing &&
      current.version === result.routing.version
      ? result.visible
      : [];
  } finally {
    await session.endSession();
  }
}

async function visibleReview(
  branchId: string,
  routing: Routing,
  approval: IApprovalRequest & { _id: Types.ObjectId },
  session: ClientSession,
  includeDetail: boolean,
) {
  const submittedRevision = approval.parentLeaveRevision;
  if (
    !approval.entityId ||
    !submittedRevision ||
    !Number.isSafeInteger(submittedRevision) ||
    submittedRevision < 1 ||
    approval.amount != null ||
    approval.delegatedTo ||
    approval.delegatedBy ||
    approval.delegationExpiresAt ||
    approval.reviewedBy ||
    approval.reviewedAt ||
    approval.withdrawnBy ||
    approval.withdrawnAt
  )
    return null;

  const application = await ParentLeaveApplication.findOne({
    _id: approval.entityId,
    approvalRequestId: approval._id,
    requesterId: approval.requesterId,
    branchId,
    state: 'pending',
    revision: submittedRevision,
    'submission.revision': submittedRevision,
    'submission.policy': routing.policy,
    'submission.version': routing.version,
  })
    .select('+submission +reason')
    .session(session)
    .lean();
  if (
    !application?.reason ||
    !Types.ObjectId.isValid(application.studentId) ||
    application.submission?.fingerprint !==
      parentLeaveFingerprint(String(application.studentId), application)
  )
    return null;

  const submitted = application.history?.at(-1);
  if (
    submitted?.action !== 'submitted' ||
    submitted.revision !== submittedRevision ||
    String(submitted.actorId) !== String(application.requesterId) ||
    !(submitted.at instanceof Date) ||
    !Number.isFinite(submitted.at.getTime())
  )
    return null;
  const approvalEvent = approval.history?.[0];
  if (
    approval.history?.length !== 1 ||
    approvalEvent?.action !== 'submitted' ||
    String(approvalEvent.performedBy) !== String(application.requesterId) ||
    !(approvalEvent.createdAt instanceof Date) ||
    approvalEvent.createdAt.getTime() !== submitted.at.getTime()
  )
    return null;

  const actor = await User.findOne({
    _id: application.requesterId,
    role: 'parent',
    isActive: true,
  })
    .where('branchId')
    .equals(branchId)
    .select('_id role branchId isActive')
    .session(session)
    .lean();
  if (!actor) return null;
  try {
    const { link, scope } = await resolveVerifiedParentChild(
      { actor, branchId },
      String(application.studentId),
      session,
    );
    const { enrollment } = scope;
    if (
      String(link._id) !== String(application.parentStudentLinkId) ||
      String(enrollment._id) !== String(application.enrollmentId) ||
      String(enrollment.academicPeriodId) !==
        String(application.academicPeriodId) ||
      String(enrollment.classId) !== String(application.classId) ||
      String(enrollment.sectionId) !== String(application.sectionId)
    )
      return null;

    const summary = {
      approvalId: String(approval._id),
      source: PARENT_LEAVE_APPROVAL_ENTITY,
      studentName: scope.user.fullName,
      startDate: application.startDate,
      endDate: application.endDate,
      status: 'pending' as const,
      submittedAt: submitted.at.toISOString(),
    };
    const detail = includeDetail
      ? {
          ...summary,
          leaveType: application.leaveType,
          reason: application.reason,
          history: application.history
            .filter(event =>
              ['draft_created', 'draft_edited', 'submitted'].includes(
                event.action,
              ),
            )
            .map(({ action, revision, at }) => ({ action, revision, at })),
        }
      : undefined;
    return { summary, detail };
  } catch (error) {
    if (error instanceof RequestContractError && error.status === 403)
      return null;
    throw error;
  }
}

export async function listParentLeaveReviews(reader: ReviewReader) {
  return (await readPendingReviews(reader)).map(review => review.summary);
}

export async function getParentLeaveReview(
  reader: ReviewReader,
  approvalId: string,
) {
  if (!Types.ObjectId.isValid(approvalId)) throw unavailable();
  const [review] = await readPendingReviews(
    reader,
    new Types.ObjectId(approvalId),
  );
  if (!review?.detail) throw unavailable();
  return review.detail;
}
