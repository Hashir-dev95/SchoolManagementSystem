import { Schema, model, type Document } from 'mongoose';
import { ProtectedEvidence } from './protectedEvidence';
import {
  consumeCollectorWriteContext,
  hasCollectorWriteContext,
} from '../services/collector-verification-record.service';

const unsupportedMutation = function (): never {
  throw new Error('Collector verification persistence mutation is restricted to the scoped service writer');
};
const unsupportedCustodyAggregation = function (): never {
  throw new Error('Custody aggregation is unavailable on protected persistence models');
};
const queryMutationMethods = [
  'update', 'updateOne', 'updateMany', 'replaceOne', 'findOneAndUpdate',
  'findOneAndReplace', 'findOneAndDelete', 'findOneAndRemove',
  'findByIdAndUpdate', 'findByIdAndDelete', 'findByIdAndRemove',
  'deleteOne', 'deleteMany', 'remove',
] as const;
const custodyModelNames = new Set([
  'CollectorVerificationRecord',
  'CollectorVerificationRecordEvent',
  'CollectorVerificationRecordEvidence',
  'CollectorVerificationRecordOperation',
]);

function installSupportedWriteGuards(schema: Schema, modelName: string) {
  const mutableSchema = schema as unknown as {
    query: Record<string, (...args: unknown[]) => never>;
    methods: Record<string, (...args: unknown[]) => never>;
    statics: Record<string, (...args: unknown[]) => never>;
  };
  for (const operation of queryMutationMethods) {
    mutableSchema.query[operation] = unsupportedMutation;
    mutableSchema.statics[operation] = unsupportedMutation;
  }
  for (const operation of ['deleteOne', 'updateOne', 'replaceOne'] as const) {
    mutableSchema.methods[operation] = unsupportedMutation;
  }
  for (const operation of ['insertMany', 'bulkWrite', 'bulkSave'] as const) {
    mutableSchema.statics[operation] = unsupportedMutation;
  }
  mutableSchema.statics.aggregate = unsupportedCustodyAggregation;
  schema.pre('insertMany', unsupportedMutation);
  schema.pre('bulkWrite', unsupportedMutation);
  (schema.pre as unknown as (
    operation: string,
    handler: (this: { pipeline: () => Record<string, unknown>[] }) => void,
  ) => Schema).call(schema, 'aggregate', function (this: { pipeline: () => Record<string, unknown>[] }) {
    if (this.pipeline().some(stage => '$out' in stage || '$merge' in stage)) {
      throw new Error(`${modelName} aggregation write stages are not supported`);
    }
  });
}

function guardDocumentSave<T extends { prototype: object }>(Model: T) {
  const prototype = Model.prototype as Record<string, unknown>;
  for (const method of ['save', '$save'] as const) {
    const originalSave = prototype[method];
    if (typeof originalSave !== 'function') throw new Error(`Mongoose document ${method} method is unavailable`);
    Object.defineProperty(prototype, method, {
      configurable: true,
      value: function (this: Document, ...args: unknown[]) {
      if (!consumeCollectorWriteContext(this, this.$session())) {
        throw new Error('Custody document writes require an exact scoped service permit');
      }
      return Reflect.apply(originalSave, this, args);
      },
    });
  }
}

const guardedConnections = new WeakSet<object>();
function guardConnectionBulkWrites(Model: object) {
  const connection = (Model as { db: object }).db as Record<string, unknown>;
  if (guardedConnections.has(connection)) return;
  const originalBulkWrite = connection.bulkWrite;
  if (typeof originalBulkWrite !== 'function') throw new Error('Mongoose connection bulkWrite method is unavailable');
  Object.defineProperty(connection, 'bulkWrite', {
    configurable: true,
    value: function (this: object, operations: unknown[], ...args: unknown[]) {
      const targetsCustodyModel = (operation: unknown) => {
        if (typeof operation !== 'object' || operation === null || !('model' in operation)) return false;
        const target = operation.model;
        const targetName = typeof target === 'string'
          ? target
          : ((typeof target === 'object' || typeof target === 'function') && target !== null && 'modelName' in target
            ? target.modelName
            : undefined);
        return typeof targetName === 'string' && custodyModelNames.has(targetName);
      };
      if (operations.some(targetsCustodyModel)) {
        throw new Error('Custody connection bulk writes are not supported');
      }
      return Reflect.apply(originalBulkWrite, this, [operations, ...args]);
    },
  });
  guardedConnections.add(connection);
}

