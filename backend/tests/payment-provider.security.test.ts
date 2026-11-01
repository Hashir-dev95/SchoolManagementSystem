import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  state,
  parentState,
  assignedFee,
  parentHttp,
  oid,
  signedProvider,
  signedEvent,
  finHttp,
  finance,
  put,
  apiHttp,
} from './helpers/finance.fixture';
import {
  startParentCheckout,
  processProviderCallback,
} from '../src/services/finance-payment.service';
import {
  FinanceTransaction,
  FinanceProviderObservation,
  FinancePaymentIntent,
  FeeObligation,
  FinanceAudit,
} from '../src/models/finance';
import express from 'express';
import { createProviderCallbackRouter } from '../src/routes/finance.routes';
import { RequestContractError } from '../src/utils/request-validation';
import type { ProviderEvent } from '../src/services/payment-provider';

async function checkout() {
  const fee = await assignedFee();
  return startParentCheckout(
    { userId: String(parentState.parent._id), role: 'parent' },
    parentState.token,
    String(state.student._id),
    fee.id,
    { operationId: 'parent_checkout_operation_001' },
    signedProvider,
  );
}

test('provider audit failure rolls back transaction, receipt and settled intent together', async t => {
  const intent = await checkout(),
    event = signedEvent(intent);
  const revision = (await FeeObligation.findById(intent.feeId))!.revision;
  t.mock.method(FinanceAudit, 'create', async () => {
    throw new Error('injected audit failure');
  });
  await assert.rejects(
    processProviderCallback(event.raw, event.headers, signedProvider),
    /injected audit failure/,
  );
  assert.equal(await FinanceTransaction.countDocuments(), 0);
  assert.equal(
    await FinanceAudit.countDocuments({ action: 'provider.paid' }),
    0,
  );
  assert.equal(
    (await FinancePaymentIntent.findById(intent.id))!.status,
    'reconciliation_required',
  );
  assert.equal(
    (await FeeObligation.findById(intent.feeId))!.revision,
    revision,
  );
  const fee = (await finHttp('/fees/' + intent.feeId)).json.data;
  assert.equal(fee.paidMinor, 0);
  assert.deepEqual(fee.receipts, []);
});

test('settled receipt identity is stable across replay and scoped read-only Student/Parent/Finance views', async () => {
  const intent = await checkout(),
    event = signedEvent(intent);
  assert.deepEqual(
    (await finHttp('/fees/' + intent.feeId)).json.data.receipts,
    [],
  );
  await processProviderCallback(event.raw, event.headers, signedProvider);
  const first = (await finHttp('/fees/' + intent.feeId)).json.data;
  assert.equal(first.status, 'paid');
  assert.equal(first.balanceMinor, 0);
  assert.equal(first.receipts.length, 1);
  const receipt = first.receipts[0];
  assert.equal(receipt.reference, 'RC-' + intent.id);
  const before = await Promise.all(
    [FinanceTransaction, FinanceAudit, FinancePaymentIntent, FeeObligation].map(
      model => model.collection.find({}).sort({ _id: 1 }).toArray(),
    ),
  );
  for (let index = 0; index < 3; index++) {
    const student = await apiHttp('/student/me/fees', state.token),
      parent = await parentHttp(`/children/${state.student._id}/fees`);
    assert.equal(student.status, 200);
    assert.equal(parent.status, 200);
    assert.deepEqual(student.json.data.items[0].receipts, first.receipts);
    assert.deepEqual(parent.json.data.items[0].receipts, first.receipts);
    assert.equal(
      (await finHttp('/fees/' + intent.feeId)).json.data.status,
      'paid',
    );
  }
  assert.deepEqual(
    await Promise.all(
      [
        FinanceTransaction,
        FinanceAudit,
        FinancePaymentIntent,
        FeeObligation,
      ].map(model => model.collection.find({}).sort({ _id: 1 }).toArray()),
    ),
    before,
  );
  assert.equal(
    (
      await parentHttp(
        `/children/${state.student._id}/fees`,
        parentState.otherToken,
      )
    ).status,
    403,
  );
  assert.equal(
    (await finHttp('/fees/' + intent.feeId, undefined, finance.foreign)).status,
    403,
  );
  assert.equal((await finHttp('/fees/' + receipt.id)).status, 403);
  assert.equal(
    (await apiHttp('/student/me/fees?receiptId=' + receipt.id, state.token))
      .status,
    403,
  );
  await processProviderCallback(event.raw, event.headers, signedProvider);
  const anotherEvent = signedEvent(intent, {
    eventId: 'another-identical-paid-event',
  });
  await processProviderCallback(
    anotherEvent.raw,
    anotherEvent.headers,
    signedProvider,
  );
  assert.deepEqual(
    (await finHttp('/fees/' + intent.feeId)).json.data.receipts,
    first.receipts,
  );
  assert.equal(await FinanceTransaction.countDocuments(), 1);
  assert.equal(
    await FinanceAudit.countDocuments({ action: 'provider.paid' }),
    1,
  );
  assert.deepEqual(Object.keys(receipt).sort(), [
    'amountLabel',
    'amountMinor',
    'id',
    'method',
    'paidAt',
    'paymentReference',
    'reference',
    'status',
  ]);
});

