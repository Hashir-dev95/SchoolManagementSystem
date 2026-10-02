import { getAuthHeaders } from './authSession';
import { API_ROOT as API_BASE } from './apiConfig';
const API_ROOT = `${API_BASE}/students/me`;

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      credentials: 'include',
      ...options,
      headers: {
        ...getAuthHeaders(),
        ...(options.headers ||
          (options.body instanceof FormData
            ? {}
            : { 'Content-Type': 'application/json' })),
      },
    });
  } catch {
    throw new Error(
      'Could not reach the student API. Check that the backend is running and reachable from this device.',
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

function dateQuery(filters = {}) {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  const query = params.toString();
  return query ? `?${query}` : '';
}

export const studentApi = {
  getProfile: () => request(''),
  getTimetable: () => request('/timetable'),
  getAttendance: filters => request(`/attendance${dateQuery(filters)}`),
  getResults: () => request('/results'),
  getProgress: () => request('/progress'),
  getHomework: () => request('/homework'),
  getApplications: () => request('/applications'),
  getNotifications: () => request('/notifications'),
  getNotification: notificationId =>
    request(`/notifications/${encodeURIComponent(notificationId)}`),
  markNotificationRead: notificationId =>
    request(`/notifications/${encodeURIComponent(notificationId)}/read`, {
      method: 'POST',
    }),
  submitApplication: application =>
    request('/applications', {
      method: 'POST',
      body: JSON.stringify(application),
    }),
  getSubmissions: homeworkId =>
    request(`/homework/${encodeURIComponent(homeworkId)}/submissions`),
  submitHomework: (homeworkId, asset) => {
    const body = new FormData();
    body.append('file', { uri: asset.uri, name: asset.name, type: asset.type });
    return request(`/homework/${encodeURIComponent(homeworkId)}/submissions`, {
      method: 'POST',
      body,
    });
  },
  getSubmissionFile: submissionId =>
    `${API_ROOT}/submissions/${encodeURIComponent(submissionId)}/file`,
};
