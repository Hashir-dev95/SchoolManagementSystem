import { apiClient, ApiError } from '../src/services/api/apiClient';
import { principalService } from '../src/services/principal/principalService';

afterEach(() => jest.restoreAllMocks());

test('eligible delegates use the request-scoped GET with authentication', async () => {
  const request = jest
    .spyOn(apiClient, 'request')
    .mockResolvedValue({ data: [], message: 'Candidates' });
  expect(
    await principalService.getEligibleDelegates('token', 'request'),
  ).toEqual({ data: [], message: 'Candidates' });
  expect(request).toHaveBeenCalledWith(
    '/approval-requests/request/eligible-delegates',
    { token: 'token' },
  );
});

test('delegation reuses approval PATCH and returns the confirmed request', async () => {
  const updated = { _id: 'request', delegatedTo: 'peer' };
  const request = jest
    .spyOn(apiClient, 'request')
    .mockResolvedValue({ data: { request: updated }, message: 'Confirmed' });
  const delegation = {
    delegatedTo: 'peer',
    delegationExpiresAt: '2099-01-01T00:00:00.000Z',
  };
  expect(
    await principalService.processApproval(
      'token',
      'request',
      'delegated',
      undefined,
      delegation,
    ),
  ).toEqual({ data: updated, message: 'Confirmed' });
  expect(request).toHaveBeenCalledWith('/approval-requests/request', {
    method: 'PATCH',
    token: 'token',
    body: { action: 'delegated', ...delegation },
  });
});

test.each([400, 403, 404, 409])(
  'API errors preserve HTTP %i and backend message',
  async status => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status,
      json: async () => ({ message: 'Backend reason' }),
    } as Response);
    await expect(
      apiClient.request('/approval-requests/request'),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      apiClient.request('/approval-requests/request'),
    ).rejects.toMatchObject({ status, message: 'Backend reason' });
  },
);
