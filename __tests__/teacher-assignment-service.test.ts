import { teacherAssignmentService as service } from '../src/services/admin/teacherAssignmentService';
import { apiClient } from '../src/services/api/apiClient';
jest.mock('../src/services/api/apiClient', () => ({
  apiClient: { request: jest.fn() },
}));
const api = jest.mocked(apiClient.request);
beforeEach(() => {
  api.mockReset();
  api.mockResolvedValue({ success: true, data: {} });
});
test('options use encoded bounded query and registered caller token', async () => {
  await service.options('token', {
    branchId: 'branch',
    teacherId: 'teacher',
    classId: 'class',
    search: 'A & B',
    offset: 20,
  });
  expect(api).toHaveBeenCalledWith(
    '/teacher-assignments/options?branchId=branch&teacherId=teacher&classId=class&search=A%20%26%20B&offset=20',
    { token: 'token' },
  );
});
test('create sends only the existing immutable assignment contract', async () => {
  await service.create('token', {
    teacherId: 't',
    classId: 'c',
    sectionId: 's',
    subjectId: 'u',
    validFrom: '2026-01-01T00:00:00Z',
    branchId: 'spoof',
    teacherName: 'spoof',
  } as any);
  expect(api).toHaveBeenCalledWith('/teacher-assignments', {
    token: 'token',
    method: 'POST',
    body: {
      teacherId: 't',
      classId: 'c',
      sectionId: 's',
      subjectId: 'u',
      validFrom: '2026-01-01T00:00:00Z',
    },
  });
});
test('history is paged and revoke uses existing PATCH with no ownership payload', async () => {
  await service.history('token', 'teacher', 20);
  expect(api).toHaveBeenCalledWith(
    '/teacher-assignments/teachers/teacher?offset=20',
    { token: 'token' },
  );
  await service.revoke('token', 'assignment');
  expect(api).toHaveBeenCalledWith('/teacher-assignments/assignment/revoke', {
    token: 'token',
    method: 'PATCH',
    body: {},
  });
});
test('server errors propagate without optimistic success or authority changes', async () => {
  const failure = new Error('Scope unavailable');
  api.mockRejectedValue(failure);
  await expect(service.options('token', {})).rejects.toBe(failure);
});
