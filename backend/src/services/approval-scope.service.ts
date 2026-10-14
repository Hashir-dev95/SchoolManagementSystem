import {AttendanceCorrection, StudentLeave} from '../models/attendanceAmendment';
import {HydratedDocument, Types} from 'mongoose';
import {IApprovalRequest} from '../models/approvalRequest';
import User from '../models/user';
import Student from '../models/student';
import Fee from '../models/fee';
import {ApprovalAccessError} from './approval-authority.policy';

export const validateApprovalId = (value: string, field: string): void => {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
    throw new ApprovalAccessError(400, `Invalid ${field}`);
  }
};

const scopedStudent = async (id: Types.ObjectId, branchId: Types.ObjectId) => {
  const student = await Student.findById(id).where('branchId').equals(branchId).select('userId').lean();
  return student && await User.exists({}).where('_id').equals(student.userId).where('branchId').equals(branchId);
};

export const assertApprovalReferences = async (request: IApprovalRequest): Promise<void> => {
  const branchId = request.branchId;
  if (!await User.exists({_id: request.requesterId}).where('branchId').equals(branchId)) {
    throw new ApprovalAccessError(404, 'Approval request not found');
  }
  if (!request.entityId) {
    throw new ApprovalAccessError(403, 'Approval entity is not supported');
  }
  // Explicit category-to-model allowlist; never resolve arbitrary model names.
  let scoped: unknown = false;
  if (request.entityType === 'attendance_correction' && request.approvalType === 'attendance_correction') {
    scoped = await AttendanceCorrection.exists({}).where('_id').equals(request.entityId).where('branchId').equals(branchId).where('approvalRequestId').equals((request as unknown as {_id:unknown})._id);
  } else if (request.entityType === 'student_leave' && request.approvalType === 'leave') {
    scoped = await StudentLeave.exists({}).where('_id').equals(request.entityId).where('branchId').equals(branchId).where('approvalRequestId').equals((request as unknown as {_id:unknown})._id);
  } else if (request.entityType === 'student' && ['leave', 'certificate'].includes(request.approvalType)) {
    scoped = await scopedStudent(request.entityId, branchId);
  } else if (request.entityType === 'user' && ['leave', 'payroll'].includes(request.approvalType)) {
    scoped = await User.exists({_id: request.entityId}).where('branchId').equals(branchId);
  } else if (request.entityType === 'fee' && ['refund', 'discount'].includes(request.approvalType)) {
    const fee = await Fee.findById(request.entityId).where('branchId').equals(branchId).select('studentId').lean();
    scoped = fee && await scopedStudent(fee.studentId as unknown as Types.ObjectId, branchId);
  } else {
    throw new ApprovalAccessError(403, 'Approval entity is not supported');
  }
  if (!scoped) throw new ApprovalAccessError(404, 'Approval request not found');
};

export const serializeApproval = async (request: HydratedDocument<IApprovalRequest>) => {
  const ids = [request.requesterId, request.reviewedBy, request.delegatedTo, request.delegatedBy,
    ...request.history.flatMap(entry => [entry.performedBy, entry.delegatedBy])].filter(Boolean);
  const users = await User.find().where('_id').in(ids).where('branchId').equals(request.branchId)
    .select('_id fullName email role branchId').lean();
  const map = new Map(users.map(user => [user._id.toString(), {
    _id: user._id.toString(), fullName: user.fullName, email: user.email,
    role: user.role, branchId: user.branchId?.toString(),
  }]));
  const safeUser = (id?: Types.ObjectId) => id
    ? map.get(id.toString()) ?? 'Unavailable reviewer' : undefined;
  // Whitelisted DTO: mixed before/after payloads and raw supportingFileUrl are
  // intentionally withheld until typed payload/authorized file delivery exists.
  return {
    _id: request._id.toString(), requesterId: safeUser(request.requesterId),
    entityType: request.entityType, entityId: request.entityId?.toString(),
    approvalType: request.approvalType, amount: request.amount, reason: request.reason,
    status: request.status, reviewedBy: safeUser(request.reviewedBy), reviewedAt: request.reviewedAt,
    delegatedTo: safeUser(request.delegatedTo), delegatedBy: safeUser(request.delegatedBy),
    delegationExpiresAt: request.delegationExpiresAt,
    history: request.history.map(entry => ({
      ...(entry._id ? {_id: entry._id.toString()} : {}),
      action: entry.action, performedBy: safeUser(entry.performedBy), reason: entry.reason,
      createdAt: entry.createdAt, authority: entry.authority,
      delegatedBy: safeUser(entry.delegatedBy),
    })),
    createdAt: request.createdAt, updatedAt: request.updatedAt,
  };
};
