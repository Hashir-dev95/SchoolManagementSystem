import { apiClient } from '../api/apiClient';
import type { TeacherAssignment, TeacherTupleIds } from './teacherService';
export interface SyllabusTopic {
  topicId: string;
  title: string;
  order: number;
  outcomes: string[];
}
export interface SyllabusUnit {
  unitId: string;
  title: string;
  order: number;
  topics: SyllabusTopic[];
}
export interface PublishedSyllabus {
  syllabusId: string;
  title: string;
  academicYear: string;
  version: number;
  revision: number;
  status: 'published';
  units: SyllabusUnit[];
}
export interface AcademicContext {
  assignment: TeacherAssignment;
  teacherName: string;
  academicYear: string;
  syllabus: PublishedSyllabus | null;
}
export interface LessonDetails {
  unitId: string;
  topicIds: string[];
  teachingDate: string;
  objectives: string;
  teachingActivities: string;
  resources: string;
  notes: string;
}
export interface LessonPlan extends LessonDetails, TeacherTupleIds {
  lessonPlanId: string;
  syllabusId: string;
  academicYear: string;
  revision: number;
  state: 'draft' | 'submitted';
  submittedAt: string | null;
}
const base = '/teacher/academic';
const query = (ids: TeacherTupleIds) =>
  `classId=${encodeURIComponent(ids.classId)}&sectionId=${encodeURIComponent(
    ids.sectionId,
  )}&subjectId=${encodeURIComponent(ids.subjectId)}`;
const request = async <T>(
  token: string,
  path: string,
  method: 'GET' | 'POST' | 'PATCH' = 'GET',
  body?: unknown,
) =>
  (
    await apiClient.request<{ success: boolean; data: T }>(base + path, {
      token,
      method,
      body,
    })
  ).data;
export const academicService = {
  context: (token: string, ids: TeacherTupleIds) =>
    request<AcademicContext>(token, `/context?${query(ids)}`),
  lessons: (token: string, ids: TeacherTupleIds) =>
    request<LessonPlan[]>(token, `/lessons?${query(ids)}`),
  create: (
    token: string,
    body: LessonDetails &
      TeacherTupleIds & { syllabusId: string; clientOperationId: string },
  ) => request<LessonPlan>(token, '/lessons', 'POST', body),
  update: (
    token: string,
    id: string,
    body: LessonDetails & { revision: number; clientOperationId: string },
  ) =>
    request<LessonPlan>(
      token,
      `/lessons/${encodeURIComponent(id)}`,
      'PATCH',
      body,
    ),
  submit: (
    token: string,
    id: string,
    revision: number,
    clientOperationId: string,
  ) =>
    request<LessonPlan>(
      token,
      `/lessons/${encodeURIComponent(id)}/submit`,
      'POST',
      { revision, clientOperationId },
    ),
};
export const academicOperationId = () =>
  `lesson_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2)}_${Math.random().toString(36).slice(2)}`;
