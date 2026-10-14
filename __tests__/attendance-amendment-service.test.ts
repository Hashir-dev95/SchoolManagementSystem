import { apiClient } from '../src/services/api/apiClient';
import { amendmentService } from '../src/services/teacher/amendmentService';
jest.mock('../src/services/api/apiClient', () => ({
  apiClient: { request: jest.fn() },
}));
const api = jest.mocked(apiClient);
beforeEach(() => {
  api.request
    .mockReset()
    .mockResolvedValue({ success: true, data: { state: 'pending' } });
});
test('Teacher review encodes context and explicit history page', async () => {
  await amendmentService.context('token', 'session/id', 'student/id', 20);
  expect(api.request).toHaveBeenCalledWith(
    '/teacher/attendance/sessions/session%2Fid/students/student%2Fid/review?offset=20',
    { token: 'token' },
  );
});
for (const kind of ['correction', 'leave'] as const)
  test(
    kind + ' uses typed creation route and preserves operation payload',
    async () => {
      const body = {
        clientOperationId: 'stable_operation_01',
        reason: 'Evidence is verified.',
      };
      await amendmentService.create('token', 'session', 'student', kind, body);
      expect(api.request).toHaveBeenCalledWith(
        '/teacher/attendance/sessions/session/students/student/' +
          (kind === 'correction' ? 'corrections' : 'leaves'),
        { token: 'token', method: 'POST', body },
      );
    },
  );
test('Principal decision uses typed transactional route', async () => {
  const body = {
    action: 'approved',
    revision: 1,
    reviewNote: 'Verified',
    clientOperationId: 'stable_decision_operation',
  };
  await amendmentService.decide('token', 'approval/id', body);
  expect(api.request).toHaveBeenCalledWith(
    '/attendance-review/approval%2Fid/decision',
    { token: 'token', method: 'POST', body },
  );
});
test('unconfirmed responses and transport failures never become success', async () => {
  api.request.mockResolvedValueOnce({
    success: false,
    data: { state: 'approved' },
  });
  await expect(amendmentService.review('token', 'approval')).rejects.toThrow(
    'did not confirm',
  );
  api.request.mockRejectedValueOnce(new Error('Network offline'));
  await expect(amendmentService.context('token', 's', 'p')).rejects.toThrow(
    'Network offline',
  );
});
