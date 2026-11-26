import { createHash, randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import Session from '../models/session';
import User from '../models/user';
import { ProtectedEvidence, type EvidenceDomain, type EvidenceOwnerType, type EvidencePurpose, type EvidenceState } from '../models/protectedEvidence';
import { EvidenceStorageError, type EvidenceInput, type ProtectedEvidenceStorage, type StagedEvidence } from './protected-evidence-storage';

const MAX_CONFIGURED_BYTES = 10_000_000;
const allowedTransitions: Record<EvidenceState, EvidenceState[]> = {
  intent: ['quarantined', 'failed', 'deletion_pending'],
  quarantined: ['available', 'failed', 'deletion_pending'],
  available: ['failed', 'deletion_pending'],
  failed: ['deletion_pending'],
  deletion_pending: ['deleted'],
  deleted: [],
};

export class ProtectedEvidenceError extends Error {
  constructor(readonly code: 'invalid_request' | 'unauthorized' | 'not_found' | 'operation_conflict' | 'invalid_content' | 'unsupported_content' | 'content_mismatch' | 'not_available' | 'storage_failure' | 'state_conflict' | 'scan_unavailable') {
    super(code);
    this.name = 'ProtectedEvidenceError';
  }
}

type EvidenceRecord = NonNullable<Awaited<ReturnType<typeof ProtectedEvidence.findOne>>>;

export type EvidenceAuthorizationRequest = Readonly<{
  action: 'upload' | 'read' | 'delete';
  actorId: string;
  branchId: string;
  domain: EvidenceDomain;
  purpose: EvidencePurpose;
  ownerType: EvidenceOwnerType;
  ownerId: string;
  resourceId: string;
}>;
export type DomainEvidenceAuthorizer = (request: EvidenceAuthorizationRequest) => Promise<boolean>;
export type EvidenceActor = Readonly<{ userId: string; branchId: string; sessionId: string }>;
export type EvidenceDto = Readonly<{
  evidenceId: string;
  domain: EvidenceDomain;
  purpose: EvidencePurpose;
  status: EvidenceState;
  contentType: string | null;
  byteLength: number | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}>;
export type EvidenceScanner = Readonly<{
  scan(input: Readonly<{ content: Buffer; sha256: string; contentType: string; signal: AbortSignal }>): Promise<Readonly<{
    result: 'clean' | 'unsafe' | 'unavailable' | 'failed';
    scannerId: string;
    sha256: string;
  }>>;
}>;

function objectId(raw: string): Types.ObjectId | null {
  if (!Types.ObjectId.isValid(raw)) return null;
  const id = new Types.ObjectId(raw);
  return id.toHexString() === raw.toLowerCase() ? id : null;
}

function detectContent(prefix: Buffer, suffix: Buffer): 'application/pdf' | 'image/png' | 'image/jpeg' | null {
  const tail = suffix.toString('latin1').trimEnd();
  if (/^%PDF-1\.[0-7]/.test(prefix.toString('ascii')) && tail.endsWith('%%EOF')) return 'application/pdf';
  const pngIhdr = prefix.length >= 24 && prefix.readUInt32BE(8) === 13 && prefix.subarray(12, 16).toString('ascii') === 'IHDR';
  if (prefix.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && pngIhdr && suffix.includes(Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44]))) return 'image/png';
  if (prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff && suffix.subarray(-2).equals(Buffer.from([0xff, 0xd9]))) return 'image/jpeg';
  return null;
}

