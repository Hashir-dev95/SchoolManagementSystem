import { financeService } from '../src/services/finance/financeService';
import { apiClient } from '../src/services/api/apiClient';
jest.mock('../src/services/api/apiClient', () => ({
  apiClient: { request: jest.fn() },
}));
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(apiClient.request)
    .mockResolvedValue({ data: { value: 'server' } });
});
test.each([
  'summary',
  'fees',
  'payments',
  'reconciliation',
  'structures',
  'students',
] as const)('%s uses authenticated own-Branch contract', async method => {
  expect(await financeService[method]('real-finance-token')).toEqual({
    value: 'server',
  });
  expect(apiClient.request).toHaveBeenCalledWith('/finance/me/' + method, {
    token: 'real-finance-token',
  });
});
test('manual recording supplies reference/key but never a client amount or paid flag', async () => {
  const body = {
    method: 'bank_transfer' as const,
    reference: 'BANK-001',
    operationId: 'stable_operation_001',
  };
  await financeService.record('token', 'fee/id', body);
  expect(apiClient.request).toHaveBeenCalledWith(
    '/finance/me/fees/fee%2Fid/manual-payments',
    { token: 'token', method: 'POST', body },
  );
});
test('verification and rejection use explicit revision/note/idempotency inputs', async () => {
  const body = {
    revision: 1,
    reviewNote: 'Independently verified',
    operationId: 'stable_verify_001',
  };
  await financeService.verify('token', 'intent', body);
  await financeService.verify('token', 'intent', body, true);
  expect(apiClient.request).toHaveBeenNthCalledWith(
    1,
    '/finance/me/payments/intent/verify',
    { token: 'token', method: 'POST', body },
  );
  expect(apiClient.request).toHaveBeenNthCalledWith(
    2,
    '/finance/me/payments/intent/reject',
    { token: 'token', method: 'POST', body },
  );
});
test('errors are propagated without sample money', async () => {
  jest.mocked(apiClient.request).mockRejectedValueOnce(new Error('Forbidden'));
  await expect(financeService.fees('token')).rejects.toThrow('Forbidden');
});
