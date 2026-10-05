import { setAccessToken, clearAccessToken } from './authSession';
import { authRequest } from './authRequest';

export async function login(email, password) {
  if (!email?.trim() || !password) throw new Error('Enter your email and password.');
  const data = await authRequest('/auth/login', {
    method: 'POST', body: JSON.stringify({ email: email.trim(), password }),
  }, false);
  if (!data?.token || !data?.user?.id) throw new Error('The school API returned an invalid session.');
  setAccessToken(data.token, data.expiresAt);
  try {
    if (data.user.role === 'student') await authRequest('/students/me');
    return data.user;
  } catch (error) {
    await logout();
    throw error;
  }
}

export async function validateSession() { return authRequest('/auth/me'); }

export async function logout() {
  // Capture the bearer header before clearing locally, including when offline.
  const pending = authRequest('/auth/logout', { method: 'POST' });
  clearAccessToken();
  try { await pending; return { revoked: true }; }
  catch { return { revoked: false }; }
}
