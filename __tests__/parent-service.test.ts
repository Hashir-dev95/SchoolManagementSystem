import { parentService } from '../src/services/parent/parentService';
import { apiClient } from '../src/services/api/apiClient';
jest.mock('../src/services/api/apiClient', () => ({
  apiClient: { request: jest.fn() },
}));
beforeEach(() => jest.clearAllMocks());
test.each([
  ['me', ''],
  ['children', '/children'],
] as const)('%s uses the real Parent self endpoint', async (method, path) => {
  jest
    .mocked(apiClient.request)
    .mockResolvedValueOnce({ data: { value: 'real' } });
  expect(await parentService[method]('parent-token')).toEqual({
    value: 'real',
  });
  expect(apiClient.request).toHaveBeenCalledWith('/parent/me' + path, {
    token: 'parent-token',
  });
});
test.each([
  ['child', ''],
  ['enrollment', '/enrollment'],
  ['timetable', '/timetable'],
  ['attendance', '/attendance'],
  ['homework', '/homework'],
  ['quizzes', '/quizzes'],
  ['results', '/results'],
  ['fees', '/fees'],
] as const)(
  '%s identifies the child without supplying authorization scope',
  async (method, suffix) => {
    jest
      .mocked(apiClient.request)
      .mockResolvedValueOnce({ data: { value: 'real' } });
    await parentService[method]('parent-token', 'child/id');
    expect(apiClient.request).toHaveBeenCalledWith(
      '/parent/me/children/child%2Fid' + suffix,
      { token: 'parent-token' },
    );
  },
);
test('failures propagate without sample data or invented success', async () => {
  jest.mocked(apiClient.request).mockRejectedValueOnce(new Error('Forbidden'));
  await expect(parentService.children('parent-token')).rejects.toThrow(
    'Forbidden',
  );
});
