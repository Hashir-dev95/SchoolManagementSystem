import { ApiError } from '../api/apiClient';
import {
  pickupRequest,
  type PickupSummary,
  type PickupDetail,
  type PickupReviewVersion,
  type PickupPage,
  type PickupResult,
} from '../parent/pickupAuthorizationService';

export type PickupReviewSummary = Omit<PickupSummary, 'capabilities'> & {
  approvalId: string;
  student: {
    id: string;
    fullName: string;
    branchId: string;
    className: string;
    sectionName: string;
  };
  requester: { id: string; fullName: string };
  capabilities: {
    allowedActions: ('reject' | 'request_changes')[];
    canApprove: false;
  };
};
export type PickupReviewDetail = Omit<PickupDetail, 'capabilities'> &
  PickupReviewSummary & { decisionVersion: PickupReviewVersion | null };
export interface PickupDecision extends PickupReviewVersion {
  action: 'reject' | 'request_changes';
  decisionReason: string;
  clientOperationId: string;
}
const path = '/principal/pickup-authorizations';
export const pickupAuthorizationReviewService = {
  list: (token: string, offset = 0) =>
    pickupRequest<PickupPage<PickupReviewSummary>>(
      token,
      `${path}?offset=${offset}`,
    ),
  detail: async (token: string, approvalId: string) => {
    const data = await pickupRequest<PickupReviewDetail>(
      token,
      `${path}/${encodeURIComponent(approvalId)}`,
    );
    if (data.approvalId !== approvalId)
      throw new ApiError(404, 'Pickup review unavailable');
    return data;
  },
  decide: async (token: string, approvalId: string, body: PickupDecision) => {
    const data = await pickupRequest<PickupResult<PickupReviewDetail>>(
      token,
      `${path}/${encodeURIComponent(approvalId)}/decisions`,
      'POST',
      body,
    );
    if (data.authorization.approvalId !== approvalId)
      throw new ApiError(404, 'Pickup review unavailable');
    return data;
  },
};
export type PickupReviewTransport = typeof pickupAuthorizationReviewService;
