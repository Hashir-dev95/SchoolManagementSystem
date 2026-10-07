const test = require('node:test');
const assert = require('node:assert/strict');
const { __test } = require('./routes');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('Finance context requires an authenticated Finance user with a branch', () => {
  for (const [user, expected] of [
    [{ id: 'finance-a', role: 'finance', branchId: 'branch-a' }, 200],
    [{ id: 'finance-a', role: 'student', branchId: 'branch-a' }, 403],
    [{ id: 'finance-a', role: 'finance' }, 403],
    [null, 401],
  ]) {
    const req = { user };
    const res = responseRecorder();
    let passed = false;
    __test.requireFinanceContext(req, res, () => {
      passed = true;
    });
    assert.equal(passed, expected === 200);
    assert.equal(res.statusCode, expected);
    if (passed) {
      assert.deepEqual(req.financeContext, {
        userId: 'finance-a',
        branchId: 'branch-a',
      });
    }
  }
});

test('Finance list filters reject invalid dates, methods, and oversized student IDs', () => {
  assert.match(__test.financeListFilters({ from: 'bad' }).error, /YYYY-MM-DD/);
  assert.match(__test.financeListFilters({ method: 'crypto' }).error, /method must/);
  assert.match(__test.financeListFilters({ studentId: 'x'.repeat(121) }).error, /too long/);
  assert.equal(__test.financeListFilters({ method: 'easypaisa' }).method, 'easypaisa');
});

test('payment history filters retain branch, status, student, dates, and method', () => {
  const filters = __test.financeListFilters({
    studentId: 'STU 002',
    from: '2026-09-01',
    to: '2026-09-30',
    method: 'bank_transfer',
  });
  const pending = __test.financePaymentMatch(
    'branch-a',
    'pending_verification',
    filters,
  );
  assert.equal(pending.branchId, 'branch-a');
  assert.equal(pending.status, 'pending_verification');
  assert.equal(pending.studentId, 'STU 002');
  assert.equal(pending.method, 'bank_transfer');
  assert.deepEqual(pending.createdAt, filters.range.filter);
  assert.equal(pending.confirmedAt, undefined);

  const confirmed = __test.financePaymentMatch(
    'branch-b',
    'confirmed',
    filters,
  );
  assert.equal(confirmed.branchId, 'branch-b');
  assert.equal(confirmed.status, 'confirmed');
  assert.deepEqual(confirmed.confirmedAt, filters.range.filter);
  assert.equal(confirmed.createdAt, undefined);
});

test('traceable non-cash payment methods require a transaction reference', () => {
  for (const method of ['bank_transfer', 'card', 'easypaisa', 'cheque']) {
    assert.equal(__test.requiresPaymentReference(method), true);
  }
  assert.equal(__test.requiresPaymentReference('cash'), false);
  assert.equal(__test.requiresPaymentReference('other'), false);
});

test('rejecting a partial payment releases only that pending reservation', () => {
  assert.deepEqual(__test.rejectedInvoiceState(
    1000,
    { paidAmount: 300, pendingAmount: 350 },
    200,
  ), {
    paidAmount: 300,
    pendingPaymentAmount: 150,
    balanceDue: 700,
    status: 'partial',
    paymentStatus: 'partial',
    availableBalance: 550,
  });
});

test('payment indexes protect idempotency per actor and references per branch', async () => {
  const calls = [];
  const payments = {
    createIndex: async (keys, options) => {
      calls.push({ keys, options });
      return options.name;
    },
  };
  await __test.ensurePaymentIdempotencyIndex(payments);
  await __test.ensurePaymentReferenceIndex(payments);
  assert.deepEqual(calls[0].keys, {
    branchId: 1,
    createdByUserId: 1,
    idempotencyKey: 1,
  });
  assert.equal(calls[0].options.unique, true);
  assert.deepEqual(calls[1].keys, { branchId: 1, reference: 1 });
  assert.equal(calls[1].options.unique, true);
});
