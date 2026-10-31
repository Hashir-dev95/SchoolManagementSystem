import { AcademicWorkAudience } from '../models/academicWorkAudience';
import { Homework } from '../models/homework';
import { Quiz } from '../models/quiz';
import { listStudentAcademicWork } from './academic-work.service';
import {
  listStudentResults,
  getStudentResult,
} from './academic-result.service';
import {
  resolveStudentSelf,
  studentSelfForbidden,
} from './student-self-scope.service';
import type { JwtPayload } from './jwt.service';
import { RequestContractError } from '../utils/request-validation';

/** Reuse canonical safe published DTOs, adding strict current membership gating. */
export async function getStudentAssignedReads(
  identity: JwtPayload | undefined,
  type: 'homework' | 'quiz',
) {
  const ctx = await resolveStudentSelf(identity);
  const work = await listStudentAcademicWork(identity);
  const items = [];
  for (const item of work) {
    if (
      item.type !== type ||
      item.classId !== String(ctx.enrollment.classId) ||
      item.sectionId !== String(ctx.enrollment.sectionId)
    ) {
      continue;
    }
    const workId = item.type === 'homework' ? item.homeworkId : item.quizId;
    const entitlement = await AcademicWorkAudience.exists({
      _id: item.audienceId,
      branchId: ctx.branchId,
      studentId: ctx.student._id,
      recipientUserId: ctx.actor._id,
      state: 'assigned',
      workType: type,
      workId,
      publishedRevision: item.publishedRevision,
    }).read('primary');
    if (!entitlement) {
      continue;
    }
    const filter = {
      _id: workId,
      branchId: ctx.branchId,
      classId: ctx.enrollment.classId,
      sectionId: ctx.enrollment.sectionId,
      academicYear: ctx.schoolClass.academicYear,
      status: 'published' as const,
      publishedRevision: item.publishedRevision,
    };
    const row =
      type === 'homework'
        ? await Homework.exists(filter).read('primary')
        : await Quiz.exists(filter).read('primary');
    if (!row) {
      continue;
    }
    items.push({
      id: workId,
      type: item.type,
      title: item.title,
      instructions: item.instructions,
      publishedRevision: item.publishedRevision,
      dueAt: item.type === 'homework' ? item.dueAt : null,
      availableFrom: item.type === 'quiz' ? item.availableFrom : null,
      availableUntil: item.type === 'quiz' ? item.availableUntil : null,
    });
  }
  return { items, readOnly: true as const };
}
export async function getStudentAssignedRead(
  identity: JwtPayload | undefined,
  type: 'homework' | 'quiz',
  id: string,
) {
  const data = await getStudentAssignedReads(identity, type);
  const item = data.items.find(value => value.id === id);
  if (!item) {
    throw studentSelfForbidden();
  }
  return item;
}
export async function getStudentPublishedReads(
  identity: JwtPayload | undefined,
) {
  await resolveStudentSelf(identity);
  return listStudentResults(identity);
}
export async function getStudentPublishedRead(
  identity: JwtPayload | undefined,
  id: unknown,
) {
  await resolveStudentSelf(identity);
  try {
    return await getStudentResult(identity, id);
  } catch (error) {
    if (error instanceof RequestContractError && error.status === 404) {
      throw studentSelfForbidden();
    }
    throw error;
  }
}
