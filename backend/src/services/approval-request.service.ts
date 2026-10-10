import { Types, UpdateQuery } from 'mongoose';

import ApprovalRequest, {
  IApprovalRequest,
} from '../models/approvalRequest';
import User from '../models/user';

export type ApprovalAction =
  | 'approved'
  | 'rejected'
  | 'changes_requested'
  | 'delegated';

export interface ApprovalActionInput {
  requestId: string;
  actorId: string;
  branchId: string;
  action: ApprovalAction;
  reason?: string;
  delegatedTo?: string;
  delegationExpiresAt?: Date;
}

const validateObjectId = (value: string, fieldName: string): void => {
  if (!Types.ObjectId.isValid(value)) {
    throw new Error(`Invalid ${fieldName}`);
  }
};

export const getPendingApprovalRequests = async (
  branchId: string,
): Promise<IApprovalRequest[]> => {
  validateObjectId(branchId, 'branch ID');

  return ApprovalRequest.find({
    branchId: new Types.ObjectId(branchId),
    status: 'pending',
  })
    .populate('requesterId', 'fullName email role branchId')
    .populate('delegatedTo', 'fullName email role branchId')
    .sort({ createdAt: -1 });
};

export const processApprovalRequest = async (
  data: ApprovalActionInput,
): Promise<IApprovalRequest> => {
  validateObjectId(data.requestId, 'request ID');
  validateObjectId(data.actorId, 'actor ID');
  validateObjectId(data.branchId, 'branch ID');

  if (
    !['approved', 'rejected', 'changes_requested', 'delegated'].includes(
      data.action,
    )
  ) {
    throw new Error('Invalid approval action');
  }

  const request = await ApprovalRequest.findOne({
    _id: new Types.ObjectId(data.requestId),
    branchId: new Types.ObjectId(data.branchId),
  });

  if (!request) {
    throw new Error('Approval request not found');
  }

  if (request.status !== 'pending') {
    throw new Error('Only pending approval requests can be processed');
  }

  if (request.requesterId.toString() === data.actorId) {
    throw new Error('Requester cannot approve their own request');
  }

  const actor = await User.findById(data.actorId).select(
    '_id role branchId isActive',
  );

  if (!actor) {
    throw new Error('Approver not found');
  }

  if (!actor.isActive) {
    throw new Error('Approver account is inactive');
  }

  if (actor.role !== 'principal') {
    throw new Error('Approver is not authorized');
  }

  if (!actor.branchId || actor.branchId.toString() !== data.branchId) {
    throw new Error('Approver is outside branch scope');
  }

  if (data.action === 'rejected' || data.action === 'changes_requested') {
    const reason = data.reason?.trim();

    if (!reason) {
      throw new Error('Reason is required for rejection or change request');
    }
  }

  if (data.action === 'delegated') {
    if (!data.delegatedTo) {
      throw new Error('Delegate user is required');
    }

    validateObjectId(data.delegatedTo, 'delegate user ID');

    if (!data.delegationExpiresAt) {
      throw new Error('Delegation expiry is required');
    }

    if (data.delegationExpiresAt.getTime() <= Date.now()) {
      throw new Error('Delegation expiry must be in the future');
    }

    if (data.delegatedTo === request.requesterId.toString()) {
      throw new Error('Requester cannot be assigned as delegate');
    }

    if (data.delegatedTo === data.actorId) {
      throw new Error('Approver cannot delegate to themselves');
    }

    const delegate = await User.findById(data.delegatedTo).select(
      '_id branchId isActive role',
    );

    if (!delegate) {
      throw new Error('Delegate user not found');
    }

    if (!delegate.isActive) {
      throw new Error('Delegate account is inactive');
    }

    if (!delegate.branchId || delegate.branchId.toString() !== data.branchId) {
      throw new Error('Delegate is outside branch scope');
    }

    request.delegatedTo = delegate._id;
    request.delegationExpiresAt = data.delegationExpiresAt;
  }

  const now = new Date();
  const update: UpdateQuery<IApprovalRequest> = {
    $push: {
      history: {
        action: data.action,
        performedBy: actor._id,
        ...(data.reason?.trim() ? { reason: data.reason.trim() } : {}),
        createdAt: now,
      },
    },
  };

  if (
    data.action === 'approved' ||
    data.action === 'rejected' ||
    data.action === 'changes_requested'
  ) {
    update.$set = {
      status: data.action,
      reviewedBy: actor._id,
      reviewedAt: now,
    };
  } else {
    update.$set = {
      delegatedTo: request.delegatedTo,
      delegationExpiresAt: request.delegationExpiresAt,
    };
  }

  const updated = await ApprovalRequest.findOneAndUpdate(
    {
      _id: request._id,
      branchId: new Types.ObjectId(data.branchId),
      status: 'pending',
      ...(data.action === 'delegated'
        ? { $or: [{ delegatedTo: { $exists: false } }, { delegatedTo: null }] }
        : {}),
    },
    update,
    { new: true, runValidators: true },
  );

  if (!updated) {
    throw new Error('Only pending approval requests can be processed');
  }

  return updated;
};
export const getApprovalRequestById = async (
  requestId: string,
  branchId: string,
): Promise<IApprovalRequest> => {
  validateObjectId(requestId, 'request ID');
  validateObjectId(branchId, 'branch ID');

  const request = await ApprovalRequest.findOne({
    _id: new Types.ObjectId(requestId),
    branchId: new Types.ObjectId(branchId),
  })
    .populate('requesterId', 'fullName email role branchId')
    .populate('delegatedTo', 'fullName email role branchId')
    .populate('reviewedBy', 'fullName email role branchId')
    .populate('history.performedBy', 'fullName email role branchId');

  if (!request) {
    throw new Error('Approval request not found');
  }

  return request;
};