test('verification authenticates before trusting shape and rejects malformed normalized evidence', async () => {
  const intent = await checkout(),
    event = signedEvent(intent);
  const normalized = JSON.parse(event.raw.toString()) as ProviderEvent;
  for (const bad of [
    null,
    [],
    { ...normalized, amountMinor: '30000' },
    { ...normalized, amountMinor: 30001 },
    { ...normalized, state: 'success' },
    { ...normalized, transactionRef: { $ne: null } },
    { ...normalized, provider: 'injected-provider' },
    { ...normalized, branchId: String(state.foreign._id) },
  ]) {
    await assert.rejects(
      processProviderCallback(event.raw, event.headers, {
        ...signedProvider,
        verifyCallback: async () => bad as unknown as ProviderEvent,
      }),
      { status: 403 },
    );
  }
  assert.equal(await FinanceTransaction.countDocuments(), 0);
  assert.equal((await finHttp('/fees/' + intent.feeId)).json.data.paidMinor, 0);
});

test('verification outages return sanitized uncertainty without recording success or releasing a reservation', async () => {
  const intent = await checkout(),
    event = signedEvent(intent);
  await assert.rejects(
    processProviderCallback(event.raw, event.headers, {
      ...signedProvider,
      verifyCallback: async () => {
        throw new RequestContractError(503, 'private adapter details');
      },
    }),
    (error: unknown) =>
      error instanceof RequestContractError &&
      error.status === 503 &&
      !error.message.includes('private'),
  );
  assert.equal(await FinanceProviderObservation.countDocuments(), 0);
  assert.equal(await FinanceTransaction.countDocuments(), 0);
  assert.equal(
    (await FinancePaymentIntent.findById(intent.id))!.status,
    'provider_pending',
  );
});

test('missing configuration and empty/oversized evidence fail before verification', async () => {
  const intent = await checkout(),
    event = signedEvent(intent);
  await assert.rejects(
    processProviderCallback(event.raw, event.headers, {
      ...signedProvider,
      merchantId: '',
    }),
    { status: 503 },
  );
  for (const raw of [Buffer.alloc(0), Buffer.alloc(65537)])
    await assert.rejects(
      processProviderCallback(raw, event.headers, signedProvider),
      { status: 400 },
    );
  assert.equal(await FinanceProviderObservation.countDocuments(), 0);
});

test('expired but provider-paid evidence retains the hold for reconciliation without settlement', async () => {
  const intent = await checkout(),
    event = signedEvent(intent);
  await FinancePaymentIntent.collection.updateOne(
    { _id: new (await import('mongoose')).Types.ObjectId(intent.id) },
    { $set: { expiresAt: new Date(0) } },
  );
  const result = await processProviderCallback(
    event.raw,
    event.headers,
    signedProvider,
  );
  assert.equal(result.status, 'reconciliation_required');
  const revision = (await FinancePaymentIntent.findById(intent.id))!.revision;
  assert.equal(
    (await processProviderCallback(event.raw, event.headers, signedProvider))
      .status,
    'reconciliation_required',
  );
  assert.equal(
    (await FinancePaymentIntent.findById(intent.id))!.revision,
    revision,
  );
  assert.equal(await FinanceTransaction.countDocuments(), 0);
  const fee = (await finHttp('/fees/' + intent.feeId)).json.data;
  assert.equal(fee.reservedMinor, 30000);
  assert.deepEqual(fee.receipts, []);
  const review = await finHttp('/reconciliation?reason=late_capture');
  assert.equal(review.status, 200);
  assert.equal(review.json.data.items[0].classification, 'late_capture');
  assert.equal(review.json.data.items[0].reviewStatus, 'unresolved');
  const foreign = await finHttp('/reconciliation', undefined, finance.foreign);
  assert.deepEqual(foreign.json.data.items, []);
  assert.deepEqual(foreign.json.data.observations, []);
});

