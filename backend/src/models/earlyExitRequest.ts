import { createHash } from 'node:crypto';
import {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
} from 'mongoose';
import ApprovalRequest from './approvalRequest';

const ref = (name: string) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required: true,
  immutable: true,
});
export const EARLY_EXIT_STATES = [
  'draft',
  'pending',
  'changes_requested',
  'rejected',
  'withdrawn',
] as const;
export const EARLY_EXIT_PROVENANCE = [
  'requesterId',
  'studentId',
  'branchId',
  'parentStudentLinkId',
  'enrollmentId',
  'academicPeriodId',
  'classId',
  'sectionId',
] as const;
const provenance = {
  requesterId: ref('User'),
  studentId: ref('Student'),
  branchId: ref('Branch'),
  parentStudentLinkId: ref('ParentStudentLink'),
  enrollmentId: ref('StudentEnrollment'),
  academicPeriodId: ref('AcademicPeriod'),
  classId: ref('SchoolClass'),
  sectionId: ref('Section'),
};
export const earlyExitDigest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const history = new Schema(
  {
    action: {
      type: String,
      enum: [
        'created',
        'edited',
        'submitted',
        'resubmitted',
        'withdrawn',
        'rejected',
        'changes_requested',
      ],
      required: true,
    },
    revision: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isSafeInteger,
    },
    actorId: ref('User'),
    at: { type: Date, required: true },
    decisionReason: { type: String, maxlength: 500 },
    fingerprint: { type: String, required: true },
  },
  { _id: false, strict: 'throw' },
);
const request = new Schema(
  {
    ...provenance,
    exitDate: { type: String, required: true },
    reason: { type: String, required: true, maxlength: 500, select: false },
    state: {
      type: String,
      enum: EARLY_EXIT_STATES,
      required: true,
      default: 'draft',
    },
    revision: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: Number.isSafeInteger,
    },
    approvalRequestId: { type: Schema.Types.ObjectId, ref: 'ApprovalRequest' },
    submissionId: { type: Schema.Types.ObjectId, ref: 'EarlyExitSubmission' },
    cycle: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: Number.isSafeInteger,
    },
    history: { type: [history], required: true, select: false },
  },
  { timestamps: true, optimisticConcurrency: true, strict: 'throw' },
);
const remember = (row: {
  get(key: string): unknown;
  $locals: Record<string, unknown>;
}) => {
  row.$locals.earlyExitHistory = JSON.stringify(row.get('history'));
  row.$locals.earlyExitRevision = row.get('revision');
  row.$locals.earlyExitApproval = row.get('approvalRequestId');
};
request.post('init', remember);
request.post('save', remember);
request.pre('validate', function () {
  const events = this.history;
  if (
    !events?.length ||
    events.length !== this.revision + 1 ||
    events.some(
      (event, index) =>
        event.revision !== index ||
        !Number.isFinite(event.at?.getTime()) ||
        event.at.getTime() > Date.now() ||
        (index > 0 && event.at < events[index - 1].at),
    )
  ) {
    this.invalidate('history', 'Invalid Early Exit chronological history');
    return;
  }
  if (
    this.isNew
      ? this.revision !== 0
      : !(
          (this.revision === this.$locals.earlyExitRevision &&
            JSON.stringify(events) === this.$locals.earlyExitHistory) ||
          (this.revision === Number(this.$locals.earlyExitRevision) + 1 &&
            JSON.stringify(events.slice(0, -1)) ===
              this.$locals.earlyExitHistory)
        )
  )
    this.invalidate('history', 'Early Exit history is append-only');
  if (
    this.$locals.earlyExitApproval &&
    String(this.approvalRequestId) !== String(this.$locals.earlyExitApproval)
  )
    this.invalidate('approvalRequestId', 'Original approval is immutable');
  let state = 'draft',
    cycle = 0;
  for (const [index, event] of events.entries()) {
    const owner = String(event.actorId) === String(this.requesterId);
    const valid =
      index === 0
        ? event.action === 'created' && owner
        : event.action === 'edited'
        ? state === 'draft' && owner
        : event.action === 'submitted'
        ? state === 'draft' && owner
        : event.action === 'resubmitted'
        ? state === 'changes_requested' && owner
        : event.action === 'withdrawn'
        ? state === 'pending' && owner
        : state === 'pending' &&
          !owner &&
          ['rejected', 'changes_requested'].includes(event.action) &&
          (event.decisionReason?.length ?? 0) >= 10;
    if (!valid)
      this.invalidate('history', 'Invalid typed Early Exit lifecycle');
    if (['submitted', 'resubmitted'].includes(event.action)) {
      state = 'pending';
      cycle++;
    } else if (
      ['withdrawn', 'rejected', 'changes_requested'].includes(event.action)
    )
      state = event.action;
  }
  if (
    this.state !== state ||
    this.cycle !== cycle ||
    !!cycle !== !!this.approvalRequestId ||
    !!cycle !== !!this.submissionId ||
    events.at(-1)?.fingerprint !==
      earlyExitDigest([
        String(this.studentId),
        { exitDate: this.exitDate, reason: this.reason },
      ])
  )
    this.invalidate('state', 'Invalid Early Exit state or payload');
});
request.index({ requesterId: 1, studentId: 1, branchId: 1, createdAt: -1 });
request.index({ branchId: 1, state: 1, createdAt: -1 });
request.index(
  { approvalRequestId: 1 },
  {
    unique: true,
    partialFilterExpression: { approvalRequestId: { $type: 'objectId' } },
    name: 'early_exit_reciprocal_approval_unique',
  },
);
export const EarlyExitRequest = model('EarlyExitRequest', request);
export type EarlyExitDocument = HydratedDocument<
  InferSchemaType<typeof request>
