import User from '../models/user';
import SchoolClass from '../models/schoolClass';
import Section from '../models/section';
import Subject from '../models/subject';
import TeacherAssignment, {ensureTeacherAssignmentUniqueIndex} from '../models/teacherAssignment';
import {PERMISSIONS} from '../constants/permissions';
import {ROLE_PERMISSIONS} from '../constants/rolePermissions';
import {dateField, objectBody, objectIdField, RequestContractError} from '../utils/request-validation';
import {currentAcademicActor, requireActiveAcademicBranch} from './teacher-scope.service';
import type {JwtPayload} from './jwt.service';

export const provisioningActor = async (identity: JwtPayload | undefined) => {
  const actor = await currentAcademicActor(identity);
  if (!['principal', 'super_admin'].includes(actor.role) ||
    !ROLE_PERMISSIONS[actor.role].includes(PERMISSIONS.TEACHER_ASSIGNMENTS_MANAGE)) {
    throw new RequestContractError(403, 'Teacher assignment management is not permitted');
  }
  if (actor.role === 'principal') await requireActiveAcademicBranch(actor.branchId?.toString());
  return actor;
};

const conceal = () => new RequestContractError(404, 'Assignment reference not found');

export const createTeacherAssignment = async (identity: JwtPayload | undefined, body: unknown) => {
  const actor = await provisioningActor(identity);
  const input = objectBody(body, ['teacherId', 'classId', 'sectionId', 'subjectId', 'validFrom', 'validUntil']);
  const teacherId = objectIdField(input.teacherId, 'teacher ID');
  const classId = objectIdField(input.classId, 'class ID');
  const sectionId = objectIdField(input.sectionId, 'section ID');
  const subjectId = objectIdField(input.subjectId, 'subject ID');
  const validFrom = dateField(input.validFrom, 'validFrom');
  const validUntil = input.validUntil === undefined ? undefined : dateField(input.validUntil, 'validUntil');
  if (validUntil && validUntil <= validFrom) throw new RequestContractError(400, 'validUntil must be after validFrom');
  const teacher = await User.findOne({
    _id: teacherId, ...(actor.role === 'principal' ? {branchId: actor.branchId} : {}),
  }).select('_id role branchId isActive').lean();
  if (!teacher) throw conceal();
  if (teacher.role !== 'teacher' || !teacher.isActive) throw new RequestContractError(403, 'Teacher is not eligible');
  const branchId = await requireActiveAcademicBranch(teacher.branchId?.toString());
  const references = await Promise.all([
    SchoolClass.exists({isActive: true}).where('_id').equals(classId).where('branchId').equals(branchId),
    Section.exists({isActive: true}).where('_id').equals(sectionId).where('branchId').equals(branchId).where('classId').equals(classId),
    Subject.exists({_id: subjectId, branchId, isActive: true}),
  ]);
  if (references.some(reference => !reference)) throw conceal();
  // Fail closed even if production disables Mongoose autoIndex. No find-then-save
  // duplicate check: MongoDB arbitrates simultaneous equivalent creates.
  await ensureTeacherAssignmentUniqueIndex();
  try {
    const assignment = await TeacherAssignment.create({
      teacherId, branchId, classId, sectionId, subjectId, validFrom, validUntil,
      createdBy: actor._id, updatedBy: actor._id,
    });
    return {assignmentId: String(assignment._id), isActive: assignment.isActive};
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
      throw new RequestContractError(409, 'An active assignment already reserves this tuple; revoke it before replacement');
    }
    throw error;
  }
};

export const revokeTeacherAssignment = async (identity: JwtPayload | undefined, id: unknown, body: unknown) => {
  const actor = await provisioningActor(identity);
  const assignmentId = objectIdField(id, 'assignment ID');
  objectBody(body, []);
  const query = TeacherAssignment.findById(assignmentId);
  if (actor.role === 'principal') query.where('branchId').equals(actor.branchId);
  const assignment = await query.select('_id branchId isActive');
  if (!assignment) throw new RequestContractError(404, 'Teacher assignment not found');
  // Revocation is allowed even if the Teacher/references have since become
  // unavailable. It only removes authority; it never repairs/reassigns a tuple.
  const updated = await TeacherAssignment.findOneAndUpdate({
    _id: assignment._id, branchId: assignment.branchId, isActive: true,
  }, {$set: {isActive: false, revokedAt: new Date(), updatedBy: actor._id}, $inc: {__v: 1}},
  {returnDocument: 'after', runValidators: true});
  if (!updated) throw new RequestContractError(409, 'Teacher assignment is already revoked');
  return {assignmentId: String(updated._id), isActive: updated.isActive};
};
