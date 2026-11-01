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
} from '../src/models/finance';
import express from 'express';
import { createProviderCallbackRouter } from '../src/routes/finance.routes';

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
