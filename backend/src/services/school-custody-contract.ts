import { Types } from 'mongoose';
import { pickupDigest } from '../models/pickupAuthorization';

/** Internal schema version, not a database flag or school-policy approval. */
export const SCHOOL_CUSTODY_CONTRACT_VERSION = 1;
export interface SchoolCustodyPolicyIdentity {
  readonly id: string;
  readonly branchId: string;
  /** Persisted business-policy revision; neither schemaVersion nor Mongo __v. */
  readonly revision: number;
}
export interface SchoolCustodyPolicyContract {
  readonly schemaVersion: typeof SCHOOL_CUSTODY_CONTRACT_VERSION;
  readonly policy: SchoolCustodyPolicyIdentity;
  readonly schoolApproval: {
    readonly state: 'unapproved';
    readonly evidenceReference: null;
  };
  readonly activation: 'unavailable';
}

/** FUTURE dependencies only. These types grant no authority and have no writer.
 * References require a separately approved protected-evidence contract; no raw
 * custody documents, verifier roles or school validity durations are defined.
 */
export interface CustodySubjectBinding {
  readonly studentId: string;
  readonly branchId: string;
  readonly enrollmentId: string;
  readonly academicPeriodId: string;
  readonly classId: string;
  readonly sectionId: string;
}
export interface CustodyVerificationDependencies {
  readonly subject: CustodySubjectBinding;
  readonly verifier: {
    readonly actorId: string;
    readonly sessionId: string;
    /** Transaction-document observations (__v), not durable school grants. */
    readonly actorRevision: number;
    readonly sessionRevision: number;
    readonly schoolAuthorityEvidenceReference: string;
  };
  readonly policy: SchoolCustodyPolicyIdentity & {
    readonly schemaVersion: typeof SCHOOL_CUSTODY_CONTRACT_VERSION;
    readonly schoolApprovalEvidenceReference: string;
  };
  readonly verification: {
    readonly evidenceReference: string;
    /** Future school-decision revision; not collector identity or document __v. */
    readonly revision: number;
    readonly validFrom: Date;
    readonly validUntil: Date;
  };
  readonly audit: {
    readonly clientOperationId: string;
    readonly recordedAt: Date;
  };
  readonly restrictions: {
    readonly custodyStateId: string;
    readonly authorityRevision: number;
    readonly state: 'unknown' | 'hold' | 'verified';
    readonly revokedAt: Date | null;
  };
}
export interface CollectorIdentityBinding {
  readonly pickupPersonId: string;
  /** PickupPerson.revision pinned by submissions; verification must not bump it. */
  readonly personRevision: number;
  readonly identityFingerprint: string;
  readonly provenance: CustodySubjectBinding & {
    readonly requesterId: string;
    readonly parentStudentLinkId: string;
  };
}
export interface CollectorVerificationDependencies
  extends CustodyVerificationDependencies {
  readonly collector: CollectorIdentityBinding;
}

/** Future in-memory observations only: no model fields, writer or proof factory.
 * Keeping the counters separate does not validate them or grant authority.
 * Document versions serialize writes; they do not change submitted identity.
 */
export interface CollectorVerificationRevisionContext {
  readonly identity: CollectorIdentityBinding;
  readonly verificationRevision: number;
  readonly policy: SchoolCustodyPolicyIdentity;
  readonly documentVersions: {
    readonly pickupPerson: number;
    readonly policy: number;
  };
}

/** Diagnostic vocabulary, not an action allowlist, school policy or API input.
 * No reason can clear Hold, authorize re-verification or enable release.
 */
export const VERIFICATION_INVALIDATION_REASONS = Object.freeze([
  'school_policy_unapproved',
  'subject_provenance_changed',
  'collector_identity_changed',
  'custody_hold',
  'verification_expired',
  'verification_revoked',
  'policy_revision_changed',
  'verifier_authority_unavailable',
  'evidence_unavailable',
] as const);
export type VerificationInvalidationReason =
  (typeof VERIFICATION_INVALIDATION_REASONS)[number];

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);
const keys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every(key => allowed.includes(key));
const revision = (value: unknown, minimum = 1): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= minimum &&
  value < Number.MAX_SAFE_INTEGER;
const objectId = (value: unknown): string | null => {
  if (value instanceof Types.ObjectId) return value.toHexString();
  return typeof value === 'string' && /^[a-f0-9]{24}$/.test(value)
    ? value
    : null;
};

/** Only canonical persisted sentinel fields are supported. Expected Branch must
 * come from an independently authorized server context, never a request body.
 * No persistence, activation path, environment override or evidence acceptance.
 */
