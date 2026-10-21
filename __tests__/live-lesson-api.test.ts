import { apiClient } from '../src/services/api/apiClient';
import { liveLessonService } from '../src/services/liveLessons/liveLessonService';
jest.mock('../src/services/api/apiClient', () => ({
  apiClient: { request: jest.fn() },
}));
test('API service uses exact authorized routes with auth only in API options', async () => {
  jest.mocked(apiClient.request).mockResolvedValue({ success: true, data: {} });
  await liveLessonService.startLesson('auth', 'period', '2026-10-20');
  await liveLessonService.getJoinToken('auth', 'session');
  await liveLessonService.endLesson('auth', 'session');
  expect(apiClient.request).toHaveBeenNthCalledWith(
    1,
    '/live-lessons/from-timetable/period/start',
    { token: 'auth', method: 'POST', body: { date: '2026-10-20' } },
  );
  expect(apiClient.request).toHaveBeenNthCalledWith(
    2,
    '/live-lessons/session/join-token',
    { token: 'auth', method: 'POST', body: {} },
  );
  expect(apiClient.request).toHaveBeenNthCalledWith(
    3,
    '/live-lessons/session/end',
    { token: 'auth', method: 'POST', body: {} },
  );
});
