import mongoose from 'mongoose';

import Branch from '../models/branch';
import SchoolClass from '../models/schoolClass';
import Section from '../models/section';
import Student, {IStudent} from '../models/student';

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

  await student.save();

  return student;
};