import { before, beforeEach } from 'node:test';
import crypto from 'node:crypto';
import {
  state,
  parentState,
  parentHttp,
  put,
  oid,
} from './parent-workspace.fixture';
import { apiHttp } from './student-workspace.fixture';
import User from '../../src/models/user';
import { generateAccessToken } from '../../src/services/jwt.service';
import { registerSession } from '../../src/services/session.service';
import { ensureFinanceIndexes } from '../../src/models/finance';
import type {
  PaymentProvider,
  ProviderEvent,
} from '../../src/services/payment-provider';
export { state, parentState, parentHttp, put, oid, apiHttp };
export let finance: any;
before(async () => {
  await ensureFinanceIndexes();
});
beforeEach(async () => {
  const make = async (email: string, branchId = state.branch._id) => {
    const user = await User.create({
      fullName: email,
      email: `${email}@test.invalid`,
      password: 'private-test',
      role: 'finance',
      branchId,
    });
    const token = generateAccessToken(String(user._id), 'finance');
    await registerSession(String(user._id), token, 'finance');
    return { user, token };
  };
  finance = {
    maker: await make('maker'),
    checker: await make('checker'),
    foreign: await make('foreign-finance', state.foreign._id),
  };
});
export const finHttp = (path: string, body?: unknown, actor = finance.maker) =>
  apiHttp('/finance/me' + path, actor.token, body);
export async function assignedFee() {
  const structure = await finHttp('/structures', {
    title: 'Term tuition',
    amountMinor: 30000,
    operationId: 'create_structure_operation_001',
  });
  if (structure.status !== 200) {
    throw new Error(JSON.stringify(structure));
  }
  const fee = await finHttp('/fees', {
    studentId: String(state.student._id),
    structureId: String(structure.json.data._id),
    dueDate: state.today,
    operationId: 'assign_fee_operation_001',
  });
  if (fee.status !== 200) {
    throw new Error(JSON.stringify(fee));
  }
  return fee.json.data;
}
export const signedProvider: PaymentProvider = {
  enabled: true,
  id: 'isolated-test-provider',
  merchantId: 'test-merchant',
  checkout: async input => ({
    transactionRef: 'txn-' + input.orderRef,
    url: 'https://provider.test/checkout/' + input.orderRef,
  }),
  verifyCallback: async (body, headers) => {
    const signature = crypto
      .createHmac('sha256', 'isolated-test-only')
      .update(body)
      .digest('hex');
    if (headers['x-test-signature'] !== signature) {
      throw new Error('Invalid signature');
    }
    return JSON.parse(body.toString()) as ProviderEvent;
  },
};
export function signedEvent(
  intent: any,
  overrides: Partial<ProviderEvent> = {},
) {
  const event = {
    eventId: 'event-' + String(intent.id),
    orderRef: String(intent.id),
    transactionRef: 'txn-' + intent.id,
    merchantId: signedProvider.merchantId,
    amountMinor: intent.amountMinor,
    currency: 'PKR',
    state: 'paid',
    ...overrides,
  };
  const raw = Buffer.from(JSON.stringify(event));
  return {
    raw,
    headers: {
      'x-test-signature': crypto
        .createHmac('sha256', 'isolated-test-only')
        .update(raw)
        .digest('hex'),
    },
  };
}
