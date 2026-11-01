import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  finance,
  state,
  parentHttp,
  assignedFee,
  finHttp,
  apiHttp,
  oid,
  put,
} from './helpers/finance.fixture';
import {
  FinanceTransaction,
  FinancePaymentIntent,
  FinanceAudit,
  FeeObligation,
} from '../src/models/finance';
import Session from '../src/models/session';
import User from '../src/models/user';
import LegacyFee from '../src/models/fee';
import { StudentEnrollment } from '../src/models/studentEnrollment';
import { ROLE_PERMISSIONS } from '../src/constants/rolePermissions';
import { PERMISSIONS } from '../src/constants/permissions';
import { getBranchFeeSummary } from '../src/services/fee.service';

async function recorded(feeId: string) {
  const result = await finHttp(`/fees/${feeId}/manual-payments`, {
    method: 'bank_transfer',
    reference: 'BANK-001',
    operationId: 'manual_payment_operation_001',
  });
  assert.equal(result.status, 200, JSON.stringify(result));
  return result.json.data;
}
const verifyBody = (revision: number) => ({
  revision,
  reviewNote: 'Bank record independently verified',
  operationId: 'verify_payment_operation_001',
});
test('Finance assigns server-valued enrollment-scoped fee and both owners see the same safe DTO', async () => {
  const fee = await assignedFee();
  assert.equal(fee.amountMinor, 30000);
  assert.equal(fee.balanceLabel, 'PKR 300.00');
  const student = await apiHttp('/student/me/fees', state.token),
    parent = await parentHttp(`/children/${state.student._id}/fees`);
  assert.equal(student.status, 200);
  assert.equal(parent.status, 200);
  assert.equal(student.json.data.items[0].id, parent.json.data.items[0].id);
  assert.equal(student.json.data.items[0].balanceMinor, 30000);
  assert.equal((await finHttp('/summary')).json.data.balanceMinor, 30000);
});
test('fee assignment retries are idempotent and client amount/status overrides are rejected', async () => {
  const fee = await assignedFee();
  assert.equal(
    (
      await finHttp('/fees', {
        studentId: String(state.student._id),
        structureId: String(
          (await FeeObligation.findById(fee.id))!.structureId,
        ),
        dueDate: state.today,
        operationId: 'assign_fee_operation_001',
      })
    ).json.data.id,
    fee.id,
  );
  assert.equal(await FeeObligation.countDocuments(), 1);
  assert.equal(
    (
      await finHttp(`/fees/${fee.id}/manual-payments`, {
        amountMinor: 1,
        status: 'settled',
        method: 'cash',
        reference: 'TAMPER',
        operationId: 'tamper_payment_operation_001',
      })
    ).status,
    400,
  );
});
for (const value of [1.1, -1, 0, Number.MAX_SAFE_INTEGER, '30000']) {
  test(`unsafe monetary value ${value} is rejected`, async () => {
    assert.equal(
      (
        await finHttp('/structures', {
          title: 'Tuition',
          amountMinor: value,
          operationId: 'invalid_money_operation_001',
        })
      ).status,
      400,
    );
  });
}
test('Finance role/Branch and Student/Parent ownership cannot be bypassed', async () => {
  const fee = await assignedFee();
  assert.equal(
    (await finHttp(`/fees/${fee.id}`, undefined, finance.foreign)).status,
    403,
  );
  assert.equal((await apiHttp('/finance/me/summary', state.token)).status, 403);
  assert.equal(
    (
      await apiHttp(
        `/student/me/fees?studentId=${state.otherStudent._id}`,
        state.token,
      )
    ).status,
    403,
  );
  assert.equal(
    (await parentHttp(`/children/${state.otherStudent._id}/fees`)).status,
    403,
  );
  assert.equal(
    (await finHttp('/fees?branchId=' + state.foreign._id)).status,
    403,
  );
});
test('missing enrollment and foreign Student assignment fail closed', async () => {
  await StudentEnrollment.deleteMany({});
  await assert.rejects(assignedFee());
  assert.equal((await apiHttp('/student/me/fees', state.token)).status, 403);
});
test('manual recording reserves balance without credit; maker cannot verify own payment', async () => {
  const fee = await assignedFee(),
    intent = await recorded(fee.id);
  const current = (await finHttp('/fees/' + fee.id)).json.data;
  assert.equal(current.paidMinor, 0);
  assert.equal(current.reservedMinor, 30000);
  assert.equal(current.availableMinor, 0);
  assert.equal(
    (
      await finHttp(
        '/payments/' + intent.id + '/verify',
        verifyBody(intent.revision),
      )
    ).status,
    403,
  );
  assert.equal(await FinanceTransaction.countDocuments(), 0);
});
test('second authorized Finance settles once and receipt reads do not create payment', async () => {
  const fee = await assignedFee(),
    intent = await recorded(fee.id);
  const result = await finHttp(
    '/payments/' + intent.id + '/verify',
    verifyBody(intent.revision),
    finance.checker,
  );
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.json.data.status, 'settled');
  const auditCount = await FinanceAudit.countDocuments();
  for (let i = 0; i < 3; i++) {
    const r = await apiHttp('/student/me/fees', state.token);
    assert.equal(r.json.data.items[0].balanceMinor, 0);
    assert.equal(r.json.data.items[0].receipts.length, 1);
  }
  assert.equal(await FinanceTransaction.countDocuments(), 1);
  assert.equal(await FinanceAudit.countDocuments(), auditCount);
});
test('same payment verification concurrently creates one financial effect', async () => {
  const fee = await assignedFee(),
    intent = await recorded(fee.id);
  const results = await Promise.all(
    [1, 2, 3].map(() =>
      finHttp(
        '/payments/' + intent.id + '/verify',
        verifyBody(intent.revision),
        finance.checker,
      ),
    ),
  );
  assert.deepEqual(
    results.map(row => row.status),
    [200, 200, 200],
  );
  assert.equal(await FinanceTransaction.countDocuments(), 1);
});
test('same recording key retries concurrently replay one intent; conflicting reuse fails', async () => {
  const fee = await assignedFee();
  await Promise.all([recorded(fee.id), recorded(fee.id)]);
  assert.equal(await FinancePaymentIntent.countDocuments(), 1);
  assert.equal(
    (
      await finHttp(`/fees/${fee.id}/manual-payments`, {
        method: 'cash',
        reference: 'DIFFERENT',
        operationId: 'manual_payment_operation_001',
      })
    ).status,
    409,
  );
});
test('expired reservations remain held for explicit review, never silently become payment', async () => {
  const fee = await assignedFee(),
    intent = await recorded(fee.id);
  await FinancePaymentIntent.collection.updateOne(
    { _id: new (await import('mongoose')).Types.ObjectId(intent.id) },
    { $set: { expiresAt: new Date(0) } },
  );
  const queue = await finHttp('/reconciliation');
  assert.equal(queue.json.data.items[0].expired, true);
  assert.equal((await finHttp('/fees/' + fee.id)).json.data.availableMinor, 0);
  assert.equal(await FinanceTransaction.countDocuments(), 0);
});
test('inactive/revoked actors and removed action permission cannot mutate money', async () => {
  const fee = await assignedFee();
  await User.updateOne(
    { _id: finance.maker.user._id },
    { $set: { isActive: false } },
  );
  assert.equal((await finHttp('/payments')).status, 401);
  await User.updateOne(
    { _id: finance.maker.user._id },
    { $set: { isActive: true } },
  );
  await Session.updateOne(
    { token: finance.maker.token },
    { $set: { isRevoked: true } },
  );
  assert.equal((await finHttp('/payments')).status, 401);
  const permissions = [...ROLE_PERMISSIONS.finance];
  ROLE_PERMISSIONS.finance = permissions.filter(
    p => p !== PERMISSIONS.PAYMENT_RECORD,
  );
  try {
    assert.equal(
      (
        await finHttp(
          `/fees/${fee.id}/manual-payments`,
          {
            method: 'cash',
            reference: 'DENIED',
            operationId: 'permission_denied_operation',
          },
          finance.checker,
        )
      ).status,
      403,
    );
  } finally {
    ROLE_PERMISSIONS.finance = permissions;
  }
});
test('unknown fees/payments and unsupported refunds/adjustments are forbidden', async () => {
  assert.equal((await finHttp('/fees/' + oid())).status, 403);
  assert.equal(
    (
      await finHttp(
        '/payments/' + oid() + '/verify',
        verifyBody(1),
        finance.checker,
      )
    ).status,
    403,
  );
  assert.equal((await finHttp('/refunds', { amountMinor: 1 })).status, 403);
});
test('legacy mutable Fee fields do not define live financial truth', async () => {
  await assignedFee();
  await put(LegacyFee, {
    branchId: state.branch._id,
    studentId: state.student._id,
    amount: 999999,
    paidAmount: 999999,
    status: 'paid',
  });
  const summary = await getBranchFeeSummary(String(state.branch._id));
  assert.equal(summary.totalAmount, 300);
  assert.equal(summary.paidAmount, 0);
  assert.equal(summary.legacyUnmigratedCount, 1);
  assert.equal(
    (await apiHttp('/student/me/fees', state.token)).json.data
      .legacyUnmigratedCount,
    1,
  );
  assert.equal(
    (await parentHttp(`/children/${state.student._id}/fees`)).json.data
      .legacyUnmigratedCount,
    1,
  );
});