export function schoolCustodyPolicyContract(
  raw: unknown,
  expectedBranchId: string,
): SchoolCustodyPolicyContract | null {
  if (
    !record(raw) ||
    !keys(raw, [
      '_id',
      'branchId',
      'revision',
      'status',
      'activationEnabled',
      'createdAt',
      'updatedAt',
      '__v',
    ])
  )
    return null;
  const id = objectId(raw._id),
    branchId = objectId(raw.branchId);
  if (
    !id ||
    !branchId ||
    branchId !== objectId(expectedBranchId) ||
    !revision(raw.revision) ||
    raw.status !== 'unconfigured' ||
    raw.activationEnabled !== false ||
    (raw.__v !== undefined && !revision(raw.__v, 0))
  )
    return null;
  for (const field of ['createdAt', 'updatedAt']) {
    const date = raw[field];
    if (
      date !== undefined &&
      (!(date instanceof Date) || !Number.isFinite(date.getTime()))
    )
      return null;
  }
  return Object.freeze({
    schemaVersion: SCHOOL_CUSTODY_CONTRACT_VERSION,
    policy: Object.freeze({ id, branchId, revision: raw.revision }),
    schoolApproval: Object.freeze({
      state: 'unapproved',
      evidenceReference: null,
    }),
    activation: 'unavailable',
  });
}

/** Denial assessment only. Even a well-formed contract is NOT school approval. */
export function assessSchoolCustodyPolicy(
  raw: unknown,
  expectedBranchId: string,
): {
  operationallyEligible: false;
  reason:
    | 'invalid_policy_contract'
    | 'unsupported_policy_version'
    | 'school_policy_unapproved';
} {
  const deny = (
    reason:
      | 'invalid_policy_contract'
      | 'unsupported_policy_version'
      | 'school_policy_unapproved',
  ) => ({ operationallyEligible: false as const, reason });
  if (
    !record(raw) ||
    !keys(raw, ['schemaVersion', 'policy', 'schoolApproval', 'activation'])
  )
    return deny('invalid_policy_contract');
  if (raw.schemaVersion !== SCHOOL_CUSTODY_CONTRACT_VERSION)
    return deny('unsupported_policy_version');
  const policy = raw.policy,
    approval = raw.schoolApproval;
  if (
    !record(policy) ||
    !keys(policy, ['id', 'branchId', 'revision']) ||
    !objectId(policy.id) ||
    !objectId(policy.branchId) ||
    policy.branchId !== objectId(expectedBranchId) ||
    !revision(policy.revision) ||
    !record(approval) ||
    !keys(approval, ['state', 'evidenceReference']) ||
    approval.state !== 'unapproved' ||
    approval.evidenceReference !== null ||
    raw.activation !== 'unavailable'
  )
    return deny('invalid_policy_contract');
  return deny('school_policy_unapproved');
}

const provenanceFields = [
  'requesterId',
  'parentStudentLinkId',
  'studentId',
  'branchId',
  'enrollmentId',
  'academicPeriodId',
  'classId',
  'sectionId',
] as const;
/** Consistency comparison only, NOT an authorization or verification proof.
 * Current must be server-loaded with private identity fields. Policy/session/
 * role/relationship/validity/Hold checks remain separate mandatory boundaries.
 */
export function collectorIdentityBindingMatches(
  binding: unknown,
  current: unknown,
): boolean {
  if (
    !record(binding) ||
    !keys(binding, [
      'pickupPersonId',
      'personRevision',
      'identityFingerprint',
      'provenance',
    ]) ||
    !record(binding.provenance) ||
    !keys(binding.provenance, provenanceFields) ||
    !record(current) ||
    !revision(binding.personRevision, 0) ||
    !revision(current.revision, 0) ||
    binding.personRevision !== current.revision ||
    !objectId(binding.pickupPersonId) ||
    objectId(binding.pickupPersonId) !== objectId(current._id) ||
    typeof binding.identityFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(binding.identityFingerprint)
  )
    return false;
  for (const field of provenanceFields)
    if (
      !objectId(binding.provenance[field]) ||
      objectId(binding.provenance[field]) !== objectId(current[field])
    )
      return false;
  if (
    ['fullName', 'relationship', 'phone'].some(
      field =>
        typeof current[field] !== 'string' ||
        !(current[field] as string).trim(),
    )
  )
    return false;
  return (
    binding.identityFingerprint ===
    pickupDigest([current.fullName, current.relationship, current.phone])
  );
}
