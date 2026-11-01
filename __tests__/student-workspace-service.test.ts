import { studentWorkspaceService as service } from '../src/services/student/workspaceService';
import { apiClient } from '../src/services/api/apiClient';
jest.mock('../src/services/api/apiClient', () => ({
  apiClient: { request: jest.fn() },
}));
beforeEach(() => jest.clearAllMocks());
test.each([
  ['profile', ''],
  ['enrollment', '/enrollment'],
  ['timetable', '/timetable'],
  ['attendance', '/attendance'],
  ['homework', '/homework'],
  ['quizzes', '/quizzes'],
  ['results', '/results'],
  ['fees', '/fees'],
] as const)(
  '%s uses only the self endpoint and real token',
  async (method, path) => {
    jest
      .mocked(apiClient.request)
      .mockResolvedValueOnce({ success: true, data: { value: 'server data' } });
    expect(await service[method]('session-token')).toEqual({
      value: 'server data',
    });
    expect(apiClient.request).toHaveBeenCalledWith('/student/me' + path, {
      token: 'session-token',
    });
  },
);
test('API errors propagate without preview or fabricated data', async () => {
  jest.mocked(apiClient.request).mockRejectedValueOnce(new Error('Forbidden'));
  await expect(service.profile('session-token')).rejects.toThrow('Forbidden');
});
