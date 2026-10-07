const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  gatewayConfiguration,
  httpsUrl,
  publicGatewayConfiguration,
  statusResponse,
  validateMerchantStatus,
} = require('./parentPaymentRoutes').__test;

const configuredEnv = {
  EASYPAISA_CHECKOUT_URL: 'https://merchant.example/checkout',
  EASYPAISA_STATUS_URL: 'https://merchant.example/status',
  EASYPAISA_STORE_ID: 'store-1',
  EASYPAISA_API_KEY: 'server-secret',
  EASYPAISA_METHODS: 'card,easypaisa',
  EASYPAISA_CONFIRMED_STATUS: 'PAID',
  EASYPAISA_FAILED_STATUSES: 'FAILED,DECLINED,CANCELLED',
};

test('checkout is disabled when any merchant verification setting is missing', () => {
  assert.equal(gatewayConfiguration({}).enabled, false);
  assert.equal(
    gatewayConfiguration({ ...configuredEnv, EASYPAISA_STATUS_URL: '' }).enabled,
    false,
  );
  assert.equal(
    gatewayConfiguration({ ...configuredEnv, EASYPAISA_CONFIRMED_STATUS: '' }).enabled,
    false,
  );
});

test('public checkout config exposes methods but never merchant secrets', () => {
  const config = publicGatewayConfiguration(configuredEnv);
  assert.equal(config.enabled, true);
  assert.deepEqual(config.methods, ['card', 'easypaisa']);
  assert.equal(config.apiKey, undefined);
  assert.equal(config.storeId, undefined);
  assert.equal(config.checkoutUrl, undefined);
  assert.equal(config.statusUrl, undefined);
});

test('merchant endpoints must use HTTPS', () => {
  assert.equal(httpsUrl('http://merchant.example/checkout'), '');
  assert.equal(httpsUrl('not a url'), '');
  assert.equal(httpsUrl('https://merchant.example/checkout'), 'https://merchant.example/checkout');
});

test('only an exact matching server status can confirm payment', () => {
  const payment = {
    providerTransactionId: 'TX-1',
    orderRef: 'ORDER-1',
    currency: 'PKR',
    amount: 1250,
  };
  const config = gatewayConfiguration(configuredEnv);
  const confirmed = validateMerchantStatus(payment, {
    transactionId: 'TX-1', orderRef: 'ORDER-1', currency: 'PKR', amount: 1250, status: 'PAID',
  }, config);
  assert.equal(confirmed.confirmed, true);
  assert.equal(confirmed.failed, false);

  const pending = validateMerchantStatus(payment, {
    transactionId: 'TX-1', orderRef: 'ORDER-1', currency: 'PKR', amount: 1250, status: 'PENDING',
  }, config);
  assert.equal(pending.confirmed, false);
  assert.equal(pending.failed, false);

  const failed = validateMerchantStatus(payment, {
    transactionId: 'TX-1', orderRef: 'ORDER-1', currency: 'PKR', amount: 1250, status: 'DECLINED',
  }, config);
  assert.equal(failed.confirmed, false);
  assert.equal(failed.failed, true);
});

test('mismatched amount, order, currency, or transaction cannot confirm', () => {
  const payment = {
    providerTransactionId: 'TX-1', orderRef: 'ORDER-1', currency: 'PKR', amount: 1250,
  };
  const config = gatewayConfiguration(configuredEnv);
  assert.throws(
    () => validateMerchantStatus(payment, {
      transactionId: 'TX-1', orderRef: 'OTHER', currency: 'PKR', amount: 1250, status: 'PAID',
    }, config),
    /did not match/,
  );
});

test('receipts are hidden until the canonical payment is confirmed', () => {
  const pending = statusResponse({ _id: '1', invoiceId: 'INV-1', status: 'pending' });
  assert.equal(pending.receipt, null);
  const confirmed = statusResponse({
    _id: '1', invoiceId: 'INV-1', status: 'confirmed', receiptNumber: 'RCT-1',
    amount: 1250, currency: 'PKR', method: 'card', confirmedAt: new Date('2026-10-07T10:00:00Z'),
  });
  assert.equal(confirmed.receipt.receiptNumber, 'RCT-1');
  assert.equal(confirmed.receipt.method, 'card');
});
