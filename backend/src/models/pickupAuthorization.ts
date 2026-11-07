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
const provenance = {
  studentId: ref('Student'),
  branchId: ref('Branch'),
  requesterId: ref('User'),
  parentStudentLinkId: ref('ParentStudentLink'),
  enrollmentId: ref('StudentEnrollment'),
  academicPeriodId: ref('AcademicPeriod'),
  classId: ref('SchoolClass'),
  sectionId: ref('Section'),
};
export const PICKUP_STATES = [
  'draft',
  'pending',
  'changes_requested',
  'rejected',
  'withdrawn',
  'approved',
] as const;
export const pickupDigest = (value: unknown) =>
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
      min: 0,
      required: true,
      validate: Number.isSafeInteger,
    },
    actorId: ref('User'),
    at: { type: Date, required: true },
    reason: { type: String, maxlength: 500 },
    fingerprint: { type: String, required: true },
  },
  { _id: false },
);

function protectHistory(schema: Schema) {
  const remember = (row: {
    get: (key: string) => unknown;
    $locals: Record<string, unknown>;
  }) => {
    row.$locals.pickupHistory = JSON.stringify(row.get('history'));
    row.$locals.pickupRevision = row.get('revision');
    row.$locals.pickupApproval = row.get('approvalRequestId');
  };
  schema.post('init', remember);
  schema.post('save', remember);
  schema.pre('validate', function () {
    const events = this.get('history') as {
      revision: number;
      at: Date;
      actorId: unknown;
    }[];
    const revision = this.get('revision');
    if (
      !events?.length ||
      events.length !== Number(revision) + 1 ||
      events.some(
        (item, index) =>
          item.revision !== index ||
          !(item.at instanceof Date) ||
          !Number.isFinite(item.at.getTime()) ||
          item.at.getTime() > Date.now() ||
          (index > 0 && item.at < events[index - 1].at),
      )
    ) {
      this.invalidate('history', 'Invalid chronological pickup history');
      return;
    }
    if (!this.isNew) {
      const same =
        revision === this.$locals.pickupRevision &&
        JSON.stringify(events) === this.$locals.pickupHistory;
      const appended =
        revision === Number(this.$locals.pickupRevision) + 1 &&
        JSON.stringify(events.slice(0, -1)) === this.$locals.pickupHistory;
      if (
        (!same && !appended) ||
        (this.$locals.pickupApproval &&
          String(this.get('approvalRequestId')) !==
            String(this.$locals.pickupApproval))
      )
        this.invalidate(
          'history',
          'Pickup history and approval identity are immutable',
        );
    } else if (revision !== 0) this.invalidate('revision', 'Pickup records begin at revision zero');
  });
}

const person = new Schema(
  {
    ...provenance,
    fullName: { type: String, required: true, maxlength: 100 },
    relationship: { type: String, required: true, maxlength: 80 },
    phone: { type: String, required: true, maxlength: 30, select: false },
    verificationState: {
      type: String,
      enum: ['proposed', 'verified', 'suspended'],
      default: 'proposed',
      required: true,
    },
    revision: {
      type: Number,
      default: 0,
      required: true,
      min: 0,
      validate: Number.isSafeInteger,
    },
    history: { type: [history], required: true, select: false },
  },
  { timestamps: true, optimisticConcurrency: true },
);
protectHistory(person);
person.pre('validate', function () {
  const last = this.history.at(-1);
  if (
    this.verificationState !== 'proposed' ||
    !last ||
    this.history.some(
      event =>
        !['created', 'edited'].includes(event.action) ||
        String(event.actorId) !== String(this.requesterId),
    ) ||
    last.fingerprint !==
      pickupDigest([this.fullName, this.relationship, this.phone])
  )
    this.invalidate(
      'verificationState',
      'Only an unverified Parent proposal is supported',
    );
});
person.index({ requesterId: 1, studentId: 1, branchId: 1, createdAt: -1 });
export const PickupPerson = model('PickupPerson', person);

const policy = new Schema(
  {
    branchId: ref('Branch'),
    revision: {
      type: Number,
      default: 1,
      required: true,
      min: 1,
      validate: Number.isSafeInteger,
    },
    status: {
      type: String,
      enum: ['unconfigured'],
      default: 'unconfigured',
      required: true,
    },
    activationEnabled: { type: Boolean, default: false, required: true },
  },
  { timestamps: true },
);
policy.pre('validate', function () {
  if (this.activationEnabled || this.status !== 'unconfigured')
    this.invalidate('status', 'School custody activation policy is unapproved');
});
policy.index(
  { branchId: 1 },
  { unique: true, name: 'pickup_policy_branch_unique' },
);
export const PickupCustodyPolicy = model('PickupCustodyPolicy', policy);

