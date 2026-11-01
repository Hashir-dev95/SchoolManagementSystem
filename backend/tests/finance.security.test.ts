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

async function collectionFixture() {
  const original = await assignedFee();
  const source = await FeeObligation.findById(original.id).lean();
  await FeeObligation.deleteOne({ _id: original.id });
  const records = [];
  for (const [index, status] of [
    'due',
    'overdue',
    'partial',
    'payment_pending',
    'paid',
  ].entries()) {
    const fee = await put(FeeObligation, {
      ...source,
      _id: oid(),
      structureId: oid(),
      challanReference: `REPORT-${status}`,
      dueDate:
        status === 'due'
          ? '2099-01-01'
          : status === 'overdue'
          ? '2000-01-01'
          : `2024-01-0${index + 1}`,
      createdAt: new Date(1000 + index),
    });
    records.push(fee);
    if (status === 'partial' || status === 'paid')
      await put(FinanceTransaction, {
        branchId: state.branch._id,
        obligationId: fee._id,
        studentId: state.student._id,
        intentId: oid(),
        amountMinor: status === 'paid' ? 30000 : 1000,
        currency: 'PKR',
        method: 'cash',
        reference: 'BANK',
        receiptReference: `RC-REPORT-${status}`,
        state: 'settled',
        actorId: finance.checker.user._id,
        paidAt: new Date(
          status === 'paid' ? '2099-01-01T00:00:00Z' : '1990-01-01T00:00:00Z',
        ),
      });
    if (status === 'payment_pending')
      await put(FinancePaymentIntent, {
        branchId: state.branch._id,
        obligationId: fee._id,
        studentId: state.student._id,
        amountMinor: 30000,
        status: 'reconciliation_required',
        expiresAt: new Date(0),
      });
  }
  return records;
}

test('collection report derives own-Branch totals from canonical settled effects, excluding holds and legacy fees', async () => {
  const records = await collectionFixture();
  await put(LegacyFee, {
    branchId: state.branch._id,
    amount: 999999,
    paidAmount: 999999,
  });
  await put(FeeObligation, {
    ...records[0],
    _id: oid(),
    branchId: state.foreign._id,
    challanReference: 'FOREIGN-REPORT',
  });
  await put(FinanceTransaction, {
    branchId: state.foreign._id,
    obligationId: records[0]._id,
    studentId: state.student._id,
    intentId: oid(),
    amountMinor: 999999,
    state: 'settled',
    receiptReference: 'FOREIGN-RC',
  });
  const response = await finHttp('/collection-report');
  assert.equal(response.status, 200, JSON.stringify(response));
  assert.deepEqual(response.json.data.summary, {
    obligationCount: 5,
    amountMinor: 150000,
    paidMinor: 31000,
    balanceMinor: 119000,
    amountLabel: 'PKR 1500.00',
    paidLabel: 'PKR 310.00',
    balanceLabel: 'PKR 1190.00',
    unpaidCount: 3,
    statusCounts: {
      due: 1,
      overdue: 1,
      partial: 1,
      payment_pending: 1,
      paid: 1,
    },
  });
  assert.equal(
    response.json.data.items.some(
      (row: any) => row.challanReference === 'FOREIGN-REPORT',
    ),
    false,
  );
});

test('collection report and dues list have identical DTO/status precedence for all canonical statuses', async () => {
  await collectionFixture();
  for (const status of [
    'due',
    'overdue',
    'partial',
    'payment_pending',
    'paid',
  ]) {
    const report = await finHttp('/collection-report?status=' + status);
    const dues = await finHttp('/fees?status=' + status);
    assert.equal(report.status, 200);
    assert.deepEqual(report.json.data.items, dues.json.data.items);
    assert.equal(report.json.data.summary.obligationCount, 1);
    assert.equal(report.json.data.summary.statusCounts[status], 1);
    assert.equal(
      report.json.data.summary.paidMinor,
      dues.json.data.items[0].paidMinor,
    );
  }
});

