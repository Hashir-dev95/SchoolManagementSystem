import {classSubjectService as service} from '../src/services/admin/classSubjectService';
import {apiClient} from '../src/services/api/apiClient';
jest.mock('../src/services/api/apiClient', () => ({apiClient: {request: jest.fn()}}));
const api = jest.mocked(apiClient.request);
beforeEach(() => {api.mockReset(); api.mockResolvedValue({success: true, data: {}});});
test('Class, Branch and mapping identifiers are encoded and revisioned mutations use registered token', async () => {
  await service.list('token', 'class & one', 'branch', 50);
  expect(api).toHaveBeenLastCalledWith('/academic-setup/classes/class%20%26%20one/subjects?branchId=branch&offset=50', {token: 'token', method: 'GET'});
  await service.create('token', 'class', 'subject');
  expect(api.mock.calls.at(-1)?.[1]).toEqual({token: 'token', method: 'POST', body: {subjectId: 'subject'}});
  const row = {id: 'mapping', subject: {id: 'subject', name: 'Science', isActive: true}, isActive: true, revision: 2};
  await service.lifecycle('token', 'class', row, 'deactivate');
  expect(api.mock.calls.at(-1)?.[1]).toEqual({token: 'token', method: 'POST', body: {revision: 2}});
});
test('unconfirmed response and server failures cannot become success', async () => {
  api.mockResolvedValueOnce({success: false, data: {}}); await expect(service.create('token', 'class', 'subject')).rejects.toThrow('server did not confirm');
  const failure = new Error('Unavailable'); api.mockRejectedValueOnce(failure); await expect(service.options('token', 'class')).rejects.toBe(failure);
});
