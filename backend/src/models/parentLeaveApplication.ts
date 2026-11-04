import { Schema, model } from 'mongoose';
import {
  PARENT_LEAVE_STATES,
  validateLeaveDates,
} from '../services/parent-leave-application.policy';

const ref = (name: string) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required: true,
  immutable: true,
});
const history = new Schema(
  {
    action: { type: String, enum: ['draft_created'], required: true },
    actorId: ref('User'),
    revision: { type: Number, required: true, enum: [0] },
    at: { type: Date, required: true, immutable: true },
  },
  { _id: false, strict: 'throw' },
);
const schema = new Schema(
  {
    requesterId: ref('User'),
    studentId: ref('Student'),
    branchId: ref('Branch'),
    parentStudentLinkId: ref('ParentStudentLink'),
    enrollmentId: ref('StudentEnrollment'),
    academicPeriodId: ref('AcademicPeriod'),
    classId: ref('SchoolClass'),
    sectionId: ref('Section'),
    leaveType: { type: String, required: true, trim: true, maxlength: 80 },
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },
    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
      select: false,
    },
    revision: { type: Number, required: true, default: 0, enum: [0] },
    state: {
      type: String,
      enum: PARENT_LEAVE_STATES,
      default: 'draft',
      required: true,
    },
    approvalRequestId: {
      type: Schema.Types.ObjectId,
      ref: 'ApprovalRequest',
      immutable: true,
      default: null,
    },
    // Opaque references only. G1 rejects populated references; no file delivery.
    protectedAttachmentIds: {
      type: [Schema.Types.ObjectId],
      default: [],
      select: false,
      validate: (ids: unknown[]) => ids.length === 0,
    },
    clientOperationId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      maxlength: 120,
      select: false,
    },
    fingerprint: {
      type: String,
      required: true,
      immutable: true,
      match: /^[a-f0-9]{64}$/,
      select: false,
    },
    history: { type: [history], required: true, immutable: true },
  },
  { timestamps: true, strict: 'throw', optimisticConcurrency: true },
);
schema.index(
  { requesterId: 1, clientOperationId: 1 },
  { unique: true, name: 'parent_leave_owner_operation' },
);
schema.index({ branchId: 1, requesterId: 1, studentId: 1, createdAt: -1 });
schema.index({ branchId: 1, studentId: 1, state: 1, startDate: 1, endDate: 1 });
schema.index(
  { approvalRequestId: 1 },
  {
    unique: true,
    partialFilterExpression: { approvalRequestId: { $type: 'objectId' } },
    name: 'parent_leave_one_linked_approval',
  },
);
schema.pre('validate', function () {
  try {
    validateLeaveDates(this.startDate, this.endDate);
  } catch {
    this.invalidate('startDate', 'Invalid leave date range');
  }
  // G1 has no executable transition writer. Future slices must replace this
  // guard only alongside atomic linked approval/history/domain integration.
  if (this.state !== 'draft' || this.approvalRequestId != null)
    this.invalidate('state', 'Only unlinked drafts can be persisted in G1');
  if (
    this.history.length !== 1 ||
    String(this.history[0]?.actorId) !== String(this.requesterId) ||
    this.history[0]?.revision !== 0 ||
    !this.history[0]?.at ||
    this.history[0].at > new Date()
  )
    this.invalidate('history', 'Draft creation provenance is required');
});

// select:false is query hygiene, not authorization. Public callers must use the
// explicit service DTO; native driver writes/reads bypass Mongoose validators.
export const ParentLeaveApplication = model('ParentLeaveApplication', schema);
