import { apiClient, ApiError } from '../src/services/api/apiClient';
import { attendanceOversightService as service } from '../src/services/principal/attendanceOversightService';
jest.mock('../src/services/api/apiClient', () => {
  const actual = jest.requireActual('../src/services/api/apiClient');
  return { ...actual, apiClient: { request: jest.fn() } };
});
const request = jest.mocked(apiClient.request);
beforeEach(() => {
  jest.clearAllMocks();
  request.mockResolvedValue({ success: true, data: { items: [] } });
});
test('overview encodes bounded server filters and school date without Branch input', async () => {
  await service.overview('token', {
    date: '2026-10-25',
    classId: 'class/1',
    sectionId: 'section',
    subjectId: 'subject',
    teacherId: 'teacher',
    state: 'unmarked',
    search: 'Grade & A',
    offset: 20,
    mode: 'scheduled',
  });
  expect(request).toHaveBeenCalledWith(
    '/principal/attendance?date=2026-10-25&classId=class%2F1&sectionId=section&subjectId=subject&teacherId=teacher&state=unmarked&search=Grade%20%26%20A&offset=20&mode=scheduled',
    { token: 'token' },
  );
});
test('detail, context options and patterns reuse read-only endpoints with independent pagination', async () => {
  await service.detail('token', 'period/1', {
    date: '2026-10-25',
    offset: 50,
    historyOffset: 20,
    mode: 'history',
  });
  expect(request).toHaveBeenLastCalledWith(
    '/principal/attendance/occurrences/period%2F1?date=2026-10-25&offset=50&historyOffset=20&mode=history',
    { token: 'token' },
  );
  await service.filters('token', 'section', {
    classId: 'class',
    search: 'A',
    offset: 20,
  });
  expect(request).toHaveBeenLastCalledWith(
    '/principal/attendance/filters?kind=section&classId=class&search=A&offset=20',
    { token: 'token' },
  );
  await service.patterns('token', {
    from: '2026-10-01',
    until: '2026-10-25',
    classId: 'class',
    offset: 20,
  });
  expect(request).toHaveBeenLastCalledWith(
    '/principal/attendance/patterns?from=2026-10-01&until=2026-10-25&classId=class&offset=20',
    { token: 'token' },
  );
});
for (const status of [400, 401, 403, 404, 409, 500])
  test('safe feedback conceals raw backend details for ' + status, async () => {
    request.mockRejectedValue(new ApiError(status, 'Mongo INTERNAL private'));
    await expect(service.overview('token')).rejects.not.toThrow('INTERNAL');
  });