test('collection report summary is independent of row pagination and is never a page subtotal', async () => {
  await collectionFixture();
  const first = await finHttp('/collection-report?limit=2'),
    second = await finHttp('/collection-report?limit=2&offset=2'),
    last = await finHttp('/collection-report?limit=2&offset=4');
  assert.equal(first.status, 200);
  assert.deepEqual(first.json.data.summary, second.json.data.summary);
  assert.deepEqual(first.json.data.summary, last.json.data.summary);
  assert.equal(first.json.data.nextOffset, 2);
  assert.equal(second.json.data.nextOffset, 4);
  assert.equal(last.json.data.nextOffset, null);
  assert.equal(last.json.data.items.length, 1);
  assert.notEqual(first.json.data.items[0].id, second.json.data.items[0].id);
});

test('report dates are inclusive obligation due dates, independent of issue and settled timestamps/timezone', async () => {
  await collectionFixture();
  const response = await finHttp(
    '/collection-report?dateFrom=2024-01-03&dateTo=2024-01-05',
  );
  assert.equal(response.status, 200);
  assert.equal(response.json.data.summary.obligationCount, 3);
  assert.equal(response.json.data.summary.paidMinor, 31000);
  assert.equal(
    response.json.data.filtersApplied.dateBasis,
    'obligation_due_date',
  );
  assert.equal(
    response.json.data.filtersApplied.settlementBasis,
    'all_settled',
  );
  const day = await finHttp(
    '/collection-report?dateFrom=2024-01-05&dateTo=2024-01-05',
  );
  assert.equal(day.json.data.summary.obligationCount, 1);
  assert.equal(day.json.data.summary.paidMinor, 30000);
  assert.equal(
    (await finHttp('/collection-report?dateTo=2000-01-01')).json.data.summary
      .obligationCount,
    1,
  );
});

test('report Student filter preserves historical obligations and rejects foreign/unknown Student IDs identically', async () => {
  await collectionFixture();
  await StudentEnrollment.updateOne(
    { _id: state.enrollment._id },
    { $set: { status: 'withdrawn', effectiveTo: new Date() } },
  );
  const response = await finHttp(
    '/collection-report?studentId=' + state.student._id,
  );
  assert.equal(response.status, 200);
  assert.equal(response.json.data.summary.obligationCount, 5);
  assert.equal(
    (await finHttp('/collection-report?studentId=' + state.otherStudent._id))
      .json.data.summary.obligationCount,
    0,
  );
  const foreign = await finHttp(
      '/collection-report?studentId=' + state.student._id,
      undefined,
      finance.foreign,
    ),
    unknown = await finHttp(
      '/collection-report?studentId=' + oid(),
      undefined,
      finance.foreign,
    );
  assert.equal(foreign.status, 403);
  assert.deepEqual(foreign, unknown);
});

test('report search is literal and supports title, period and issued reference; filtered-empty totals are safe zeros', async () => {
  await collectionFixture();
  for (const search of ['tuition', 'Current term', 'REPORT-paid']) {
    const response = await finHttp(
      '/collection-report?search=' + encodeURIComponent(search),
    );
    assert.equal(response.status, 200);
    assert.ok(response.json.data.summary.obligationCount > 0);
  }
  const empty = await finHttp(
    '/collection-report?search=' + encodeURIComponent('.*'),
  );
  assert.equal(empty.json.data.summary.obligationCount, 0);
  assert.equal(empty.json.data.summary.amountLabel, 'PKR 0.00');
  assert.equal(empty.json.data.summary.paidMinor, 0);
  assert.deepEqual(empty.json.data.items, []);
  assert.equal(empty.json.data.nextOffset, null);
});

test('report denies wrong roles, removed view permission, inactive actors and revoked/missing sessions', async () => {
  assert.equal(
    (await apiHttp('/finance/me/collection-report', state.token)).status,
    403,
  );
  assert.equal(
    (await apiHttp('/finance/me/collection-report', '')).status,
    401,
  );
  const permissions = [...ROLE_PERMISSIONS.finance];
  ROLE_PERMISSIONS.finance = permissions.filter(
    p => p !== PERMISSIONS.FINANCE_VIEW,
  );
  try {
    assert.equal((await finHttp('/collection-report')).status, 403);
  } finally {
    ROLE_PERMISSIONS.finance = permissions;
  }
  await User.updateOne(
    { _id: finance.maker.user._id },
    { $set: { isActive: false } },
  );
  assert.equal((await finHttp('/collection-report')).status, 401);
  await Session.updateOne(
    { token: finance.checker.token },
    { $set: { isRevoked: true } },
  );
  assert.equal(
    (await finHttp('/collection-report', undefined, finance.checker)).status,
    401,
  );
});

