import { Schema, model } from 'mongoose';

const event = new Schema({
  revision: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  action: { type: String, enum: ['draft_created', 'draft_updated', 'submitted_for_approval', 'approved', 'withdrawn'], required: true, immutable: true },
  reason: { type: String, required: true, maxlength: 500, immutable: true },
  at: { type: Date, required: true, immutable: true },
}, { _id: false, strict: 'throw' });

const schema = new Schema({
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, immutable: true },
  policyId: { type: Schema.Types.ObjectId, ref: 'PickupCustodyPolicy', required: true, immutable: true },
  revision: { type: Number, required: true, min: 1, validate: Number.isSafeInteger, immutable: true },
  schemaVersion: { type: Number, required: true, enum: [1], immutable: true },
  status: { type: String, enum: ['draft', 'pending_approval', 'approved', 'withdrawn'], required: true },
  configuration: { type: Schema.Types.Mixed, required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  approvedAt: Date,
  history: { type: [event], required: true, select: false },
}, { timestamps: true, strict: 'throw', optimisticConcurrency: true });
schema.index({ branchId: 1, revision: 1 }, { unique: true, name: 'custody_policy_branch_revision_unique' });
schema.index({ branchId: 1, status: 1, revision: -1 }, { name: 'custody_policy_branch_status_revision' });
schema.pre('validate', function () {
  if (this.status === 'approved' || this.approvedBy || this.approvedAt)
    this.invalidate('status', 'Policy approval requires a future typed authorized workflow');
  if (!Array.isArray(this.history) || !this.history.length || this.history.length > 100)
    this.invalidate('history', 'Policy history must be bounded and nonempty');
});
export const CustodyPolicyRevision = model('CustodyPolicyRevision', schema);
