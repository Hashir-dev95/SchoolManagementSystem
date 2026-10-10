import { apiClient } from '../api/apiClient';

export interface PrincipalRequester {
  _id: string;
  fullName: string;
  email: string;
  role: string;
  branchId?: string;
}

export type ApprovalAction = 'approved' | 'rejected' | 'changes_requested';

export interface ApprovalHistoryEntry {
  action: ApprovalAction | 'delegated';
  performedBy: string | PrincipalRequester;
  reason?: string;
  createdAt: string;
}

export interface ApprovalRequest {
  _id: string;
  requesterId: PrincipalRequester | string;
  entityType: string;
  entityId?: string;
  approvalType: string;
  amount?: number;
  reason: string;
  supportingFileUrl?: string;
  beforeData?: unknown;
  afterData?: unknown;
  status: 'pending' | 'approved' | 'rejected' | 'changes_requested';
  reviewedBy?: string | PrincipalRequester;
  reviewedAt?: string;
  history: ApprovalHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface SchoolNotice {
  _id: string;
  title: string;
  message: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'published';
  publishedAt?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
}

interface PendingApprovalData {
  requests: ApprovalRequest[];
  total: number;
}

export interface PrincipalDashboardData {
  branch: {
    id: string;
    name: string;
    code: string;
    city: string;
    isActive: boolean;
  };
  students: { total: number; active: number };
  attendance: {
    totalMarked: number;
    present: number;
    absent: number;
    late: number;
    leave: number;
    attendancePercentage: number;
  };
  feeSummary: {
    totalInvoices: number;
    totalAmount: number;
    paidAmount: number;
    outstandingAmount: number;
    pendingInvoices: number;
    partialInvoices: number;
    paidInvoices: number;
    overdueInvoices: number;
  };
  safetyAlerts: {
    total: number;
    open: number;
    inProgress: number;
    critical: number;
    high: number;
    byType: Record<string, number>;
  };
  notices: SchoolNotice[];
  pendingApprovals: {
    total: number;
    byType: Record<string, number>;
  };
}

export interface PrincipalApiResult<T> {
  data: T;
  message: string;
}

export const principalService = {
  getDashboard: async (token: string) => {
    const response = await apiClient.request<
      ApiEnvelope<PrincipalDashboardData>
    >('/principal/dashboard', { token });
    return { data: response.data, message: response.message };
  },

  getPendingApprovals: async (token: string) => {
    const response = await apiClient.request<ApiEnvelope<PendingApprovalData>>(
      '/approval-requests/pending',
      { token },
    );
    return { data: response.data, message: response.message };
  },

  getApprovalById: async (token: string, requestId: string) => {
    const response = await apiClient.request<ApiEnvelope<ApprovalRequest>>(
      `/approval-requests/${requestId}`,
      { token },
    );
    return { data: response.data, message: response.message };
  },

  processApproval: async (
    token: string,
    requestId: string,
    action: ApprovalAction,
    reason?: string,
  ) => {
    const response = await apiClient.request<
      ApiEnvelope<{ request: ApprovalRequest }>
    >(`/approval-requests/${requestId}`, {
      method: 'PATCH',
      token,
      body: { action, ...(reason ? { reason } : {}) },
    });
    return { data: response.data.request, message: response.message };
  },

  getNotices: async (token: string) => {
    const response = await apiClient.request<ApiEnvelope<SchoolNotice[]>>(
      '/principal/notices',
      { token },
    );
    return { data: response.data, message: response.message };
  },

  getNotice: async (token: string, noticeId: string) => {
    const response = await apiClient.request<ApiEnvelope<SchoolNotice>>(
      `/principal/notices/${noticeId}`,
      { token },
    );
    return { data: response.data, message: response.message };
  },
};
