import { RequestContractError } from '../utils/request-validation';
export interface ProviderEvent {
  eventId: string;
  orderRef: string;
  transactionRef: string;
  merchantId: string;
  amountMinor: number;
  currency: string;
  state: 'paid' | 'pending' | 'failed';
}
export interface PaymentProvider {
  readonly enabled: boolean;
  readonly id: string;
  readonly merchantId: string;
  checkout(input: {
    orderRef: string;
    amountMinor: number;
    currency: string;
    idempotencyKey: string;
  }): Promise<{ transactionRef: string; url: string }>;
  verifyCallback(
    body: Buffer,
    headers: Record<string, unknown>,
  ): Promise<ProviderEvent>;
}
const unavailable = () =>
  new RequestContractError(
    503,
    'Online payments unavailable — provider validation pending',
  );
// No guessed merchant protocol or environment switch enables live settlement.
// A reviewed server-only adapter must implement this boundary before enabling it.
export const paymentProvider: PaymentProvider = {
  enabled: false,
  id: 'unconfigured',
  merchantId: '',
  checkout: async () => {
    throw unavailable();
  },
  verifyCallback: async () => {
    throw unavailable();
  },
};
