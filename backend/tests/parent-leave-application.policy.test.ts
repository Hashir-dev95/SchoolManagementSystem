import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertNoActiveParentLeaveOverlap,
  assertParentLeaveRevision,
  normalizeParentLeaveDraft,
  parentLeaveFingerprint,
  PARENT_LEAVE_STATES,
  validateParentLeaveTransition,
  type ParentLeaveState,
} from '../src/services/parent-leave-application.policy';
import { RequestContractError } from '../src/utils/request-validation';

const draft = {
  leaveType: 'School-defined type',
  startDate: '2026-11-04',
  endDate: '2026-11-05',
  reason: 'Private family reason',
  clientOperationId: 'draft-operation-1',
};
const errorStatus = (status: number) => (error: unknown) =>
  error instanceof RequestContractError && error.status === status;

test('normalization, canonical fingerprint and no invented duration/category policy', () => {
  const a = normalizeParentLeaveDraft(draft);
  const b = normalizeParentLeaveDraft({
    ...draft,
    reason: '  Private family reason  ',
    leaveType: ' School-defined type ',
  });
  assert.deepEqual(a, b);
  const student = '0123456789abcdef01234567';
  assert.equal(
    parentLeaveFingerprint(student, a.payload),
    parentLeaveFingerprint(student.toUpperCase(), b.payload),
  );
  assert.notEqual(
    parentLeaveFingerprint(student, a.payload),
    parentLeaveFingerprint('0123456789abcdef01234568', a.payload),
  );
  assert.doesNotThrow(() =>
    normalizeParentLeaveDraft({ ...draft, endDate: '2030-01-01' }),
  );
  assert.doesNotThrow(() =>
    normalizeParentLeaveDraft({ ...draft, startDate: '2026-01-01' }),
  );
});

for (const patch of [
  { startDate: '2026-02-30' },
  { startDate: '2026-11-04T00:00:00Z' },
  { startDate: '2026-11-06' },
  { endDate: '' },
  { startDate: null },
  { leaveType: '' },
  { leaveType: 1 },
  { reason: ' ' },
  { reason: 'x'.repeat(501) },
  { clientOperationId: '' },
  { clientOperationId: null },
  { branchId: 'forged' },
  { classId: 'forged' },
  { requesterId: 'forged' },
  { state: 'approved' },
  { approvalRequestId: 'forged' },
  { approved: true },
  { fileUrl: 'https://example.invalid/private.pdf' },
  { protectedAttachmentIds: [] },
]) {
  test(`reject malformed or authority-bearing input ${
    Object.keys(patch)[0]
  } ${JSON.stringify(patch)}`, () => {
    assert.throws(
      () => normalizeParentLeaveDraft({ ...draft, ...patch }),
      errorStatus(400),
    );
  });
}

test('missing body and required fields fail closed', () => {
  for (const value of [
    undefined,
    null,
    [],
    {},
    { ...draft, reason: undefined },
  ])
    assert.throws(() => normalizeParentLeaveDraft(value), errorStatus(400));
});

const transitions: [ParentLeaveState, ParentLeaveState, string][] = [
  ['draft', 'pending', 'current_requester'],
  ['pending', 'approved', 'current_domain_reviewer'],
  ['pending', 'rejected', 'current_domain_reviewer'],
  ['pending', 'changes_requested', 'current_domain_reviewer'],
  ['pending', 'withdrawn', 'current_requester'],
  ['changes_requested', 'pending', 'current_requester'],
];
for (const [from, to, capability] of transitions) {
  test(`pure contract permits ${from} -> ${to} with proper capability`, () => {
    assert.deepEqual(
      validateParentLeaveTransition({
        from,
        to,
        capability,
        revision: 2,
        expectedRevision: 2,
        decisionReason: 'Applicant-visible decision reason',
      }),
      {
        from,
        to,
        revision: 3,
        reason: 'Applicant-visible decision reason',
      },
    );
  });
}

test('exhaustive state-pair matrix rejects every unlisted transition', () => {
  for (const from of PARENT_LEAVE_STATES)
    for (const to of PARENT_LEAVE_STATES) {
      if (transitions.some(([a, b]) => a === from && b === to)) continue;
      assert.throws(
        () =>
          validateParentLeaveTransition({
            from,
            to,
            capability: 'current_domain_reviewer',
            revision: 0,
            expectedRevision: 0,
          }),
        errorStatus(409),
      );
    }
});

test('requester cannot decide and reviewer cannot submit/withdraw for requester', () => {
  for (const [from, to, capability] of transitions)
    assert.throws(
      () =>
        validateParentLeaveTransition({
          from,
          to,
          capability:
            capability === 'current_requester'
              ? 'current_domain_reviewer'
              : 'current_requester',
          revision: 0,
          expectedRevision: 0,
          decisionReason: 'A decision note',
        }),
      errorStatus(403),
    );
});

test('stale, missing, invalid and exhausted revisions cannot transition', () => {
  assert.throws(() => assertParentLeaveRevision(2, 1), errorStatus(409));
  for (const value of [undefined, null, -1, 0.5, '0', NaN, Infinity])
    assert.throws(
      () => assertParentLeaveRevision(value, value),
      errorStatus(400),
    );
  assert.throws(
    () =>
      validateParentLeaveTransition({
        from: 'draft',
        to: 'pending',
        capability: 'current_requester',
        revision: Number.MAX_SAFE_INTEGER,
        expectedRevision: Number.MAX_SAFE_INTEGER,
      }),
    errorStatus(409),
  );
});

test('rejection/change requests require bounded meaningful public reasons', () => {
  for (const to of ['rejected', 'changes_requested'])
    for (const reason of [undefined, '', ' ', 1, 'x'.repeat(501)])
      assert.throws(
        () =>
          validateParentLeaveTransition({
            from: 'pending',
            to,
            capability: 'current_domain_reviewer',
            revision: 0,
            expectedRevision: 0,
            decisionReason: reason,
          }),
        errorStatus(400),
      );
});

test('future overlap contract includes boundary dates and all active states', () => {
  const candidate = {
    branchId: 'branch-a',
    studentId: 'student-a',
    startDate: '2026-11-04',
    endDate: '2026-11-05',
  };
  for (const state of PARENT_LEAVE_STATES) {
    const check = () =>
      assertNoActiveParentLeaveOverlap(candidate, [
        { ...candidate, startDate: '2026-11-05', state },
      ]);
    if (['pending', 'approved', 'changes_requested'].includes(state))
      assert.throws(check, errorStatus(409));
    else assert.doesNotThrow(check);
  }
  for (const patch of [
    { branchId: 'branch-b' },
    { studentId: 'student-b' },
    { startDate: '2026-11-06', endDate: '2026-11-06' },
    { startDate: '2026-11-01', endDate: '2026-11-03' },
  ])
    assert.doesNotThrow(() =>
      assertNoActiveParentLeaveOverlap(candidate, [
        { ...candidate, ...patch, state: 'pending' },
      ]),
    );
});
