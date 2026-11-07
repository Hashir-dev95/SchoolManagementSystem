import { ApiError, apiClient } from '../api/apiClient';
import type { LeaveReviewCycle } from '../parent/leaveApplicationService';

export interface ParentLeaveReviewSummary {
  approvalId: string;
  source: 'parent_leave_application';
  studentName: string;
  startDate: string;
  endDate: string;
  status: 'pending';
  submittedAt: string;
}

export interface ParentLeaveDecisionVersion {
  applicationRevision: number;
  approvalVersion: number;
}

export interface ParentLeaveDecision extends ParentLeaveDecisionVersion {
  action: 'approve' | 'reject' | 'request_changes';
  clientOperationId: string;
  decisionReason?: string;
}

export interface ParentLeaveReviewDetail
  extends Omit<ParentLeaveReviewSummary, 'status'> {
  status: 'pending' | 'approved' | 'rejected' | 'changes_requested';
  priorCycles?: LeaveReviewCycle[];
  decisionVersion?: ParentLeaveDecisionVersion | null;
  leaveType: string;
  reason: string;
  history: {
    action:
      | 'draft_created'
      | 'draft_edited'
      | 'submitted'
      | 'resubmitted'
      | 'changes_requested'
      | 'approved'
      | 'rejected';
    revision: number;
    at: string;
    decisionReason?: string;
  }[];
}

const path = '/principal/parent-leave-reviews';

export const parentLeaveReviewService = {
  list: async (token: string) => {
    const { data } = await apiClient.request<{
      data: { requests: ParentLeaveReviewSummary[] };
    }>(path, { token });
    return data.requests;
  },
  detail: async (token: string, approvalId: string) => {
    const { data } = await apiClient.request<{ data: ParentLeaveReviewDetail }>(
      `${path}/${encodeURIComponent(approvalId)}`,
      { token },
    );
    if (
      data.approvalId !== approvalId ||
      data.source !== 'parent_leave_application'
    ) {
      throw new ApiError(404, 'Parent leave review is unavailable');
    }
    return data;
  },
  decide: async (
    token: string,
    approvalId: string,
    body: ParentLeaveDecision,
  ) => {
    const { data } = await apiClient.request<{
      data: {
        approvalId: string;
        state: 'approved' | 'rejected' | 'changes_requested';
        revision: number;
        decidedAt: string;
        replayed: boolean;
      };
    }>(`${path}/${encodeURIComponent(approvalId)}/decisions`, {
      method: 'POST',
      token,
      body,
    });
    if (
      data.approvalId !== approvalId ||
      data.state !==
        (body.action === 'approve'
          ? 'approved'
          : body.action === 'reject'
          ? 'rejected'
          : 'changes_requested')
    ) {
      throw new ApiError(404, 'Parent leave review is unavailable');
    }
    return data;
  },
};
