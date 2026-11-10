import type { ClientSession } from 'mongoose';
import User from '../models/user';
import { PERMISSIONS } from '../constants/permissions';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import {
  PickupCustodyPolicy,
  pickupDigest,
} from '../models/pickupAuthorization';
import { StudentCustodyState } from '../models/gateFoundation';
import {
  ApprovalAccessError,
  assertApprovalAuthority,
} from './approval-authority.policy';
import { communicationFence } from './teacher-communication-access.service';
import {
  objectBody,
  objectIdField,
  RequestContractError,
  textField,
} from '../utils/request-validation';
import { scheduleDate, schoolDateTime } from './school-date.service';
import type { StudentReadScope } from './student-self-scope.service';
import {
  schoolCustodyPolicyContract,
  assessSchoolCustodyPolicy,
} from './school-custody-contract';

export const pickupUnavailable = () =>
  new RequestContractError(404, 'Pickup proposal is unavailable');
export const pickupConflict = () =>
  new RequestContractError(
    409,
    'Pickup proposal changed; refresh and review again',
  );
export const pickupRoutingUnavailable = () =>
  new RequestContractError(
    503,
    'Pickup review routing is not configured for this school',
  );
export const PICKUP_PAYLOAD_FIELDS = [
  'fullName',
  'relationship',
  'phone',
  'validFromDate',
  'validUntilDate',
  'notes',
] as const;
export type PickupPayload = {
  fullName: string;
  relationship: string;
  phone: string;
  validFromDate: string;
  validUntilDate: string;
  notes: string;
};
export function pickupPayload(body: Record<string, unknown>): PickupPayload {
  const phone = textField(body.phone, 'contact phone', 30, 7);
  if (!/^\+?[0-9 ()-]+$/.test(phone))
    throw new RequestContractError(400, 'Invalid contact phone');
  const payload = {
    fullName: textField(
      typeof body.fullName === 'string'
        ? body.fullName.normalize('NFC')
        : body.fullName,
      'full name',
      100,
      2,
    ),
    relationship: textField(body.relationship, 'relationship', 80, 2),
    phone,
    validFromDate: scheduleDate(body.validFromDate),
    validUntilDate: scheduleDate(body.validUntilDate),
    notes: body.notes === undefined ? '' : textField(body.notes, 'notes', 500),
  };
  if (payload.validUntilDate < payload.validFromDate)
    throw new RequestContractError(400, 'Invalid proposed validity range');
  return payload;
}
export function pickupRevision(value: unknown) {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) >= Number.MAX_SAFE_INTEGER
  )
    throw new RequestContractError(400, 'Invalid revision');
  return value as number;
}
export const pickupFingerprint = (student: unknown, payload: PickupPayload) =>
  pickupDigest(['pickup_payload_v1', String(student), payload]);
export function assertPickupRange(
  payload: PickupPayload,
  scope: StudentReadScope,
) {
  const start = scheduleDate(scope.period.startDate),
    end = scheduleDate(scope.period.endDate);
  if (
    payload.validFromDate < start ||
    payload.validUntilDate > end ||
    payload.validFromDate < schoolDateTime(scope.enrollment.effectiveFrom).date
  )
    throw pickupConflict();
}

export function readPickupRouting(branchId: string) {
  try {
    const value = objectBody(
      JSON.parse(process.env.PICKUP_AUTHORIZATION_ROUTING_POLICY ?? '{}'),
      ['policy', 'version', 'enabled', 'branchIds'],
    );
    if (
      value.policy !== 'shared_branch_principal' ||
      value.enabled !== true ||
      !Number.isSafeInteger(value.version) ||
      (value.version as number) < 1 ||
      !Array.isArray(value.branchIds) ||
      !value.branchIds.length ||
      value.branchIds.some(id => objectIdField(id, 'routing Branch') !== id) ||
      new Set(value.branchIds).size !== value.branchIds.length ||
      !value.branchIds.includes(branchId)
    )
      throw pickupRoutingUnavailable();
    return {
      policy: 'shared_branch_principal' as const,
      version: value.version as number,
    };
  } catch {
    throw pickupRoutingUnavailable();
  }
}
export async function verifyPickupQueue(
  branchId: string,
  session: ClientSession,
  lockReviewers = true,
) {
  const routing = readPickupRouting(branchId);
  if (
    !ROLE_PERMISSIONS.principal.includes(
      PERMISSIONS.PRINCIPAL_APPROVALS_VIEW,
    ) ||
    !ROLE_PERMISSIONS.principal.includes(PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE)
  )
    throw pickupRoutingUnavailable();
  const candidates = await User.find({ role: 'principal', isActive: true })
    .where('branchId')
    .equals(branchId)
    .select('_id')
    .session(session)
    .lean();
  const eligible = candidates.filter(candidate => {
    try {
      assertApprovalAuthority(String(candidate._id), branchId, {
        approvalType: 'pickup_authorization',
      });
      return true;
    } catch (error) {
      if (error instanceof ApprovalAccessError) return false;
      throw error;
    }
  });
  if (!eligible.length) throw pickupRoutingUnavailable();
  if (lockReviewers)
    for (const reviewer of eligible)
      await communicationFence(
        session,
        User.collection.name,
        String(reviewer._id),
      );
  return routing;
}

export async function currentPickupPolicy(
  branchId: string,
  session: ClientSession,
  create = false,
) {
  let policy = await PickupCustodyPolicy.findOne({ branchId })
    .session(session)
    .lean();
  if (!policy && create) {
    const [row] = await PickupCustodyPolicy.create([{ branchId }], { session });
    policy = row.toObject();
  }
  if (!policy || !schoolCustodyPolicyContract(policy, branchId))
    throw pickupConflict();
  return policy;
}

export async function pickupEligibility(
  branchId: string,
  studentId: string,
  enrollmentId: string,
  session: ClientSession,
) {
  const policy = await PickupCustodyPolicy.findOne({ branchId })
    .session(session)
    .lean();
  const custody = await StudentCustodyState.findOne({ branchId, studentId })
    .session(session)
    .lean();
  const custodyState =
    custody &&
    String(custody.enrollmentId) === enrollmentId &&
    custody.state === 'hold'
      ? 'hold'
      : 'unknown';
  const contract = schoolCustodyPolicyContract(policy, branchId);
  return {
    operationallyEligible: assessSchoolCustodyPolicy(contract, branchId)
      .operationallyEligible,
    identityVerification: 'unverified' as const,
    custodyState,
    policyState: 'unconfigured' as const,
    policyRevision: contract?.policy.revision ?? null,
    blockedReasons: [
      'school_custody_policy_unconfigured',
      'pickup_identity_unverified',
      custodyState === 'hold' ? 'custody_hold' : 'custody_unknown',
      'operational_activation_unavailable',
    ],
  };
}
