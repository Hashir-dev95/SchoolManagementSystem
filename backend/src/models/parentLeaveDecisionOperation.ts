import { Schema, model } from 'mongoose';

const id = { type: Schema.Types.ObjectId, required: true, immutable: true };
const revision = {
  type: Number,
  min: 0,
  required: true,
  immutable: true,
  validate: Number.isSafeInteger,
};
const receipt = new Schema(
  {
    reviewerId: id,
    branchId: id,
    approvalId: id,
    applicationId: id,
    clientOperationId: {
      type: String,
      maxlength: 120,
      required: true,
      immutable: true,
    },
    fingerprint: {
      type: String,
      match: /^[a-f0-9]{64}$/,
      required: true,
      immutable: true,
      select: false,
    },
    action: {
      type: String,
      enum: ['approve', 'reject', 'request_changes'] as const,
      required: true,
      immutable: true,
    },
    applicationRevision: revision,
    approvalVersion: revision,
    coverageId: { type: Schema.Types.ObjectId, immutable: true },
    decidedAt: { type: Date, required: true, immutable: true },
  },
  { strict: 'throw' },
);

receipt.index(
  { reviewerId: 1, clientOperationId: 1 },
  { unique: true, name: 'parent_leave_principal_operation' },
);

export const ParentLeaveDecisionOperation = model(
  'ParentLeaveDecisionOperation',
  receipt,
);
