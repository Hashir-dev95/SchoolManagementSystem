import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Types } from 'mongoose';
import { pickupDigest } from '../src/models/pickupAuthorization';
import {
  schoolCustodyPolicyContract,
  assessSchoolCustodyPolicy,
  collectorIdentityBindingMatches,
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
