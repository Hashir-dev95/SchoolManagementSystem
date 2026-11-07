import {
  Error as MongooseError,
  type ClientSession,
  type Types,
} from 'mongoose';
import ApprovalRequest, {
  PARENT_LEAVE_APPROVAL_ENTITY,
  type IApprovalRequest,
} from '../models/approvalRequest';
import {
  currentLeaveSnapshot,
  type ParentLeaveDocument,
} from '../models/parentLeaveApplication';

type Approval = IApprovalRequest & { _id: Types.ObjectId; __v?: number };

export async function matchesParentLeaveReview(
  row: ParentLeaveDocument,
  approval: Approval,
) {
  if (
    !row.submission ||
    approval.entityType !== PARENT_LEAVE_APPROVAL_ENTITY ||
    approval.approvalType !== 'leave' ||
    String(approval._id) !== String(row.approvalRequestId) ||
    String(approval.entityId) !== String(row._id) ||
    String(approval.requesterId) !== String(row.requesterId) ||
    String(approval.branchId) !== String(row.branchId) ||
    approval.status !== row.state ||
    approval.parentLeaveRevision !== row.submission.revision ||
    approval.amount != null ||
    approval.delegatedTo ||
    approval.delegatedBy ||
    approval.delegationExpiresAt
  )
    return false;
  try {
    await row.validate();
  } catch (error) {
    if (error instanceof MongooseError.ValidationError) return false;
    throw error;
  }
  const linkedEvents = row.history.filter(
    event =>
      event.action !== 'draft_created' && event.action !== 'draft_edited',
  );
  if (
    approval.history?.length !== linkedEvents.length ||
    linkedEvents.some((event, index) => {
      const mirror = approval.history[index];
      return (
        mirror.action !== event.action ||
        String(mirror.performedBy) !== String(event.actorId) ||
        !(mirror.createdAt instanceof Date) ||
        !Number.isFinite(mirror.createdAt.getTime()) ||
        // Legacy withdrawal used Mongoose's generated history timestamp.
        (event.action !== 'withdrawn' &&
          mirror.createdAt.getTime() !== event.at.getTime()) ||
        mirror.reason !== event.decisionReason
      );
    })
  )
    return false;
  const latest = linkedEvents.at(-1)!;
  if (row.state === 'withdrawn') {
    return (
      !approval.reviewedBy &&
      !approval.reviewedAt &&
      String(approval.withdrawnBy) === String(latest.actorId) &&
      approval.withdrawnAt?.getTime() === latest.at.getTime()
    );
  }
  if (approval.withdrawnBy || approval.withdrawnAt) return false;
  if (row.state === 'pending')
    return !approval.reviewedBy && !approval.reviewedAt;
  return (
    String(approval.reviewedBy) === String(latest.actorId) &&
    approval.reviewedAt?.getTime() === latest.at.getTime()
  );
}

export async function readLinkedParentLeaveApproval(
  row: ParentLeaveDocument,
  session: ClientSession,
) {
  const approval = await ApprovalRequest.findById(row.approvalRequestId)
    .session(session)
    .lean();
  return approval && (await matchesParentLeaveReview(row, approval))
    ? approval
    : null;
}

export function parentLeaveHistory(row: ParentLeaveDocument) {
  return row.history.map(({ action, revision, at, decisionReason }) => ({
    action,
    revision,
    at,
    ...(decisionReason ? { decisionReason } : {}),
  }));
}

// This DTO is exclusively for authorized typed detail. Each archived revision
// points to its immutable submission and reviewer events in both histories.
export function parentLeavePriorCycles(row: ParentLeaveDocument) {
  return (row.priorSubmissions ?? []).map(
    ({ revision, leaveType, startDate, endDate, reason }, index) => ({
      cycle: index + 1,
      revision,
      leaveType,
      startDate,
      endDate,
      reason,
      submittedAt: row.history[revision].at,
      changesRequestedAt: row.history[revision + 1].at,
      decisionReason: row.history[revision + 1].decisionReason,
    }),
  );
}

export function archiveCurrentLeave(row: ParentLeaveDocument) {
  const current = currentLeaveSnapshot(row);
  if (current)
    row.set('priorSubmissions', [...(row.priorSubmissions ?? []), current]);
}
