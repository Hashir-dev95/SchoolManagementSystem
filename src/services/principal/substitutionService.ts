import { apiClient } from '../api/apiClient';
export interface SubstitutionOccurrence {
  originalWindow?: { startTime: string; endTime: string; room: string };
  periodId: string;
  versionId: string;
  date: string;
  revision: string;
  className: string;
  sectionName: string;
  subjectName: string;
  startTime: string;
  endTime: string;
  room: string;
  originalTeacher: { id: string; name: string };
  substituteTeacher: { id: string; name: string } | null;
  substituteId: string | null;
  reason: string | null;
  canManage: boolean;
  history: {
    id: string;
    status: string;
    teacher: { id: string; name: string };
    reason: string | null;
    createdAt: string;
    retiredAt: string | null;
  }[];
}
export interface SubstitutionOverview {
  date: string;
  today: string;
  timezone: string;
  items: SubstitutionOccurrence[];
  nextOffset: number | null;
}
export interface SubstitutionCandidates {
  revision: string;
  policy: string;
  items: { id: string; name: string; eligibility: string }[];
  nextOffset: number | null;
}
const query = (input: Record<string, string | number | undefined>) =>
  '?' +
  Object.entries(input)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
export const substitutionService = {
  async overview(token: string, date?: string, offset = 0) {
    return (
      await apiClient.request<{ data: SubstitutionOverview }>(
        '/timetables/occurrences' + query({ date, offset }),
        { token },
      )
    ).data;
  },
  async candidates(
    token: string,
    periodId: string,
    date: string,
    search: string,
    offset = 0,
  ) {
    return (
      await apiClient.request<{ data: SubstitutionCandidates }>(
        `/timetables/occurrences/${encodeURIComponent(periodId)}/candidates` +
          query({ date, search, offset }),
        { token },
      )
    ).data;
  },
  async assign(
    token: string,
    row: SubstitutionOccurrence,
    teacherId: string,
    reason: string,
  ) {
    return apiClient.request(
      `/timetables/occurrences/${encodeURIComponent(row.periodId)}/substitute`,
      {
        token,
        method: 'POST',
        body: { date: row.date, revision: row.revision, teacherId, reason },
      },
    );
  },
  async cancel(token: string, row: SubstitutionOccurrence) {
    return apiClient.request(
      `/timetables/occurrences/${encodeURIComponent(
        row.periodId,
      )}/cancel-substitute`,
      {
        token,
        method: 'POST',
        body: { date: row.date, revision: row.revision },
      },
    );
  },
};
