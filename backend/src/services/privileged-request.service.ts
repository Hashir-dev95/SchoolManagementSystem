import {Types} from 'mongoose';

import PrivilegedRequest, {
  IPrivilegedRequest,
  PrivilegedRequestStatus,
} from '../models/privilegedRequest';

export const getPendingPrivilegedRequests =
  async (): Promise<IPrivilegedRequest[]> => {
    return PrivilegedRequest.find({status: 'pending'})
      .populate('requesterId', 'fullName email role')
      .populate('branchId', 'name code')
      .sort({createdAt: -1});
  };

export const reviewPrivilegedRequest = async (
  requestId: string,
  status: Extract<PrivilegedRequestStatus, 'approved' | 'rejected'>,
  reviewedBy: string,
): Promise<IPrivilegedRequest> => {
  if (!Types.ObjectId.isValid(requestId)) {
    throw new Error('Invalid request ID');
  }

  if (!['approved', 'rejected'].includes(status)) {
    throw new Error('Invalid status');
  }

  if (!Types.ObjectId.isValid(reviewedBy)) {
    throw new Error('Invalid reviewer ID');
  }

  const request = await PrivilegedRequest.findById(requestId);

  if (!request) {
    throw new Error('Privileged request not found');
  }

  if (request.status !== 'pending') {
    throw new Error('Only pending requests can be reviewed');
  }

  request.status = status;
  request.reviewedBy = new Types.ObjectId(reviewedBy);
  request.reviewedAt = new Date();

  await request.save();

  return request;
};