for (const status of ['failed', 'rejected', 'cancelled']) {
  test(`terminal/corrupt reservation ${status} is never resurrected by paid evidence`, async () => {
    const intent = await checkout(),
      event = signedEvent(intent);
    await FinancePaymentIntent.collection.updateOne(
      { _id: new (await import('mongoose')).Types.ObjectId(intent.id) },
      { $set: { status } },
    );
    assert.equal(
      (await processProviderCallback(event.raw, event.headers, signedProvider))
        .status,
      'inconsistent',
    );
    assert.equal(
      (await FinancePaymentIntent.findById(intent.id))!.status,
      status,
    );
    assert.equal(await FinanceTransaction.countDocuments(), 0);
  });
}

for (const field of [
  'actorId',
  'studentId',
  'obligationId',
  'channel',
  'provider',
]) {
  test(`verification rejects corrupt reservation ${field} mapping`, async () => {
    const intent = await checkout(),
      event = signedEvent(intent);
    const value =
      field === 'actorId'
        ? finance.foreign.user._id
        : field === 'studentId'
        ? state.otherStudent._id
        : field === 'obligationId'
        ? oid()
        : field === 'channel'
        ? 'manual'
        : 'another-provider';
    await FinancePaymentIntent.collection.updateOne(
      { _id: new (await import('mongoose')).Types.ObjectId(intent.id) },
      { $set: { [field]: value } },
    );
    await assert.rejects(
      processProviderCallback(event.raw, event.headers, signedProvider),
      { status: 403 },
    );
    assert.equal(await FinanceTransaction.countDocuments(), 0);
  });
}

test('one provider transaction cannot verify/credit two unrelated reservations', async () => {
  const first = await checkout(),
    event = signedEvent(first);
  await processProviderCallback(event.raw, event.headers, signedProvider);
  const source = await FeeObligation.findById(first.feeId).lean();
  const secondFee = await put(FeeObligation, {
    ...source,
    _id: oid(),
    structureId: oid(),
    challanReference: 'SECOND-PROVIDER-FEE',
  });
  const second = await startParentCheckout(
    { userId: String(parentState.parent._id), role: 'parent' },
    parentState.token,
    String(state.student._id),
    String(secondFee._id),
    { operationId: 'second_provider_checkout_001' },
    {
      ...signedProvider,
      checkout: async () => ({
        transactionRef: 'txn-' + first.id,
        url: 'https://provider.test/checkout',
      }),
    },
  );
  const reused = signedEvent(second, {
    transactionRef: 'txn-' + first.id,
    eventId: 'second-transaction-reuse',
  });
  await assert.rejects(
    processProviderCallback(reused.raw, reused.headers, signedProvider),
    { status: 409 },
  );
  assert.equal(await FinanceTransaction.countDocuments(), 1);
  assert.equal((await finHttp('/fees/' + second.feeId)).json.data.paidMinor, 0);
  const review = await finHttp('/reconciliation?reason=conflicting_effect');
  assert.equal(review.status, 200);
  assert.equal(review.json.data.items[0].id, second.id);
  assert.equal(review.json.data.items[0].classification, 'conflicting_effect');
});

