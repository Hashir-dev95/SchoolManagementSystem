import { apiClient } from '../api/apiClient';
import type {
  StudentProfile,
  StudentEnrollmentView,
  StudentOccurrence,
  AssignedRead,
} from '../student/workspaceService';
import type { StudentResult } from '../student/resultService';
export interface VerifiedChild extends StudentProfile {
  relationship: string;
  enrollment: StudentEnrollmentView;
}
const read = async <T>(token: string, path: string) =>
  (
    await apiClient.request<{ success: boolean; data: T }>(
      `/parent/me${path}`,
      { token },
    )
  ).data;
const childPath = (id: string) => `/children/${encodeURIComponent(id)}`;
// IDs identify a requested child; the server revalidates the relationship.
export const parentService = {
  me: (token: string) => read<{ fullName: string }>(token, ''),
  children: (token: string) =>
    read<{ items: VerifiedChild[] }>(token, '/children'),
  child: (token: string, id: string) =>
    read<VerifiedChild>(token, childPath(id)),
  enrollment: (token: string, id: string) =>
    read<StudentEnrollmentView>(token, childPath(id) + '/enrollment'),
  timetable: (token: string, id: string) =>
    read<{ date: string; items: StudentOccurrence[] }>(
      token,
      childPath(id) + '/timetable',
    ),
  attendance: (token: string, id: string) =>
    read<{ date: string; kind: 'physical'; items: StudentOccurrence[] }>(
      token,
      childPath(id) + '/attendance',
    ),
  homework: (token: string, id: string) =>
    read<{ items: AssignedRead[]; readOnly: true }>(
      token,
      childPath(id) + '/homework',
    ),
  quizzes: (token: string, id: string) =>
    read<{ items: AssignedRead[]; readOnly: true }>(
      token,
      childPath(id) + '/quizzes',
    ),
  results: (token: string, id: string) =>
    read<{ items: StudentResult[]; total: number }>(
      token,
      childPath(id) + '/results',
    ),
};
