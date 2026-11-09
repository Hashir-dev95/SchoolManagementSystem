import type {
  EarlyExitDetail,
  EarlyExitFields,
  EarlyExitResult,
} from '../../src/services/parent/earlyExitService';
import type { EarlyExitReviewDetail } from '../../src/services/principal/earlyExitReviewService';
export {
  pickupChild as earlyExitChild,
  deferredPickup as deferredEarlyExit,
} from './pickup-fixture';
export const earlyExitFields: EarlyExitFields = {
  exitDate: '2026-11-12',
  reason: 'PRIVATE EARLY EXIT REASON',
};
export function earlyExitDetail(
  patch: Partial<EarlyExitDetail> = {},
): EarlyExitDetail {
  return {
    requestId: 'request-A',
    studentId: 'A',
    approvalId: null,
    state: 'draft',
    revision: 0,
    ...earlyExitFields,
    createdAt: '2026-11-09T10:00:00Z',
    updatedAt: '2026-11-09T10:00:00Z',
    eligibility: {
      operationallyEligible: false,
      physicalReleaseAllowed: false,
      schoolPolicyState: 'unconfigured',
      custodyState: 'unknown',
    },
    reviewRoutingState: 'configured',
    capabilities: {
      canEditDraft: true,
      canSubmit: true,
      canWithdraw: false,
      canResubmit: false,
    },
    reviewVersion: null,
    history: [{ action: 'created', revision: 0, at: '2026-11-09T10:00:00Z' }],
    submissions: [],
    ...patch,
  };
}
export function earlyExitReview(
  patch: Partial<EarlyExitReviewDetail> = {},
): EarlyExitReviewDetail {
  return {
    ...earlyExitDetail(),
    state: 'pending',
    revision: 1,
    approvalId: 'approval-A',
    student: {
      id: 'A',
      fullName: 'Child A',
      branchId: 'branch',
      className: 'Grade 8',
      sectionName: 'A',
    },
    requester: { id: 'parent-A', fullName: 'Parent A' },
    capabilities: {
      allowedActions: ['reject', 'request_changes'],
      canApprove: false,
    },
    decisionVersion: { applicationRevision: 1, approvalVersion: 0 },
    ...patch,
  };
}
export function earlyExitResult<
  T extends {
    requestId: string;
    approvalId: string | null;
    revision: number;
    state: EarlyExitDetail['state'];
  },
>(request: T): EarlyExitResult<T> {
  return {
    requestId: request.requestId,
    approvalId: request.approvalId,
    operationRevision: request.revision,
    operationState: request.state,
    operationCycle: 0,
    replayed: false,
    request,
  };
}