function safeDto(record: EvidenceRecord): EvidenceDto {
  return Object.freeze({
    evidenceId: record.evidenceId,
    domain: record.domain,
    purpose: record.purpose,
    status: record.status,
    contentType: record.detectedContentType ?? null,
    byteLength: record.byteLength ?? null,
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

export function createProtectedEvidenceService(config: Readonly<{
  storage: ProtectedEvidenceStorage;
  maxBytes: number;
  scanTimeoutMs?: number;
  scanner?: EvidenceScanner;
}>) {
  if (!Number.isSafeInteger(config.maxBytes) || config.maxBytes < 1 || config.maxBytes > MAX_CONFIGURED_BYTES)
    throw new ProtectedEvidenceError('invalid_request');
  const scanTimeoutMs = config.scanTimeoutMs ?? 15_000;
  if (!Number.isSafeInteger(scanTimeoutMs) || scanTimeoutMs < 10 || scanTimeoutMs > 60_000) throw new ProtectedEvidenceError('invalid_request');

  async function requireActor(actor: EvidenceActor) {
    const userId = objectId(actor.userId), branchId = objectId(actor.branchId), sessionId = objectId(actor.sessionId);
    if (!userId || !branchId || !sessionId) throw new ProtectedEvidenceError('unauthorized');
    const user = await User.findById(userId).lean();
    if (!user || !user.isActive || !user.branchId || String(user.branchId) !== branchId.toHexString()) throw new ProtectedEvidenceError('unauthorized');
    const session = await Session.findById(sessionId).lean();
    if (!session || session.isRevoked || String(session.userId) !== userId.toHexString() || session.role !== user.role) throw new ProtectedEvidenceError('unauthorized');
    return { userId, branchId };
  }

  async function requireDomainAccess(authorize: DomainEvidenceAuthorizer | undefined, request: EvidenceAuthorizationRequest) {
    if (!authorize) throw new ProtectedEvidenceError('unauthorized');
    try { if (await authorize(request) === true) return; }
    catch { /* fail closed without surfacing domain-private details */ }
    throw new ProtectedEvidenceError('unauthorized');
  }

  async function revalidate(actor: EvidenceActor, authorize: DomainEvidenceAuthorizer | undefined, request: EvidenceAuthorizationRequest) {
    const current = await requireActor(actor);
    if (current.userId.toHexString() !== request.actorId || current.branchId.toHexString() !== request.branchId) throw new ProtectedEvidenceError('unauthorized');
    await requireDomainAccess(authorize, request);
  }

  async function failRevokedRecord(record: EvidenceRecord, actorId?: Types.ObjectId) {
    let failed: EvidenceRecord | null = null;
    if (record.status === 'intent' || record.status === 'quarantined' || record.status === 'available') {
      failed = await mutate(record, 'failed', {
        scanStatus: 'failed', scanDigest: undefined, scannerId: undefined, scannedAt: undefined,
        scanErrorCode: 'authorization_revoked',
      }, 'authorization_revoked', actorId).catch(() => null);
    }
    const current = failed ?? await ProtectedEvidence.findOne({ evidenceId: record.evidenceId });
    if (current && current.status === 'failed' && current.scanErrorCode === 'authorization_revoked') {
      await config.storage.delete(current.storageObjectKey).catch(() => undefined);
    }
  }

  async function mutate(record: EvidenceRecord, next: EvidenceState, fields: Record<string, unknown>, action: string, actorId?: Types.ObjectId): Promise<EvidenceRecord> {
    if (next !== record.status && !allowedTransitions[record.status as EvidenceState].includes(next)) throw new ProtectedEvidenceError('state_conflict');
    const revision = record.revision + 1;
    const definedFields = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
    const clearedFields = Object.fromEntries(Object.entries(fields).filter(([, value]) => value === undefined).map(([key]) => [key, 1]));
    const update = await ProtectedEvidence.updateOne(
      { evidenceId: record.evidenceId, status: record.status, revision: record.revision },
      { $set: { ...definedFields, status: next }, ...(Object.keys(clearedFields).length ? { $unset: clearedFields } : {}), $inc: { revision: 1 }, $push: { history: { revision, action, actorType: actorId ? 'user' : 'system', ...(actorId ? { actorId } : {}), occurredAt: new Date() } } },
    );
    if (update.modifiedCount !== 1) throw new ProtectedEvidenceError('state_conflict');
    const updated = await ProtectedEvidence.findOne({ evidenceId: record.evidenceId });
    if (!updated) throw new ProtectedEvidenceError('state_conflict');
    return updated;
  }

  async function scanQuarantined(record: EvidenceRecord, authority: Readonly<{ actor: EvidenceActor; authorize?: DomainEvidenceAuthorizer; request: EvidenceAuthorizationRequest }>): Promise<EvidenceRecord> {
    if (!config.scanner) {
      await revalidate(authority.actor, authority.authorize, authority.request);
      return mutate(record, record.status, { scanStatus: 'unavailable', scanErrorCode: 'scanner_unavailable' }, 'scan_unavailable');
    }
    try {
      await revalidate(authority.actor, authority.authorize, authority.request);
      const content = await config.storage.read(record.storageObjectKey, config.maxBytes);
      await revalidate(authority.actor, authority.authorize, authority.request);
      const digest = createHash('sha256').update(content).digest('hex');
      if (digest !== record.sha256 || content.length !== record.byteLength) {
        return mutate(record, 'failed', { scanStatus: 'failed', scanErrorCode: 'scan_digest_mismatch' }, 'validation_failed');
      }
      if (!record.detectedContentType) return mutate(record, 'failed', { scanStatus: 'failed', scanErrorCode: 'scanner_failed' }, 'validation_failed');
      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let result: Awaited<ReturnType<EvidenceScanner['scan']>>;
      try {
        result = await Promise.race([
          config.scanner.scan({ content, sha256: digest, contentType: record.detectedContentType, signal: controller.signal }),
          new Promise<never>((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error('scanner timeout')); }, scanTimeoutMs); }),
        ]);
      } finally { if (timeout) clearTimeout(timeout); }
      await revalidate(authority.actor, authority.authorize, authority.request);
      if (!result || !['clean', 'unsafe', 'unavailable', 'failed'].includes(result.result) || !result.scannerId || result.scannerId.length > 120)
        return mutate(record, record.status, { scanStatus: 'failed', scanErrorCode: 'scanner_failed' }, 'scan_unavailable');
      if (result.result === 'unavailable' || result.result === 'failed')
        return mutate(record, record.status, { scanStatus: result.result, scannerId: result.scannerId, scanErrorCode: result.result === 'unavailable' ? 'scanner_unavailable' : 'scanner_failed' }, 'scan_unavailable');
      if (result.sha256 !== digest)
        return mutate(record, record.status, { scanStatus: 'failed', scannerId: result.scannerId, scanErrorCode: 'scan_digest_mismatch' }, 'scan_unavailable');
      const scannedAt = new Date();
      if (result.result === 'unsafe')
        return mutate(record, 'failed', { scanStatus: 'unsafe', scannerId: result.scannerId, scanDigest: digest, scannedAt }, 'scan_unsafe');
      return mutate(record, 'available', { scanStatus: 'clean', scannerId: result.scannerId, scanDigest: digest, scannedAt, scanErrorCode: undefined }, 'scan_clean');
    } catch {
      try { await revalidate(authority.actor, authority.authorize, authority.request); }
      catch {
        await failRevokedRecord(record, objectId(authority.actor.userId) ?? undefined);
        throw new ProtectedEvidenceError('unauthorized');
      }
      return mutate(record, record.status, { scanStatus: 'unavailable', scanErrorCode: 'scanner_failed' }, 'scan_unavailable');
    }
  }

  async function ingest(input: Readonly<{
    actor: EvidenceActor; operationId: string; domain: EvidenceDomain; purpose: EvidencePurpose;
    ownerType: EvidenceOwnerType; ownerId: string; resourceId: string; retentionPolicyRef: string;
    declaredContentType?: string; source: EvidenceInput; authorize?: DomainEvidenceAuthorizer;
  }>): Promise<EvidenceDto> {
    const { userId, branchId } = await requireActor(input.actor);
    const ownerId = objectId(input.ownerId), resourceId = objectId(input.resourceId);
    if (!ownerId || !resourceId || !/^[A-Za-z0-9._:-]{12,128}$/.test(input.operationId) || !/^[A-Za-z0-9._:-]{1,120}$/.test(input.retentionPolicyRef))
      throw new ProtectedEvidenceError('invalid_request');
    const authorizationRequest: EvidenceAuthorizationRequest = {
      action: 'upload', actorId: userId.toHexString(), branchId: branchId.toHexString(), domain: input.domain,
      purpose: input.purpose, ownerType: input.ownerType, ownerId: ownerId.toHexString(), resourceId: resourceId.toHexString(),
    };
    await requireDomainAccess(input.authorize, authorizationRequest);
    let staged: StagedEvidence;
    try { staged = await config.storage.stage(input.source, config.maxBytes); }
    catch (error) {
      if (error instanceof EvidenceStorageError && ['object_too_large', 'object_missing'].includes(error.code)) throw new ProtectedEvidenceError('invalid_content');
      throw new ProtectedEvidenceError('storage_failure');
    }
    config.storage.keepAlive?.(staged);
    try { await revalidate(input.actor, input.authorize, authorizationRequest); }
    catch (error) {
      await config.storage.discard(staged).catch(() => undefined);
      throw error;
    }
    const detectedContentType = detectContent(staged.prefix, staged.suffix);
    if (!detectedContentType) { await config.storage.discard(staged); throw new ProtectedEvidenceError('unsupported_content'); }
    if (input.declaredContentType && input.declaredContentType !== detectedContentType) {
      await config.storage.discard(staged);
      throw new ProtectedEvidenceError('content_mismatch');
    }
    const fingerprint = createHash('sha256').update(JSON.stringify({
      domain: input.domain, purpose: input.purpose, branchId: branchId.toHexString(), ownerType: input.ownerType,
      ownerId: ownerId.toHexString(), resourceId: resourceId.toHexString(), retentionPolicyRef: input.retentionPolicyRef,
      declaredContentType: input.declaredContentType ?? null, byteLength: staged.byteLength, sha256: staged.sha256,
    })).digest('hex');
    const existing = await ProtectedEvidence.findOne({ uploaderId: userId, operationId: input.operationId });
    if (existing) {
      await config.storage.discard(staged);
      await revalidate(input.actor, input.authorize, authorizationRequest);
      if (existing.payloadFingerprint !== fingerprint) throw new ProtectedEvidenceError('operation_conflict');
      if (existing.status === 'intent') {
        await recover(existing.evidenceId);
        const resumed = await ProtectedEvidence.findOne({ evidenceId: existing.evidenceId });
        if (resumed?.status === 'quarantined') return safeDto(await scanQuarantined(resumed, { actor: input.actor, authorize: input.authorize, request: authorizationRequest }));
        if (resumed) {
          await revalidate(input.actor, input.authorize, authorizationRequest);
          return safeDto(resumed);
        }
      }
      if (existing.status === 'quarantined') return safeDto(await scanQuarantined(existing, { actor: input.actor, authorize: input.authorize, request: authorizationRequest }));
      await revalidate(input.actor, input.authorize, authorizationRequest);
      return safeDto(existing);
    }
    try { await revalidate(input.actor, input.authorize, authorizationRequest); }
    catch (error) {
      await config.storage.discard(staged).catch(() => undefined);
      throw error;
    }
    const evidenceId = randomUUID().replaceAll('-', '');
    const storageObjectKey = randomUUID().replaceAll('-', '');
    let record: EvidenceRecord;
    try {
      record = await ProtectedEvidence.create({
        evidenceId, domain: input.domain, purpose: input.purpose, branchId, ownerType: input.ownerType,
        ownerId, resourceId, uploaderId: userId, operationId: input.operationId, payloadFingerprint: fingerprint,
        storageObjectKey, declaredContentType: input.declaredContentType, byteLength: staged.byteLength,
        sha256: staged.sha256, detectedContentType, status: 'intent', scanStatus: 'not_scanned', revision: 1,
        retentionPolicyRef: input.retentionPolicyRef, history: [{ revision: 1, action: 'intent_created', actorType: 'user', actorId: userId, occurredAt: new Date() }],
      });
    } catch (error) {
      await config.storage.discard(staged);
      if ((error as { code?: number }).code === 11000) {
        const raced = await ProtectedEvidence.findOne({ uploaderId: userId, operationId: input.operationId });
        await revalidate(input.actor, input.authorize, authorizationRequest);
        if (raced?.payloadFingerprint === fingerprint) {
          let canonical = raced;
          if (canonical.status === 'intent') {
            await recover(canonical.evidenceId);
            canonical = await ProtectedEvidence.findOne({ evidenceId: canonical.evidenceId }) ?? canonical;
          }
          if (canonical.status === 'quarantined') canonical = await scanQuarantined(canonical, { actor: input.actor, authorize: input.authorize, request: authorizationRequest });
          await revalidate(input.actor, input.authorize, authorizationRequest);
          return safeDto(canonical);
        }
        throw new ProtectedEvidenceError('operation_conflict');
      }
      throw new ProtectedEvidenceError('storage_failure');
    }
    try { await revalidate(input.actor, input.authorize, authorizationRequest); }
    catch (error) {
      await config.storage.discard(staged).catch(() => undefined);
      await mutate(record, 'failed', { scanStatus: 'failed', scanErrorCode: 'authorization_revoked' }, 'authorization_revoked', userId).catch(() => undefined);
      throw error;
    }
    try { await config.storage.promote(staged, storageObjectKey); }
    catch {
      await config.storage.discard(staged).catch(() => undefined);
      const failed = await mutate(record, 'failed', { scanStatus: 'failed' }, 'ingestion_failed', userId).catch(() => null);
      if (!failed) throw new ProtectedEvidenceError('storage_failure');
      throw new ProtectedEvidenceError('storage_failure');
    }
    try { await revalidate(input.actor, input.authorize, authorizationRequest); }
    catch (error) {
      await failRevokedRecord(record, userId);
      throw error;
    }
    try { record = await mutate(record, 'quarantined', { scanStatus: 'pending' }, 'content_quarantined', userId); }
    catch (error) {
      if (!(error instanceof ProtectedEvidenceError) || error.code !== 'state_conflict') throw error;
      const current = await ProtectedEvidence.findOne({
        evidenceId, uploaderId: userId, branchId, domain: input.domain, purpose: input.purpose,
        ownerType: input.ownerType, ownerId, resourceId, payloadFingerprint: fingerprint,
      });
      if (!current || !['quarantined', 'available'].includes(current.status)) throw error;
      await revalidate(input.actor, input.authorize, authorizationRequest);
      if (current.status === 'available') {
        if (current.scanStatus !== 'clean' || !current.sha256 || !/^[a-f0-9]{64}$/.test(current.sha256)
          || current.scanDigest !== current.sha256 || !current.detectedContentType
          || !Number.isSafeInteger(current.byteLength) || !current.byteLength || !current.scannerId || !current.scannedAt) throw error;
        return safeDto(current);
      }
      record = current;
    }
    if (!record) throw new ProtectedEvidenceError('storage_failure');
    record = await scanQuarantined(record, { actor: input.actor, authorize: input.authorize, request: authorizationRequest });
    try { await revalidate(input.actor, input.authorize, authorizationRequest); }
    catch (error) {
      await failRevokedRecord(record, userId);
      throw error;
    }
    return safeDto(record);
  }

  async function readAvailable(input: Readonly<{ actor: EvidenceActor; evidenceId: string; authorize?: DomainEvidenceAuthorizer }>) {
    const { userId, branchId } = await requireActor(input.actor);
    if (!/^[a-f0-9]{32}$/.test(input.evidenceId)) throw new ProtectedEvidenceError('not_found');
    const record = await ProtectedEvidence.findOne({ evidenceId: input.evidenceId, branchId });
    if (!record) throw new ProtectedEvidenceError('not_found');
    const authorizationRequest: EvidenceAuthorizationRequest = {
      action: 'read', actorId: userId.toHexString(), branchId: branchId.toHexString(), domain: record.domain,
      purpose: record.purpose, ownerType: record.ownerType, ownerId: String(record.ownerId), resourceId: String(record.resourceId),
    };
    await requireDomainAccess(input.authorize, authorizationRequest);
    if (record.status !== 'available' || record.scanStatus !== 'clean' || record.scanDigest !== record.sha256)
      throw new ProtectedEvidenceError('not_available');
    try {
      const content = await config.storage.read(record.storageObjectKey, config.maxBytes);
      const digest = createHash('sha256').update(content).digest('hex');
      if (content.length !== record.byteLength || digest !== record.sha256 || detectContent(content.subarray(0, 32), content.subarray(-32)) !== record.detectedContentType) {
        await mutate(record, 'failed', { scanStatus: 'failed', scanDigest: undefined, scannerId: undefined, scannedAt: undefined, scanErrorCode: 'scan_digest_mismatch' }, 'availability_invalidated').catch(() => undefined);
        throw new ProtectedEvidenceError('not_available');
      }
      await revalidate(input.actor, input.authorize, authorizationRequest);
      return { metadata: safeDto(record), content: Buffer.from(content), contentType: record.detectedContentType as string };
    } catch (error) {
      if (error instanceof ProtectedEvidenceError) throw error;
      await mutate(record, 'failed', { scanStatus: 'failed', scanDigest: undefined, scannerId: undefined, scannedAt: undefined, scanErrorCode: 'scanner_failed' }, 'availability_invalidated').catch(() => undefined);
      throw new ProtectedEvidenceError('not_available');
    }
  }

  async function requestDeletion(input: Readonly<{ actor: EvidenceActor; evidenceId: string; authorize?: DomainEvidenceAuthorizer }>): Promise<EvidenceDto> {
    const { userId, branchId } = await requireActor(input.actor);
    const record = await ProtectedEvidence.findOne({ evidenceId: input.evidenceId, branchId });
    if (!record) throw new ProtectedEvidenceError('not_found');
    const authorizationRequest: EvidenceAuthorizationRequest = {
      action: 'delete', actorId: userId.toHexString(), branchId: branchId.toHexString(), domain: record.domain,
      purpose: record.purpose, ownerType: record.ownerType, ownerId: String(record.ownerId), resourceId: String(record.resourceId),
    };
    await requireDomainAccess(input.authorize, authorizationRequest);
    if (record.status === 'deleted') {
      await revalidate(input.actor, input.authorize, authorizationRequest);
      return safeDto(record);
    }
    if (record.status !== 'deletion_pending') {
      await revalidate(input.actor, input.authorize, authorizationRequest);
      await mutate(record, 'deletion_pending', { deletedBy: userId, deletionRequestedAt: new Date() }, 'deletion_requested', userId);
    }
    const pending = await ProtectedEvidence.findOne({ evidenceId: record.evidenceId });
    if (!pending || pending.status !== 'deletion_pending') throw new ProtectedEvidenceError('state_conflict');
    await revalidate(input.actor, input.authorize, authorizationRequest);
    try { await config.storage.delete(pending.storageObjectKey); }
    catch { throw new ProtectedEvidenceError('storage_failure'); }
    const deleted = await mutate(pending, 'deleted', { deletedAt: new Date() }, 'deleted', userId);
    // Once physical deletion begins, finish metadata reconciliation even if
    // authority changes; otherwise the record would misstate file existence.
    await revalidate(input.actor, input.authorize, authorizationRequest);
    return safeDto(deleted);
  }

  async function recover(evidenceId: string): Promise<void> {
    if (!/^[a-f0-9]{32}$/.test(evidenceId)) throw new ProtectedEvidenceError('not_found');
    let record = await ProtectedEvidence.findOne({ evidenceId });
    if (!record) throw new ProtectedEvidenceError('not_found');
    if (record.status === 'deleted') return;
    if (record.status === 'deletion_pending') {
      try { await config.storage.delete(record.storageObjectKey); }
      catch {
        record = await mutate(record, record.status, { recoveryAttempts: record.recoveryAttempts + 1, lastRecoveryAt: new Date(), lastRecoveryErrorCode: 'storage_unavailable' }, 'recovery_failed');
        throw new ProtectedEvidenceError('storage_failure');
      }
      record = await mutate(record, 'deleted', { deletedAt: new Date(), recoveryAttempts: record.recoveryAttempts + 1, lastRecoveryAt: new Date(), lastRecoveryErrorCode: undefined }, 'deleted');
      return;
    }
    if (record.status === 'failed' && record.scanErrorCode === 'authorization_revoked') {
      await config.storage.delete(record.storageObjectKey).catch(() => undefined);
      return;
    }
    if (record.status === 'intent' || record.status === 'quarantined' || record.status === 'available') {
      let content: Buffer;
      try { content = await config.storage.read(record.storageObjectKey, config.maxBytes); }
      catch {
        if (record.status === 'intent') {
          // An ingestion may still be between durable intent creation and
          // promotion. Do not revise its live CAS token or mark it failed.
          return;
        }
        await mutate(record, 'failed', { recoveryAttempts: record.recoveryAttempts + 1, lastRecoveryAt: new Date(), lastRecoveryErrorCode: 'object_missing', scanStatus: 'failed' }, 'recovery_failed');
        throw new ProtectedEvidenceError('not_available');
      }
      const digest = createHash('sha256').update(content).digest('hex');
      if (digest !== record.sha256 || content.length !== record.byteLength || detectContent(content.subarray(0, 32), content.subarray(-32)) !== record.detectedContentType) {
        await mutate(record, 'failed', { recoveryAttempts: record.recoveryAttempts + 1, lastRecoveryAt: new Date(), lastRecoveryErrorCode: 'digest_mismatch', scanStatus: 'failed', scanDigest: undefined, scannerId: undefined, scannedAt: undefined }, 'recovery_failed');
        throw new ProtectedEvidenceError('not_available');
      }
      if (record.status === 'intent') record = await mutate(record, 'quarantined', { scanStatus: 'pending', recoveryAttempts: record.recoveryAttempts + 1, lastRecoveryAt: new Date(), lastRecoveryErrorCode: undefined }, 'recovery_completed');
      else if (record.status === 'available') {
        if (record.scanStatus === 'clean' && record.scanDigest === record.sha256 && record.sha256 === digest) return;
        await mutate(record, 'failed', { recoveryAttempts: record.recoveryAttempts + 1, lastRecoveryAt: new Date(), lastRecoveryErrorCode: 'digest_mismatch', scanStatus: 'failed' }, 'recovery_failed');
        throw new ProtectedEvidenceError('not_available');
      }
      if (!record) throw new ProtectedEvidenceError('state_conflict');
      return;
    }
  }

  async function recoverStagedFiles(olderThanMs: number): Promise<number> {
    return config.storage.cleanupStaged(olderThanMs);
  }

  return Object.freeze({ ingest, readAvailable, requestDeletion, recover, recoverStagedFiles });
}
