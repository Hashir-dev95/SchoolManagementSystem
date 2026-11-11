import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Types } from 'mongoose';
import { pickupDigest } from '../src/models/pickupAuthorization';
import {
  schoolCustodyPolicyContract,
  assessSchoolCustodyPolicy,
  collectorIdentityBindingMatches,
  VERIFICATION_INVALIDATION_REASONS,
  type CollectorVerificationRevisionContext,
  type VerificationInvalidationReason,
} from '../src/services/school-custody-contract';

const id = () => new Types.ObjectId().toHexString();
const branchId = id();
const policy = () => ({
  _id: new Types.ObjectId(),
  branchId,
  revision: 1,
  status: 'unconfigured',
  activationEnabled: false,
});

test('legacy canonical sentinel normalizes without inventing school approval or activation', () => {
  const source = policy();
  const contract = schoolCustodyPolicyContract(source, branchId)!;
  assert.equal(contract.schemaVersion, 1);
  assert.deepEqual(contract.policy, {
    id: String(source._id),
    branchId,
    revision: 1,
  });
  assert.deepEqual(contract.schoolApproval, {
    state: 'unapproved',
    evidenceReference: null,
  });
  assert.equal(contract.activation, 'unavailable');
  assert.deepEqual(assessSchoolCustodyPolicy(contract, branchId), {
    operationallyEligible: false,
    reason: 'school_policy_unapproved',
  });
  assert.ok(Object.isFrozen(contract) && Object.isFrozen(contract.policy));
});
for (const [name, value] of Object.entries({
  missing: null,
  array: [],
  wrongBranch: { ...policy(), branchId: id() },
  missingProvenance: { ...policy(), _id: undefined },
  malformedIdentity: { ...policy(), _id: { toString: () => id() } },
  zeroRevision: { ...policy(), revision: 0 },
  fractionalRevision: { ...policy(), revision: 1.5 },
  unsafeRevision: { ...policy(), revision: Number.MAX_SAFE_INTEGER },
  enabledFlag: { ...policy(), activationEnabled: true },
  approvedStatus: { ...policy(), status: 'approved' },
  unsupportedVersion: { ...policy(), schemaVersion: 2 },
  fabricatedEvidence: {
    ...policy(),
    schoolApproval: { state: 'approved', evidenceReference: 'private' },
  },
}))
  test(`${name} cannot normalize to a canonical school policy contract`, () => {
    assert.equal(schoolCustodyPolicyContract(value, branchId), null);
    assert.equal(
      assessSchoolCustodyPolicy(value, branchId).operationallyEligible,
      false,
    );
  });

test('unsupported contract version, forged approval and unknown activation claims all deny', () => {
  const contract = schoolCustodyPolicyContract(policy(), branchId)!;
  for (const candidate of [
    { ...contract, schemaVersion: 999 },
    {
      ...contract,
      schoolApproval: { state: 'approved', evidenceReference: 'forged' },
    },
    {
      ...contract,
      schoolApproval: { state: 'unapproved', evidenceReference: 'forged' },
    },
    { ...contract, activation: 'enabled' },
    { ...contract, verified: true },
    { ...contract, policy: { ...contract.policy, revision: 0 } },
    { ...contract, policy: { ...contract.policy, branchId: id() } },
  ])
    assert.equal(
      assessSchoolCustodyPolicy(candidate, branchId).operationallyEligible,
      false,
    );
  assert.equal(
    assessSchoolCustodyPolicy({ ...contract, schemaVersion: 999 }, branchId)
      .reason,
    'unsupported_policy_version',
  );
});

const person = () => ({
  _id: id(),
  requesterId: id(),
  parentStudentLinkId: id(),
  studentId: id(),
  branchId,
  enrollmentId: id(),
  academicPeriodId: id(),
  classId: id(),
  sectionId: id(),
  revision: 3,
  fullName: 'Fictional Collector',
  relationship: 'Family friend',
  phone: '+92 300 0000000',
});
const binding = (source: ReturnType<typeof person>) => ({
  pickupPersonId: source._id,
  personRevision: source.revision,
  identityFingerprint: pickupDigest([
    source.fullName,
    source.relationship,
    source.phone,
  ]),
  provenance: Object.fromEntries(
    [
      'requesterId',
      'parentStudentLinkId',
      'studentId',
      'branchId',
      'enrollmentId',
      'academicPeriodId',
      'classId',
      'sectionId',
    ].map(key => [key, source[key as keyof typeof source]]),
  ),
});
test('identity binding describes consistency only; a matching proposed collector remains ineligible', () => {
  const source = person();
  assert.equal(collectorIdentityBindingMatches(binding(source), source), true);
  assert.equal(
    assessSchoolCustodyPolicy(
      schoolCustodyPolicyContract(policy(), branchId),
      branchId,
    ).operationallyEligible,
    false,
  );
});
for (const field of [
  'fullName',
  'relationship',
  'phone',
  'revision',
  '_id',
  'requesterId',
  'parentStudentLinkId',
  'studentId',
  'branchId',
  'enrollmentId',
  'academicPeriodId',
  'classId',
  'sectionId',
] as const)
  test(`changing collector ${field} invalidates the original identity binding`, () => {
    const source = person();
    const changed = {
      ...source,
      [field]:
        field === 'revision'
          ? source.revision + 1
          : field === 'fullName'
          ? 'Changed Collector'
          : field === 'relationship'
          ? 'Changed relationship'
          : field === 'phone'
          ? '+92 300 1111111'
          : id(),
    };
    assert.equal(
      collectorIdentityBindingMatches(binding(source), changed),
      false,
    );
  });
