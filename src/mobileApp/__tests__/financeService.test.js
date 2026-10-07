jest.mock('../apiConfig', () => ({ API_ROOT: 'http://school.test/api' }));
jest.mock('../authRequest', () => ({ authRequest: jest.fn() }));

import { authRequest } from '../authRequest';
import { financeApi } from '../financeService';

beforeEach(() => {
  authRequest.mockReset();
  authRequest.mockResolvedValue({ success: true, data: [] });
});

test('pending payments use one query delimiter and encode every supported filter', async () => {
  await financeApi.getPendingPayments({
    studentId: 'STU/002 & sibling',
    from: '2026-09-01',
    to: '2026-09-30',
    method: 'bank_transfer',
    q: 'ignored',
  });

  expect(authRequest).toHaveBeenCalledWith(
    '/finance/payments?status=pending_verification&studentId=STU%2F002+%26+sibling&from=2026-09-01&to=2026-09-30&method=bank_transfer',
    {},
    true,
    true,
  );
  expect(authRequest.mock.calls[0][0].match(/\?/g)).toHaveLength(1);
});

test('confirmed payment history uses the same encoded filter contract', async () => {
  await financeApi.getPaymentHistory({
    studentId: '002',
    from: '2026-10-01',
    to: '2026-10-07',
    method: 'easypaisa',
  });

  expect(authRequest).toHaveBeenCalledWith(
    '/finance/payments?status=confirmed&studentId=002&from=2026-10-01&to=2026-10-07&method=easypaisa',
    {},
    true,
    true,
  );
  expect(authRequest.mock.calls[0][0].match(/\?/g)).toHaveLength(1);
});

test('payment queries omit empty filters without adding another delimiter', async () => {
  await financeApi.getPendingPayments({});
  await financeApi.getPaymentHistory();

  expect(authRequest.mock.calls.map(call => call[0])).toEqual([
    '/finance/payments?status=pending_verification',
    '/finance/payments?status=confirmed',
  ]);
});
