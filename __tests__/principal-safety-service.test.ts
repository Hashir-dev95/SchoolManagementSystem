import { apiClient, ApiError } from '../src/services/api/apiClient';
import {
  principalService,
  SafetyFilters,
} from '../src/services/principal/principalService';
afterEach(() => jest.restoreAllMocks());
test('safety list sends only typed filters and does not forward spoofed branch', async () => {
  const call = jest
    .spyOn(apiClient, 'request')
    .mockResolvedValue({ data: [], message: 'Listed' });
  await principalService.getSafetyAlerts('token', {
    status: 'open',
    severity: 'high',
    type: 'incident',
    branchId: 'foreign',
  } as SafetyFilters);
  expect(call).toHaveBeenCalledWith(
    '/principal/safety-alerts?status=open&severity=high&type=incident',
    { token: 'token' },
  );
});
test('safety detail and officers use scoped authenticated endpoints', async () => {
  const call = jest
    .spyOn(apiClient, 'request')
    .mockResolvedValue({ data: [], message: '' });
  await principalService.getSafetyAlert('token', 'alert');
  await principalService.getSafetyOfficers('token', 'alert');
  expect(call).toHaveBeenNthCalledWith(1, '/principal/safety-alerts/alert', {
    token: 'token',
  });
  expect(call).toHaveBeenNthCalledWith(
    2,
    '/principal/safety-alerts/alert/eligible-officers',
    { token: 'token' },
  );
});
test.each(['assign', 'resolve', 'escalate'] as const)(
  'safety %s sends only action-specific fields and uses confirmed alert',
  async action => {
    const alert = { id: 'confirmed', status: 'resolved' };
    const call = jest
      .spyOn(apiClient, 'request')
      .mockResolvedValue({ data: null, alert, message: 'Confirmed' });
    expect(
      await principalService.processSafetyAlert(
        'token',
        'alert',
        action,
        'officer',
      ),
    ).toEqual({ data: alert, message: 'Confirmed' });
    expect(call).toHaveBeenCalledWith('/principal/safety-alerts/alert', {
      method: 'PATCH',
      token: 'token',
      body: {
        action,
        ...(action === 'assign' ? { assignedTo: 'officer' } : {}),
      },
    });
  },
);
test.each([400, 401, 403, 404, 409])(
  'safety service preserves ApiError %s',
  async status => {
    const error = new ApiError(status, 'Denied');
    jest.spyOn(apiClient, 'request').mockRejectedValue(error);
    await expect(
      principalService.processSafetyAlert('token', 'alert', 'resolve'),
    ).rejects.toBe(error);
  },
);
