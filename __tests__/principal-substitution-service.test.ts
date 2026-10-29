import { apiClient } from '../src/services/api/apiClient';
import {
  substitutionService as service,
  type SubstitutionOccurrence,
} from '../src/services/principal/substitutionService';
jest.mock('../src/services/api/apiClient', () => ({
  apiClient: { request: jest.fn() },
}));
const request = jest.mocked(apiClient.request);
beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue({ data: { items: [] } });
});
test('overview leaves school date resolution on server', async () => {
  await service.overview('token');
  expect(request).toHaveBeenCalledWith('/timetables/occurrences?offset=0', {
    token: 'token',
  });
});
test('candidate search and occurrence IDs are encoded and pagination explicit', async () => {
  await service.candidates('token', 'p/1', '2026-10-27', 'A & B', 30);
  expect(request).toHaveBeenCalledWith(
    '/timetables/occurrences/p%2F1/candidates?date=2026-10-27&search=A%20%26%20B&offset=30',
    { token: 'token' },
  );
});
test('assignment sends only occurrence revision and bounded replacement input', async () => {
  const row = {
    periodId: 'p',
    date: '2026-10-27',
    revision: 'r',
    branchId: 'forged',
  } as unknown as SubstitutionOccurrence;
  await service.assign('token', row, 't', 'Emergency');
  expect(request).toHaveBeenCalledWith('/timetables/occurrences/p/substitute', {
    token: 'token',
    method: 'POST',
    body: {
      date: row.date,
      revision: 'r',
      teacherId: 't',
      reason: 'Emergency',
    },
  });
});
test('cancellation sends revision and date only', async () => {
  await service.cancel('token', {
    periodId: 'p',
    date: '2026-10-27',
    revision: 'r',
  } as SubstitutionOccurrence);
  expect(request).toHaveBeenCalledWith(
    '/timetables/occurrences/p/cancel-substitute',
    {
      token: 'token',
      method: 'POST',
      body: { date: '2026-10-27', revision: 'r' },
    },
  );
});
