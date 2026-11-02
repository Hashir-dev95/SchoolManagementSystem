import { inboxService } from '../src/services/notifications/inboxService';
import { apiClient } from '../src/services/api/apiClient';
jest.mock('../src/services/api/apiClient', () => ({
  apiClient: { request: jest.fn() },
}));
const request = jest.mocked(apiClient.request);
beforeEach(() =>
  request.mockReset().mockResolvedValue({ success: true, data: {} }),
);
test('generic inbox uses only canonical own routes, bounded query and operation body; no recipient selector', async () => {
  await inboxService.list('token', { status: 'unread', offset: 25, limit: 25 });
  await inboxService.get('token', 'unsafe/id');
  await inboxService.markRead('token', 'unsafe/id', 'read_operation_12345');
  expect(request.mock.calls).toEqual([
    [
      '/notifications/me?status=unread&offset=25&limit=25',
      { token: 'token', method: 'GET' },
    ],
    ['/notifications/unsafe%2Fid', { token: 'token', method: 'GET' }],
    [
      '/notifications/unsafe%2Fid/read',
      {
        token: 'token',
        method: 'POST',
        body: { clientOperationId: 'read_operation_12345' },
      },
    ],
  ]);
});
