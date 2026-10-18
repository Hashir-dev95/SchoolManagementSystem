import {academicSetupService as service} from '../src/services/admin/academicSetupService';
import {apiClient} from '../src/services/api/apiClient';
jest.mock('../src/services/api/apiClient', () => ({apiClient: {request: jest.fn()}}));
const api = jest.mocked(apiClient.request);
beforeEach(() => {api.mockReset(); api.mockResolvedValue({success: true, data: {}});});
test('Branch/parent/period queries are encoded and optional Principal Branch is omitted', async () => {
  await service.list('token', 'sections', {classId: 'A & B', offset: 50});
  expect(api).toHaveBeenLastCalledWith('/academic-setup/sections?classId=A%20%26%20B&offset=50', {token: 'token', method: 'GET'});
  await service.periods('token', {branchId: 'branch'});
  expect(api).toHaveBeenLastCalledWith('/academic-setup/periods?branchId=branch', {token: 'token', method: 'GET'});
});
test('revisioned lifecycle and update contracts propagate the registered token', async () => {
  await service.lifecycle('token', 'classes', {}, 'class', 'deactivate', 3);
  expect(api).toHaveBeenLastCalledWith('/academic-setup/classes/class/deactivate', {token: 'token', method: 'POST', body: {revision: 3}});
  await service.update('token', 'subjects', {}, 'subject', {name: 'Science', revision: 1});
  expect(api).toHaveBeenLastCalledWith('/academic-setup/subjects/subject', {token: 'token', method: 'PATCH', body: {name: 'Science', revision: 1}});
});
test('unconfirmed responses and network errors never become success', async () => {
  api.mockResolvedValueOnce({success: false, data: {}});
  await expect(service.create('token', 'subjects', {}, {name: 'Science'})).rejects.toThrow('server did not confirm');
  const failure = new Error('Network unavailable'); api.mockRejectedValueOnce(failure);
  await expect(service.branches('token')).rejects.toBe(failure);
});