test('event replay binds merchant identity and completed replay requires its actual matching transaction', async () => {
  const intent = await checkout(),
    event = signedEvent(intent);
  await processProviderCallback(event.raw, event.headers, signedProvider);
  const changed = signedEvent(intent, { merchantId: 'rotated-merchant' });
  await assert.rejects(
    processProviderCallback(changed.raw, changed.headers, {
      ...signedProvider,
      merchantId: 'rotated-merchant',
    }),
    { status: 409 },
  );
  await FinanceTransaction.deleteMany({});
  await assert.rejects(
    processProviderCallback(event.raw, event.headers, signedProvider),
    { status: 503 },
  );
});
test('Parent reservation rejects unlinked children, foreign fees and wrong roles before provider interaction', async () => {
  const fee = await assignedFee();
  let attempts = 0;
  const provider = {
    ...signedProvider,
    checkout: async () => {
      attempts++;
      return {
        transactionRef: 'UNEXPECTED',
        url: 'https://provider.test/unexpected',
      };
    },
  };
  const start = (
    childId: string,
    identity = {
      userId: String(parentState.parent._id),
      role: 'parent' as const,
    },
    token = parentState.token,
  ) =>
    startParentCheckout(
      identity,
      token,
      childId,
      fee.id,
      { operationId: 'parent_scope_reservation_001' },
      provider,
    );
  await assert.rejects(start(String(state.otherStudent._id)), { status: 403 });
  await assert.rejects(
    startParentCheckout(
      { userId: String(finance.maker.user._id), role: 'finance' },
      finance.maker.token,
      String(state.student._id),
      fee.id,
      { operationId: 'wrong_role_reservation_001' },
      provider,
    ),
    { status: 403 },
  );
  await FeeObligation.collection.updateOne(
    { _id: new (await import('mongoose')).Types.ObjectId(fee.id) },
    { $set: { branchId: state.foreign._id } },
  );
  await assert.rejects(start(String(state.student._id)), { status: 403 });
  assert.equal(attempts, 0);
  assert.equal(await FinancePaymentIntent.countDocuments(), 0);
  assert.equal(await FinanceTransaction.countDocuments(), 0);
});
test('production checkout is honestly disabled and never fabricates successful payment', async () => {
  const fee = await assignedFee();
  assert.equal(
    (
      await parentHttp(
        `/children/${state.student._id}/fees/${fee.id}/checkout`,
        parentState.token,
        { operationId: 'parent_checkout_operation_001' },
      )
    ).status,
    503,
  );
  assert.equal(await FinancePaymentIntent.countDocuments(), 0);
  assert.equal(await FinanceTransaction.countDocuments(), 0);
});
test('server reservation controls checkout amount and same idempotency key replays one intent', async () => {
  const intent = await checkout();
  assert.equal(intent.amountMinor, 30000);
  assert.equal(intent.status, 'provider_pending');
  const retry = await startParentCheckout(
    { userId: String(parentState.parent._id), role: 'parent' },
    parentState.token,
    String(state.student._id),
    intent.feeId,
    { operationId: 'parent_checkout_operation_001' },
    signedProvider,
  );
  assert.equal(retry.id, intent.id);
  assert.equal(await FinancePaymentIntent.countDocuments(), 1);
});
test('client lower amount and self-paid fields cannot enter checkout contract', async () => {
  const fee = await assignedFee();
  assert.equal(
    (
      await parentHttp(
        `/children/${state.student._id}/fees/${fee.id}/checkout`,
        parentState.token,
        {
          amountMinor: 1,
          status: 'paid',
          operationId: 'parent_checkout_operation_001',
        },
      )
    ).status,
    400,
  );
});
test('provider timeout keeps one reservation and retries do not create another checkout', async () => {
  const fee = await assignedFee();
  let attempts = 0;
  const provider = {
    ...signedProvider,
    checkout: async () => {
      attempts++;
      throw new Error('Provider timeout');
    },
  };
  const start = () =>
    startParentCheckout(
      { userId: String(parentState.parent._id), role: 'parent' },
      parentState.token,
      String(state.student._id),
      fee.id,
      { operationId: 'timeout_checkout_operation_001' },
      provider,
    );
  const first = await start();
  assert.equal(first.status, 'reconciliation_required');
  assert.equal((await start()).id, first.id);
  assert.equal(attempts, 1);
  assert.equal((await finHttp('/fees/' + fee.id)).json.data.availableMinor, 0);
  assert.equal(await FinanceTransaction.countDocuments(), 0);
  const review = await finHttp('/reconciliation?reason=provider_uncertain');
  assert.equal(review.status, 200);
  assert.equal(review.json.data.items[0].id, first.id);
  assert.equal(review.json.data.items[0].classification, 'provider_uncertain');
});

