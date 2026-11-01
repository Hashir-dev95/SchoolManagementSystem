import { Schema, model } from 'mongoose';
const ref = (name: string) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required: true,
  immutable: true,
});
const text = { type: String, required: true, immutable: true };
const minor = {
  type: Number,
  required: true,
  immutable: true,
  min: 1,
  max: 1000000000,
  validate: {
    validator: Number.isSafeInteger,
    message: 'Integer minor units required',
  },
};
const structure = new Schema(
  {
    branchId: ref('Branch'),
    title: text,
    titleKey: text,
    amountMinor: minor,
    currency: {
      type: String,
      enum: ['PKR'],
      default: 'PKR',
      immutable: true,
      required: true,
    },
    createdBy: ref('User'),
  },
  { timestamps: true },
);
structure.index(
  { branchId: 1, titleKey: 1, amountMinor: 1, currency: 1 },
  { unique: true, name: 'unique_fixed_fee_structure' },
);
const obligation = new Schema(
  {
    branchId: ref('Branch'),
    studentId: ref('Student'),
    recipientUserId: ref('User'),
    enrollmentId: ref('StudentEnrollment'),
    academicPeriodId: ref('AcademicPeriod'),
    structureId: ref('FeeStructure'),
    title: text,
    academicPeriodName: text,
    amountMinor: minor,
    currency: text,
    dueDate: text,
    challanReference: { ...text, unique: true },
    createdBy: ref('User'),
    revision: { type: Number, default: 1 },
  },
  { timestamps: true },
);
obligation.index({ branchId: 1, studentId: 1, createdAt: -1 });
obligation.index(
  {
    branchId: 1,
    studentId: 1,
    academicPeriodId: 1,
    structureId: 1,
    dueDate: 1,
  },
  { unique: true, name: 'one_fee_assignment' },
);
const intent = new Schema(
  {
    branchId: ref('Branch'),
    obligationId: ref('FeeObligation'),
    studentId: ref('Student'),
    actorId: ref('User'),
    amountMinor: minor,
    currency: text,
    channel: {
      type: String,
      enum: ['manual', 'online'],
      required: true,
      immutable: true,
    },
    method: text,
    reference: text,
    status: {
      type: String,
      enum: [
        'reserved',
        'awaiting_verification',
        'provider_pending',
        'reconciliation_required',
        'settled',
        'rejected',
        'failed',
      ],
      required: true,
    },
    expiresAt: { type: Date, required: true, immutable: true },
    provider: { type: String, immutable: true },
    merchantId: { type: String, immutable: true },
    providerTransactionRef: String,
    checkoutUrl: String,
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    verifiedAt: Date,
    revision: { type: Number, default: 1 },
  },
  { timestamps: true },
);
intent.index(
  { branchId: 1, channel: 1, method: 1, reference: 1 },
  {
    unique: true,
    partialFilterExpression: { channel: 'manual' },
    name: 'unique_manual_payment_reference',
  },
);
intent.index({ branchId: 1, obligationId: 1, status: 1 });
const transaction = new Schema(
  {
    branchId: ref('Branch'),
    obligationId: ref('FeeObligation'),
    intentId: ref('FinancePaymentIntent'),
    studentId: ref('Student'),
    amountMinor: minor,
    currency: text,
    method: text,
    reference: text,
    receiptReference: { ...text, unique: true },
    state: { type: String, enum: ['settled'], required: true, immutable: true },
    actorId: ref('User'),
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User', immutable: true },
    paidAt: { type: Date, required: true, immutable: true },
    provider: String,
    providerTransactionRef: String,
  },
  { timestamps: true },
);
transaction.index({ intentId: 1 }, { unique: true });
transaction.index(
  { provider: 1, providerTransactionRef: 1 },
  {
    unique: true,
    partialFilterExpression: { providerTransactionRef: { $type: 'string' } },
    name: 'unique_provider_financial_effect',
  },
);
transaction.index({ branchId: 1, obligationId: 1, state: 1 });
const audit = new Schema(
  {
    branchId: ref('Branch'),
    actorId: ref('User'),
    operationId: text,
    action: text,
    fingerprint: text,
    targetId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    amountMinor: { type: Number, immutable: true },
    reference: String,
    beforeState: String,
    afterState: String,
  },
  { timestamps: true },
);
audit.index(
  { branchId: 1, actorId: 1, operationId: 1 },
  { unique: true, name: 'unique_finance_operation' },
);
const observation = new Schema(
  {
    provider: text,
    eventId: text,
    orderRef: text,
    transactionRef: text,
    amountMinor: minor,
    currency: text,
    state: text,
    outcome: String,
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch' },
  },
  { timestamps: true },
);
observation.index({ provider: 1, eventId: 1 }, { unique: true });
export const FeeStructure = model('FeeStructure', structure);
export const FeeObligation = model('FeeObligation', obligation);
export const FinancePaymentIntent = model('FinancePaymentIntent', intent);
export const FinanceTransaction = model('FinanceTransaction', transaction);
export const FinanceAudit = model('FinanceAudit', audit);
export const FinanceProviderObservation = model(
  'FinanceProviderObservation',
  observation,
);
export const ensureFinanceIndexes = () =>
  Promise.all(
    [
      FeeStructure,
      FeeObligation,
      FinancePaymentIntent,
      FinanceTransaction,
      FinanceAudit,
      FinanceProviderObservation,
    ].map(value => value.createIndexes()),
  );