test('report rejects invalid dates, structured/oversized inputs, client Branch and unsupported filters', async () => {
  for (const query of [
    'dateFrom=2024-02-30',
    'dateTo=2024-1-1',
    'dateFrom=2024-02-01&dateTo=2024-01-01',
    'dateFrom=2024-01-01T00:00:00Z',
    'dateTo=a&dateTo=b',
    'search=' + 'x'.repeat(81),
    'search=a&search=b',
    'studentId=not-an-id',
    'status=confirmed',
    'limit=101',
    'offset=-1',
    'offset=10001',
  ]) {
    assert.equal(
      (await finHttp('/collection-report?' + query)).status,
      400,
      query,
    );
  }
  for (const query of [
    'branchId=' + state.foreign._id,
    'search[$ne]=x',
    'academicPeriod=arbitrary',
    'method=cash',
  ])
    assert.equal(
      (await finHttp('/collection-report?' + query)).status,
      403,
      query,
    );
});

test('collection report performs zero writes to obligations, transactions, intents, audits and enrollment', async () => {
  await collectionFixture();
  const snapshot = async () =>
    Promise.all(
      [
        FeeObligation,
        FinanceTransaction,
        FinancePaymentIntent,
        FinanceAudit,
        StudentEnrollment,
        Session,
      ].map(model => model.collection.find({}).sort({ _id: 1 }).toArray()),
    );
  const before = await snapshot();
  for (const path of [
    '/collection-report',
    '/collection-report?status=paid&limit=1',
    '/collection-report?search=REPORT-&offset=1',
  ])
    assert.equal((await finHttp(path)).status, 200);
  assert.deepEqual(await snapshot(), before);
});

test('report fails honestly on invalid ledger data instead of presenting fabricated totals', async () => {
  const records = await collectionFixture();
  await FinancePaymentIntent.collection.updateOne(
    { obligationId: records[3]._id },
    { $set: { amountMinor: 30001 } },
  );
  const response = await finHttp('/collection-report');
  assert.equal(response.status, 503);
  assert.equal(response.json.data, undefined);
});

test('Finance Student search uses canonical enrollment and minimal identity for name, admission and ID', async () => {
  await StudentEnrollment.deleteMany({ studentId: state.otherStudent._id });
  for (const term of ['Student One', 'SELF-1', String(state.student._id)]) {
    const response = await finHttp(
      '/students?search=' + encodeURIComponent(term),
    );
    assert.equal(response.status, 200);
    const row = response.json.data.items[0];
    assert.deepEqual(Object.keys(row).sort(), [
      'admissionNumber',
      'enrollment',
      'fullName',
      'id',
    ]);
    assert.equal(row.id, String(state.student._id));
    assert.deepEqual(row.enrollment, {
      id: String(state.enrollment._id),
      academicPeriod: 'Current term',
      className: 'Grade 8',
      sectionName: 'A',
    });
  }
  assert.equal(
    (await finHttp('/students?search=maker')).json.data.items.length,
    0,
  );
  assert.equal(
    (await finHttp('/students?search=Student')).json.data.items.length,
    1,
  ); // Other Student has no valid enrollment.
  await StudentEnrollment.updateOne(
    { _id: state.enrollment._id },
    { $set: { status: 'withdrawn', effectiveTo: new Date() } },
  );
  assert.equal(
    (await finHttp('/students?search=SELF-1')).json.data.items.length,
    0,
  );
});

test('Finance Student search excludes foreign Branch and non-Student identities', async () => {
  assert.equal(
    (await finHttp('/students?search=SELF-1', undefined, finance.foreign)).json
      .data.items.length,
    0,
  );
  assert.equal(
    (await apiHttp('/finance/me/students?search=SELF-1', state.token)).status,
    403,
  );
  await User.updateOne({ _id: state.user._id }, { $set: { role: 'teacher' } });
  assert.equal(
    (await finHttp('/students?search=SELF-1')).json.data.items.length,
    0,
  );
});

