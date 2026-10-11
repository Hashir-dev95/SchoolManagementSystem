import {UpdateQuery} from 'mongoose';
import ApprovalRequest, {IApprovalRequest} from '../models/approvalRequest';
import User from '../models/user';
import {ApprovalAccessError, assertApprovalAuthority} from './approval-authority.policy';
import {assertApprovalReferences, serializeApproval, validateApprovalId} from './approval-scope.service';

export type ApprovalAction = 'approved' | 'rejected' | 'changes_requested' | 'delegated';
export interface ApprovalActionInput {
  requestId: string;
  actorId: string;
  branchId: string;
  action: ApprovalAction;
  reason?: string;
  delegatedTo?: string;
  delegationExpiresAt?: Date;
}

const authorizedActor = async (actorId: string, branchId: string) => {
  validateApprovalId(actorId, 'actor ID');
  validateApprovalId(branchId, 'branch ID');
  const actor = await User.findById(actorId).where('branchId').equals(branchId)
    .where('role').equals('principal').where('isActive').equals(true);
  if (!actor) throw new ApprovalAccessError(403, 'Approval reviewer is not authorized');
  return actor;
};

export const getPendingApprovalRequests = async (branchId: string, actorId: string) => {
  await authorizedActor(actorId, branchId);
  const requests = await ApprovalRequest.find({branchId, status: 'pending'}).sort({createdAt: -1});
  const visible = [];
  for (const request of requests) {
    try {
      assertApprovalAuthority(actorId, branchId, request);
      await assertApprovalReferences(request);
      visible.push(await serializeApproval(request));
    } catch (error) {
      if (!(error instanceof ApprovalAccessError)) throw error;
      // Invalid/out-of-scope/unconfigured entries disclose no request content.
    }
  }
  return visible;
};

export const getApprovalRequestById = async (requestId: string, branchId: string, actorId: string) => {
  validateApprovalId(requestId, 'request ID');
  await authorizedActor(actorId, branchId);
  const request = await ApprovalRequest.findOne({_id: requestId, branchId});
  if (!request) throw new ApprovalAccessError(404, 'Approval request not found');
  assertApprovalAuthority(actorId, branchId, request);
  await assertApprovalReferences(request);
  return serializeApproval(request);
};

export const processApprovalRequest = async (data: ApprovalActionInput) => {
  validateApprovalId(data.requestId, 'request ID');
  const actor = await authorizedActor(data.actorId, data.branchId);
  if (!['approved', 'rejected', 'changes_requested', 'delegated'].includes(data.action)) {
    throw new ApprovalAccessError(400, 'Invalid approval action');
  }
  if (data.reason !== undefined && (typeof data.reason !== 'string' || data.reason.trim().length > 500)) {
    throw new ApprovalAccessError(400, 'Invalid decision reason');
  }
  if (['rejected', 'changes_requested'].includes(data.action) && !data.reason?.trim()) {
    throw new ApprovalAccessError(400, 'Reason is required for rejection or change request');
  }
  const request = await ApprovalRequest.findOne({_id: data.requestId, branchId: data.branchId});
  if (!request) throw new ApprovalAccessError(404, 'Approval request not found');
  if (request.status !== 'pending') throw new ApprovalAccessError(409, 'Only pending approval requests can be processed');
  if (request.requesterId.equals(actor._id)) {
    throw new ApprovalAccessError(403, 'Requester cannot review their own request');
  }
  assertApprovalAuthority(data.actorId, data.branchId, request);
  await assertApprovalReferences(request);
  const now = new Date();
  const isDelegate = request.delegatedTo?.equals(actor._id) ?? false;
  if (isDelegate) {
    if (!request.delegatedBy || !request.delegationExpiresAt || request.delegationExpiresAt.getTime() <= now.getTime()) {
      throw new ApprovalAccessError(403, 'Delegation is unavailable or expired');
    }
    if (data.action === 'delegated') throw new ApprovalAccessError(403, 'Delegated reviewers cannot redelegate');
    const delegator = await authorizedActor(request.delegatedBy.toString(), data.branchId);
    if (delegator._id.equals(request.requesterId)) throw new ApprovalAccessError(403, 'Requester cannot delegate their own request');
    assertApprovalAuthority(delegator._id.toString(), data.branchId, request);
  }
  const update: UpdateQuery<IApprovalRequest> = {
    $push: {history: {
      action: data.action, performedBy: actor._id, createdAt: now,
      authority: isDelegate ? 'delegated' : 'direct',
      ...(isDelegate ? {delegatedBy: request.delegatedBy} : {}),
      ...(data.reason?.trim() ? {reason: data.reason.trim()} : {}),
    }},
    $inc: {__v: 1},
  };
  if (data.action === 'delegated') {
    if (!data.delegatedTo) throw new ApprovalAccessError(400, 'Delegate user is required');
    validateApprovalId(data.delegatedTo, 'delegate user ID');
    if (!(data.delegationExpiresAt instanceof Date) || !Number.isFinite(data.delegationExpiresAt.getTime()) || data.delegationExpiresAt.getTime() <= now.getTime()) {
      throw new ApprovalAccessError(400, 'Delegation expiry must be in the future');
    }
    if (actor._id.equals(data.delegatedTo) || request.requesterId.equals(data.delegatedTo)) {
      throw new ApprovalAccessError(403, 'Delegate cannot be the requester or delegator');
    }
    const delegate = await authorizedActor(data.delegatedTo, data.branchId);
    assertApprovalAuthority(delegate._id.toString(), data.branchId, request);
    if (request.delegatedTo) throw new ApprovalAccessError(409, 'Request already has a delegation');
    update.$set = {delegatedTo: delegate._id, delegatedBy: actor._id, delegationExpiresAt: data.delegationExpiresAt};
  } else {
    update.$set = {status: data.action, reviewedBy: actor._id, reviewedAt: now};
  }
  // Compare the authorized snapshot, not just status. An intervening delegation
  // or amount/entity change must not turn an earlier authority check into a write.
  const updated = await ApprovalRequest.findOneAndUpdate({
    _id: request._id, branchId: request.branchId, status: 'pending',
    __v: request.__v ?? {$exists: false}, updatedAt: request.updatedAt,
    approvalType: request.approvalType, amount: request.amount ?? null,
    requesterId: request.requesterId, entityType: request.entityType, entityId: request.entityId,
    delegatedTo: request.delegatedTo ?? null, delegatedBy: request.delegatedBy ?? null,
    delegationExpiresAt: request.delegationExpiresAt ?? null,
    // Evaluate expiry against the database clock at the atomic write, including
    // time spent in network queues after application authorization completed.
    ...(isDelegate ? {$expr: {$gt: ['$delegationExpiresAt', '$$NOW']}} : {}),
    ...(data.action === 'delegated' ? {$expr: {$gt: [{$literal: data.delegationExpiresAt}, '$$NOW']}} : {}),
  }, update, {returnDocument: 'after', runValidators: true});
  if (!updated) throw new ApprovalAccessError(409, 'Approval request changed or was already processed');
  return serializeApproval(updated);
};
