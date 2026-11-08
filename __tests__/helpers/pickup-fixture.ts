import type {
  PickupDetail,
  PickupFields,
  PickupResult,
} from '../../src/services/parent/pickupAuthorizationService';
import type { PickupReviewDetail } from '../../src/services/principal/pickupAuthorizationReviewService';
import type { VerifiedChild } from '../../src/services/parent/parentService';

export const pickupFields: PickupFields = {
  fullName: 'Proposed Collector',
  relationship: 'Aunt',
  phone: '+92 300 1234567',
  validFromDate: '2026-11-09',
  validUntilDate: '2026-11-13',
  notes: 'PRIVATE PROPOSAL',
};
export function pickupChild(id = 'A'): VerifiedChild {
  return {
    studentId: id,
    fullName: `Child ${id}`,
    email: `${id}@example.invalid`,
    admissionNumber: id,
    relationship: 'guardian',
    enrollment: {
      enrollmentId: id,
      status: 'active',
      effectiveFrom: '2026-01-01',
      branch: { id: 'branch', name: 'Own Branch' },
      schoolClass: { id: 'class', name: 'Grade 8' },
      section: { id: 'section', name: 'A' },
      academicPeriod: { id: 'term', name: 'Term' },
    },
  };
}
export function pickupDetail(patch: Partial<PickupDetail> = {}): PickupDetail {
  return {
    authorizationId: 'proposal-A',
    pickupPersonId: 'person-A',
    studentId: 'A',
    state: 'draft',
    revision: 0,
    personRevision: 0,
    person: {
      fullName: pickupFields.fullName,
      relationship: pickupFields.relationship,
      phone: pickupFields.phone,
    },
    validFromDate: pickupFields.validFromDate,
    validUntilDate: pickupFields.validUntilDate,
    notes: pickupFields.notes,
    eligibility: {
      operationallyEligible: false,
      identityVerification: 'unverified',
      custodyState: 'unknown',
      policyState: 'unconfigured',
      policyRevision: 1,
      blockedReasons: ['school_custody_policy_unconfigured'],
    },
    capabilities: {
      canEditDraft: true,
      canSubmit: true,
      canWithdraw: false,
      canResubmit: false,
    },
    policyBindingCurrent: true,
    reviewRoutingState: 'configured',
    approvalId: null,
    reviewVersion: null,
    history: [{ action: 'created', revision: 0, at: '2026-11-08T10:00:00Z' }],
    submissions: [],
    ...patch,
  };
}
export function pickupReview(
  patch: Partial<PickupReviewDetail> = {},
): PickupReviewDetail {
  return {
    ...pickupDetail(),
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
    decisionVersion: {
      applicationRevision: 1,
      personRevision: 0,
      approvalVersion: 0,
    },
    ...patch,
  };
}
export function pickupResult<
  T extends {
    authorizationId: string;
    pickupPersonId: string;
    approvalId: string | null;
    revision: number;
    personRevision: number;
    state: PickupDetail['state'];
  },
>(authorization: T): PickupResult<T> {
  return {
    authorizationId: authorization.authorizationId,
    pickupPersonId: authorization.pickupPersonId,
    approvalId: authorization.approvalId,
    operationRevision: authorization.revision,
    operationPersonRevision: authorization.personRevision,
    operationState: authorization.state,
    operationCycle: 0,
    replayed: false,
    authorization,
  };
}
export function deferredPickup<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
