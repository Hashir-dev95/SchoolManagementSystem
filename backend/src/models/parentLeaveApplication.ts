import {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
} from 'mongoose';
import ApprovalRequest from './approvalRequest';
import { ParentLeaveOperation } from './parentLeaveOperation';
import { ParentLeaveDecisionOperation } from './parentLeaveDecisionOperation';
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
        'resubmitted',
        'changes_requested',
        'withdrawn',
        'approved',
        'rejected',
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
    decisionReason: {
      type: String,
      trim: true,
      maxlength: 500,
      immutable: true,
    },
  },
  { _id: false, strict: 'throw' },
);
const submissionFields = {
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
} as const;
const submission = new Schema(submissionFields, {
  _id: false,
  strict: 'throw',
});
const archivedSubmission = new Schema(
  {
    ...submissionFields,
    leaveType: { type: String, required: true, maxlength: 80 },
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },
    reason: { type: String, required: true, maxlength: 500 },
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
    priorSubmissions: {
      type: [archivedSubmission],
      select: false,
      default: undefined,
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
function snapshot(row: {
  submission?: InferSchemaType<typeof submission> | null;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string;
}) {
  if (!row.submission) return undefined;
  const { revision, policy, version, fingerprint } = row.submission;
  return {
    revision,
    policy,
    version,
    fingerprint,
    leaveType: row.leaveType,
    startDate: row.startDate,
    endDate: row.endDate,
    reason: row.reason,
  };
}

schema.pre('validate', function () {
  try {
    validateLeaveDates(this.startDate, this.endDate);
  } catch {
    this.invalidate('startDate', 'Invalid leave date range');
  }
  const linked = this.state !== 'draft';
  const archives = this.priorSubmissions ?? [];
  const submittedRevision = this.submission?.revision;
  if (linked) {
    const expected = this.revision - (this.state === 'pending' ? 0 : 1);
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
    this.submission ||
    archives.length
  ) {
    this.invalidate('state', 'Leave lifecycle state is unavailable');
  }
  if (this.$locals.linkedApproval) {
    const resubmitted =
      this.$locals.leaveState === 'changes_requested' &&
      this.state === 'pending' &&
      this.revision === this.$locals.leaveHistoryLength &&
      this.history.at(-1)?.action === 'resubmitted';
    const count = Number(this.$locals.archiveCount);
    const frozen =
      JSON.stringify(archives.slice(0, count)) === this.$locals.leaveArchives;
    const previous = this.$locals.leaveSnapshot as ReturnType<typeof snapshot>;
    const archived = archives[count];
    if (
      String(this.approvalRequestId) !== this.$locals.linkedApproval ||
      !frozen ||
      archives.length !== count + Number(resubmitted) ||
      (resubmitted
        ? !previous ||
          !archived ||
          Object.entries(previous).some(
            ([key, value]) => archived.get(key) !== value,
          ) ||
          this.submission?.policy !== previous.policy ||
          this.submission?.version !== previous.version
        : JSON.stringify(this.submission) !== this.$locals.leaveSubmission)
    ) {
      this.invalidate(
        'approvalRequestId',
        'Leave submission link and prior evidence are immutable',
      );
    }
  } else if (archives.length) {
    this.invalidate(
      'priorSubmissions',
      'An initial submission has no prior cycles',
    );
  }
  if (
    this.$locals.leaveHistory &&
    JSON.stringify(
      this.history.slice(0, Number(this.$locals.leaveHistoryLength)),
    ) !== this.$locals.leaveHistory
  )
    this.invalidate('history', 'Existing leave history is immutable');
  let state: (typeof PARENT_LEAVE_STATES)[number] = 'draft';
  const revisions: number[] = [];
  const invalid = this.history.some((entry, index) => {
    const { action } = entry;
    const decision =
      action === 'approved' ||
      action === 'rejected' ||
      action === 'changes_requested';
    const reasonRequired =
      action === 'rejected' || action === 'changes_requested';
    if (
      !entry.actorId ||
      (String(entry.actorId) === String(this.requesterId)) === decision ||
      (reasonRequired
        ? (entry.decisionReason?.length ?? 0) < 10
        : entry.decisionReason !== undefined) ||
      entry.revision !== index ||
      !Number.isFinite(entry.at?.getTime()) ||
      entry.at > new Date() ||
      (index > 0 && entry.at < this.history[index - 1].at)
    )
      return true;
    if (index === 0) return action !== 'draft_created';
    if (state === 'draft' && action === 'draft_edited') return false;
    if (
      (state === 'draft' && action === 'submitted') ||
      (state === 'changes_requested' && action === 'resubmitted')
    ) {
      state = 'pending';
      revisions.push(index);
      return false;
    }
    if (state === 'pending' && (decision || action === 'withdrawn')) {
      state = action;
      return false;
    }
    return true;
  });
  if (
    invalid ||
    this.history.length !== this.revision + 1 ||
    (state as string) !== this.state ||
    revisions.at(-1) !== submittedRevision ||
    archives.length !== Math.max(0, revisions.length - 1) ||
    archives.some(
      (entry, index) =>
        entry.revision !== revisions[index] ||
        entry.policy !== this.submission?.policy ||
        entry.version !== this.submission?.version ||
        entry.fingerprint !==
          parentLeaveFingerprint(String(this.studentId), entry),
    )
  ) {
    this.invalidate('history', 'Leave history does not match its revision');
  }
});
function rememberPersistedLeave(
  row: HydratedDocument<InferSchemaType<typeof schema>>,
) {
  row.$locals.linkedApproval =
    row.approvalRequestId && String(row.approvalRequestId);
  row.$locals.leaveSubmission = JSON.stringify(row.submission);
  row.$locals.leaveHistory = JSON.stringify(row.history);
  row.$locals.leaveHistoryLength = row.history?.length;
  row.$locals.leaveState = row.state;
  row.$locals.leaveSnapshot = snapshot(row);
  row.$locals.archiveCount = row.priorSubmissions?.length ?? 0;
  row.$locals.leaveArchives = JSON.stringify(row.priorSubmissions ?? []);
}
schema.post('init', rememberPersistedLeave);
schema.post('save', rememberPersistedLeave);

// select:false is query hygiene, not authorization. Public callers must use the
// explicit service DTO; native driver writes/reads bypass Mongoose validators.
export const ParentLeaveApplication = model('ParentLeaveApplication', schema);
export type ParentLeaveDocument = HydratedDocument<
  InferSchemaType<typeof schema>
>;
export const currentLeaveSnapshot = snapshot;

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
  await ParentLeaveDecisionOperation.createIndexes();
  await ApprovalRequest.createIndexes();
}