test('Finance search treats regex characters literally and rejects oversized/structured inputs', async () => {
  await User.updateOne(
    { _id: state.user._id },
    { $set: { fullName: 'Learner [A]+ (One)' } },
  );
  assert.equal(
    (await finHttp('/students?search=' + encodeURIComponent('[A]+'))).json.data
      .items.length,
    1,
  );
  assert.equal(
    (await finHttp('/students?search=' + encodeURIComponent('.*'))).json.data
      .items.length,
    0,
  );
  for (const query of [
    'search=' + 'x'.repeat(81),
    'search=a&search=b',
    'offset=-1',
    'offset=10001',
    'branchId=' + state.foreign._id,
  ]) {
    assert.ok(
      [400, 403].includes((await finHttp('/students?' + query)).status),
    );
  }
});

test('Student search fails closed on invalid enrollment references without using profile placement', async () => {
  // Simulate corrupt imported data; model updates correctly forbid changing
  // immutable placement and effectiveFrom fields.
  await StudentEnrollment.collection.updateOne(
    { _id: state.enrollment._id },
    { $set: { classId: oid() } },
  );
  assert.equal(
    (await finHttp('/students?search=SELF-1')).json.data.items.length,
    0,
  );
  await StudentEnrollment.collection.updateOne(
    { _id: state.enrollment._id },
    { $set: { classId: state.cls._id, effectiveFrom: new Date('2099-01-01') } },
  );
  assert.equal(
    (await finHttp('/students?search=SELF-1')).json.data.items.length,
    0,
  );
});

test('new Finance reads require current view permission and a valid Session', async () => {
  const fee = await assignedFee();
  const paths = [
    '/students?search=SELF-1',
    '/fees?status=due',
    '/fees/by-reference?reference=' + fee.challanReference,
  ];
  const permissions = [...ROLE_PERMISSIONS.finance];
  ROLE_PERMISSIONS.finance = permissions.filter(
    permission => permission !== PERMISSIONS.FINANCE_VIEW,
  );
  try {
    for (const path of paths) assert.equal((await finHttp(path)).status, 403);
  } finally {
    ROLE_PERMISSIONS.finance = permissions;
  }
  await Session.updateOne(
    { token: finance.maker.token },
    { $set: { isRevoked: true } },
  );
  for (const path of paths) assert.equal((await finHttp(path)).status, 401);
});

test('Student filtering keeps obligation history readable without active enrollment and conceals foreign IDs', async () => {
  const fee = await assignedFee();
  await StudentEnrollment.updateOne(
    { _id: state.enrollment._id },
    { $set: { status: 'withdrawn', effectiveTo: new Date() } },
  );
  assert.deepEqual(
    (await finHttp('/fees?studentId=' + state.student._id)).json.data.items.map(
      (row: any) => row.id,
    ),
    [fee.id],
  );
  assert.equal(
    (
      await finHttp(
        '/fees?studentId=' + state.student._id,
        undefined,
        finance.foreign,
      )
    ).status,
    403,
  );
  assert.equal((await finHttp('/fees?studentId=' + oid())).status, 403);
});

test('obligation text/reference searches are literal, bounded and scoped', async () => {
  const fee = await assignedFee();
  for (const term of ['tuition', 'Current term', fee.challanReference]) {
    const response = await finHttp('/fees?search=' + encodeURIComponent(term));
    assert.equal(response.status, 200);
    assert.equal(response.json.data.items[0].id, fee.id);
  }
  assert.equal(
    (await finHttp('/fees?search=' + encodeURIComponent('.*'))).json.data.items
      .length,
    0,
  );
  assert.equal(
    (
      await finHttp(
        '/fees?search=' + fee.challanReference,
        undefined,
        finance.foreign,
      )
    ).json.data.items.length,
    0,
  );
  for (const query of [
    'search=' + 'x'.repeat(81),
    'status=confirmed',
    'limit=0',
    'limit=101',
    'offset=-1',
    'status=due&status=paid',
  ]) {
    assert.equal((await finHttp('/fees?' + query)).status, 400);
  }
});

