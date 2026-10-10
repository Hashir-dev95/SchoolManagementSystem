import {Schema, model, Types} from 'mongoose';

export const APPROVAL_TYPES = {
  LEAVE: 'leave',
  REFUND: 'refund',
  DISCOUNT: 'discount',
  RESULT: 'result',
  PAPER: 'paper',
  PURCHASE: 'purchase',
  PAYROLL: 'payroll',
  CERTIFICATE: 'certificate',
} as const;

export type ApprovalType =
  (typeof APPROVAL_TYPES)[keyof typeof APPROVAL_TYPES];

export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'changes_requested';

export interface IApprovalHistory {
  action:
    | 'approved'
    | 'rejected'
    | 'changes_requested'
    | 'delegated';
  performedBy: Types.ObjectId;
  reason?: string;
  createdAt: Date;
}

export interface IApprovalRequest {
  branchId: Types.ObjectId;

  requesterId: Types.ObjectId;

  entityType: string;
  entityId?: Types.ObjectId;

  approvalType: ApprovalType;

  amount?: number;
  reason: string;

  supportingFileUrl?: string;

  beforeData?: unknown;
  afterData?: unknown;

  status: ApprovalStatus;

  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;

  delegatedTo?: Types.ObjectId;
  delegationExpiresAt?: Date;

  history: IApprovalHistory[];

  createdAt: Date;
  updatedAt: Date;
}

const approvalHistorySchema = new Schema<IApprovalHistory>(
  {
    action: {
      type: String,
      enum: [
        'approved',
        'rejected',
        'changes_requested',
        'delegated',
      ],
      required: true,
    },

    performedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    reason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
  },
  {
    timestamps: {createdAt: true, updatedAt: false},
    _id: true,
  },
);

const approvalRequestSchema = new Schema<IApprovalRequest>(
  {
    branchId: {
      type: Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
      index: true,
    },

    requesterId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    entityType: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },

    entityId: {
      type: Schema.Types.ObjectId,
    },

    approvalType: {
      type: String,
      enum: Object.values(APPROVAL_TYPES),
      required: true,
      index: true,
    },

    amount: {
      type: Number,
      min: 0,
    },

    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },

    supportingFileUrl: {
      type: String,
      trim: true,
      maxlength: 500,
    },

    beforeData: {
      type: Schema.Types.Mixed,
    },

    afterData: {
      type: Schema.Types.Mixed,
    },

    status: {
      type: String,
      enum: [
        'pending',
        'approved',
        'rejected',
        'changes_requested',
      ],
      default: 'pending',
      required: true,
      index: true,
    },

    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },

    reviewedAt: {
      type: Date,
    },

    delegatedTo: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },

    delegationExpiresAt: {
      type: Date,
    },

    history: {
      type: [approvalHistorySchema],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

approvalRequestSchema.index({
  branchId: 1,
  status: 1,
  createdAt: -1,
});

approvalRequestSchema.index({
  branchId: 1,
  approvalType: 1,
  status: 1,
});

const ApprovalRequest = model<IApprovalRequest>(
  'ApprovalRequest',
  approvalRequestSchema,
);

export default ApprovalRequest;