import mongoose from 'mongoose';

import Branch from '../models/branch';
import SchoolClass from '../models/schoolClass';
import Section from '../models/section';
import Student, {IStudent} from '../models/student';
import {withTimetablePublication} from './teacher-timetable.service';
import {AcademicPeriod} from '../models/academicPeriod';
import {RequestContractError} from '../utils/request-validation';

export interface CreateStudentInput {
  userId: string;
  branchId: string;
  classId: string;
  sectionId: string;
  admissionNumber: string;
  dateOfBirth?: Date;
  gender?: 'male' | 'female' | 'other';
  guardianName?: string;
  guardianPhone?: string;
  address?: string;
}

export const createStudent = async (
  data: CreateStudentInput,
): Promise<IStudent> => {
  const userId = data.userId.trim();
  const branchId = data.branchId.trim();
  const classId = data.classId.trim();
  const sectionId = data.sectionId.trim();
  const admissionNumber = data.admissionNumber.trim().toUpperCase();

  if (
    !userId ||
    !branchId ||
    !classId ||
    !sectionId ||
    !admissionNumber
  ) {
    throw new Error(
      'User, branch, class, section and admission number are required',
    );
  }

  if (
    !mongoose.isValidObjectId(userId) ||
    !mongoose.isValidObjectId(branchId) ||
    !mongoose.isValidObjectId(classId) ||
    !mongoose.isValidObjectId(sectionId)
  ) {
    throw new Error('Invalid student reference ID');
  }

  const branchObjectId = new mongoose.Types.ObjectId(branchId);
  const classObjectId = new mongoose.Types.ObjectId(classId);
  const sectionObjectId = new mongoose.Types.ObjectId(sectionId);

  const branch = await Branch.findById(branchObjectId).select('_id isActive');

  if (!branch || !branch.isActive) {
    throw new Error('Assigned branch not found or inactive');
  }

  const schoolClass = await SchoolClass.findById(classObjectId).select(
    '_id branchId isActive',
  );

  if (!schoolClass || !schoolClass.isActive) {
    throw new Error('Assigned class not found or inactive');
  }

  if (schoolClass.branchId.toString() !== branchId) {
    throw new Error('Class does not belong to the assigned branch');
  }

  const section = await Section.findById(sectionObjectId).select(
    '_id branchId classId isActive',
  );

  if (!section || !section.isActive) {
    throw new Error('Assigned section not found or inactive');
  }

  if (
    section.branchId.toString() !== branchId ||
    section.classId.toString() !== classId
  ) {
    throw new Error(
      'Section does not belong to the assigned class and branch',
    );
  }

  const existingStudent = await Student.collection.findOne({
  branchId: branchObjectId,
  admissionNumber,
});

if (existingStudent) {
  throw new Error(
    'Student with this admission number already exists in this branch',
  );
}

  const student = new Student({
    userId: new mongoose.Types.ObjectId(userId),
    branchId: branchObjectId,
    classId: classObjectId,
    sectionId: sectionObjectId,
    admissionNumber,
    dateOfBirth: data.dateOfBirth,
    gender: data.gender,
    guardianName: data.guardianName?.trim(),
    guardianPhone: data.guardianPhone?.trim(),
    address: data.address?.trim(),
    isActive: true,
  });

  // Attendance mutations hold this same branch fence. New enrollment must not
  // appear as an unfenced phantom between roster validation and commit.
  // A fresh document per driver transaction attempt preserves insert semantics
  // after a retry; the initially allocated ID remains stable.
  return withTimetablePublication(branchId, undefined, async session => {
    // This transaction writes the same Branch fence as Academic Setup. Repeat
    // reference validation after that write so deactivation cannot slip between
    // the early form validation and enrollment commit.
    const currentClass = await SchoolClass.findOne({isActive: true}).where('_id').equals(classId).where('branchId').equals(branchId).session(session);
    const currentSection = await Section.exists({isActive: true}).where('_id').equals(sectionId).where('branchId').equals(branchId).where('classId').equals(classId).session(session);
    if (!currentClass || !currentSection) throw new RequestContractError(409, 'Student Class or Section is no longer active');
    if (currentClass.academicPeriodId && !await AcademicPeriod.exists({_id: currentClass.academicPeriodId, branchId, status: 'active'}).session(session)) {
      throw new RequestContractError(409, 'An active Academic Period is required');
    }
    return new Student(student.toObject()).save({session});
  });
};