test('all canonical status filters match feeDTO precedence, with filtering before pagination', async () => {
  const original = await assignedFee();
  const source = await FeeObligation.findById(original.id).lean();
  for (const [index, status] of [
    'due',
    'overdue',
    'partial',
    'payment_pending',
    'paid',
  ].entries()) {
    const id = oid(),
      studentId = state.student._id;
    await put(FeeObligation, {
      ...source,
      _id: id,
      structureId: oid(),
      challanReference: `STATUS-${status}`,
      dueDate: status === 'overdue' ? '2000-01-01' : '2099-01-01',
      createdAt: new Date(1000 + index),
    });
    if (status === 'partial' || status === 'paid')
      await put(FinanceTransaction, {
        branchId: state.branch._id,
        obligationId: id,
        studentId,
        intentId: oid(),
        amountMinor: status === 'paid' ? 30000 : 1000,
        currency: 'PKR',
        method: 'cash',
        reference: 'TEST',
        receiptReference: `RC-STATUS-${status}`,
        state: 'settled',
        actorId: finance.checker.user._id,
        paidAt: new Date(),
      });
    if (status === 'payment_pending')
      await put(FinancePaymentIntent, {
        branchId: state.branch._id,
        obligationId: id,
        studentId,
        amountMinor: 30000,
        status: 'awaiting_verification',
        expiresAt: new Date(0),
      });
  }
  for (const status of [
    'due',
    'overdue',
    'partial',
    'payment_pending',
    'paid',
  ]) {
    const response = await finHttp(
      '/fees?status=' + status + '&search=STATUS-&limit=1',
    );
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.equal(response.json.data.items.length, 1);
    assert.equal(response.json.data.items[0].status, status);
    assert.equal(
      response.json.data.items[0].challanReference,
      `STATUS-${status}`,
    );
  }
  const first = await finHttp('/fees?search=STATUS-&limit=2');
  assert.equal(first.json.data.nextOffset, 2);
  const second = await finHttp('/fees?search=STATUS-&limit=2&offset=2');
  assert.equal(second.json.data.items.length, 2);
  assert.notEqual(first.json.data.items[0].id, second.json.data.items[0].id);
});

test('exact challan lookup is safe for unknown/foreign references and denies wrong role', async () => {
  const fee = await assignedFee(),
    path =
      '/fees/by-reference?reference=' +
      encodeURIComponent(fee.challanReference);
  const response = await finHttp(path);
  assert.equal(response.status, 200);
  assert.equal(response.json.data.id, fee.id);
  assert.equal(response.json.data.status, 'due');
  assert.equal(response.json.data.paidMinor, 0);
  const unknown = await finHttp('/fees/by-reference?reference=CH-' + oid());
  const foreign = await finHttp(path, undefined, finance.foreign);
  assert.equal(unknown.status, 404);
  assert.deepEqual(foreign, unknown);
  assert.equal((await apiHttp('/finance/me' + path, state.token)).status, 403);
  for (const query of [
    'reference=',
    'reference=' + 'x'.repeat(81),
    'reference=a&reference=b',
  ]) {
    assert.equal((await finHttp('/fees/by-reference?' + query)).status, 400);
  }
});

test('search, status filtering, paging and challan reads perform zero financial writes', async () => {
  const fee = await assignedFee();
  const snapshot = async () =>
    Promise.all(
      [
        FeeObligation,
        FinanceTransaction,
        FinancePaymentIntent,
        FinanceAudit,
      ].map(model => model.collection.find({}).sort({ _id: 1 }).toArray()),
    );
  const before = await snapshot();
  for (let i = 0; i < 2; i++) {
    assert.equal((await finHttp('/students?search=SELF-1')).status, 200);
    assert.equal((await finHttp('/fees?status=due&limit=1')).status, 200);
    assert.equal(
      (await finHttp('/fees/by-reference?reference=' + fee.challanReference))
        .status,
      200,
    );
  }
  assert.deepEqual(await snapshot(), before);
});

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
