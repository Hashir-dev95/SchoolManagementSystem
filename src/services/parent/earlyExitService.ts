import { ApiError, apiClient } from '../api/apiClient';
// Reuse the established native secure UUID generator; no transport/auth fork.
export { pickupOperationId as earlyExitOperationId } from './pickupAuthorizationService';

export const earlyExitStates = [
  'draft',
  'pending',
  'changes_requested',
  'rejected',
  'withdrawn',
] as const;
export type EarlyExitState = (typeof earlyExitStates)[number];
export interface EarlyExitFields {
  exitDate: string;
  reason: string;
}
export interface EarlyExitVersion {
  applicationRevision: number;
}
export interface EarlyExitReviewVersion extends EarlyExitVersion {
  approvalVersion: number;
}
export interface EarlyExitSummary {
  requestId: string;
  studentId: string;
  approvalId: string | null;
  exitDate: string;
  state: EarlyExitState;
  revision: number;
  createdAt: string;
  updatedAt: string;
  eligibility: {
    operationallyEligible: false;
    physicalReleaseAllowed: false;
    schoolPolicyState: 'unconfigured';
    custodyState: 'unknown' | 'hold';
  };
  reviewRoutingState: 'configured' | 'revision_mismatch' | 'unconfigured';
  capabilities: {
    canEditDraft: boolean;
    canSubmit: boolean;
    canWithdraw: boolean;
    canResubmit: boolean;
  };
}
export interface EarlyExitDetail extends EarlyExitSummary {
  reason: string;
  reviewVersion: EarlyExitReviewVersion | null;
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
    decisionReason?: string;
  }[];
  submissions: (EarlyExitFields & {
    cycle: number;
    applicationRevision: number;
    submittedAt: string;
  })[];
}
export interface EarlyExitPage<T = EarlyExitSummary> {
  items: T[];
  nextOffset: number | null;
}
export interface EarlyExitResult<T = EarlyExitDetail> {
  requestId: string;
  approvalId: string | null;
  operationRevision: number;
  operationState: EarlyExitState;
  operationCycle: number;
  replayed: boolean;
  request: T;
}
type Nonce = { clientOperationId: string };
export type EarlyExitWrite =
  | { kind: 'create'; body: EarlyExitFields & Nonce }
  | {
      kind: 'edit';
      id: string;
      body: EarlyExitFields & EarlyExitVersion & Nonce;
    }
  | { kind: 'submit'; id: string; body: EarlyExitVersion & Nonce }
  | { kind: 'withdraw'; id: string; body: EarlyExitReviewVersion & Nonce }
  | {
      kind: 'resubmit';
      id: string;
      body: EarlyExitFields & EarlyExitReviewVersion & Nonce;
    };

export const emptyEarlyExitFields: EarlyExitFields = {
  exitDate: '',
  reason: '',
};
export const normalizeEarlyExitFields = (
  fields: EarlyExitFields,
): EarlyExitFields => ({
  exitDate: fields.exitDate,
  reason: fields.reason.normalize('NFC').trim(),
});
export function earlyExitFieldErrors(fields: EarlyExitFields) {
  const errors: Partial<Record<keyof EarlyExitFields, string>> = {};
  const date = new Date(typeof fields.exitDate === 'string' ? fields.exitDate + 'T00:00:00Z' : NaN);
  if (
    typeof fields.exitDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(fields.exitDate) ||
    Number(fields.exitDate.slice(0, 4)) < 1 ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== fields.exitDate
  )
    errors.exitDate = 'Enter a valid date as YYYY-MM-DD.';
  const reason = typeof fields.reason === 'string' ? fields.reason.normalize('NFC').trim() : '';
  if (!reason.length || reason.length > 500)
    errors.reason = 'Enter a private reason of 1–500 characters.';
  return errors;
}
export function earlyExitKeys(body: object, keys: string[]) {
  if (
    !body ||
    Object.keys(body).some(key => !keys.includes(key)) ||
    keys.some(key => !Object.prototype.hasOwnProperty.call(body, key))
  )
    throw new ApiError(400, 'Invalid Early Exit fields');
}
export function earlyExitRevision(value: number) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value >= Number.MAX_SAFE_INTEGER
  )
    throw new ApiError(400, 'Invalid revision');
  return value;
}
export function earlyExitNonce(value: string) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120)
    throw new ApiError(400, 'Invalid operation ID');
  return value.trim();
}
export function earlyExitOffset(offset: number) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
    throw new ApiError(400, 'Invalid page');
  return offset;
}
export async function earlyExitRequest<T>(
  token: string,
  endpoint: string,
  method?: 'POST' | 'PATCH',
  body?: object,
) {
  const envelope = await apiClient.request<{ success: boolean; data: T }>(
    endpoint,
    { token, method, body },
  );
  if (envelope.success !== true || envelope.data == null)
    throw new Error('Early Exit response unconfirmed');
  return envelope.data;
}
const path = (child: string) =>
  `/parent/me/children/${encodeURIComponent(child)}/early-exit-requests`;
