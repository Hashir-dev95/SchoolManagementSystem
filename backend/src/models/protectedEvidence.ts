import { Schema, model } from 'mongoose';

export const EVIDENCE_DOMAINS = ['custody', 'parent_leave', 'homework', 'school_document', 'helpdesk'] as const;
export type EvidenceDomain = (typeof EVIDENCE_DOMAINS)[number];
export const EVIDENCE_PURPOSES = ['verification', 'medical_attachment', 'homework_attachment', 'school_document', 'helpdesk_attachment'] as const;
export const EVIDENCE_STATES = ['intent', 'quarantined', 'available', 'failed', 'deletion_pending', 'deleted'] as const;
export type EvidenceState = (typeof EVIDENCE_STATES)[number];
export type EvidencePurpose = (typeof EVIDENCE_PURPOSES)[number];
export type EvidenceOwnerType = 'student' | 'parent' | 'teacher' | 'school_record' | 'helpdesk_ticket';

const eventSchema = new Schema({
  revision: { type: Number, required: true, min: 1, validate: Number.isSafeInteger, immutable: true },
  action: { type: String, enum: ['intent_created', 'content_quarantined', 'scan_clean', 'scan_unsafe', 'scan_unavailable', 'validation_failed', 'ingestion_failed', 'authorization_revoked', 'availability_invalidated', 'deletion_requested', 'deleted', 'recovery_completed', 'recovery_failed'], required: true, immutable: true },
  actorType: { type: String, enum: ['user', 'system'], required: true, immutable: true },
  actorId: { type: Schema.Types.ObjectId, ref: 'User', immutable: true },
  occurredAt: { type: Date, required: true, immutable: true },
}, { _id: false, strict: 'throw' });

const schema = new Schema({
  evidenceId: { type: String, required: true, immutable: true, match: /^[a-f0-9]{32}$/ },
  domain: { type: String, required: true, enum: EVIDENCE_DOMAINS, immutable: true },
  purpose: { type: String, required: true, enum: EVIDENCE_PURPOSES, immutable: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, immutable: true },
  ownerType: { type: String, required: true, enum: ['student', 'parent', 'teacher', 'school_record', 'helpdesk_ticket'], immutable: true },
  ownerId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  resourceId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  uploaderId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  operationId: { type: String, required: true, immutable: true, match: /^[A-Za-z0-9._:-]{12,128}$/ },
  payloadFingerprint: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  storageObjectKey: { type: String, required: true, immutable: true, match: /^[a-f0-9]{32}$/ },
  declaredContentType: { type: String, maxlength: 100, immutable: true },
  detectedContentType: { type: String, enum: ['application/pdf', 'image/png', 'image/jpeg'] },
  byteLength: { type: Number, min: 1, max: 10_000_000, validate: Number.isSafeInteger },
  sha256: { type: String, match: /^[a-f0-9]{64}$/ },
  status: { type: String, required: true, enum: EVIDENCE_STATES, default: 'intent' },
  scanStatus: { type: String, required: true, enum: ['not_scanned', 'pending', 'clean', 'unsafe', 'unavailable', 'failed'], default: 'not_scanned' },
  scannerId: { type: String, maxlength: 120 },
  scanDigest: { type: String, match: /^[a-f0-9]{64}$/ },
  scannedAt: Date,
  scanErrorCode: { type: String, enum: ['scanner_unavailable', 'scanner_failed', 'scan_digest_mismatch', 'authorization_revoked'] },
  revision: { type: Number, required: true, min: 1, default: 1, validate: Number.isSafeInteger },
  retentionPolicyRef: { type: String, required: true, maxlength: 120, immutable: true, match: /^[A-Za-z0-9._:-]+$/ },
  deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  deletionRequestedAt: Date,
  deletedAt: Date,
  recoveryAttempts: { type: Number, required: true, default: 0, min: 0, validate: Number.isSafeInteger },
  lastRecoveryAt: Date,
  lastRecoveryErrorCode: { type: String, enum: ['object_missing', 'digest_mismatch', 'storage_unavailable', 'metadata_conflict'] },
  history: { type: [eventSchema], required: true, select: false },
}, { timestamps: true, strict: 'throw', optimisticConcurrency: true });

schema.index({ evidenceId: 1 }, { unique: true, name: 'protected_evidence_id_unique' });
schema.index({ uploaderId: 1, operationId: 1 }, { unique: true, name: 'protected_evidence_operation_unique' });
schema.index({ storageObjectKey: 1 }, { unique: true, name: 'protected_evidence_storage_key_unique' });
schema.index({ branchId: 1, domain: 1, ownerType: 1, ownerId: 1, resourceId: 1, createdAt: -1 }, { name: 'protected_evidence_owner_lookup' });
schema.index({ status: 1, updatedAt: 1 }, { name: 'protected_evidence_recovery_lookup' });

schema.pre('validate', function () {
  const purposeByDomain: Record<string, string[]> = {
    custody: ['verification'], parent_leave: ['medical_attachment'], homework: ['homework_attachment'],
    school_document: ['school_document'], helpdesk: ['helpdesk_attachment'],
  };
  if (!purposeByDomain[this.domain]?.includes(this.purpose)) this.invalidate('purpose', 'Purpose is incompatible with evidence domain');
  if (!Array.isArray(this.history) || !this.history.length || this.history.length > 200) this.invalidate('history', 'Evidence lifecycle history must be bounded and nonempty');
  if (this.status === 'available' && (this.scanStatus !== 'clean' || !this.sha256 || this.scanDigest !== this.sha256 || !this.scannerId || !this.scannedAt))
    this.invalidate('status', 'Available evidence requires a clean scan tied to the current digest');
  if (this.status === 'deleted' && (!this.deletedAt || !this.deletionRequestedAt || !this.deletedBy)) this.invalidate('status', 'Deleted evidence requires completed deletion metadata');
  if (this.status !== 'deleted' && this.deletedAt) this.invalidate('deletedAt', 'Only deleted evidence may have a deletion completion time');
});

export const ProtectedEvidence = model('ProtectedEvidence', schema);
export const ensureProtectedEvidenceIndexes = () => ProtectedEvidence.createIndexes();
