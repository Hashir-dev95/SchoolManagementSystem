import { Schema, model } from 'mongoose';
import { CustodyPolicyRevision } from './custodyPolicyRevision';

const history = new Schema({
  revision: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  action: { type: String, enum: ['created', 'revoked'], required: true, immutable: true },
  reason: { type: String, required: true, maxlength: 500, immutable: true },
  at: { type: Date, required: true, immutable: true },
}, { _id: false, strict: 'throw' });

const schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, immutable: true },
  scope: { type: String, enum: ['student_custody', 'collector_identity'], required: true, immutable: true },
  revision: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  status: { type: String, enum: ['active', 'revoked'], required: true },
  validFrom: { type: Date, required: true, immutable: true },
  validUntil: { type: Date, required: true, immutable: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  revokedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  revokedAt: Date,
  history: { type: [history], required: true, select: false },
}, { timestamps: true, strict: 'throw', optimisticConcurrency: true });
schema.index({ userId: 1, branchId: 1, scope: 1, status: 1 }, { name: 'custody_verifier_scope_lookup' });
schema.index({ userId: 1, branchId: 1, scope: 1, revision: 1 }, { unique: true, name: 'custody_verifier_revision_unique' });
schema.pre('validate', function () {
  if (!(this.validFrom instanceof Date) || !(this.validUntil instanceof Date) || this.validFrom >= this.validUntil)
    this.invalidate('validUntil', 'Grant validity interval is invalid');
  if ((this.status === 'revoked') !== Boolean(this.revokedAt && this.revokedBy))
    this.invalidate('status', 'Revocation metadata must match grant status');
  if (!Array.isArray(this.history) || !this.history.length || this.history.length > 100)
    this.invalidate('history', 'Grant history must be bounded and nonempty');
});
export const CustodyVerifierGrant = model('CustodyVerifierGrant', schema);

export async function ensureCustodyVerifierIndexes() {
  await Promise.all([CustodyPolicyRevision.createIndexes(), CustodyVerifierGrant.createIndexes()]);
}
