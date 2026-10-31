import { apiClient } from '../api/apiClient';
import type { StudentResult } from './resultService';

export interface StudentProfile {
  studentId: string;
  fullName: string;
  email: string;
  admissionNumber: string;
}
export interface StudentEnrollmentView {
  enrollmentId: string;
  status: string;
  effectiveFrom: string;
  branch: { id: string; name: string };
  schoolClass: { id: string; name: string };
  section: { id: string; name: string };
  academicPeriod: { id: string; name: string };
}
export interface StudentOccurrence {
  periodId: string;
  date: string;
  startTime: string;
  endTime: string;
  subject: string;
  teacher: string;
  room: string;
  isSubstitute: boolean;
  status?: 'present' | 'absent' | 'late' | 'leave' | null;
  state?: 'submitted' | 'in_progress' | 'unmarked';
}
export interface AssignedRead {
  id: string;
  type: 'homework' | 'quiz';
  title: string;
  instructions: string;
  publishedRevision: number;
  dueAt: string | null;
  availableFrom: string | null;
  availableUntil: string | null;
}
const read = async <T>(token: string, path: string): Promise<T> =>
  (
    await apiClient.request<{ success: boolean; data: T }>(
      `/student/me${path}`,
      { token },
    )
  ).data;

// No Student/scope selectors, writes, preview imports or data fallbacks.
export const studentWorkspaceService = {
  profile: (token: string) => read<StudentProfile>(token, ''),
  enrollment: (token: string) =>
    read<StudentEnrollmentView>(token, '/enrollment'),
  timetable: (token: string) =>
    read<{ date: string; items: StudentOccurrence[] }>(token, '/timetable'),
  attendance: (token: string) =>
    read<{ date: string; kind: 'physical'; items: StudentOccurrence[] }>(
      token,
      '/attendance',
    ),
  homework: (token: string) =>
    read<{ items: AssignedRead[]; readOnly: true }>(token, '/homework'),
  quizzes: (token: string) =>
    read<{ items: AssignedRead[]; readOnly: true }>(token, '/quizzes'),
  results: (token: string) =>
    read<{ items: StudentResult[]; total: number }>(token, '/results'),
};
