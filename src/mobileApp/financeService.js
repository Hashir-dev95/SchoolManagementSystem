import { getAuthHeaders } from './authSession';
import { API_ROOT } from './apiConfig';
const NOTIFICATION_ROOT = `${API_ROOT}/finance/me/notifications`;

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      credentials: 'include',
      ...options,
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), ...options.headers },
    });
  } catch {
    throw new Error(
      `Could not reach the school API at ${API_ROOT}. Check that the backend is running and reachable from this device.`,
    );
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(
      `The API returned an unreadable response (${response.status}).`,
    );
  }
  if (!response.ok || payload.success !== true) {
    throw new Error(payload.error || `Request failed (${response.status}).`);
  }
  return payload;
}

function queryString(filters = {}) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}

export const financeApi = {
  getNotifications: async () => {
    const payload = await notificationRequest('');
    return payload.data;
  },
  getNotification: async notificationId =>
    (await notificationRequest(`/${encodeURIComponent(notificationId)}`)).data,
  markNotificationRead: async notificationId =>
    (
      await notificationRequest(`/${encodeURIComponent(notificationId)}/read`, {
        method: 'POST',
      })
    ).data,
  getSummary: filters => request(`/finance/summary${queryString(filters)}`),
  searchStudents: query =>
    request(`/finance/students${queryString({ q: query })}`),
  searchInvoices: filters =>
    request(`/finance/invoices${queryString(filters)}`),
  getDues: filters => request(`/finance/dues${queryString(filters)}`),
  verifyVoucher: code =>
    request(`/finance/vouchers/${encodeURIComponent(code)}/verify`),
  enterPayment: (payment, idempotencyKey) =>
    request('/finance/payments', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payment),
    }),
  getPendingPayments: () =>
    request('/finance/payments?status=pending_verification'),
  getPaymentHistory: () => request('/finance/payments?status=confirmed'),
  verifyPayment: paymentId =>
    request(`/finance/payments/${encodeURIComponent(paymentId)}/verify`, {
      method: 'POST',
    }),
  getReceipts: filters => request(`/finance/receipts${queryString(filters)}`),
  getReceipt: paymentId =>
    request(`/finance/receipts/${encodeURIComponent(paymentId)}`),
  getCollectionReport: filters =>
    request(`/finance/reports/collections${queryString(filters)}`),
};

async function notificationRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`${NOTIFICATION_ROOT}${path}`, {
      credentials: 'include',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
        ...options.headers,
      },
    });
  } catch {
    throw new Error('Could not reach the Finance notification API.');
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(
      `The API returned an unreadable response (${response.status}).`,
    );
  }
  if (!response.ok || payload.success !== true) {
    throw new Error(payload.error || `Request failed (${response.status}).`);
  }
  return payload;
}
