import { setAccessToken, clearAccessToken, getAuthHeaders } from './authSession';
import { API_ROOT } from './apiConfig';
async function request(path, options = {}) { const response = await fetch(`${API_ROOT}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), ...options.headers } }); const payload = await response.json().catch(() => null); if (!response.ok || payload?.success !== true) throw new Error(payload?.error || `Authentication request failed (${response.status}).`); return payload.data; }
export async function login(email, password) { const data = await request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }); setAccessToken(data.token); return data.user; }
export async function logout() { try { await request('/auth/logout', { method: 'POST' }); } finally { clearAccessToken(); } }
