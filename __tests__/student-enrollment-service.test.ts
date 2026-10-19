import {enrollmentService as service} from '../src/services/admin/enrollmentService';
import {apiClient} from '../src/services/api/apiClient';
jest.mock('../src/services/api/apiClient', () => ({apiClient: {request: jest.fn()}}));
const api = jest.mocked(apiClient.request);
beforeEach(() => {api.mockReset(); api.mockResolvedValue({success: true, data: {}});});
test('lists encode search, Branch and offsets; mutations carry operation identity/revision', async () => {
  await service.list('token', 'A & B', 'active', 50, 'branch'); expect(api).toHaveBeenLastCalledWith('/students?branchId=branch&search=A%20%26%20B&status=active&offset=50', {token: 'token', method: 'GET'});
  await service.mutate('token', 'student', 'withdraw', {id: 'enrollment', revision: 2} as any, {operationId: 'operation-001', reason: 'Withdrawal'}); expect(api).toHaveBeenLastCalledWith('/students/student/enrollments/enrollment/withdraw', {token: 'token', method: 'POST', body: {operationId: 'operation-001', reason: 'Withdrawal', revision: 2}});
});
test('unconfirmed response cannot become saved enrollment', async () => {api.mockResolvedValueOnce({success: false, data: {}}); await expect(service.detail('token', 'student')).rejects.toThrow('server did not confirm');});
