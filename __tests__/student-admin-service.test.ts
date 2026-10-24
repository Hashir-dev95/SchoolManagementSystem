import { apiClient, ApiError } from '../src/services/api/apiClient';
import {
  studentAdminService,
  type AdmissionInput,
} from '../src/services/admin/studentAdminService';
afterEach(() => jest.restoreAllMocks());
const profile = {
  id: 'student',
  fullName: 'Ahmed Khan',
  admissionNumber: 'ST-1',
  email: 'student@example.org',
  phone: '',
  dateOfBirth: '',
  gender: '',
  guardianName: '',
  guardianPhone: '',
  address: '',
  isActive: true,
  revision: 0,
};
const body: AdmissionInput = {
  fullName: profile.fullName,
  admissionNumber: profile.admissionNumber,
  phone: '',
  dateOfBirth: '',
  gender: '',
  guardianName: '',
  guardianPhone: '',
  address: '',
  email: profile.email,
  password: 'Explicit-initial-password',
  academicPeriodId: 'period',
  classId: 'class',
  sectionId: 'section',
  operationId: 'student_request_001',
};
test('admission uses authenticated focused API and returns explicit server DTO', async () => {
  const call = jest.spyOn(apiClient, 'request').mockResolvedValue({
    success: true,
    data: { student: profile, capabilities: { editProfile: true } },
  });
  const result = await studentAdminService.admit('token', body);
  expect(call).toHaveBeenCalledWith('/students/admissions', {
    token: 'token',
    method: 'POST',
    body,
  });
  expect(result.student).toEqual(profile);
  expect(body).not.toHaveProperty('branchId');
  expect(body).not.toHaveProperty('role');
});
test('profile detail encodes ID and uses authenticated resource', async () => {
  const call = jest
    .spyOn(apiClient, 'request')
    .mockResolvedValue({ data: { student: profile } });
  await studentAdminService.profile('token', 'student/id');
  expect(call).toHaveBeenCalledWith('/students/student%2Fid/profile', {
    token: 'token',
  });
});
test('profile patch uses revision and permanent fields rather than enrollment endpoint', async () => {
  const call = jest
    .spyOn(apiClient, 'request')
    .mockResolvedValue({ data: { student: profile } });
  const fields = {
    fullName: body.fullName,
    admissionNumber: body.admissionNumber,
    phone: body.phone,
    dateOfBirth: body.dateOfBirth,
    gender: body.gender,
    guardianName: body.guardianName,
    guardianPhone: body.guardianPhone,
    address: body.address,
  };
  await studentAdminService.edit('token', 'student', {
    ...fields,
    revision: 0,
  });
  expect(call).toHaveBeenCalledWith('/students/student/profile', {
    token: 'token',
    method: 'PATCH',
    body: { ...fields, revision: 0 },
  });
});
test.each([401, 403, 404, 409, 500])(
  'server %s remains an error rather than optimistic success',
  async status => {
    const error = new ApiError(status, 'Safe server message');
    jest.spyOn(apiClient, 'request').mockRejectedValueOnce(error);
    await expect(studentAdminService.admit('token', body)).rejects.toBe(error);
  },
);
