import { Schema, model } from 'mongoose';
import User from './user';

const ref = (name: string) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required: true,
  immutable: true,
});
export const GATE_DUTIES = [
  'tasks_view',
  'entry_record',
  'pickup_verify',
  'exit_confirm',
  'incident_escalate',
] as const;
export type GateDuty = (typeof GATE_DUTIES)[number];
const history = new Schema(
  {
    revision: { type: Number, required: true },
    actorId: ref('User'),
    at: { type: Date, required: true },
    action: {
      type: String,
      enum: ['created', 'updated', 'revoked', 'held', 'reset'],
      required: true,
    },
    reason: { type: String, required: true, maxlength: 500 },
    snapshot: { type: Schema.Types.Mixed, required: true },
  },
  { _id: false },
);
const audit = {
  revision: {
    type: Number,
    min: 1,
    required: true,
    validate: Number.isSafeInteger,
  },
  createdBy: ref('User'),
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  history: { type: [history], required: true, select: false },
};

// All domain writers load the private audit prefix and append one exact version.
// A normal model save cannot rewrite old evidence or omit the current snapshot.
function protectHistory(schema: Schema, fields: readonly string[]) {
  schema.post('init', function (row) {
    row.$locals.gateHistory = JSON.stringify(row.get('history'));
    row.$locals.gateRevision = row.get('revision');
  });
  schema.pre('validate', function () {
    const events = this.get('history') as {
      revision: number;
      actorId: unknown;
      at: Date;
      snapshot: unknown;
    }[];
    const revision = this.get('revision') as number;
    const last = events?.at(-1);
    const current = Object.fromEntries(
      fields.map(field => [field, this.get(field)]),
    );
    if (
      !last ||
      events.length !== revision ||
      last.revision !== revision ||
      String(last.actorId) !== String(this.get('updatedBy')) ||
      !(last.at instanceof Date) ||
      !Number.isFinite(last.at.getTime()) ||
      last.at.getTime() > Date.now() ||
      JSON.stringify(last.snapshot) !== JSON.stringify(current) ||
      (this.isNew
        ? revision !== 1 ||
          String(this.get('createdBy')) !== String(last.actorId)
        : revision !== Number(this.$locals.gateRevision) + 1 ||
          JSON.stringify(events.slice(0, -1)) !== this.$locals.gateHistory)
    ) {
      this.invalidate(
        'history',
        'An immutable audit prefix and next revision are required',
      );
    }
  });
}

export const GATE_SNAPSHOT_FIELDS = ['code', 'name', 'isActive'] as const;
const gate = new Schema(
  {
    branchId: ref('Branch'),
    code: { type: String, required: true, immutable: true, maxlength: 40 },
    name: { type: String, required: true, maxlength: 100 },
    isActive: { type: Boolean, required: true },
    ...audit,
  },
  { timestamps: true, optimisticConcurrency: true },
);
protectHistory(gate, GATE_SNAPSHOT_FIELDS);
gate.index(
  { branchId: 1, code: 1 },
  { unique: true, name: 'gate_branch_code_unique' },
);
gate.index({ branchId: 1, isActive: 1, code: 1 });
export const Gate = model('Gate', gate);

export const ASSIGNMENT_SNAPSHOT_FIELDS = [
  'duties',
  'validFrom',
  'validUntil',
  'status',
] as const;
const assignment = new Schema(
  {
    branchId: ref('Branch'),
    gateId: ref('Gate'),
    operatorId: ref('User'),
    duties: { type: [{ type: String, enum: GATE_DUTIES }], required: true },
    validFrom: { type: Date, required: true, immutable: true },
    validUntil: { type: Date, required: true, immutable: true },
    status: { type: String, enum: ['active', 'revoked'], required: true },
    revokedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    revokedAt: Date,
    ...audit,
  },
  { timestamps: true, optimisticConcurrency: true },
);
protectHistory(assignment, ASSIGNMENT_SNAPSHOT_FIELDS);
assignment.pre('validate', function () {
  if (
    !this.duties.length ||
    new Set(this.duties).size !== this.duties.length ||
    !this.validFrom ||
    !this.validUntil ||
    this.validUntil <= this.validFrom ||
    (this.status === 'active'
      ? !!this.revokedBy || !!this.revokedAt
      : !this.revokedBy || !this.revokedAt)
  )
    this.invalidate(
      'status',
      'Assignment duties, interval and revocation must agree',
    );
  if (!this.isNew && this.$locals.gateRevision !== 1)
    this.invalidate('revision', 'Revoked assignment history is terminal');
});
assignment.index(
  { operatorId: 1, gateId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
    name: 'gate_operator_active_unique',
  },
);
assignment.index({
  operatorId: 1,
  branchId: 1,
  status: 1,
  validFrom: 1,
  validUntil: 1,
});
export const GateStaffAssignment = model('GateStaffAssignment', assignment);

export const CUSTODY_SNAPSHOT_FIELDS = ['state', 'authorityRevision'] as const;
const custody = new Schema(
  {
    branchId: ref('Branch'),
    studentId: ref('Student'),
    enrollmentId: ref('StudentEnrollment'),
    academicPeriodId: ref('AcademicPeriod'),
    classId: ref('SchoolClass'),
    sectionId: ref('Section'),
    state: {
      type: String,
      enum: ['unknown', 'verified', 'hold'],
      required: true,
    },
    authorityRevision: {
      type: Number,
      min: 1,
      required: true,
      validate: Number.isSafeInteger,
    },
    ...audit,
  },
  { timestamps: true, optimisticConcurrency: true },
);
protectHistory(custody, CUSTODY_SNAPSHOT_FIELDS);
custody.pre('validate', function () {
  if (this.state === 'verified' || this.authorityRevision !== this.revision)
    this.invalidate(
      'state',
      'Verified custody requires an approved future policy',
    );
});
custody.index(
  { studentId: 1, branchId: 1 },
  { unique: true, name: 'custody_student_branch_unique' },
);
export const StudentCustodyState = model('StudentCustodyState', custody);

const operation = new Schema(
  {
    actorId: ref('User'),
    branchId: ref('Branch'),
    clientOperationId: {
      type: String,
      required: true,
      immutable: true,
      maxlength: 100,
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
  { timestamps: { createdAt: true, updatedAt: false } },
);
operation.index(
  { actorId: 1, clientOperationId: 1 },
  { unique: true, name: 'gate_admin_operation_unique' },
);
export const GateAdminOperation = model('GateAdminOperation', operation);

export async function ensureGateFoundationIndexes() {
  await Promise.all([
    Gate.createIndexes(),
    GateStaffAssignment.createIndexes(),
    StudentCustodyState.createIndexes(),
    GateAdminOperation.createIndexes(),
    User.collection.createIndex({ email: 1 }, { unique: true }),
  ]);
}
