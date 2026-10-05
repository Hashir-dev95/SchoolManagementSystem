import { authRequest } from './authRequest';
import { API_ROOT as API_BASE } from './apiConfig';
const API_ROOT = `${API_BASE}/students/me`;

const request = (path, options) => authRequest('/students/me' + path, options);

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
  submitHomework: (homeworkId, submission = {}) => {
    const body = new FormData();
    if (submission.text?.trim()) body.append('text', submission.text.trim());
    if (submission.uri && submission.name) {
      body.append('file', {
        uri: submission.uri,
        name: submission.name,
        type: submission.type,
      });
    }
    return request(`/homework/${encodeURIComponent(homeworkId)}/submissions`, {
      method: 'POST',
      body,
    });
  },
  getSubmissionFile: submissionId =>
    `${API_ROOT}/submissions/${encodeURIComponent(submissionId)}/file`,
};