test('malformed and forged binding metadata never passes consistency validation', () => {
  const source = person(),
    original = binding(source);
  for (const candidate of [
    null,
    {},
    { ...original, verified: true },
    { ...original, personRevision: -1 },
    { ...original, identityFingerprint: 'fake' },
    { ...original, provenance: { ...original.provenance, isAuthorized: true } },
  ])
    assert.equal(collectorIdentityBindingMatches(candidate, source), false);
});

test('B1 identity, decision, policy and transaction counters remain separate observations', () => {
  const source = person();
  const identity = {
    pickupPersonId: source._id,
    personRevision: source.revision,
    identityFingerprint: pickupDigest([
      source.fullName,
      source.relationship,
      source.phone,
    ]),
    provenance: {
      requesterId: source.requesterId,
      parentStudentLinkId: source.parentStudentLinkId,
      studentId: source.studentId,
      branchId: source.branchId,
      enrollmentId: source.enrollmentId,
      academicPeriodId: source.academicPeriodId,
      classId: source.classId,
      sectionId: source.sectionId,
    },
  };
  const contract = schoolCustodyPolicyContract(
    { ...policy(), revision: 7, __v: 31 },
    branchId,
  )!;
  const observation: CollectorVerificationRevisionContext = {
    identity,
    verificationRevision: 19,
    policy: contract.policy,
    documentVersions: { pickupPerson: 23, policy: 31 },
  };
  assert.equal(observation.identity.personRevision, 3);
  assert.equal(observation.verificationRevision, 19);
  assert.equal(observation.policy.revision, 7);
  assert.equal(contract.schemaVersion, 1);
  assert.equal(
    collectorIdentityBindingMatches(observation.identity, {
      ...source,
      __v: 23,
    }),
    true,
  );
  assert.equal(
    collectorIdentityBindingMatches(
      { ...identity, personRevision: observation.verificationRevision },
      source,
    ),
    false,
  );
  assert.equal(
    collectorIdentityBindingMatches(
      {
        ...identity,
        personRevision: observation.documentVersions.pickupPerson,
      },
      source,
    ),
    false,
  );
  assert.equal(
    assessSchoolCustodyPolicy(contract, branchId).operationallyEligible,
    false,
  );
});

test('B1 changing only policy document __v does not change its business identity or approval', () => {
  const source = policy();
  const original = schoolCustodyPolicyContract({ ...source, __v: 0 }, branchId);
  const fenced = schoolCustodyPolicyContract({ ...source, __v: 29 }, branchId);
  assert.deepEqual(fenced, original);
  assert.equal(
    assessSchoolCustodyPolicy(fenced, branchId).operationallyEligible,
    false,
  );
});

test('B1 speculative verification metadata is not persisted policy or collector binding input', () => {
  const source = person();
  for (const claim of [
    { verificationRevision: 1 },
    { documentVersions: { pickupPerson: 1, policy: 1 } },
    { verification: { state: 'verified' } },
  ]) {
    assert.equal(
      schoolCustodyPolicyContract({ ...policy(), ...claim }, branchId),
      null,
    );
    assert.equal(
      collectorIdentityBindingMatches({ ...binding(source), ...claim }, source),
      false,
    );
  }
});

test('B1 invalidation reasons are immutable diagnostic labels with no operational authority', () => {
  assert.ok(Object.isFrozen(VERIFICATION_INVALIDATION_REASONS));
  const source = person();
  for (const reason of VERIFICATION_INVALIDATION_REASONS) {
    const typedReason: VerificationInvalidationReason = reason;
    const contract = schoolCustodyPolicyContract(policy(), branchId)!;
    assert.equal(
      assessSchoolCustodyPolicy(
        { ...contract, invalidationReason: typedReason },
        branchId,
      ).operationallyEligible,
      false,
    );
    assert.equal(
      collectorIdentityBindingMatches(
        { ...binding(source), invalidationReason: typedReason },
        source,
      ),
      false,
    );
  }
});