export const COLLECTOR_VERIFICATION_RECORD_STATES = [
  'draft',
  'submitted',
  'changes_requested',
  'review_completed',
  'withdrawn',
  'revoked',
  'invalidated',
] as const;
export type CollectorVerificationRecordState =
  (typeof COLLECTOR_VERIFICATION_RECORD_STATES)[number];
export const COLLECTOR_VERIFICATION_RECORD_EVENT_ACTIONS = [
  'created',
  'evidence_attached',
  'submitted',
  'changes_requested',
  'review_completed',
  'withdrawn',
  'revoked',
  'invalidated',
  'draft_updated',
] as const;
export type CollectorVerificationRecordEventAction =
  (typeof COLLECTOR_VERIFICATION_RECORD_EVENT_ACTIONS)[number];

const immutableObjectId = (ref: string) => ({
  type: Schema.Types.ObjectId,
  ref,
  required: true,
  immutable: true,
});

const recordSchema = new Schema(
  {
    pickupPersonId: immutableObjectId('PickupPerson'),
    pickupAuthorizationId: immutableObjectId('PickupAuthorization'),
    pickupSubmissionId: immutableObjectId('PickupSubmission'),
    submissionCycle: { type: Number, required: true, min: 1, validate: Number.isSafeInteger, immutable: true },
    personRevision: { type: Number, required: true, min: 0, validate: Number.isSafeInteger, immutable: true },
    identityFingerprint: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
    requesterId: immutableObjectId('User'),
    parentStudentLinkId: immutableObjectId('ParentStudentLink'),
    branchId: immutableObjectId('Branch'),
    studentId: immutableObjectId('Student'),
    enrollmentId: immutableObjectId('StudentEnrollment'),
    academicPeriodId: immutableObjectId('AcademicPeriod'),
    classId: immutableObjectId('SchoolClass'),
    sectionId: immutableObjectId('Section'),
    policyId: immutableObjectId('PickupCustodyPolicy'),
    policyRevision: { type: Number, required: true, min: 1, validate: Number.isSafeInteger, immutable: true },
    createdBy: immutableObjectId('User'),
    state: {
      type: String,
      enum: COLLECTOR_VERIFICATION_RECORD_STATES,
      required: true,
      default: 'draft',
    },
    revision: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isSafeInteger,
      default: 1,
    },
    summary: { type: String, required: true, trim: true, maxlength: 1000 },
  },
  { timestamps: true, strict: 'throw', optimisticConcurrency: true },
);
installSupportedWriteGuards(recordSchema, 'CollectorVerificationRecord');
const recordTransitions: Record<string, readonly string[]> = {
  draft: ['draft', 'submitted', 'withdrawn', 'invalidated'],
  changes_requested: ['draft', 'submitted', 'withdrawn', 'invalidated'],
  submitted: ['changes_requested', 'review_completed', 'withdrawn', 'revoked', 'invalidated'],
  review_completed: [],
  withdrawn: [],
  revoked: [],
  invalidated: [],
};
recordSchema.post('init', function (record) {
  record.$locals.custodyInitial = {
    pickupPersonId: String(record.pickupPersonId), pickupAuthorizationId: String(record.pickupAuthorizationId),
    pickupSubmissionId: String(record.pickupSubmissionId), submissionCycle: record.submissionCycle,
    personRevision: record.personRevision, identityFingerprint: record.identityFingerprint,
    parentStudentLinkId: String(record.parentStudentLinkId), policyId: String(record.policyId), policyRevision: record.policyRevision,
    requesterId: String(record.requesterId),
    branchId: String(record.branchId), studentId: String(record.studentId),
    enrollmentId: String(record.enrollmentId), academicPeriodId: String(record.academicPeriodId),
    classId: String(record.classId), sectionId: String(record.sectionId), createdBy: String(record.createdBy),
    revision: record.revision, state: record.state, summary: record.summary,
  };
});
recordSchema.pre('validate', function () {
  if (this.state === 'review_completed' && this.revision < 2)
    this.invalidate('state', 'Administrative review requires a submitted record');
  if (this.isNew) {
    if (!hasCollectorWriteContext(this, this.$session()))
      this.invalidate('state', 'Collector verification record creation requires the scoped domain service');
    if (this.revision !== 1 || this.state !== 'draft') this.invalidate('state', 'Collector verification records must begin as revision-one drafts');
    return;
  }
  if (!hasCollectorWriteContext(this, this.$session()))
    this.invalidate('state', 'Custody lifecycle writes require the scoped domain service');
  const original = this.$locals.custodyInitial as Record<string, unknown> | undefined;
  if (!original || this.revision !== Number(original.revision) + 1 || !recordTransitions[String(original.state)]?.includes(String(this.state))) {
    this.invalidate('revision', 'Custody lifecycle changes require the next business revision and an allowed transition');
    return;
  }
  for (const field of ['pickupPersonId', 'pickupAuthorizationId', 'pickupSubmissionId', 'submissionCycle', 'personRevision', 'identityFingerprint', 'requesterId', 'parentStudentLinkId', 'policyId', 'policyRevision', 'branchId', 'studentId', 'enrollmentId', 'academicPeriodId', 'classId', 'sectionId', 'createdBy'] as const) {
    const current = this.get(field);
    const prior = original[field];
    const changed = typeof prior === 'number' ? current !== prior : String(current) !== prior;
    if (changed) this.invalidate(field, 'Collector verification record provenance is immutable');
  }
  if (this.summary !== original.summary && !(['draft', 'changes_requested'].includes(String(original.state)) && this.state === 'draft'))
    this.invalidate('summary', 'Only a draft edit may change the private summary');
});
const rejectRecordMutation = function () {
  throw new Error('Collector verification records are retained and lifecycle writes require the service');
};
for (const operation of [
  'updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
  'deleteOne', 'deleteMany', 'findOneAndDelete',
] as const) {
  recordSchema.pre(operation, { query: true, document: false }, rejectRecordMutation);
  if (operation === 'deleteOne' || operation === 'updateOne' || operation === 'replaceOne') {
    recordSchema.pre(operation, { query: false, document: true }, rejectRecordMutation);
  }
}
recordSchema.index(
  { pickupAuthorizationId: 1, submissionCycle: 1, personRevision: 1 },
  { unique: true, name: 'collector_verification_proposal_cycle_identity_unique' },
);
recordSchema.index(
  { branchId: 1, studentId: 1, enrollmentId: 1, createdAt: -1 },
  { name: 'collector_verification_record_current_scope' },
);
recordSchema.index(
  { branchId: 1, studentId: 1, state: 1, createdAt: -1 },
  { name: 'collector_verification_record_branch_state' },
);
export const CollectorVerificationRecord = model('CollectorVerificationRecord', recordSchema);
guardDocumentSave(CollectorVerificationRecord);
guardConnectionBulkWrites(CollectorVerificationRecord);

