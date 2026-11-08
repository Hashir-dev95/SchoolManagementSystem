import { ApiError, apiClient } from '../api/apiClient';

export type PickupState =
  | 'draft'
  | 'pending'
  | 'changes_requested'
  | 'rejected'
  | 'withdrawn'
  | 'approved';
export interface PickupFields {
  fullName: string;
  relationship: string;
  phone: string;
  validFromDate: string;
  validUntilDate: string;
  notes: string;
}
export interface PickupVersion {
  applicationRevision: number;
  personRevision: number;
}
export interface PickupReviewVersion extends PickupVersion {
  approvalVersion: number;
}
export interface PickupSummary {
  authorizationId: string;
  pickupPersonId: string;
  studentId: string;
  state: PickupState;
  revision: number;
  personRevision: number;
  person: { fullName: string; relationship: string };
  validFromDate: string;
  validUntilDate: string;
  eligibility: {
    operationallyEligible: false;
    identityVerification: 'unverified';
    custodyState: 'unknown' | 'hold';
    policyState: 'unconfigured';
    policyRevision: number | null;
    blockedReasons: string[];
  };
  capabilities: {
    canEditDraft: boolean;
    canSubmit: boolean;
    canWithdraw: boolean;
    canResubmit: boolean;
  };
  policyBindingCurrent: boolean;
  reviewRoutingState: 'configured' | 'revision_mismatch' | 'unconfigured';
}
export interface PickupDetail extends PickupSummary {
  person: PickupSummary['person'] & { phone: string };
  notes: string;
  approvalId: string | null;
  reviewVersion: PickupReviewVersion | null;
  history: {
    action:
      | 'created'
      | 'edited'
      | 'submitted'
      | 'resubmitted'
      | 'withdrawn'
      | 'rejected'
      | 'changes_requested';
    revision: number;
    at: string;
    reason?: string;
  }[];
  submissions: (PickupFields & {
    cycle: number;
    applicationRevision: number;
    submittedAt: string;
  })[];
}
export interface PickupPage<T = PickupSummary> {
  items: T[];
  nextOffset: number | null;
}
export interface PickupResult<T = PickupDetail> {
  authorizationId: string;
  pickupPersonId: string;
  approvalId: string | null;
  operationRevision: number;
  operationPersonRevision: number;
  operationState: PickupState;
  operationCycle: number;
  replayed: boolean;
  authorization: T;
}
export type PickupWrite =
  | { kind: 'create'; body: PickupFields & { clientOperationId: string } }
  | {
      kind: 'edit';
      id: string;
      body: PickupFields & PickupVersion & { clientOperationId: string };
    }
  | {
      kind: 'submit';
      id: string;
      body: PickupVersion & { clientOperationId: string };
    }
  | {
      kind: 'withdraw';
      id: string;
      body: PickupReviewVersion & { clientOperationId: string };
    }
  | {
      kind: 'resubmit';
      id: string;
      body: PickupFields & PickupReviewVersion & { clientOperationId: string };
    };

const path = (child: string) =>
  `/parent/me/children/${encodeURIComponent(child)}/pickup-authorizations`;
export async function pickupRequest<T>(
  token: string,
  endpoint: string,
  method?: 'POST' | 'PATCH',
  body?: unknown,
) {
  return (
    await apiClient.request<{ success: boolean; data: T }>(endpoint, {
      token,
      method,
      body,
    })
  ).data;
}
export const pickupAuthorizationService = {
  list: (token: string, child: string, offset = 0, state?: PickupState) =>
    pickupRequest<PickupPage>(
      token,
      `${path(child)}?offset=${offset}${state ? `&state=${state}` : ''}`,
    ),
  detail: async (token: string, child: string, id: string) => {
    const data = await pickupRequest<PickupDetail>(
      token,
      `${path(child)}/${encodeURIComponent(id)}`,
    );
    if (data.studentId !== child || data.authorizationId !== id)
      throw new ApiError(404, 'Pickup proposal unavailable');
    return data;
  },
  write: async (token: string, child: string, operation: PickupWrite) => {
    const suffix =
      operation.kind === 'create'
        ? ''
        : `/${encodeURIComponent(operation.id)}${
            operation.kind === 'edit' ? '' : `/${operation.kind}`
          }`;
    const data = await pickupRequest<PickupResult>(
      token,
      path(child) + suffix,
      operation.kind === 'edit' ? 'PATCH' : 'POST',
      operation.body,
    );
    if (
      data.authorization.studentId !== child ||
      (operation.kind !== 'create' &&
        data.authorization.authorizationId !== operation.id)
    )
      throw new ApiError(404, 'Pickup proposal unavailable');
    return data;
  },
};
export type PickupTransport = typeof pickupAuthorizationService;

/** Native secure randomness is installed by index.js. No Math.random fallback. */
export function pickupOperationId() {
  const runtime = globalThis as typeof globalThis & {
    crypto?: { getRandomValues(bytes: Uint8Array): Uint8Array };
    RN$Bridgeless?: boolean;
    nativeCallSyncHook?: unknown;
  };
  if (
    (__DEV__ &&
      runtime.RN$Bridgeless !== true &&
      typeof runtime.nativeCallSyncHook === 'undefined') ||
    typeof runtime.crypto?.getRandomValues !== 'function'
  )
    throw new Error('Secure operation IDs require the native runtime.');
  const bytes = runtime.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] % 16) + 64;
  bytes[8] = (bytes[8] % 64) + 128;
  const hex = Array.from(bytes, v => v.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export const emptyPickupFields: PickupFields = {
  fullName: '',
  relationship: '',
  phone: '',
  validFromDate: '',
  validUntilDate: '',
  notes: '',
};
export function pickupFieldErrors(fields: PickupFields) {
  const errors: Partial<Record<keyof PickupFields, string>> = {};
  for (const [key, min, max] of [
    ['fullName', 2, 100],
    ['relationship', 2, 80],
    ['phone', 7, 30],
    ['notes', 0, 500],
  ] as const) {
    const value = fields[key].normalize('NFC').trim();
    if (value.length < min || value.length > max)
      errors[key] = `Use ${min}–${max} characters.`;
  }
  if (!/^\+?[0-9 ()-]+$/.test(fields.phone.trim()))
    errors.phone = 'Enter a valid contact phone.';
  for (const key of ['validFromDate', 'validUntilDate'] as const) {
    const value = fields[key],
      date = new Date(value + 'T00:00:00Z');
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number(value.slice(0, 4)) < 1 ||
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    )
      errors[key] = 'Enter a valid date as YYYY-MM-DD.';
  }
  if (
    !errors.validFromDate &&
    !errors.validUntilDate &&
    fields.validUntilDate < fields.validFromDate
  )
    errors.validUntilDate = 'End date must be on or after start date.';
  return errors;
}
