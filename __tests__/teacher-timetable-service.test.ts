import { apiClient } from '../src/services/api/apiClient';
import { timetableService } from '../src/services/teacher/timetableService';
jest.mock('../src/services/api/apiClient', () => ({
  apiClient: { request: jest.fn() },
}));
const request = jest.mocked(apiClient.request);
beforeEach(() =>
  request
    .mockReset()
    .mockResolvedValue({ success: true, data: { marker: 'exact' } }),
);
test('day/week use shared client, optional dates and exact DTO unwrapping', async () => {
  expect(await timetableService.getToday('token')).toEqual({ marker: 'exact' });
  expect(request).toHaveBeenLastCalledWith('/teacher/timetable', {
    token: 'token',
  });
  await timetableService.getToday('token', '2026-10-13');
  expect(request).toHaveBeenLastCalledWith(
    '/teacher/timetable?date=2026-10-13',
    { token: 'token' },
  );
  await timetableService.getWeek('token', '2026-10-13');
  expect(request).toHaveBeenLastCalledWith(
    '/teacher/timetable/week?start=2026-10-13',
    { token: 'token' },
  );
  await timetableService.getWeek('token');
  expect(request).toHaveBeenLastCalledWith('/teacher/timetable/week', {
    token: 'token',
  });
});
test('detail encodes IDs and actions send only date/reason, without authority claims', async () => {
  await timetableService.getPeriod('token', 'p/x', '2026-10-13');
  expect(request).toHaveBeenLastCalledWith(
    '/teacher/timetable/periods/p%2Fx?date=2026-10-13',
    { token: 'token' },
  );
  await timetableService.acknowledge('token', 'p/x', '2026-10-13');
  expect(request).toHaveBeenLastCalledWith(
    '/teacher/timetable/periods/p%2Fx/acknowledge',
    { token: 'token', method: 'POST', body: { date: '2026-10-13' } },
  );
  await timetableService.requestIssue(
    'token',
    'p/x',
    '2026-10-13',
    '  Room conflict  ',
    'operation_service_0001',
  );
  expect(request).toHaveBeenLastCalledWith(
    '/teacher/timetable/periods/p%2Fx/issues',
    {
      token: 'token',
      method: 'POST',
      body: {
        date: '2026-10-13',
        reason: 'Room conflict',
        clientOperationId: 'operation_service_0001',
      },
    },
  );
});
test('authorization/network errors propagate without false success', async () => {
  const failure = new Error('Denied');
  request.mockRejectedValue(failure);
  await expect(timetableService.getToday('token')).rejects.toBe(failure);
  await expect(
    timetableService.getPeriod('token', 'p', '2026-10-13'),
  ).rejects.toBe(failure);
  await expect(
    timetableService.acknowledge('token', 'p', '2026-10-13'),
  ).rejects.toBe(failure);
  await expect(
    timetableService.requestIssue(
      'token',
      'p',
      '2026-10-13',
      'Room',
      'operation_service_0001',
    ),
  ).rejects.toBe(failure);
});