const eventSchema = new Schema(
  {
    recordId: immutableObjectId('CollectorVerificationRecord'),
    pickupPersonId: immutableObjectId('PickupPerson'),
    pickupAuthorizationId: immutableObjectId('PickupAuthorization'),
    pickupSubmissionId: immutableObjectId('PickupSubmission'),
    submissionCycle: { type: Number, required: true, min: 1, validate: Number.isSafeInteger, immutable: true },
    personRevision: { type: Number, required: true, min: 0, validate: Number.isSafeInteger, immutable: true },
    identityFingerprint: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
    requesterId: immutableObjectId('User'),
    parentStudentLinkId: immutableObjectId('ParentStudentLink'),
    revision: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isSafeInteger,
      immutable: true,
    },
    branchId: immutableObjectId('Branch'),
    studentId: immutableObjectId('Student'),
    enrollmentId: immutableObjectId('StudentEnrollment'),
    academicPeriodId: immutableObjectId('AcademicPeriod'),
    classId: immutableObjectId('SchoolClass'),
    sectionId: immutableObjectId('Section'),
    policyId: immutableObjectId('PickupCustodyPolicy'),
    policyRevision: { type: Number, required: true, min: 1, validate: Number.isSafeInteger, immutable: true },
    actorId: immutableObjectId('User'),
    action: {
      type: String,
      enum: COLLECTOR_VERIFICATION_RECORD_EVENT_ACTIONS,
      required: true,
      immutable: true,
    },
    state: {
      type: String,
      enum: COLLECTOR_VERIFICATION_RECORD_STATES,
      required: true,
      immutable: true,
    },
    summary: { type: String, required: true, maxlength: 1000, immutable: true },
    reason: { type: String, required: true, maxlength: 500, immutable: true },
    at: { type: Date, required: true, immutable: true },
  },
  { timestamps: false, strict: 'throw', versionKey: false },
);
installSupportedWriteGuards(eventSchema, 'CollectorVerificationRecordEvent');
eventSchema.index(
  { recordId: 1, revision: 1 },
  { unique: true, name: 'collector_verification_event_revision_unique' },
);
eventSchema.index(
  { branchId: 1, studentId: 1, recordId: 1, revision: 1 },
  { name: 'collector_verification_event_scope' },
);