>;

const submission = new Schema(
  {
    ...provenance,
    requestId: ref('EarlyExitRequest'),
    approvalRequestId: ref('ApprovalRequest'),
    applicationRevision: { type: Number, required: true, immutable: true },
    cycle: { type: Number, required: true, immutable: true },
    exitDate: { type: String, required: true, immutable: true },
    reason: { type: String, required: true, immutable: true, select: false },
    fingerprint: {
      type: String,
      required: true,
      immutable: true,
      select: false,
    },
    routingVersion: { type: Number, required: true, immutable: true },
    submittedAt: { type: Date, required: true, immutable: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw' },
);
submission.pre('save', function () {
  if (!this.isNew && this.isModified())
    throw new Error('Early Exit submissions are immutable');
});
submission.index(
  { requestId: 1, cycle: 1 },
  { unique: true, name: 'early_exit_submission_cycle_unique' },
);
submission.index(
  { requestId: 1, applicationRevision: 1 },
  { unique: true, name: 'early_exit_submission_revision_unique' },
);
export const EarlyExitSubmission = model('EarlyExitSubmission', submission);

const operation = new Schema(
  {
    actorId: ref('User'),
    requestId: ref('EarlyExitRequest'),
    branchId: ref('Branch'),
    studentId: ref('Student'),
    clientOperationId: {
      type: String,
      required: true,
      immutable: true,
      maxlength: 120,
    },
    kind: {
      type: String,
      enum: [
        'create',
        'edit',
        'submit',
        'withdraw',
        'resubmit',
        'reject',
        'request_changes',
      ],
      required: true,
      immutable: true,
    },
    fingerprint: {
      type: String,
      required: true,
      immutable: true,
      select: false,
    },
    result: {
      type: Schema.Types.Mixed,
      required: true,
      immutable: true,
      select: false,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw' },
);
operation.pre('save', function () {
  if (!this.isNew && this.isModified())
    throw new Error('Early Exit operation receipts are immutable');
});
operation.index(
  { actorId: 1, clientOperationId: 1 },
  { unique: true, name: 'early_exit_actor_operation_unique' },
);
export const EarlyExitOperation = model('EarlyExitOperation', operation);
export async function ensureEarlyExitIndexes() {
  await Promise.all([
    EarlyExitRequest.createIndexes(),
    EarlyExitSubmission.createIndexes(),
    EarlyExitOperation.createIndexes(),
    ApprovalRequest.createIndexes(),
  ]);
}
