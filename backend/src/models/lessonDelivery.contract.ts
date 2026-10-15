/** Phase 2 contract only. No persistence or implicit delivery transition exists.
 * Dates, approved plans and elapsed periods are never delivery evidence.
 */
export interface LessonDeliveryEvidence {
  deliveryId: string;
  branchId: string;
  teacherId: string;
  assignmentId: string;
  classId: string;
  sectionId: string;
  subjectId: string;
  academicYear: string;
  syllabusId: string;
  lessonPlanId?: string;
  lessonPlanRevision?: number;
  teachingDate: string;
  occurrence?: { periodId: string; timetableVersionId: string; date: string };
  topics: {
    unitId: string;
    syllabusTopicId: string;
    state: 'partial' | 'completed';
    evidence: string;
  }[];
  recordedAt: string;
  recordedBy: string;
  revision: number;
  clientOperationId: string;
}
// An absent accepted delivery leaves coverage pending. Corrections must append
// evidence revisions and invalidate derived projections, never rewrite history.
export type SyllabusCoverageState = 'pending' | 'partial' | 'completed';
