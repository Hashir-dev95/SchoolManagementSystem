import { ApiError } from '../api/apiClient';
import {
  earlyExitKeys,
  earlyExitNonce,
  earlyExitOffset,
  earlyExitRequest,
  earlyExitRevision,
  earlyExitStates,
  type EarlyExitSummary,
  type EarlyExitDetail,
  type EarlyExitReviewVersion,
  type EarlyExitPage,
  type EarlyExitResult,
} from '../parent/earlyExitService';

export type EarlyExitReviewSummary = Omit<
  EarlyExitSummary,
  'capabilities' | 'approvalId'
> & {
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
export type EarlyExitReviewDetail = Omit<
  EarlyExitDetail,
  'capabilities' | 'approvalId'
> &
  EarlyExitReviewSummary & { decisionVersion: EarlyExitReviewVersion | null };
export interface EarlyExitDecision extends EarlyExitReviewVersion {
  action: 'reject' | 'request_changes';
  decisionReason: string;
  clientOperationId: string;
}
const path = '/principal/early-exit-requests';
function scoped<T extends EarlyExitReviewSummary>(
  data: T,
  branch: string,
  id?: string,
) {
  if (
    data.student.branchId !== branch ||
    data.student.id !== data.studentId ||
    !data.approvalId ||
    !earlyExitStates.includes(data.state) ||
    (id && data.approvalId !== id)
  )
    throw new ApiError(404, 'Early Exit review unavailable');
  return data;
}
export const earlyExitReviewService = {
  list: async (token: string, branch: string, offset = 0) => {
    const data = await earlyExitRequest<EarlyExitPage<EarlyExitReviewSummary>>(
      token,
      `${path}?offset=${earlyExitOffset(offset)}`,
    );
    data.items.forEach(item => scoped(item, branch));
    if (data.nextOffset !== null) earlyExitOffset(data.nextOffset);
    return data;
  },
  detail: async (token: string, branch: string, id: string) =>
    scoped(
      await earlyExitRequest<EarlyExitReviewDetail>(
        token,
        `${path}/${encodeURIComponent(id)}`,
      ),
      branch,
      id,
    ),
  decide: async (
    token: string,
    branch: string,
    id: string,
    body: EarlyExitDecision,
  ) => {
    earlyExitKeys(body, [
      'action',
      'decisionReason',
      'clientOperationId',
      'applicationRevision',
      'approvalVersion',
    ]);
    const reason = typeof body.decisionReason === 'string' ? body.decisionReason.normalize('NFC').trim() : '';
    if (
      !['reject', 'request_changes'].includes(body.action) ||
      reason.length < 10 ||
      reason.length > 500
    )
      throw new ApiError(400, 'Invalid decision');
    const payload: EarlyExitDecision = {
      action: body.action,
      decisionReason: reason,
      clientOperationId: earlyExitNonce(body.clientOperationId),
      applicationRevision: earlyExitRevision(body.applicationRevision),
      approvalVersion: earlyExitRevision(body.approvalVersion),
    };
    const data = await earlyExitRequest<EarlyExitResult<EarlyExitReviewDetail>>(
      token,
      `${path}/${encodeURIComponent(id)}/decisions`,
      'POST',
      payload,
    );
    scoped(data.request, branch, id);
    if (data.requestId !== data.request.requestId)
      throw new ApiError(404, 'Early Exit review unavailable');
    return data;
  },
};
export type EarlyExitReviewTransport = typeof earlyExitReviewService;