for (const operation of [
  'updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
  'deleteOne', 'deleteMany', 'findOneAndDelete',
] as const) {
  eventSchema.pre(operation, { query: true, document: false }, unsupportedMutation);
  if (operation === 'deleteOne' || operation === 'updateOne' || operation === 'replaceOne') {
    eventSchema.pre(operation, { query: false, document: true }, unsupportedMutation);
  }
}
eventSchema.pre('save', async function () {
  if (!this.isNew) throw new Error('Collector verification record events are append-only');
  const session = this.$session() ?? null;
  const record = await CollectorVerificationRecord.findById(this.recordId).session(session).lean();
  if (!record || record.revision !== this.revision || String(record.branchId) !== String(this.branchId) || String(record.studentId) !== String(this.studentId) || String(record.enrollmentId) !== String(this.enrollmentId) || String(record.academicPeriodId) !== String(this.academicPeriodId) || String(record.classId) !== String(this.classId) || String(record.sectionId) !== String(this.sectionId) || String(record.pickupPersonId) !== String(this.pickupPersonId) || String(record.pickupAuthorizationId) !== String(this.pickupAuthorizationId) || String(record.pickupSubmissionId) !== String(this.pickupSubmissionId) || record.submissionCycle !== this.submissionCycle || record.personRevision !== this.personRevision || record.identityFingerprint !== this.identityFingerprint || String(record.requesterId) !== String(this.requesterId) || String(record.parentStudentLinkId) !== String(this.parentStudentLinkId) || String(record.policyId) !== String(this.policyId) || record.policyRevision !== this.policyRevision || record.state !== this.state || record.summary !== this.summary)
    throw new Error('Collector verification record event must match the current record revision');
  const count = await CollectorVerificationRecordEvent.countDocuments({ recordId: this.recordId }).session(session);
  const previous = await CollectorVerificationRecordEvent.findOne({ recordId: this.recordId }).sort({ revision: -1 }).session(session).lean();
  if (count !== this.revision - 1 || (this.revision === 1 ? this.action !== 'created' : previous?.revision !== this.revision - 1))
    throw new Error('Collector verification record event history must be contiguous');
});
export const CollectorVerificationRecordEvent = model(
  'CollectorVerificationRecordEvent',
  eventSchema,
);
guardDocumentSave(CollectorVerificationRecordEvent);

