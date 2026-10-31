import User from '../models/user';
import Student from '../models/student';
import Branch from '../models/branch';
import SchoolClass from '../models/schoolClass';
import Section from '../models/section';
import { AcademicPeriod } from '../models/academicPeriod';
import {
  StudentEnrollment,
  activeEnrollmentFilter,
} from '../models/studentEnrollment';
import {
  currentAcademicActor,
  requireActiveAcademicBranch,
} from './teacher-scope.service';
import type { JwtPayload } from './jwt.service';
import { RequestContractError } from '../utils/request-validation';

export const studentSelfForbidden = () =>
  new RequestContractError(
    403,
    'Student record or current enrollment is unavailable',
  );

/** Strict self-service scope. Never uses Student.classId/sectionId as placement. */
export async function resolveStudentSelf(identity: JwtPayload | undefined) {
  const actor = await currentAcademicActor(identity);
  if (actor.role !== 'student') {
    throw studentSelfForbidden();
  }
  const branchId = await requireActiveAcademicBranch(
    actor.branchId?.toString(),
  );
  const student = await Student.findOne({ isActive: true })
    .where('userId')
    .equals(actor._id)
    .where('branchId')
    .equals(branchId)
    .read('primary')
    .lean();
  if (!student) {
    throw studentSelfForbidden();
  }
  // Require exactly one current membership, including detection of corrupt duplicates.
  const enrollments = await StudentEnrollment.find({
    studentId: student._id,
    ...activeEnrollmentFilter(),
    effectiveTo: null,
  })
    .limit(2)
    .read('primary')
    .lean();
  if (enrollments.length !== 1) {
    throw studentSelfForbidden();
  }
  const enrollment = enrollments[0];
  if (String(enrollment.branchId) !== branchId) {
    throw studentSelfForbidden();
  }
  const [branch, schoolClass, section, period, user] = await Promise.all([
    Branch.findOne({ _id: branchId, isActive: true })
      .select('name')
      .read('primary')
      .lean(),
    SchoolClass.findOne({ isActive: true })
      .where('_id')
      .equals(enrollment.classId)
      .where('branchId')
      .equals(branchId)
      .where('academicPeriodId')
      .equals(enrollment.academicPeriodId)
      .select('name academicYear')
      .read('primary')
      .lean(),
    Section.findOne({ isActive: true })
      .where('_id')
      .equals(enrollment.sectionId)
      .where('branchId')
      .equals(branchId)
      .where('classId')
      .equals(enrollment.classId)
      .select('name')
      .read('primary')
      .lean(),
    AcademicPeriod.findOne({
      _id: enrollment.academicPeriodId,
      branchId,
      status: 'active',
    })
      .select('name startDate endDate')
      .read('primary')
      .lean(),
    User.findOne({ role: 'student', isActive: true })
      .where('_id')
      .equals(actor._id)
      .where('branchId')
      .equals(branchId)
      .select('fullName email')
      .read('primary')
      .lean(),
  ]);
  if (!branch || !schoolClass || !section || !period || !user) {
    throw studentSelfForbidden();
  }
  return {
    actor,
    branchId,
    student,
    enrollment,
    branch,
    schoolClass,
    section,
    period,
    user,
  };
}

export async function getStudentSelf(identity: JwtPayload | undefined) {
  const ctx = await resolveStudentSelf(identity);
  return {
    studentId: String(ctx.student._id),
    fullName: ctx.user.fullName,
    email: ctx.user.email,
    admissionNumber: ctx.student.admissionNumber,
  };
}
export async function getStudentEnrollment(identity: JwtPayload | undefined) {
  const ctx = await resolveStudentSelf(identity);
  return {
    enrollmentId: String(ctx.enrollment._id),
    status: ctx.enrollment.status,
    branch: { id: ctx.branchId, name: ctx.branch.name },
    schoolClass: {
      id: String(ctx.enrollment.classId),
      name: ctx.schoolClass.name,
    },
    section: { id: String(ctx.enrollment.sectionId), name: ctx.section.name },
    academicPeriod: {
      id: String(ctx.enrollment.academicPeriodId),
      name: ctx.period.name,
    },
    effectiveFrom: ctx.enrollment.effectiveFrom.toISOString(),
  };
}
