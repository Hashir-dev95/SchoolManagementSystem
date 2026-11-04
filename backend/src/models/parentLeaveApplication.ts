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
    action: {
      type: String,
      enum: ['draft_created', 'draft_edited'],
      required: true,
    },
    actorId: ref('User'),
    revision: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isSafeInteger,
    },
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
    revision: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: Number.isSafeInteger,
    },
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
    history: { type: [history], required: true },
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
  // Draft editing grants no lifecycle transition. Future slices must replace this
  // guard only alongside atomic linked approval/history/domain integration.
  if (this.state !== 'draft' || this.approvalRequestId != null)
    this.invalidate('state', 'Only unlinked drafts can be persisted');
  if (
    this.history.length !== this.revision + 1 ||
    this.history.some(
      (entry, index) =>
        String(entry.actorId) !== String(this.requesterId) ||
        entry.revision !== index ||
        entry.action !== (index === 0 ? 'draft_created' : 'draft_edited') ||
        !entry.at ||
        entry.at > new Date() ||
        (index > 0 && entry.at < this.history[index - 1].at),
    )
  )
    this.invalidate('history', 'Draft creation provenance is required');
});

// select:false is query hygiene, not authorization. Public callers must use the
// explicit service DTO; native driver writes/reads bypass Mongoose validators.
export const ParentLeaveApplication = model('ParentLeaveApplication', schema);

const editOperation = new Schema(
  {
    requesterId: ref('User'),
    branchId: ref('Branch'),
    studentId: ref('Student'),
    applicationId: ref('ParentLeaveApplication'),
    clientOperationId: {
      type: String,
      required: true,
      immutable: true,
      maxlength: 120,
    },
    fingerprint: {
      type: String,
      required: true,
      immutable: true,
      match: /^[a-f0-9]{64}$/,
      select: false,
    },
    resultRevision: {
      type: Number,
      required: true,
      immutable: true,
      min: 1,
      validate: Number.isSafeInteger,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw' },
);
editOperation.index(
  { requesterId: 1, clientOperationId: 1 },
  { unique: true, name: 'parent_leave_edit_owner_operation' },
);
export const ParentLeaveEditOperation = model(
  'ParentLeaveEditOperation',
  editOperation,
);
export async function ensureParentLeaveApplicationIndexes() {
  await ParentLeaveApplication.createIndexes();
  await ParentLeaveEditOperation.createIndexes();
}
