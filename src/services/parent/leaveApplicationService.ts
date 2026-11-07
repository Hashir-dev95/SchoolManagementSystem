import { apiClient } from '../api/apiClient';

export interface LeaveFields {
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string;
}
export interface LeaveSummary extends Omit<LeaveFields, 'reason'> {
  applicationId: string;
  studentId: string;
  state:
    | 'draft'
    | 'pending'
    | 'withdrawn'
    | 'approved'
    | 'rejected'
    | 'changes_requested';
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface LeaveDraft extends LeaveSummary {
  reason: string;
  priorCycles?: LeaveReviewCycle[];
  resubmitVersion?: LeaveReviewVersion;
  history: {
    action:
      | 'draft_created'
      | 'draft_edited'
      | 'submitted'
      | 'withdrawn'
      | 'approved'
      | 'rejected'
      | 'resubmitted'
      | 'changes_requested';
    revision: number;
    at: string;
    decisionReason?: string;
  }[];
}
export interface LeaveReviewVersion {
  applicationRevision: number;
  approvalVersion: number;
}
export interface LeaveReviewCycle extends LeaveFields {
  cycle: number;
  revision: number;
  submittedAt: string;
  changesRequestedAt: string;
  decisionReason: string;
}
export interface LeavePage {
  items: LeaveSummary[];
  total: number;
  offset: number;
  limit: number;
}
export interface LeaveSave {
  applicationId: string;
  replayed: boolean;
  operationRevision?: number;
  application: LeaveDraft;
}
export interface LeaveLifecycleResult extends LeaveSave {
  operationState: 'pending' | 'withdrawn';
  operationRevision: number;
}
export const leaveOperationId = () => {
  const runtime = globalThis as typeof globalThis & {
    RN$Bridgeless?: boolean;
    nativeCallSyncHook?: unknown;
    crypto?: { getRandomValues: (bytes: Uint8Array) => Uint8Array };
  };
  if (
    (__DEV__ &&
      runtime.RN$Bridgeless !== true &&
      typeof runtime.nativeCallSyncHook === 'undefined') ||
    typeof runtime.crypto?.getRandomValues !== 'function'
  )
    throw new Error('Secure leave operation IDs require the native runtime.');
  const bytes = new Uint8Array(16);
  runtime.crypto.getRandomValues(bytes);
  return (
    'leave_' +
    Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
  );
};
const path = (child: string) =>
  `/parent/me/children/${encodeURIComponent(child)}/leave-applications`;
const request = async <T>(
  token: string,
  endpoint: string,
  options: { method?: 'POST' | 'PATCH'; body?: unknown } = {},
) =>
  (
    await apiClient.request<{ success: boolean; data: T }>(endpoint, {
      ...options,
      token,
    })
  ).data;
export const leaveApplicationService = {
  list: (token: string, child: string, offset = 0) =>
    request<LeavePage>(token, `${path(child)}?offset=${offset}&limit=25`),
  detail: (token: string, child: string, id: string) =>
    request<LeaveDraft>(token, `${path(child)}/${encodeURIComponent(id)}`),
  create: (
    token: string,
    child: string,
    fields: LeaveFields,
    clientOperationId: string,
  ) =>
    request<LeaveSave>(token, path(child), {
      method: 'POST',
      body: { ...fields, clientOperationId },
    }),
  edit: (
    token: string,
    child: string,
    id: string,
    fields: LeaveFields,
    revision: number,
    clientOperationId: string,
  ) =>
    request<LeaveSave>(token, `${path(child)}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { ...fields, revision, clientOperationId },
    }),
  submit: (
    token: string,
    child: string,
    id: string,
    revision: number,
    clientOperationId: string,
  ) =>
    request<LeaveLifecycleResult>(
      token,
      `${path(child)}/${encodeURIComponent(id)}/submit`,
      {
        method: 'POST',
        body: { revision, clientOperationId },
      },
    ),
  withdraw: (
    token: string,
    child: string,
    id: string,
    revision: number,
    clientOperationId: string,
  ) =>
    request<LeaveLifecycleResult>(
      token,
      `${path(child)}/${encodeURIComponent(id)}/withdraw`,
      {
        method: 'POST',
        body: { revision, clientOperationId },
      },
    ),
  resubmit: (
    token: string,
    child: string,
    id: string,
    fields: LeaveFields,
    version: LeaveReviewVersion,
    clientOperationId: string,
  ) =>
    request<LeaveLifecycleResult & { operationCycle: number }>(
      token,
      `${path(child)}/${encodeURIComponent(id)}/resubmit`,
      {
        method: 'POST',
        body: { ...fields, ...version, clientOperationId },
      },
    ),
};
export type LeaveTransport = typeof leaveApplicationService;

/** Field feedback only. Canonical validation and authority remain server-side. */
export function leaveFieldErrors(fields: LeaveFields) {
  const errors: Partial<Record<keyof LeaveFields, string>> = {};
  if (!fields.leaveType.trim() || fields.leaveType.trim().length > 80)
    errors.leaveType = 'Enter a leave type (up to 80 characters).';
  if (!fields.reason.trim() || fields.reason.trim().length > 500)
    errors.reason = 'Enter a private reason (up to 500 characters).';
  for (const key of ['startDate', 'endDate'] as const) {
    const value = fields[key];
    const parsed = new Date(value + 'T00:00:00Z');
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number(value.slice(0, 4)) < 1 ||
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value
    )
      errors[key] = 'Enter a valid date as YYYY-MM-DD.';
  }
  if (!errors.startDate && !errors.endDate && fields.endDate < fields.startDate)
    errors.endDate = 'End date must be on or after start date.';
  return errors;
}
