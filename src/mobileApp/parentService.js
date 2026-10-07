import { authRequest } from './authRequest';

async function request(path, options = {}) {
  try {
    return await authRequest(`/parents/me${path}`, options);
  } catch (error) {
    if (error.message?.startsWith('Could not reach the school API')) {
      throw new Error('Could not reach the Parent API. Check that the backend is running and reachable from this device.');
    }
    throw error;
  }
}

export const parentApi = {
  getChildren: () => request('/children'),
  getNotifications: () => request('/notifications'),
  markNotificationRead: notificationId =>
    request(`/notifications/${encodeURIComponent(notificationId)}/read`, {
      method: 'POST',
    }),
  openNotification: notificationId =>
    request(`/notifications/${encodeURIComponent(notificationId)}`),
  getNotification: notificationId =>
    request(`/notifications/${encodeURIComponent(notificationId)}`),
  getChild: childId => request(`/children/${encodeURIComponent(childId)}`),
  getAttendance: (childId, filters = {}) => {
    const query = new URLSearchParams();
    if (filters.from) query.set('from', filters.from);
    if (filters.to) query.set('to', filters.to);
    const suffix = query.toString();
    return request(
      `/children/${encodeURIComponent(childId)}/attendance${suffix ? `?${suffix}` : ''}`,
    );
  },
  getTimetable: childId =>
    request(`/children/${encodeURIComponent(childId)}/timetable`),
  getHomework: childId =>
    request(`/children/${encodeURIComponent(childId)}/homework`),
  getResults: childId =>
    request(`/children/${encodeURIComponent(childId)}/results`),
  getProgress: childId =>
    request(`/children/${encodeURIComponent(childId)}/progress`),
  getFees: childId => request(`/children/${encodeURIComponent(childId)}/fees`),
  getFeeCheckoutConfig: () => request('/payments/checkout/config'),
  createFeeCheckout: (childId, invoiceId, method) =>
    request(
      `/payments/children/${encodeURIComponent(childId)}/invoices/${encodeURIComponent(invoiceId)}/checkout`,
      { method: 'POST', body: JSON.stringify({ method }) },
    ),
  getFeePaymentStatus: paymentId =>
    request(`/payments/transactions/${encodeURIComponent(paymentId)}/status`),
  getFeedback: childId =>
    request(`/children/${encodeURIComponent(childId)}/feedback`),
  getApplications: childId =>
    request(`/children/${encodeURIComponent(childId)}/applications`),
  submitApplication: (childId, application) =>
    request(`/children/${encodeURIComponent(childId)}/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(application),
    }),
};
