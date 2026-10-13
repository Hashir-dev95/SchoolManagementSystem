import { apiClient } from '../src/services/api/apiClient';
import { teacherService } from '../src/services/teacher/teacherService';
import {
  hasPermission,
  PERMISSIONS,
  ROLE_PERMISSIONS,
} from '../src/constants/permissions';
import { USER_ROLES } from '../src/constants/roles';
jest.mock('../src/services/api/apiClient', () => ({
  apiClient: { request: jest.fn() },
}));
const request = jest.mocked(apiClient.request);
beforeEach(() => {
  request.mockReset().mockResolvedValue({ success: true, data: [] });
});
test('assigned classes uses the shared authenticated client and unwraps exact data', async () => {
  expect(await teacherService.getAssignedClasses('token')).toEqual([]);
  expect(request).toHaveBeenCalledWith('/teacher/classes', { token: 'token' });
});
test('tuple detail and roster encode identifiers and send no authority claims', async () => {
  const ids = { classId: 'c/x', sectionId: 's?', subjectId: 'sub' };
  await teacherService.getAssignedClassDetail('token', ids);
  expect(request).toHaveBeenLastCalledWith(
    '/teacher/classes/c%2Fx/sections/s%3F/subjects/sub',
    { token: 'token' },
  );
  request.mockResolvedValueOnce({
    success: true,
    data: { assignment: ids, students: [] },
  });
  expect(await teacherService.getRoster('token', ids)).toEqual({
    assignment: ids,
    students: [],
  });
  expect(request).toHaveBeenLastCalledWith(
    '/teacher/classes/c%2Fx/sections/s%3F/subjects/sub/students',
    { token: 'token' },
  );
});
test('service preserves client errors', async () => {
  const error = new Error('Denied');
  request.mockRejectedValueOnce(error);
  await expect(teacherService.getAssignedClasses('token')).rejects.toBe(error);
});
test('Teacher capability has only its class grant and cannot inherit Principal authority', () => {
  expect(
    hasPermission(USER_ROLES.TEACHER, PERMISSIONS.TEACHER_CLASSES_VIEW),
  ).toBe(true);
  expect(ROLE_PERMISSIONS.teacher).toEqual([
    PERMISSIONS.TEACHER_ATTENDANCE_VIEW,
    PERMISSIONS.TEACHER_ATTENDANCE_MANAGE,
    PERMISSIONS.TEACHER_CLASSES_VIEW,
    PERMISSIONS.TEACHER_TIMETABLE_VIEW,
    PERMISSIONS.TEACHER_TIMETABLE_ACKNOWLEDGE,
    PERMISSIONS.TEACHER_TIMETABLE_ISSUE,
  ]);
  expect(
    hasPermission(USER_ROLES.PRINCIPAL, PERMISSIONS.TEACHER_CLASSES_VIEW),
  ).toBe(false);
});
