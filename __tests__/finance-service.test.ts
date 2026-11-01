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

test('reconciliation serializes reason and paging through the canonical GET contract', async () => {
  await financeService.reconciliation('token', {
    reason: 'late_capture',
    offset: 0,
    limit: 25,
  });
  expect(apiClient.request).toHaveBeenCalledWith(
    '/finance/me/reconciliation?reason=late_capture&offset=0&limit=25',
    { token: 'token' },
  );
  await financeService.reconciliation('token', { reason: undefined });
  expect(apiClient.request).toHaveBeenLastCalledWith(
    '/finance/me/reconciliation',
    { token: 'token' },
  );
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

test('reservation returns authoritative server DTO and preserves its retry identity without amount fields', async () => {
  const dto = {
    id: 'intent',
    feeId: 'fee',
    amountMinor: 29000,
    amountLabel: 'SERVER RESERVED',
    currency: 'PKR',
    status: 'awaiting_verification',
    createdAt: '2026-11-01T00:00:00Z',
    expiresAt: '2026-11-01T00:30:00Z',
  };
  const body = {
    method: 'bank_transfer' as const,
    reference: 'BANK-001',
    operationId: 'reservation_retry_001',
  };
  jest
    .mocked(apiClient.request)
    .mockRejectedValueOnce(new Error('Unknown network outcome'))
    .mockResolvedValueOnce({ data: dto });
  await expect(financeService.record('token', 'fee', body)).rejects.toThrow(
    'Unknown network outcome',
  );
  expect(await financeService.record('token', 'fee', body)).toEqual(dto);
  const calls = jest.mocked(apiClient.request).mock.calls;
  expect(calls[0]).toEqual(calls[1]);
  expect(Object.keys(body).sort()).toEqual([
    'method',
    'operationId',
    'reference',
  ]);
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

test('obligation filters normalize optional values and encode search/Student/status/page', async () => {
  await financeService.fees('token', {
    search: '  Tuition  & A/B? ',
    studentId: 'student/id',
    status: 'payment_pending',
    offset: 0,
    limit: 25,
  });
  expect(apiClient.request).toHaveBeenCalledWith(
    '/finance/me/fees?search=Tuition%20%26%20A%2FB%3F&studentId=student%2Fid&status=payment_pending&offset=0&limit=25',
    { token: 'token' },
  );
  await financeService.fees('token', {
    search: '   ',
    studentId: undefined,
    status: undefined,
  });
  expect(apiClient.request).toHaveBeenLastCalledWith('/finance/me/fees', {
    token: 'token',
  });
});

test('Student search encodes literal names and paging without accepting Branch authority', async () => {
  await financeService.students('token', ' A+B / One ', 50);
  expect(apiClient.request).toHaveBeenCalledWith(
    '/finance/me/students?search=A%2BB%20%2F%20One&offset=50',
    { token: 'token' },
  );
});

test('challan lookup encodes the typed reference and returns the server DTO using GET only', async () => {
  const dto = { id: 'fee', status: 'due', balanceLabel: 'SERVER LABEL' };
  jest.mocked(apiClient.request).mockResolvedValueOnce({ data: dto });
  expect(await financeService.challan('token', ' CH-A&/ ? ')).toEqual(dto);
  expect(apiClient.request).toHaveBeenCalledWith(
    '/finance/me/fees/by-reference?reference=CH-A%26%2F%20%3F',
    { token: 'token' },
  );
});

test('collection report serializes normalized dates, Student, status, text and pagination through a GET', async () => {
  const dto = {
    summary: { amountLabel: 'SERVER TOTAL' },
    items: [],
    nextOffset: null,
  };
  jest.mocked(apiClient.request).mockResolvedValueOnce({ data: dto });
  expect(
    await financeService.collectionReport('finance-token', {
      dateFrom: ' 2024-01-01 ',
      dateTo: '2024-01-31',
      studentId: 'student/id',
      status: 'paid',
      search: ' A+B &/ ',
      offset: 0,
      limit: 25,
    }),
  ).toEqual(dto);
  expect(apiClient.request).toHaveBeenCalledWith(
    '/finance/me/collection-report?dateFrom=2024-01-01&dateTo=2024-01-31&studentId=student%2Fid&status=paid&search=A%2BB%20%26%2F&offset=0&limit=25',
    { token: 'finance-token' },
  );
  await financeService.collectionReport('finance-token', {
    search: ' ',
    dateFrom: undefined,
  });
  expect(apiClient.request).toHaveBeenLastCalledWith(
    '/finance/me/collection-report',
    { token: 'finance-token' },
  );
});

test('collection report propagates errors without substituting zero totals', async () => {
  jest
    .mocked(apiClient.request)
    .mockRejectedValueOnce(new Error('Report offline'));
  await expect(financeService.collectionReport('token')).rejects.toThrow(
    'Report offline',
  );
});