const authorization = new Schema(
  {
    ...provenance,
    pickupPersonId: ref('PickupPerson'),
    policyId: ref('PickupCustodyPolicy'),
    policyRevision: { type: Number, required: true, min: 1, immutable: true },
    validFromDate: { type: String, required: true },
    validUntilDate: { type: String, required: true },
    notes: { type: String, default: '', maxlength: 500, select: false },
    state: {
      type: String,
      enum: PICKUP_STATES,
      default: 'draft',
      required: true,
    },
    revision: {
      type: Number,
      default: 0,
      required: true,
      min: 0,
      validate: Number.isSafeInteger,
    },
    approvalRequestId: { type: Schema.Types.ObjectId, ref: 'ApprovalRequest' },
    submissionId: { type: Schema.Types.ObjectId, ref: 'PickupSubmission' },
    cycle: {
      type: Number,
      default: 0,
      required: true,
      min: 0,
      validate: Number.isSafeInteger,
    },
    operationalStatus: {
      type: String,
      enum: ['inactive', 'suspended', 'revoked'],
      default: 'inactive',
      required: true,
    },
    revocation: {
      type: new Schema(
        {
          actorId: ref('User'),
          at: { type: Date, required: true },
          reason: { type: String, required: true, maxlength: 500 },
        },
        { _id: false },
      ),
      select: false,
    },
    history: { type: [history], required: true, select: false },
  },
  { timestamps: true, optimisticConcurrency: true },
);
protectHistory(authorization);
authorization.pre('validate', function () {
  let state = 'draft',
    cycles = 0;
  for (const [index, entry] of this.history.entries()) {
    const owner = String(entry.actorId) === String(this.requesterId);
    const valid =
      index === 0
        ? entry.action === 'created' && owner
        : entry.action === 'edited'
        ? state === 'draft' && owner
        : entry.action === 'submitted'
        ? state === 'draft' && owner
        : entry.action === 'resubmitted'
        ? state === 'changes_requested' && owner
        : entry.action === 'withdrawn'
        ? state === 'pending' && owner
        : state === 'pending' &&
          !owner &&
          ['rejected', 'changes_requested'].includes(entry.action) &&
          !!entry.reason &&
          entry.reason.length >= 10;
    if (!valid) this.invalidate('history', 'Invalid typed pickup lifecycle');
    if (['submitted', 'resubmitted'].includes(entry.action)) {
      state = 'pending';
      cycles++;
    } else if (
      ['withdrawn', 'rejected', 'changes_requested'].includes(entry.action)
    )
      state = entry.action;
  }
  if (
    state !== this.state ||
    cycles !== this.cycle ||
    !!cycles !== !!this.approvalRequestId ||
    !!cycles !== !!this.submissionId ||
    this.operationalStatus !== 'inactive' ||
    this.revocation
  )
    this.invalidate(
      'state',
      'Pickup proposal cannot establish operational authority',
    );
});
authorization.index({
  requesterId: 1,
  studentId: 1,
  branchId: 1,
  state: 1,
  createdAt: -1,
});
authorization.index(
  { pickupPersonId: 1 },
  { unique: true, name: 'pickup_proposal_person_unique' },
);
authorization.index(
  { approvalRequestId: 1 },
  {
    unique: true,
    partialFilterExpression: { approvalRequestId: { $type: 'objectId' } },
    name: 'pickup_reciprocal_approval_unique',
  },
);
authorization.index({ branchId: 1, state: 1, createdAt: -1 });
authorization.index({
  branchId: 1,
  studentId: 1,
  operationalStatus: 1,
  validUntilDate: 1,
});
export const PickupAuthorization = model('PickupAuthorization', authorization);
export type PickupAuthorizationDocument = HydratedDocument<
  InferSchemaType<typeof authorization>
>;

const payload = new Schema(
  {
    fullName: { type: String, required: true },
    relationship: { type: String, required: true },
    phone: { type: String, required: true },
    validFromDate: { type: String, required: true },
    validUntilDate: { type: String, required: true },
    notes: { type: String, default: '' },
  },
  { _id: false },
);
const submission = new Schema(
  {
    authorizationId: ref('PickupAuthorization'),
    pickupPersonId: ref('PickupPerson'),
    branchId: ref('Branch'),
    requesterId: ref('User'),
    studentId: ref('Student'),
    applicationRevision: { type: Number, required: true, immutable: true },
    personRevision: { type: Number, required: true, immutable: true },
    cycle: { type: Number, required: true, immutable: true },
    payload: { type: payload, required: true, immutable: true, select: false },
    fingerprint: {
      type: String,
      required: true,
      immutable: true,
      select: false,
    },
    routingVersion: { type: Number, required: true, immutable: true },
    policyId: ref('PickupCustodyPolicy'),
    policyRevision: { type: Number, required: true, immutable: true },
    submittedAt: { type: Date, required: true, immutable: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
submission.pre('save', function () {
  if (!this.isNew && this.isModified())
    throw new Error('Pickup submissions are immutable');
});
submission.index(
  { authorizationId: 1, cycle: 1 },
  { unique: true, name: 'pickup_submission_cycle_unique' },
);
submission.index(
  { authorizationId: 1, applicationRevision: 1 },
  { unique: true, name: 'pickup_submission_revision_unique' },
);
export const PickupSubmission = model('PickupSubmission', submission);

const operation = new Schema(
  {
    actorId: ref('User'),
    branchId: ref('Branch'),
    studentId: ref('Student'),
    authorizationId: ref('PickupAuthorization'),
    pickupPersonId: ref('PickupPerson'),
    approvalRequestId: {
      type: Schema.Types.ObjectId,
      ref: 'ApprovalRequest',
      immutable: true,
    },
    clientOperationId: {
      type: String,
      required: true,
      maxlength: 120,
      immutable: true,
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
    expectedRevision: { type: Number, immutable: true },
    expectedPersonRevision: { type: Number, immutable: true },
    expectedApprovalVersion: { type: Number, immutable: true },
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
  { timestamps: { createdAt: true, updatedAt: false } },
);
operation.index(
  { actorId: 1, clientOperationId: 1 },
  { unique: true, name: 'pickup_actor_operation_unique' },
);
export const PickupOperation = model('PickupOperation', operation);

export async function ensurePickupAuthorizationIndexes() {
  await Promise.all([
    PickupPerson.createIndexes(),
    PickupAuthorization.createIndexes(),
    PickupSubmission.createIndexes(),
    PickupOperation.createIndexes(),
    PickupCustodyPolicy.createIndexes(),
    ApprovalRequest.createIndexes(),
  ]);
}
