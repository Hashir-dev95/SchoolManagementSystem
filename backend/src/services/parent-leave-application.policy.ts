import { createHash } from 'node:crypto';
import {
  dateField,
  enumField,
  objectBody,
  objectIdField,
  RequestContractError,
  textField,
} from '../utils/request-validation';

export const PARENT_LEAVE_STATES = [
  'draft',
  'pending',
  'approved',
  'rejected',
  'changes_requested',
  'withdrawn',
] as const;
export type ParentLeaveState = (typeof PARENT_LEAVE_STATES)[number];
export interface ParentLeavePayload {
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string;
}

const normalizedText = (value: unknown, name: string, max: number) =>
  textField(value, name, max, 1).normalize('NFC');

/** Calendar dates, not UTC instants or inferred school-specific leave limits. */
export function validateLeaveDates(startDate: unknown, endDate: unknown) {
  for (const value of [startDate, endDate]) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new RequestContractError(400, 'Invalid leave date');
    dateField(value, 'leave date', true);
  }
  if ((endDate as string) < (startDate as string))
    throw new RequestContractError(400, 'Invalid leave date range');
}

/** No authority, status, files, approver or academic placement accepted here. */
export function normalizeParentLeaveDraft(raw: unknown) {
  const body = objectBody(raw, [
    'leaveType',
    'startDate',
    'endDate',
    'reason',
    'clientOperationId',
  ]);
  validateLeaveDates(body.startDate, body.endDate);
  const payload: ParentLeavePayload = {
    // Bounded free text until the school supplies a canonical type catalogue.
    leaveType: normalizedText(body.leaveType, 'leave type', 80),
    startDate: body.startDate as string,
    endDate: body.endDate as string,
    reason: normalizedText(body.reason, 'leave reason', 500),
  };
  return {
    payload,
    clientOperationId: textField(
      body.clientOperationId,
      'operation ID',
      120,
      1,
    ),
  };
}

export function parentLeaveFingerprint(
  studentId: string,
  payload: ParentLeavePayload,
) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'parent_leave_draft_v1',
        objectIdField(studentId, 'student ID'),
        payload.leaveType,
        payload.startDate,
        payload.endDate,
        payload.reason,
      ]),
    )
    .digest('hex');
}

export function assertParentLeaveRevision(actual: unknown, expected: unknown) {
  if (
    !Number.isSafeInteger(actual) ||
    (actual as number) < 0 ||
    !Number.isSafeInteger(expected) ||
    (expected as number) < 0
  )
    throw new RequestContractError(400, 'Invalid application revision');
  if (actual !== expected)
    throw new RequestContractError(
      409,
      'Application changed; refresh and retry',
    );
}

/**
 * Pure future-integration contract, never authorization or a persistence command.
 * A trusted caller must derive the capability from current canonical authority.
 * G2/G3 must atomically update the linked ApprovalRequest, history and domain
 * effect; this function cannot enable approval, submission or withdrawal in G1.
 */
export function validateParentLeaveTransition(raw: unknown) {
  const body = objectBody(raw, [
    'from',
    'to',
    'revision',
    'expectedRevision',
    'capability',
    'decisionReason',
  ]);
  const from = enumField(body.from, 'source state', PARENT_LEAVE_STATES);
  const to = enumField(body.to, 'target state', PARENT_LEAVE_STATES);
  assertParentLeaveRevision(body.revision, body.expectedRevision);
  if (body.revision === Number.MAX_SAFE_INTEGER)
    throw new RequestContractError(409, 'Application revision is exhausted');
  const requester =
    ((from === 'draft' || from === 'changes_requested') && to === 'pending') ||
    (from === 'pending' && to === 'withdrawn');
  const reviewer =
    from === 'pending' &&
    ['approved', 'rejected', 'changes_requested'].includes(to);
  if (!requester && !reviewer)
    throw new RequestContractError(
      409,
      'Application transition is unavailable',
    );
  if (
    body.capability !==
    (requester ? 'current_requester' : 'current_domain_reviewer')
  )
    throw new RequestContractError(403, 'Application action is not permitted');
  const reason =
    body.decisionReason === undefined
      ? undefined
      : normalizedText(body.decisionReason, 'decision reason', 500);
  if (['rejected', 'changes_requested'].includes(to) && !reason)
    throw new RequestContractError(400, 'Decision reason is required');
  return { from, to, revision: (body.revision as number) + 1, reason };
}

export interface ParentLeaveInterval {
  branchId: string;
  studentId: string;
  startDate: string;
  endDate: string;
  state: ParentLeaveState;
}

/**
 * Future submit-time overlap rule: all guardians of the same child count.
 * Drafts reserve no dates. Query and check must share the canonical Branch
 * transaction lock with insertion; this pure predicate alone is not a lock.
 */
export function assertNoActiveParentLeaveOverlap(
  candidate: Omit<ParentLeaveInterval, 'state'>,
  existing: readonly ParentLeaveInterval[],
) {
  validateLeaveDates(candidate.startDate, candidate.endDate);
  for (const interval of existing) {
    validateLeaveDates(interval.startDate, interval.endDate);
    enumField(interval.state, 'application state', PARENT_LEAVE_STATES);
    if (
      interval.branchId === candidate.branchId &&
      interval.studentId === candidate.studentId &&
      ['pending', 'approved', 'changes_requested'].includes(interval.state) &&
      interval.startDate <= candidate.endDate &&
      interval.endDate >= candidate.startDate
    )
      throw new RequestContractError(409, 'A leave request covers these dates');
  }
}
