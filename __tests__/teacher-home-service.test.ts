import { apiClient } from '../src/services/api/apiClient';
import { homeService } from '../src/services/teacher/homeService';
jest.mock('../src/services/api/apiClient', () => ({
  apiClient: { request: jest.fn() },
}));
const api = jest.mocked(apiClient);
afterEach(() => jest.clearAllMocks());
test('Home client sends only authenticated GET without caller scope claims', async () => {
  const data = {
    teacher: { id: 't', fullName: 'Ayesha' },
    hero: { state: 'no_periods' },
  };
  api.request.mockResolvedValue({ success: true, data });
  expect(await homeService.getHome('token')).toEqual(data);
  expect(api.request).toHaveBeenCalledWith('/teacher/home', { token: 'token' });
});
test('unconfirmed server response is an error', async () => {
  api.request.mockResolvedValue({ success: false });
  await expect(homeService.getHome('token')).rejects.toThrow(
    'could not be confirmed',
  );
});
test('network failures propagate without fabricated data', async () => {
  api.request.mockRejectedValue(new Error('Network request failed'));
  await expect(homeService.getHome('token')).rejects.toThrow(
    'Network request failed',
  );
});
