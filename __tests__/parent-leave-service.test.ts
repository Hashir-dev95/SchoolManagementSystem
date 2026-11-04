import { apiClient } from '../src/services/api/apiClient';
import {
  leaveApplicationService as service,
  leaveFieldErrors,
} from '../src/services/parent/leaveApplicationService';
jest.mock('../src/services/api/apiClient', () => ({
  apiClient: { request: jest.fn() },
}));
const request = jest.mocked(apiClient.request);
const fields = {
  leaveType: 'Family',
  startDate: '2026-11-04',
  endDate: '2026-11-05',
  reason: 'Private reason',
};
beforeEach(() => {
  request
    .mockReset()
    .mockResolvedValue({ success: true, data: { applicationId: 'own' } });
});
test('canonical paths encode child/application identifiers and use bearer options', async () => {
  await service.list('token', 'child/id', 25);
  expect(request).toHaveBeenLastCalledWith(
    '/parent/me/children/child%2Fid/leave-applications?offset=25&limit=25',
    { token: 'token' },
  );
  await service.detail('token', 'child', 'draft/id');
  expect(request).toHaveBeenLastCalledWith(
    '/parent/me/children/child/leave-applications/draft%2Fid',
    { token: 'token' },
  );
});
test('create and edit use different operations and preserve original expected revision', async () => {
  await service.create('token', 'child', fields, 'create-op');
  expect(request).toHaveBeenLastCalledWith(
    '/parent/me/children/child/leave-applications',
    {
      token: 'token',
      method: 'POST',
      body: { ...fields, clientOperationId: 'create-op' },
    },
  );
  await service.edit('token', 'child', 'draft', fields, 3, 'edit-op');
  expect(request).toHaveBeenLastCalledWith(
    '/parent/me/children/child/leave-applications/draft',
    {
      token: 'token',
      method: 'PATCH',
      body: { ...fields, revision: 3, clientOperationId: 'edit-op' },
    },
  );
});
test('transport failures propagate to scoped screen handling', async () => {
  request.mockRejectedValueOnce(new Error('offline'));
  await expect(service.list('token', 'child')).rejects.toThrow('offline');
});
test('field feedback validates calendar/date order without inventing catalogue or duration policy', () => {
  expect(leaveFieldErrors(fields)).toEqual({});
  expect(leaveFieldErrors({ ...fields, endDate: '2030-01-01' })).toEqual({});
  expect(
    leaveFieldErrors({ ...fields, startDate: '2026-02-30' }).startDate,
  ).toBeDefined();
  expect(
    leaveFieldErrors({ ...fields, endDate: '2026-01-01' }).endDate,
  ).toBeDefined();
  expect(leaveFieldErrors({ ...fields, reason: ' ' }).reason).toBeDefined();
});
