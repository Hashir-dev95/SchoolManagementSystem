let accessToken = '';
export function setAccessToken(token) { accessToken = token || ''; }
export function clearAccessToken() { accessToken = ''; }
export function getAuthHeaders() { return accessToken ? { Authorization: `Bearer ${accessToken}` } : {}; }
