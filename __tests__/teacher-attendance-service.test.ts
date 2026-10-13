import { apiClient } from '../src/services/api/apiClient';
import {
  attendanceService,
  attendanceOperationId,
} from '../src/services/teacher/attendanceService';
jest.mock('../src/services/api/apiClient', () => ({
  apiClient: { request: jest.fn() },
}));
const request = jest.mocked(apiClient.request);
beforeEach(() => {
  request.mockClear();
  request.mockResolvedValue({ success: true, data: {} });
});
test('pending queue uses shared authenticated API client', async () => {
  await attendanceService.getPending('token');
  expect(request).toHaveBeenCalledWith('/teacher/attendance/pending', {
    token: 'token',
  });
});
test('occurrence and session identifiers are encoded with no authority payload', async () => {
  await attendanceService.open('token', 'period/id', '2026-10-13');
  expect(request).toHaveBeenCalledWith(
    '/teacher/attendance/occurrences/period%2Fid?date=2026-10-13',
    { token: 'token' },
  );
  await attendanceService.getSession('token', 'session/id');
  expect(request).toHaveBeenLastCalledWith(
    '/teacher/attendance/sessions/session%2Fid',
    { token: 'token' },
  );
});
test('save preserves operation, revision, roster version and explicit null marks', async () => {
  const body = {
    revision: 2,
    rosterVersion: 'hash',
    clientOperationId: 'operation_0000001',
    marks: [{ studentId: 'student', status: null }],
  };
  await attendanceService.save('token', 'session', 'draft', body);
  expect(request).toHaveBeenCalledWith(
    '/teacher/attendance/sessions/session/draft',
    { token: 'token', method: 'POST', body },
  );
});
test('operation IDs are valid and distinct', () => {
  const ids = Array.from({ length: 100 }, attendanceOperationId);
  ids.forEach(id => expect(id).toMatch(/^[A-Za-z0-9_-]{16,80}$/));
  expect(new Set(ids).size).toBe(100);
});
