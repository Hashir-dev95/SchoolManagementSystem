import { Schema, model } from 'mongoose';

const id = {
  type: Schema.Types.ObjectId,
  required: true,
  immutable: true,
};

const schema = new Schema(
  {
    requesterId: id,
    studentId: id,
    branchId: id,
    applicationId: id,
    approvalRequestId: id,
    kind: {
      type: String,
      enum: ['submit', 'withdraw'] as const,
      required: true,
      immutable: true,
    },
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
    resultRevision: {
      type: Number,
      min: 1,
      validate: Number.isSafeInteger,
      required: true,
      immutable: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw' },
);
schema.index(
  { requesterId: 1, clientOperationId: 1 },
  { unique: true, name: 'parent_leave_lifecycle_owner_operation' },
);

export const ParentLeaveOperation = model('ParentLeaveOperation', schema);