test('consistent settled replay is absent from unresolved queue and available as already_resolved', async () => {
  const intent = await checkout(),
    event = signedEvent(intent);
  await processProviderCallback(event.raw, event.headers, signedProvider);
  const before = await FinanceTransaction.findOne({
    intentId: intent.id,
  }).lean();
  await processProviderCallback(event.raw, event.headers, signedProvider);
  assert.deepEqual((await finHttp('/reconciliation')).json.data.items, []);
  const resolved = await finHttp('/reconciliation?reason=already_resolved');
  assert.equal(resolved.status, 200);
  assert.equal(resolved.json.data.items[0].reviewStatus, 'resolved');
  assert.equal(resolved.json.data.items[0].id, intent.id);
  assert.equal(
    (await FinanceTransaction.findOne({ intentId: intent.id }))!
      .receiptReference,
    before!.receiptReference,
  );
  assert.equal(await FinanceTransaction.countDocuments(), 1);
});
test('signed non-string event identifiers cannot inject a database selector', async () => {
  const intent = await checkout(),
    event = signedEvent(intent, {
      eventId: { $ne: null } as unknown as string,
    });
  await assert.rejects(
    processProviderCallback(event.raw, event.headers, signedProvider),
    { status: 403 },
  );
  assert.equal(await FinanceProviderObservation.countDocuments(), 0);
  assert.equal(await FinanceTransaction.countDocuments(), 0);
});
test('valid server-verified callback settles once under concurrent duplicate delivery', async () => {
  const intent = await checkout(),
    event = signedEvent(intent);
  const results = await Promise.all(
    [1, 2, 3].map(() =>
      processProviderCallback(event.raw, event.headers, signedProvider),
    ),
  );
  assert.deepEqual(
    results.map(r => r.status),
    ['settled', 'settled', 'settled'],
  );
  assert.equal(await FinanceTransaction.countDocuments(), 1);
  assert.equal(
    (await finHttp('/fees/' + intent.feeId)).json.data.balanceMinor,
    0,
  );
});
test('invalid signature cannot credit money', async () => {
  const intent = await checkout(),
    event = signedEvent(intent);
  await assert.rejects(
    processProviderCallback(
      event.raw,
      { 'x-test-signature': 'wrong' },
      signedProvider,
    ),
    { status: 403 },
  );
  assert.equal(await FinanceTransaction.countDocuments(), 0);
});
test('raw HTTP callback verification rejects invalid signatures and settles a signed event once', async () => {
  const intent = await checkout(),
    event = signedEvent(intent);
  const callbackApp = express();
  callbackApp.use('/provider', createProviderCallbackRouter(signedProvider));
  const server = callbackApp.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  try {
    const send = (signature: string) =>
      fetch(`http://127.0.0.1:${address.port}/provider/callback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-test-signature': signature,
        },
        body: event.raw.toString(),
      });
    assert.equal((await send('invalid')).status, 403);
    const replies = await Promise.all([
      send(event.headers['x-test-signature']),
      send(event.headers['x-test-signature']),
    ]);
    assert.deepEqual(
      replies.map(reply => reply.status),
      [200, 200],
    );
    assert.equal(await FinanceTransaction.countDocuments(), 1);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
test('a signed event ID cannot be replayed with a different state', async () => {
  const intent = await checkout(),
    event = signedEvent(intent);
  await processProviderCallback(event.raw, event.headers, signedProvider);
  const changed = signedEvent(intent, { state: 'failed' });
  await assert.rejects(
    processProviderCallback(changed.raw, changed.headers, signedProvider),
    { status: 409 },
  );
  assert.equal(await FinanceTransaction.countDocuments(), 1);
});
for (const override of [
  { amountMinor: 1 },
  { currency: 'USD' },
  { merchantId: 'foreign-merchant' },
  { transactionRef: 'other-transaction' },
]) {
  test(`signed but mismatched provider data ${JSON.stringify(
    override,
  )} is denied`, async () => {
    const intent = await checkout(),
      event = signedEvent(intent, override);
    await assert.rejects(
      processProviderCallback(event.raw, event.headers, signedProvider),
      { status: 403 },
    );
    assert.equal(await FinanceTransaction.countDocuments(), 0);
  });
}
test('unknown order references are detected without creating a payment', async () => {
  const event = signedEvent({ id: String(oid()), amountMinor: 30000 });
  await assert.rejects(
    processProviderCallback(event.raw, event.headers, signedProvider),
    { status: 403 },
  );
  assert.equal(
    await FinanceProviderObservation.countDocuments({ outcome: 'unmatched' }),
    1,
  );
});
test('provider inconsistency after local settlement is queued without undoing or duplicating money', async () => {
  const intent = await checkout(),
    event = signedEvent(intent);
  await processProviderCallback(event.raw, event.headers, signedProvider);
  const failed = signedEvent(intent, {
    eventId: 'later-event',
    state: 'failed',
  });
  assert.equal(
    (await processProviderCallback(failed.raw, failed.headers, signedProvider))
      .status,
    'inconsistent',
  );
  assert.equal(await FinanceTransaction.countDocuments(), 1);
  assert.equal(
    (await finHttp('/reconciliation')).json.data.observations.length,
    1,
  );
});
