jest.mock('../apiConfig', () => ({ API_ROOT: 'http://school.test/api' }));
import { login, logout, validateSession } from '../authService';
import { studentApi } from '../studentService';
import { clearAccessToken, setAccessToken, getAuthHeaders, subscribeSessionExpiry, checkSessionExpiry } from '../authSession';

const reply = (status, data) => ({ ok: status < 400, status, json: async () => data });
beforeEach(() => { clearAccessToken(); global.fetch = jest.fn(); });
afterEach(() => { clearAccessToken(); jest.restoreAllMocks(); });

test('login sends credentials without a stale bearer and verifies the linked profile', async () => {
  setAccessToken('old');
  fetch.mockResolvedValueOnce(reply(200, { success: true, data: { token: 'new', user: { id: 'account', role: 'student' } } }))
    .mockResolvedValueOnce(reply(200, { success: true, data: { id: '002' } }));
  await expect(login(' student@school.test ', 'test-only')).resolves.toEqual({ id: 'account', role: 'student' });
  expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  expect(JSON.parse(fetch.mock.calls[0][1].body).email).toBe('student@school.test');
  expect(fetch.mock.calls[1][0]).toBe('http://school.test/api/students/me');
  expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer new');
});

test('missing linked profile rejects login and revokes the issued session', async () => {
  fetch.mockResolvedValueOnce(reply(200, { success: true, data: { token: 'new', user: { id: 'account', role: 'student' } } }))
    .mockResolvedValueOnce(reply(403, { success: false, error: 'No student record is linked to this user.' }))
    .mockResolvedValueOnce(reply(200, { success: true }));
  await expect(login('student@school.test', 'test-only')).rejects.toThrow('No student record');
  expect(fetch.mock.calls[2][1].headers.Authorization).toBe('Bearer new');
  expect(getAuthHeaders()).toEqual({});
});

test('student 401 clears the bearer and notifies the workspace', async () => {
  setAccessToken('expired');
  const listener = jest.fn(); const unsubscribe = subscribeSessionExpiry(listener);
  fetch.mockResolvedValue(reply(401, { success: false, error: 'Session is invalid or expired.' }));
  await expect(studentApi.getProfile()).rejects.toThrow('expired');
  expect(listener).toHaveBeenCalledTimes(1);
  expect(getAuthHeaders()).toEqual({}); unsubscribe();
});

test('403 does not expire a valid session', async () => {
  setAccessToken('valid');
  fetch.mockResolvedValue(reply(403, { success: false, error: 'Forbidden' }));
  await expect(studentApi.getProfile()).rejects.toThrow('Forbidden');
  expect(getAuthHeaders().Authorization).toBe('Bearer valid');
});

test('delayed old-session 401 does not clear a newer login', async () => {
  setAccessToken('old'); let resolve;
  fetch.mockImplementation(() => new Promise(done => { resolve = done; }));
  const pending = validateSession(); setAccessToken('new');
  resolve(reply(401, { success: false, error: 'Expired' }));
  await expect(pending).rejects.toThrow('Expired');
  expect(getAuthHeaders().Authorization).toBe('Bearer new');
});

test('server-provided deadline expires the local session', () => {
  const listener = jest.fn(); const unsubscribe = subscribeSessionExpiry(listener);
  setAccessToken('expired', new Date(Date.now() - 1000).toISOString());
  checkSessionExpiry(); expect(listener).toHaveBeenCalledTimes(1);
  expect(getAuthHeaders()).toEqual({}); unsubscribe();
});

test('offline logout clears immediately and resolves so the navigator exits', async () => {
  setAccessToken('valid'); fetch.mockRejectedValue(new TypeError('Network request failed'));
  const pending = logout(); expect(getAuthHeaders()).toEqual({});
  await expect(pending).resolves.toEqual({ revoked: false });
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer valid');
});

test('successful logout sends the bearer for server revocation', async () => {
  setAccessToken('valid'); fetch.mockResolvedValue(reply(200, { success: true }));
  await expect(logout()).resolves.toEqual({ revoked: true });
  expect(getAuthHeaders()).toEqual({});
});

test('connectivity errors retain the session and explain the failure', async () => {
  setAccessToken('valid'); fetch.mockRejectedValue(new TypeError('Network request failed'));
  await expect(validateSession()).rejects.toThrow('Could not reach the school API');
  expect(getAuthHeaders().Authorization).toBe('Bearer valid');
});
