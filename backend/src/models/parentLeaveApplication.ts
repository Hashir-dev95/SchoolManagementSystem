import {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
} from 'mongoose';
import ApprovalRequest from './approvalRequest';
import { ParentLeaveOperation } from './parentLeaveOperation';
import {
  parentLeaveFingerprint,
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
      enum: [
        'draft_created',
        'draft_edited',
        'submitted',
        'withdrawn',
      ] as const,
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
const submission = new Schema(
  {
    revision: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isSafeInteger,
    },
    policy: { type: String, enum: ['shared_branch_principal'], required: true },
    version: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isSafeInteger,
    },
    fingerprint: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
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
      default: null,
    },
    submission: { type: submission, select: false },
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
  const linked = this.state === 'pending' || this.state === 'withdrawn';
  const submittedRevision = this.submission?.revision;
  if (linked) {
    const expected = this.revision - (this.state === 'withdrawn' ? 1 : 0);
    if (
      this.isNew ||
      !this.approvalRequestId ||
      !submittedRevision ||
      submittedRevision !== expected
    )
      this.invalidate('state', 'Linked leave submission is invalid');
    if (
      !this.studentId ||
      !this.reason ||
      !this.submission ||
      this.submission.fingerprint !==
        parentLeaveFingerprint(String(this.studentId), this)
    )
      this.invalidate('submission', 'Submitted leave content is frozen');
  } else if (
    this.state !== 'draft' ||
    this.approvalRequestId != null ||
    this.submission
  ) {
    this.invalidate('state', 'Leave lifecycle state is unavailable');
  }
  if (
    this.$locals.linkedApproval &&
    (String(this.approvalRequestId) !== this.$locals.linkedApproval ||
      JSON.stringify(this.submission) !== this.$locals.leaveSubmission)
  )
    this.invalidate('approvalRequestId', 'Leave submission link is immutable');
  if (
    this.$locals.leaveHistory &&
    JSON.stringify(
      this.history.slice(0, Number(this.$locals.leaveHistoryLength)),
    ) !== this.$locals.leaveHistory
  )
    this.invalidate('history', 'Existing leave history is immutable');
  if (
    this.history.length !== this.revision + 1 ||
    this.history.some(
      (entry, index) =>
        String(entry.actorId) !== String(this.requesterId) ||
        entry.revision !== index ||
        entry.action !==
          (index === 0
            ? 'draft_created'
            : index === submittedRevision
            ? 'submitted'
            : linked && this.state === 'withdrawn' && index === this.revision
            ? 'withdrawn'
            : 'draft_edited') ||
        !entry.at ||
        entry.at > new Date() ||
        (index > 0 && entry.at < this.history[index - 1].at),
    )
  )
    this.invalidate('history', 'Leave history does not match its revision');
});
function rememberPersistedLeave(
  row: HydratedDocument<InferSchemaType<typeof schema>>,
) {
  row.$locals.linkedApproval =
    row.approvalRequestId && String(row.approvalRequestId);
  row.$locals.leaveSubmission = JSON.stringify(row.submission);
  row.$locals.leaveHistory = JSON.stringify(row.history);
  row.$locals.leaveHistoryLength = row.history?.length;
}
schema.post('init', rememberPersistedLeave);
schema.post('save', rememberPersistedLeave);

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
  await ParentLeaveOperation.createIndexes();
  await ApprovalRequest.createIndexes();
}
