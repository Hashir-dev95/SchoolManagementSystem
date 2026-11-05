import { ApiError, apiClient } from '../api/apiClient';

export interface ParentLeaveReviewSummary {
  approvalId: string;
  source: 'parent_leave_application';
  studentName: string;
  startDate: string;
  endDate: string;
  status: 'pending';
  submittedAt: string;
}

export interface ParentLeaveReviewDetail extends ParentLeaveReviewSummary {
  leaveType: string;
  reason: string;
  history: {
    action: 'draft_created' | 'draft_edited' | 'submitted';
    revision: number;
    at: string;
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
};
