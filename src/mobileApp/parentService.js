import { getAuthHeaders } from './authSession';
import { API_ROOT as API_BASE } from './apiConfig';
const API_ROOT = `${API_BASE}/parents/me`;

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      credentials: 'include',
      ...options,
      headers: { ...getAuthHeaders(), ...options.headers },
    });
  } catch {
    throw new Error(
      'Could not reach the Parent API. Check that the backend is running and reachable from this device.',
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
  return payload.data;
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
  getAttendance: childId =>
    request(`/children/${encodeURIComponent(childId)}/attendance`),
  getTimetable: childId =>
    request(`/children/${encodeURIComponent(childId)}/timetable`),
  getHomework: childId =>
    request(`/children/${encodeURIComponent(childId)}/homework`),
  getResults: childId =>
    request(`/children/${encodeURIComponent(childId)}/results`),
  getFees: childId => request(`/children/${encodeURIComponent(childId)}/fees`),
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