const evidenceSchema = new Schema(
  {
    recordId: immutableObjectId('CollectorVerificationRecord'),
    pickupPersonId: immutableObjectId('PickupPerson'),
    pickupAuthorizationId: immutableObjectId('PickupAuthorization'),
    pickupSubmissionId: immutableObjectId('PickupSubmission'),
    submissionCycle: { type: Number, required: true, min: 1, validate: Number.isSafeInteger, immutable: true },
    personRevision: { type: Number, required: true, min: 0, validate: Number.isSafeInteger, immutable: true },
    requesterId: immutableObjectId('User'),
    parentStudentLinkId: immutableObjectId('ParentStudentLink'),
    branchId: immutableObjectId('Branch'),
    studentId: immutableObjectId('Student'),
    enrollmentId: immutableObjectId('StudentEnrollment'),
    evidenceId: {
      type: String,
      required: true,
      immutable: true,
      match: /^[a-f0-9]{32}$/,
    },
    evidenceObjectId: immutableObjectId('ProtectedEvidence'),
    evidenceRevision: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isSafeInteger,
      immutable: true,
    },
    evidenceDigest: {
      type: String,
      required: true,
      immutable: true,
      match: /^[a-f0-9]{64}$/,
    },
    contentType: {
      type: String,
      required: true,
      enum: ['application/pdf', 'image/png', 'image/jpeg'],
      immutable: true,
    },
    byteLength: {
      type: Number,
      required: true,
      min: 1,
      max: 10_000_000,
      validate: Number.isSafeInteger,
      immutable: true,
    },
    attachedBy: immutableObjectId('User'),
    attachedAt: { type: Date, required: true, immutable: true },
  },
  { timestamps: false, strict: 'throw', versionKey: false },
);
installSupportedWriteGuards(evidenceSchema, 'CollectorVerificationRecordEvidence');
for (const operation of [
  'updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
  'deleteOne', 'deleteMany', 'findOneAndDelete',
] as const) {
  evidenceSchema.pre(operation, { query: true, document: false }, unsupportedMutation);
  if (operation === 'deleteOne' || operation === 'updateOne' || operation === 'replaceOne') {
    evidenceSchema.pre(operation, { query: false, document: true }, unsupportedMutation);
  }
}
evidenceSchema.index(
  { recordId: 1, evidenceId: 1 },
  { unique: true, name: 'collector_verification_evidence_unique' },
);
evidenceSchema.pre('save', async function () {
  if (!this.isNew) throw new Error('Collector verification evidence associations are append-only');
  const session = this.$session() ?? null;
  const [record, evidence] = await Promise.all([
    CollectorVerificationRecord.findOne({ _id: this.recordId, branchId: this.branchId, studentId: this.studentId, enrollmentId: this.enrollmentId, pickupPersonId: this.pickupPersonId, personRevision: this.personRevision }).session(session).lean(),
    ProtectedEvidence.findOne({ _id: this.evidenceObjectId, evidenceId: this.evidenceId, branchId: this.branchId, domain: 'custody', purpose: 'verification', ownerType: 'student', ownerId: this.studentId, resourceId: this.recordId, uploaderId: this.attachedBy, status: 'available', scanStatus: 'clean', revision: this.evidenceRevision, sha256: this.evidenceDigest, scanDigest: this.evidenceDigest }).session(session).lean(),
  ]);
  if (!record || record.state !== 'draft' || String(record.pickupPersonId) !== String(this.pickupPersonId) || String(record.pickupAuthorizationId) !== String(this.pickupAuthorizationId) || String(record.pickupSubmissionId) !== String(this.pickupSubmissionId) || record.submissionCycle !== this.submissionCycle || record.personRevision !== this.personRevision || String(record.requesterId) !== String(this.requesterId) || String(record.parentStudentLinkId) !== String(this.parentStudentLinkId) || !evidence || evidence.detectedContentType !== this.contentType || evidence.byteLength !== this.byteLength)
    throw new Error('Collector verification evidence association is outside its record or evidence scope');
});
export const CollectorVerificationRecordEvidence = model(
  'CollectorVerificationRecordEvidence',
  evidenceSchema,
);
guardDocumentSave(CollectorVerificationRecordEvidence);

const operationSchema = new Schema(
  {
    pickupPersonId: immutableObjectId('PickupPerson'),
    pickupAuthorizationId: immutableObjectId('PickupAuthorization'),
    pickupSubmissionId: immutableObjectId('PickupSubmission'),
    submissionCycle: { type: Number, required: true, min: 1, validate: Number.isSafeInteger, immutable: true },
    personRevision: { type: Number, required: true, min: 0, validate: Number.isSafeInteger, immutable: true },
    recordId: immutableObjectId('CollectorVerificationRecord'),
    actorId: immutableObjectId('User'),
    branchId: immutableObjectId('Branch'),
    clientOperationId: {
      type: String,
      required: true,
      immutable: true,
      match: /^[A-Za-z0-9._:-]{12,128}$/,
    },
    fingerprint: {
      type: String,
      required: true,
      immutable: true,
      select: false,
      match: /^[a-f0-9]{64}$/,
    },
    result: { type: Schema.Types.Mixed, required: true, immutable: true, select: false },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw' },
);
installSupportedWriteGuards(operationSchema, 'CollectorVerificationRecordOperation');
for (const operation of [
  'updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
  'deleteOne', 'deleteMany', 'findOneAndDelete',
] as const) {
  operationSchema.pre(operation, { query: true, document: false }, unsupportedMutation);
  if (operation === 'deleteOne' || operation === 'updateOne' || operation === 'replaceOne') {
    operationSchema.pre(operation, { query: false, document: true }, unsupportedMutation);
  }
}
operationSchema.index(
  { actorId: 1, clientOperationId: 1 },
  { unique: true, name: 'collector_verification_operation_unique' },
);
export const CollectorVerificationRecordOperation = model(
  'CollectorVerificationRecordOperation',
  operationSchema,
);
guardDocumentSave(CollectorVerificationRecordOperation);

export async function ensureCollectorVerificationRecordIndexes() {
  await Promise.all([
    CollectorVerificationRecord.createIndexes(),
    CollectorVerificationRecordEvent.createIndexes(),
    CollectorVerificationRecordEvidence.createIndexes(),
    CollectorVerificationRecordOperation.createIndexes(),
  ]);
}
