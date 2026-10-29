import { apiClient, ApiError } from '../api/apiClient';
import type { AttendanceStatus } from '../teacher/attendanceService';
export type AttendanceView = 'scheduled' | 'history';
export type AttendanceState = 'unmarked' | 'in_progress' | 'submitted';
export interface AttendanceFilters {
  date?: string;
  classId?: string;
  sectionId?: string;
  subjectId?: string;
  teacherId?: string;
  state?: AttendanceState | 'needs_attention' | 'all';
  search?: string;
  offset?: number;
  mode?: AttendanceView;
}
export interface AttendanceSummary {
  date: string;
  timezone: string;
  expected: number;
  submitted: number;
  unmarked: number;
  inProgress: number;
  needsAttention: number;
}
export interface AttendanceOccurrence {
  periodId: string;
  date: string;
  versionId: string;
  classId: string;
  sectionId: string;
  subjectId: string;
  teacherId: string;
  className: string;
  sectionName: string;
  subjectName: string;
  teacherName: string;
  room: string;
  startTime: string;
  endTime: string;
  isSubstitute: boolean;
  state: AttendanceState;
  needsAttention: boolean;
  issues: string[];
  configurationIssue: boolean;
  operational: boolean;
  sessionId: string | null;
  revision: number;
  submittedAt: string | null;
}
export interface AttendanceOverview {
  date: string;
  today: string;
  timezone: string;
  mode: AttendanceView;
  summary: Omit<AttendanceSummary, 'date' | 'timezone'>;
  items: AttendanceOccurrence[];
  total: number;
  nextOffset: number | null;
}
export interface AttendanceOccurrenceDetail {
  occurrence: AttendanceOccurrence;
  timezone: string;
  counts: {
    total: number;
    present: number;
    absent: number;
    late: number;
    leave: number;
    unmarked: number;
    approvedLeave: number;
    leaveMismatch: number;
  };
  students: {
    studentId: string;
    fullName: string;
    admissionNumber: string;
    status: AttendanceStatus | null;
    originalStatus?: AttendanceStatus;
    effectiveRevision: number;
    approvedLeave: boolean;
  }[];
  nextOffset: number | null;
  amendments: {
    requestId: string;
    approvalId: string;
    studentId: string;
    kind: 'correction' | 'leave';
    state: string;
    requestedStatus?: AttendanceStatus;
    createdAt: string;
    reviewedAt?: string;
    fromDate?: string;
    untilDate?: string;
    canOpenReview?: boolean;
  }[];
  historyTotal: number;
  nextHistoryOffset: number | null;
  operationHistory: {
    action: 'draft' | 'submit';
    resultingRevision: number;
    createdAt: string;
  }[];
}
export interface AttendancePattern {
  studentId: string;
  fullName: string;
  admissionNumber: string;
  absent: number;
  late: number;
  sessions: number;
}
export interface AttendancePatterns {
  from: string;
  until: string;
  timezone: string;
  items: AttendancePattern[];
  total: number;
  nextOffset: number | null;
}
export interface AttendanceFilterPage {
  items: { id: string; label: string }[];
  total: number;
  nextOffset: number | null;
}
export type AttendanceFilterKind = 'class' | 'section' | 'subject' | 'teacher';
const query = (values: object) =>
  Object.entries(values)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(
      ([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v)),
    )
    .join('&');
async function read<T>(
  token: string,
  path: string,
  values: object,
): Promise<T> {
  try {
    return (
      await apiClient.request<{ success: boolean; data: T }>(
        '/principal/attendance' + path + '?' + query(values),
        { token },
      )
    ).data;
  } catch (error) {
    if (error instanceof ApiError) {
      if ([401, 403].includes(error.status))
        throw new Error(
          'Attendance is unavailable for your account or active Branch. Please check your permission.',
        );
      if (error.status === 404)
        throw new Error(
          'This attendance context is unavailable or outside your Branch. Refresh your selection.',
        );
      if (error.status === 400)
        throw new Error(
          'Check the school date, date range and attendance filters.',
        );
      if (error.status === 409)
        throw new Error(
          'Attendance changed. Refresh to load the latest state.',
        );
    }
    throw new Error('Unable to load attendance. Please retry.');
  }
}
export const attendanceOversightService = {
  overview: (token: string, filters: AttendanceFilters = {}) =>
    read<AttendanceOverview>(token, '', filters),
  detail: (
    token: string,
    periodId: string,
    filters: {
      date: string;
      mode?: AttendanceView;
      offset?: number;
      historyOffset?: number;
    },
  ) =>
    read<AttendanceOccurrenceDetail>(
      token,
      '/occurrences/' + encodeURIComponent(periodId),
      filters,
    ),
  filters: (
    token: string,
    kind: AttendanceFilterKind,
    filters: { search?: string; offset?: number; classId?: string } = {},
  ) => read<AttendanceFilterPage>(token, '/filters', { kind, ...filters }),
  patterns: (
    token: string,
    filters: {
      from?: string;
      until?: string;
      offset?: number;
      classId?: string;
      sectionId?: string;
      subjectId?: string;
      teacherId?: string;
    } = {},
  ) => read<AttendancePatterns>(token, '/patterns', filters),
};