function owned<T extends EarlyExitSummary>(
  data: T,
  child: string,
  id?: string,
) {
  if (
    data.studentId !== child ||
    (id && data.requestId !== id) ||
    !earlyExitStates.includes(data.state)
  )
    throw new ApiError(404, 'Early Exit request unavailable');
  return data;
}
export const earlyExitService = {
  list: async (
    token: string,
    child: string,
    offset = 0,
    state?: EarlyExitState,
  ) => {
    earlyExitOffset(offset);
    if (state !== undefined && !earlyExitStates.includes(state))
      throw new ApiError(400, 'Invalid state');
    const data = await earlyExitRequest<EarlyExitPage>(
      token,
      `${path(child)}?offset=${offset}${state ? `&state=${state}` : ''}`,
    );
    data.items.forEach(item => owned(item, child));
    if (data.nextOffset !== null) earlyExitOffset(data.nextOffset);
    return data;
  },
  detail: async (token: string, child: string, id: string) =>
    owned(
      await earlyExitRequest<EarlyExitDetail>(
        token,
        `${path(child)}/${encodeURIComponent(id)}`,
      ),
      child,
      id,
    ),
  write: async (token: string, child: string, operation: EarlyExitWrite) => {
    const { kind, body } = operation;
    if (!['create', 'edit', 'submit', 'withdraw', 'resubmit'].includes(kind))
      throw new ApiError(400, 'Unsupported action');
    const hasFields =
      kind === 'create' || kind === 'edit' || kind === 'resubmit';
    earlyExitKeys(body, [
      'clientOperationId',
      ...(hasFields ? ['exitDate', 'reason'] : []),
      ...(kind !== 'create' ? ['applicationRevision'] : []),
      ...(['withdraw', 'resubmit'].includes(kind) ? ['approvalVersion'] : []),
    ]);
    const normalized: Record<string, string | number> = {
      clientOperationId: earlyExitNonce(body.clientOperationId),
    };
    if ('exitDate' in body) {
      if (Object.keys(earlyExitFieldErrors(body)).length)
        throw new ApiError(400, 'Invalid date or reason');
      Object.assign(normalized, normalizeEarlyExitFields(body));
    }
    if ('applicationRevision' in body)
      normalized.applicationRevision = earlyExitRevision(
        body.applicationRevision,
      );
    if ('approvalVersion' in body)
      normalized.approvalVersion = earlyExitRevision(body.approvalVersion);
    const suffix =
      kind === 'create'
        ? ''
        : `/${encodeURIComponent(operation.id)}${
            kind === 'edit' ? '' : `/${kind}`
          }`;
    const result = await earlyExitRequest<EarlyExitResult>(
      token,
      path(child) + suffix,
      kind === 'edit' ? 'PATCH' : 'POST',
      normalized,
    );
    owned(
      result.request,
      child,
      kind === 'create' ? result.requestId : operation.id,
    );
    if (result.requestId !== result.request.requestId)
      throw new ApiError(404, 'Early Exit request unavailable');
    return result;
  },
};
export type EarlyExitTransport = typeof earlyExitService;
