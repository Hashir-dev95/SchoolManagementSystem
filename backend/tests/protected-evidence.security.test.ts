import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import Branch from '../src/models/branch';
import User from '../src/models/user';
import Session from '../src/models/session';
import { ProtectedEvidence, ensureProtectedEvidenceIndexes, type EvidencePurpose } from '../src/models/protectedEvidence';
import { createPrivateFilesystemEvidenceStorage, EvidenceStorageError } from '../src/services/protected-evidence-storage';
import { createProtectedEvidenceService, ProtectedEvidenceError, type DomainEvidenceAuthorizer, type EvidenceActor, type EvidenceScanner } from '../src/services/protected-evidence.service';

const pdf = Buffer.from('%PDF-1.7\nsynthetic-safe-fixture\n%%EOF\n', 'ascii');
const ownerAllow: DomainEvidenceAuthorizer = async request => request.domain === 'parent_leave' && request.purpose === 'medical_attachment' && request.branchId === branch?.toHexString() && request.ownerId === owner?.toHexString() && request.resourceId === resource?.toHexString() && request.action !== 'delete';
let replica: MongoMemoryReplSet;
let storageRoot: string;
let storage: Awaited<ReturnType<typeof createPrivateFilesystemEvidenceStorage>>;
let service: ReturnType<typeof createProtectedEvidenceService>;
let actor: EvidenceActor;
let branch: mongoose.Types.ObjectId;
let owner: mongoose.Types.ObjectId;
let resource: mongoose.Types.ObjectId;
let user: mongoose.Types.ObjectId;
let session: mongoose.Types.ObjectId;
const originalNodeEnv = process.env.NODE_ENV;
const scanner: EvidenceScanner = {
  async scan(scanInput) { return { result: 'clean', scannerId: 'synthetic-test-scanner-v1', sha256: scanInput.sha256 }; },
};

before(async () => {
  process.env.NODE_ENV = 'test';
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replica.getUri(), { dbName: 'protected_evidence_isolated', autoIndex: false });
  await ensureProtectedEvidenceIndexes();
});

beforeEach(async () => {
  for (const collection of await mongoose.connection.db!.collections()) await collection.deleteMany({});
  storageRoot = await mkdtemp(path.join(os.tmpdir(), 'school-app-private-evidence-'));
  storage = await createPrivateFilesystemEvidenceStorage(storageRoot);
  service = createProtectedEvidenceService({ storage, maxBytes: 10_000, scanner });
  const branchRecord = await Branch.create({ name: 'Evidence Test Branch', code: `EV${randomUUID().slice(0, 6).toUpperCase()}`, address: 'Test only', city: 'Test only', isActive: true });
  branch = branchRecord._id;
  const userRecord = await User.create({ fullName: 'Synthetic Parent', email: `${randomUUID()}@example.invalid`, password: 'synthetic-only-password', role: 'parent', branchId: branch as unknown as mongoose.Schema.Types.ObjectId, isActive: true });
  user = userRecord._id;
  const sessionRecord = await Session.create({ token: `synthetic-session-${randomUUID()}`, userId: user, role: 'parent', isRevoked: false });
  session = sessionRecord._id;
  owner = new mongoose.Types.ObjectId();
  resource = new mongoose.Types.ObjectId();
  actor = { userId: user.toHexString(), branchId: branch.toHexString(), sessionId: session.toHexString() };
});

after(async () => {
  await mongoose.disconnect();
  await replica.stop();
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalNodeEnv;
});

afterEach(async () => { if (storageRoot) await rm(storageRoot, { recursive: true, force: true }); });

function input(overrides: Partial<Parameters<typeof service.ingest>[0]> = {}): Parameters<typeof service.ingest>[0] {
  return {
    actor, operationId: `operation-${randomUUID()}`, domain: 'parent_leave', purpose: 'medical_attachment',
    ownerType: 'student', ownerId: owner.toHexString(), resourceId: resource.toHexString(), retentionPolicyRef: 'retention.school-parent-leave.v1',
    declaredContentType: 'application/pdf', source: pdf, authorize: ownerAllow, ...overrides,
  };
}

function barrier<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('metadata rejects unknown authority fields and incompatible domain purpose', async () => {
  const base = {
    evidenceId: randomUUID().replaceAll('-', ''), domain: 'parent_leave', purpose: 'medical_attachment', branchId: branch,
    ownerType: 'student', ownerId: owner, resourceId: resource, uploaderId: user, operationId: `operation-${randomUUID()}`,
    payloadFingerprint: 'a'.repeat(64), storageObjectKey: randomUUID().replaceAll('-', ''), byteLength: pdf.length,
    sha256: createHash('sha256').update(pdf).digest('hex'), detectedContentType: 'application/pdf', status: 'quarantined',
    scanStatus: 'pending', revision: 1, retentionPolicyRef: 'retention.test.v1', history: [{ revision: 1, action: 'intent_created', actorType: 'user', actorId: user, occurredAt: new Date() }],
  };
  assert.throws(() => new ProtectedEvidence({ ...base, arbitraryAuthority: true }), /arbitraryAuthority/);
  await assert.rejects(new ProtectedEvidence({ ...base, purpose: 'verification' as EvidencePurpose }).validate());
  await assert.rejects(new ProtectedEvidence({ ...base, status: 'available' }).validate());
});

test('database enforces unique operation and storage identities and keeps evidence revision independent', async () => {
  const first = await service.ingest(input());
  const record = await ProtectedEvidence.findOne({ evidenceId: first.evidenceId });
  assert.equal(record?.revision, 3);
  assert.equal(record?.__v, 0);
  const duplicate = await service.ingest(input({ operationId: (await ProtectedEvidence.findOne({ evidenceId: first.evidenceId }))!.operationId }));
  assert.equal(duplicate.evidenceId, first.evidenceId);
  assert.equal(await ProtectedEvidence.countDocuments(), 1);
  const doc = await ProtectedEvidence.findOne({ evidenceId: first.evidenceId }).select('+history').orFail();
  const duplicateKey = (error: unknown, pattern: Record<string, number>) => {
    assert.ok(error instanceof Error);
    assert.equal((error as Error & { code?: number }).code, 11000);
    assert.deepEqual((error as Error & { keyPattern?: Record<string, number> }).keyPattern, pattern);
    return true;
  };
  const copy = doc.toObject();
  copy._id = new mongoose.Types.ObjectId();
  copy.evidenceId = randomUUID().replaceAll('-', '');
  copy.operationId = `operation-${randomUUID()}`;
  await assert.rejects(ProtectedEvidence.create(copy), error => duplicateKey(error, { storageObjectKey: 1 }));
  copy._id = new mongoose.Types.ObjectId();
  copy.evidenceId = doc.evidenceId;
  copy.operationId = `operation-${randomUUID()}`;
  copy.storageObjectKey = randomUUID().replaceAll('-', '');
  await assert.rejects(ProtectedEvidence.create(copy), error => duplicateKey(error, { evidenceId: 1 }));
  copy._id = new mongoose.Types.ObjectId();
  copy.evidenceId = randomUUID().replaceAll('-', '');
  copy.operationId = doc.operationId;
  copy.storageObjectKey = randomUUID().replaceAll('-', '');
  await assert.rejects(ProtectedEvidence.create(copy), error => duplicateKey(error, { uploaderId: 1, operationId: 1 }));
});

test('valid PDF is stored privately with detected MIME and server digest, but DTO omits internal references', async () => {
  const result = await service.ingest(input({ declaredContentType: 'application/pdf' }));
  assert.equal(result.status, 'available');
  assert.equal(result.contentType, 'application/pdf');
  assert.equal(result.byteLength, pdf.length);
  assert.equal('storageObjectKey' in result, false);
  assert.equal('sha256' in result, false);
  const record = await ProtectedEvidence.findOne({ evidenceId: result.evidenceId }).orFail();
  assert.equal(record.sha256, createHash('sha256').update(pdf).digest('hex'));
  const objectBytes = await readFile(path.join(storageRoot, record.storageObjectKey));
  assert.deepEqual(objectBytes, pdf);
});

test('PNG and JPEG signatures are detected without trusting the declared MIME', async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.alloc(13), Buffer.alloc(4), Buffer.from([0, 0, 0, 0]), Buffer.from('IEND'), Buffer.from([0xae, 0x42, 0x60, 0x82])]);
  const pngResult = await service.ingest(input({ source: png, declaredContentType: 'image/png' }));
  assert.equal(pngResult.contentType, 'image/png');
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const jpegResult = await service.ingest(input({ source: jpeg, declaredContentType: 'image/jpeg' }));
  assert.equal(jpegResult.contentType, 'image/jpeg');
});

test('empty, oversized, unsupported and MIME-mismatched content is rejected and leaves no metadata or files', async () => {
  await assert.rejects(service.ingest(input({ source: Buffer.alloc(0) })), (error: unknown) => error instanceof ProtectedEvidenceError);
  await assert.rejects(service.ingest(input({ source: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(10_001)]) })), (error: unknown) => error instanceof ProtectedEvidenceError && error.code === 'invalid_content');
  await assert.rejects(service.ingest(input({ source: Buffer.from('%PDF-1.7 header without required EOF marker') })), (error: unknown) => error instanceof ProtectedEvidenceError && error.code === 'unsupported_content');
  await assert.rejects(service.ingest(input({ source: Buffer.from('MZ executable') })), (error: unknown) => error instanceof ProtectedEvidenceError && error.code === 'unsupported_content');
  await assert.rejects(service.ingest(input({ declaredContentType: 'image/png' })), (error: unknown) => error instanceof ProtectedEvidenceError && error.code === 'content_mismatch');
  assert.equal(await ProtectedEvidence.countDocuments(), 0);
  assert.deepEqual(await readdir(storageRoot), []);
});

test('unsafe object keys and public or implicit production storage roots are rejected', async () => {
  await assert.rejects(storage.read('../secrets', 100), (error: unknown) => error instanceof EvidenceStorageError && error.code === 'unsafe_object_key');
  await assert.rejects(createPrivateFilesystemEvidenceStorage(path.resolve(process.cwd(), 'public', 'evidence')), (error: unknown) => error instanceof EvidenceStorageError && error.code === 'invalid_storage_root');
  await assert.rejects(createPrivateFilesystemEvidenceStorage(''), (error: unknown) => error instanceof EvidenceStorageError && error.code === 'invalid_storage_root');
  process.env.NODE_ENV = '';
  await assert.rejects(createPrivateFilesystemEvidenceStorage(storageRoot), (error: unknown) => error instanceof EvidenceStorageError && error.code === 'invalid_storage_root');
  process.env.NODE_ENV = 'test';
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try { await assert.rejects(createPrivateFilesystemEvidenceStorage(storageRoot), (error: unknown) => error instanceof EvidenceStorageError && error.code === 'invalid_storage_root'); }
  finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});

test('input streams have an idle bound and timed-out partial files are removed', async () => {
  const shortTimeoutStorage = await createPrivateFilesystemEvidenceStorage(storageRoot, { inputIdleTimeoutMs: 10 });
  const stalled: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<Uint8Array>>(resolve => setTimeout(() => resolve({ done: false, value: pdf }), 40)) }; } };
  await assert.rejects(shortTimeoutStorage.stage(stalled, 10_000), (error: unknown) => error instanceof EvidenceStorageError && error.code === 'storage_unavailable');
  assert.deepEqual(await readdir(storageRoot), []);
});

test('storage never replaces existing object contents', async () => {
  const stagedA = await storage.stage(pdf, 10_000);
  const key = randomUUID().replaceAll('-', '');
  await storage.promote(stagedA, key);
  const stagedB = await storage.stage(Buffer.from('%PDF-1.4\nother'), 10_000);
  await assert.rejects(storage.promote(stagedB, key), (error: unknown) => error instanceof EvidenceStorageError && error.code === 'object_exists');
  await storage.discard(stagedB);
  assert.deepEqual(await storage.read(key, 10_000), pdf);
});

test('storage refuses symbolic-link object targets and preserves the external target', async t => {
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), 'school-app-evidence-link-target-'));
  const outsideFile = path.join(outsideRoot, 'private-target.bin');
  const objectKey = randomUUID().replaceAll('-', '');
  const linkPath = path.join(storageRoot, objectKey);
  const outsideBytes = Buffer.from('outside target must remain untouched');
  await writeFile(outsideFile, outsideBytes);
  try {
    await symlink(outsideFile, linkPath, 'file');
  } catch (error) {
    await rm(outsideRoot, { recursive: true, force: true });
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'EACCES' || code === 'ENOSYS') {
      t.skip(`symbolic links are unavailable in this environment (${code})`);
      return;
    }
    throw error;
  }
  try {
    await assert.rejects(storage.read(objectKey, 10_000), (error: unknown) => error instanceof EvidenceStorageError);
    await assert.rejects(storage.delete(objectKey), (error: unknown) => error instanceof EvidenceStorageError);
    assert.deepEqual(await readFile(outsideFile), outsideBytes);
  } finally { await rm(outsideRoot, { recursive: true, force: true }); }
});

test('incomplete staged filesystem writes can be safely recovered repeatedly', async () => {
  const stagedPath = path.join(storageRoot, `.stage-${randomUUID().replaceAll('-', '')}`);
  await writeFile(stagedPath, Buffer.from('orphaned stage from a prior process'));
  const old = new Date(Date.now() - 60 * 60 * 1000);
  await utimes(stagedPath, old, old);
  const cleanupAdapter = await createPrivateFilesystemEvidenceStorage(storageRoot);
  assert.equal(await cleanupAdapter.cleanupStaged(15 * 60 * 1000), 1);
  assert.equal(await cleanupAdapter.cleanupStaged(15 * 60 * 1000), 0);
  assert.deepEqual(await readdir(storageRoot), []);
});

test('session revocation during asynchronous staging discards bytes before metadata creation', async () => {
  const entered = barrier();
  const release = barrier();
  const stagedStorage = {
    ...storage,
    async stage(source: Parameters<typeof storage.stage>[0], maxBytes: number) {
      const staged = await storage.stage(source, maxBytes);
      entered.resolve();
      await release.promise;
      return staged;
    },
  };
  const local = createProtectedEvidenceService({ storage: stagedStorage, maxBytes: 10_000, scanner });
  const attempt = local.ingest(input());
  await entered.promise;
  await Session.updateOne({ _id: session }, { $set: { isRevoked: true } });
  release.resolve();
  await assert.rejects(attempt, (error: unknown) => error instanceof ProtectedEvidenceError && error.code === 'unauthorized');
  assert.equal(await ProtectedEvidence.countDocuments(), 0);
  assert.deepEqual(await readdir(storageRoot), []);
});

test('domain authorization revoked while scanning never leaves evidence available', async () => {
  const scanEntered = barrier();
  const releaseScan = barrier();
  let allowed = true;
  const authorize: DomainEvidenceAuthorizer = async request => allowed && request.action === 'upload' && request.ownerId === owner.toHexString();
  const delayedScanner: EvidenceScanner = {
    async scan(scanInput) {
      scanEntered.resolve();
      await releaseScan.promise;
      return { result: 'clean', scannerId: 'synthetic-delayed-scanner', sha256: scanInput.sha256 };
    },
  };
  const local = createProtectedEvidenceService({ storage, maxBytes: 10_000, scanner: delayedScanner });
  const attempt = local.ingest(input({ authorize }));
  await scanEntered.promise;
  allowed = false;
  releaseScan.resolve();
  await assert.rejects(attempt, (error: unknown) => error instanceof ProtectedEvidenceError && error.code === 'unauthorized');
  const saved = await ProtectedEvidence.findOne({}).orFail();
  assert.equal(saved.status, 'failed');
  assert.equal(saved.scanErrorCode, 'authorization_revoked');
  await assert.rejects(storage.read(saved.storageObjectKey, 10_000));
});

test('read rechecks session after storage returns bytes and never returns stale-authority content', async () => {
  const created = await service.ingest(input());
  const readEntered = barrier();
  const releaseRead = barrier();
  const delayedStorage = {
    ...storage,
    async read(key: string, maxBytes: number) {
      const content = await storage.read(key, maxBytes);
      readEntered.resolve();
      await releaseRead.promise;
      return content;
    },
  };
  const local = createProtectedEvidenceService({ storage: delayedStorage, maxBytes: 10_000, scanner });
  let returned = false;
  const attempt = local.readAvailable({ actor, evidenceId: created.evidenceId, authorize: ownerAllow }).then(value => { returned = true; return value; });
  await readEntered.promise;
  await Session.updateOne({ _id: session }, { $set: { isRevoked: true } });
  releaseRead.resolve();
  await assert.rejects(attempt, (error: unknown) => error instanceof ProtectedEvidenceError && error.code === 'unauthorized');
  assert.equal(returned, false);
});

test('active stage is protected from concurrent cleanup and abandoned stages are recovered idempotently', async () => {
  const entered = barrier();
  const release = barrier();
  const delayedInput: AsyncIterable<Uint8Array> = {
    async *[Symbol.asyncIterator]() {
      yield pdf.subarray(0, 12);
      entered.resolve();
      await release.promise;
      yield pdf.subarray(12);
    },
  };
  const staging = storage.stage(delayedInput, 10_000);
  await entered.promise;
  const stageName = (await readdir(storageRoot)).find(name => name.startsWith('.stage-'));
  assert.ok(stageName);
  const old = new Date(Date.now() - 60 * 60 * 1000);
  await utimes(path.join(storageRoot, stageName), old, old);
  const cleanupAdapter = await createPrivateFilesystemEvidenceStorage(storageRoot);
  assert.equal(await cleanupAdapter.cleanupStaged(15 * 60 * 1000), 0);
  assert.equal((await readdir(storageRoot)).includes(stageName), true);
  release.resolve();
  const finished = await staging;
  assert.equal(await cleanupAdapter.cleanupStaged(15 * 60 * 1000), 0);
  await storage.discard(finished);

  const abandonedName = `.stage-${randomUUID().replaceAll('-', '')}`;
  const abandonedPath = path.join(storageRoot, abandonedName);
  await writeFile(abandonedPath, Buffer.from('abandoned stage'));
  await utimes(abandonedPath, old, old);
  assert.equal(await storage.cleanupStaged(15 * 60 * 1000), 1);
  assert.equal(await storage.cleanupStaged(15 * 60 * 1000), 0);
  assert.deepEqual(await readdir(storageRoot), []);
});

test('missing scanner configuration leaves evidence quarantined and unreadable', async () => {
  const noScanner = createProtectedEvidenceService({ storage, maxBytes: 10_000 });
  const forged = { ...input(), status: 'available', scanStatus: 'clean', scannerId: 'client-forged', scanDigest: createHash('sha256').update(pdf).digest('hex') } as Parameters<typeof service.ingest>[0];
  const result = await noScanner.ingest(forged);
  assert.equal(result.status, 'quarantined');
  const saved = await ProtectedEvidence.findOne({ evidenceId: result.evidenceId }).orFail();
  assert.equal(saved.scannerId, undefined);
  assert.equal(saved.scanStatus, 'unavailable');
  await assert.rejects(noScanner.readAvailable({ actor, evidenceId: result.evidenceId, authorize: ownerAllow }), (error: unknown) => error instanceof ProtectedEvidenceError && error.code === 'not_available');
});

test('unsafe, failed, unavailable and digest-mismatched scans never make evidence available', async () => {
  const outcomes: EvidenceScanner[] = [
    { scan: async x => ({ result: 'unsafe', scannerId: 'synthetic', sha256: x.sha256 }) },
    { scan: async x => ({ result: 'failed', scannerId: 'synthetic', sha256: x.sha256 }) },
    { scan: async x => ({ result: 'unavailable', scannerId: 'synthetic', sha256: x.sha256 }) },
    { scan: async () => ({ result: 'clean', scannerId: 'synthetic', sha256: '0'.repeat(64) }) },
  ];
  for (const testScanner of outcomes) {
    const local = createProtectedEvidenceService({ storage, maxBytes: 10_000, scanner: testScanner });
    const result = await local.ingest(input({ operationId: `operation-${randomUUID()}` }));
    assert.notEqual(result.status, 'available');
    await assert.rejects(local.readAvailable({ actor, evidenceId: result.evidenceId, authorize: ownerAllow }));
  }
});

test('scanner timeout aborts work and leaves evidence quarantined', async () => {
  const timeoutScanner: EvidenceScanner = {
    scan: ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
  };
  const local = createProtectedEvidenceService({ storage, maxBytes: 10_000, scanTimeoutMs: 10, scanner: timeoutScanner });
  const result = await local.ingest(input());
  assert.equal(result.status, 'quarantined');
  const stored = await ProtectedEvidence.findOne({ evidenceId: result.evidenceId }).orFail();
  assert.equal(stored.scanStatus, 'unavailable');
  assert.equal(stored.scanErrorCode, 'scanner_failed');
});

test('cross-Branch, cross-domain, foreign-owner, and missing domain grants cannot retrieve evidence', async () => {
  const result = await service.ingest(input());
  const denied: DomainEvidenceAuthorizer = async () => false;
  await assert.rejects(service.readAvailable({ actor, evidenceId: result.evidenceId, authorize: denied }), (error: unknown) => error instanceof ProtectedEvidenceError && error.code === 'unauthorized');
  await assert.rejects(service.readAvailable({ actor: { ...actor, branchId: new mongoose.Types.ObjectId().toHexString() }, evidenceId: result.evidenceId, authorize: ownerAllow }), (error: unknown) => error instanceof ProtectedEvidenceError);
  await assert.rejects(service.readAvailable({ actor, evidenceId: result.evidenceId }), (error: unknown) => error instanceof ProtectedEvidenceError && error.code === 'unauthorized');
  await assert.rejects(service.ingest(input({ authorize: denied })), (error: unknown) => error instanceof ProtectedEvidenceError && error.code === 'unauthorized');
  const custodyService = createProtectedEvidenceService({ storage, maxBytes: 10_000, scanner });
  const custodyAuthorize: DomainEvidenceAuthorizer = async request => request.domain === 'custody' && request.purpose === 'verification';
  const custodyEvidence = await custodyService.ingest(input({ domain: 'custody', purpose: 'verification', authorize: custodyAuthorize }));
  await assert.rejects(custodyService.readAvailable({ actor, evidenceId: custodyEvidence.evidenceId, authorize: ownerAllow }), (error: unknown) => error instanceof ProtectedEvidenceError && error.code === 'unauthorized');
});

test('malformed owner and resource identifiers are rejected before staging', async () => {
  await assert.rejects(service.ingest(input({ ownerId: 'bad-id' })), (error: unknown) => error instanceof ProtectedEvidenceError && error.code === 'invalid_request');
  await assert.rejects(service.ingest(input({ resourceId: 'bad-id' })), (error: unknown) => error instanceof ProtectedEvidenceError && error.code === 'invalid_request');
  assert.deepEqual(await readdir(storageRoot), []);
});

test('persisted domain and ownership bindings cannot be retargeted', async () => {
  const result = await service.ingest(input());
  const original = await ProtectedEvidence.findOne({ evidenceId: result.evidenceId }).orFail();
  const ownerId = String(original.ownerId), resourceId = String(original.resourceId), domain = original.domain;
  original.ownerId = new mongoose.Types.ObjectId();
  original.resourceId = new mongoose.Types.ObjectId();
  original.domain = 'custody';
  await assert.rejects(original.save(), (error: unknown) => error instanceof mongoose.Error.ValidationError);
  const stored = await ProtectedEvidence.findOne({ evidenceId: result.evidenceId }).orFail();
  assert.equal(String(stored.ownerId), ownerId);
  assert.equal(String(stored.resourceId), resourceId);
  assert.equal(stored.domain, domain);
});

test('revoked or mismatched canonical session and inactive account are denied', async () => {
  const result = await service.ingest(input());
  await Session.updateOne({ _id: session }, { $set: { isRevoked: true } });
  await assert.rejects(service.readAvailable({ actor, evidenceId: result.evidenceId, authorize: ownerAllow }), (error: unknown) => error instanceof ProtectedEvidenceError && error.code === 'unauthorized');
  await Session.updateOne({ _id: session }, { $set: { isRevoked: false } });
  await User.updateOne({ _id: user }, { $set: { role: 'teacher' } });
  await assert.rejects(service.readAvailable({ actor, evidenceId: result.evidenceId, authorize: ownerAllow }), (error: unknown) => error instanceof ProtectedEvidenceError && error.code === 'unauthorized');
  await User.updateOne({ _id: user }, { $set: { role: 'parent' } });
  await User.updateOne({ _id: user }, { $set: { isActive: false } });
  await assert.rejects(service.readAvailable({ actor, evidenceId: result.evidenceId, authorize: ownerAllow }), (error: unknown) => error instanceof ProtectedEvidenceError && error.code === 'unauthorized');
});

test('duplicate operation replay is idempotent and conflicting payload replay is rejected', async () => {
  const firstInput = input();
  const first = await service.ingest(firstInput);
  const replay = await service.ingest(firstInput);
  assert.equal(replay.evidenceId, first.evidenceId);
  assert.equal(await ProtectedEvidence.countDocuments(), 1);
  const original = await ProtectedEvidence.findOne({ evidenceId: first.evidenceId }).orFail();
  const originalDigest = original.sha256;
  const originalObjectKey = original.storageObjectKey;
  const originalBytes = await storage.read(originalObjectKey, 10_000);
  const conflictingValidPdf = Buffer.from('%PDF-1.7\nconflicting valid body\n%%EOF\n', 'ascii');
  assert.notEqual(createHash('sha256').update(conflictingValidPdf).digest('hex'), originalDigest);
  await assert.rejects(service.ingest({ ...firstInput, source: conflictingValidPdf }), (error: unknown) => error instanceof ProtectedEvidenceError && error.code === 'operation_conflict');
  await assert.rejects(service.ingest({ ...firstInput, source: Buffer.from('not a supported document') }), (error: unknown) => error instanceof ProtectedEvidenceError && error.code === 'unsupported_content');
  assert.equal(await ProtectedEvidence.countDocuments(), 1);
  const reloaded = await ProtectedEvidence.findOne({ evidenceId: first.evidenceId }).orFail();
  assert.equal(reloaded.sha256, originalDigest);
  assert.equal(reloaded.storageObjectKey, originalObjectKey);
  assert.deepEqual(await storage.read(reloaded.storageObjectKey, 10_000), originalBytes);
  assert.deepEqual((await readdir(storageRoot)).sort(), [originalObjectKey]);
});

test('concurrent duplicate replay does not revise a live intent and converges on one object', async () => {
  const promoteEntered = barrier();
  const releasePromote = barrier();
  const blockedStorage = {
    ...storage,
    async promote(staged: Parameters<typeof storage.promote>[0], key: string) {
      promoteEntered.resolve();
      await releasePromote.promise;
      await storage.promote(staged, key);
    },
  };
  const local = createProtectedEvidenceService({ storage: blockedStorage, maxBytes: 10_000, scanner });
  const same = input();
  const winner = local.ingest(same);
  await promoteEntered.promise;
  const beforeReplay = await ProtectedEvidence.findOne({ uploaderId: user, operationId: same.operationId }).orFail();
  assert.equal(beforeReplay.status, 'intent');
  assert.equal(beforeReplay.revision, 1);

  const duplicate = await local.ingest(same);
  assert.equal(duplicate.evidenceId, beforeReplay.evidenceId);
  assert.equal(duplicate.status, 'intent');
  const afterReplay = await ProtectedEvidence.findOne({ evidenceId: beforeReplay.evidenceId }).orFail();
  assert.equal(afterReplay.revision, beforeReplay.revision);
  assert.equal(afterReplay.status, 'intent');

  releasePromote.resolve();
  const completed = await winner;
  assert.equal(completed.evidenceId, duplicate.evidenceId);
  assert.equal(completed.status, 'available');
  assert.equal(await ProtectedEvidence.countDocuments(), 1);
  const canonical = await ProtectedEvidence.findOne({ evidenceId: completed.evidenceId }).orFail();
  assert.equal(canonical.sha256, createHash('sha256').update(pdf).digest('hex'));
  assert.deepEqual(await storage.read(canonical.storageObjectKey, 10_000), pdf);
  assert.deepEqual((await readdir(storageRoot)).sort(), [canonical.storageObjectKey]);
});

test('revoked authority during duplicate conflict resolution cannot return a successful replay', async () => {
  const promoteEntered = barrier();
  const releasePromote = barrier();
  const blockedStorage = {
    ...storage,
    async promote(staged: Parameters<typeof storage.promote>[0], key: string) {
      promoteEntered.resolve();
      await releasePromote.promise;
      await storage.promote(staged, key);
    },
  };
  const local = createProtectedEvidenceService({ storage: blockedStorage, maxBytes: 10_000, scanner });
  const same = input();
  const winner = local.ingest(same);
  await promoteEntered.promise;
  const intent = await ProtectedEvidence.findOne({ uploaderId: user, operationId: same.operationId }).orFail();
  let allowed = true;
  let checks = 0;
  const resolutionReached = barrier();
  const releaseResolution = barrier();
  const revokingAuthorization: DomainEvidenceAuthorizer = async request => {
    if (request.action !== 'upload') return false;
    checks += 1;
    if (checks === 4) {
      resolutionReached.resolve();
      await releaseResolution.promise;
    }
    return allowed;
  };
  const duplicateAttempt = local.ingest(input({ ...same, authorize: revokingAuthorization }));
  await resolutionReached.promise;
  allowed = false;
  releaseResolution.resolve();
  await assert.rejects(duplicateAttempt, (error: unknown) => error instanceof ProtectedEvidenceError && error.code === 'unauthorized');
  const afterDeniedReplay = await ProtectedEvidence.findOne({ evidenceId: intent.evidenceId }).orFail();
  assert.equal(afterDeniedReplay.status, 'intent');
  assert.equal(afterDeniedReplay.revision, intent.revision);

  releasePromote.resolve();
  const completed = await winner;
  assert.equal(completed.status, 'available');
  assert.equal(await ProtectedEvidence.countDocuments(), 1);
  const canonical = await ProtectedEvidence.findOne({ evidenceId: intent.evidenceId }).orFail();
  assert.deepEqual(await storage.read(canonical.storageObjectKey, 10_000), pdf);
  assert.deepEqual((await readdir(storageRoot)).sort(), [canonical.storageObjectKey]);
});

test('authorized read verifies digest, while tampered or missing binary invalidates availability', async () => {
  const result = await service.ingest(input());
  const data = await service.readAvailable({ actor, evidenceId: result.evidenceId, authorize: ownerAllow });
  assert.deepEqual(data.content, pdf);
  const record = await ProtectedEvidence.findOne({ evidenceId: result.evidenceId }).orFail();
  await writeFile(path.join(storageRoot, record.storageObjectKey), Buffer.from('%PDF-1.7\ntampered'));
  await assert.rejects(service.readAvailable({ actor, evidenceId: result.evidenceId, authorize: ownerAllow }), (error: unknown) => error instanceof ProtectedEvidenceError && error.code === 'not_available');
  const invalidated = await ProtectedEvidence.findOne({ evidenceId: result.evidenceId });
  assert.equal(invalidated?.status, 'failed');
  assert.equal(invalidated?.scanStatus, 'failed');
  assert.equal(invalidated?.scanDigest, undefined);
});

test('missing binary content is denied and marked failed', async () => {
  const result = await service.ingest(input());
  const record = await ProtectedEvidence.findOne({ evidenceId: result.evidenceId }).orFail();
  await storage.delete(record.storageObjectKey);
  await assert.rejects(service.readAvailable({ actor, evidenceId: result.evidenceId, authorize: ownerAllow }), (error: unknown) => error instanceof ProtectedEvidenceError && error.code === 'not_available');
  assert.equal((await ProtectedEvidence.findOne({ evidenceId: result.evidenceId }))?.status, 'failed');
});

test('binary promotion failure leaves a non-available recoverable record', async () => {
  const failingStorage = { ...storage, promote: async () => { throw new EvidenceStorageError('storage_unavailable'); } };
  const local = createProtectedEvidenceService({ storage: failingStorage, maxBytes: 10_000, scanner });
  await assert.rejects(local.ingest(input()), (error: unknown) => error instanceof ProtectedEvidenceError && error.code === 'storage_failure');
  const row = await ProtectedEvidence.findOne({ status: 'failed' });
  assert.ok(row);
  assert.equal(row.status, 'failed');
  await assert.rejects(local.readAvailable({ actor, evidenceId: row.evidenceId, authorize: ownerAllow }));
});

test('recovery racing object promotion stays quarantined until the authorized scan resumes', async () => {
  const promoteEntered = barrier();
  const releasePromote = barrier();
  let scannerCalls = 0;
  const countingScanner: EvidenceScanner = {
    async scan(scanInput) {
      scannerCalls += 1;
      return { result: 'clean', scannerId: 'synthetic-recovery-race', sha256: scanInput.sha256 };
    },
  };
  const delayedPromotionStorage = {
    ...storage,
    async promote(staged: Parameters<typeof storage.promote>[0], key: string) {
      await storage.promote(staged, key);
      promoteEntered.resolve();
      await releasePromote.promise;
    },
  };
  const local = createProtectedEvidenceService({ storage: delayedPromotionStorage, maxBytes: 10_000, scanner: countingScanner });
  const attempt = local.ingest(input());
  await promoteEntered.promise;
  const intent = await ProtectedEvidence.findOne({ status: 'intent' }).orFail();
  await local.recover(intent.evidenceId);
  assert.equal((await ProtectedEvidence.findOne({ evidenceId: intent.evidenceId }))?.status, 'quarantined');
  assert.equal(scannerCalls, 0);
  releasePromote.resolve();
  const result = await attempt;
  assert.equal(result.status, 'available');
  assert.equal(scannerCalls, 1);
});

test('maintenance recovery quarantines interrupted metadata without scanning or authorizing availability', async () => {
  const result = await service.ingest(input());
  await ProtectedEvidence.updateOne({ evidenceId: result.evidenceId }, { $set: { status: 'intent', scanStatus: 'not_scanned' }, $inc: { revision: 1 } });
  await service.recover(result.evidenceId);
  assert.equal((await ProtectedEvidence.findOne({ evidenceId: result.evidenceId }))?.status, 'quarantined');
  await assert.rejects(service.readAvailable({ actor, evidenceId: result.evidenceId, authorize: ownerAllow }), (error: unknown) => error instanceof ProtectedEvidenceError && error.code === 'not_available');
});

test('failed deletion stays pending, recovery retries it, and repeated deletion does not lie', async () => {
  const result = await service.ingest(input());
  const failingStorage = { ...storage, delete: async () => { throw new EvidenceStorageError('storage_unavailable'); } };
  const failingService = createProtectedEvidenceService({ storage: failingStorage, maxBytes: 10_000, scanner });
  const deleteAuth: DomainEvidenceAuthorizer = async request => request.action === 'delete';
  await assert.rejects(failingService.requestDeletion({ actor, evidenceId: result.evidenceId, authorize: deleteAuth }), (error: unknown) => error instanceof ProtectedEvidenceError && error.code === 'storage_failure');
  assert.equal((await ProtectedEvidence.findOne({ evidenceId: result.evidenceId }))?.status, 'deletion_pending');
  await service.recover(result.evidenceId);
  assert.equal((await ProtectedEvidence.findOne({ evidenceId: result.evidenceId }))?.status, 'deleted');
  assert.equal(await storage.read((await ProtectedEvidence.findOne({ evidenceId: result.evidenceId }))!.storageObjectKey, 10_000).then(() => true, () => false), false);
  await service.recover(result.evidenceId);
  assert.equal((await ProtectedEvidence.findOne({ evidenceId: result.evidenceId }))?.status, 'deleted');
});

test('deletion authority revoked before the pending transition leaves evidence unchanged', async () => {
  const result = await service.ingest(input());
  let checks = 0;
  const revokingDeleteAuthority: DomainEvidenceAuthorizer = async request => {
    if (request.action !== 'delete') return false;
    checks += 1;
    return checks === 1;
  };
  await assert.rejects(service.requestDeletion({ actor, evidenceId: result.evidenceId, authorize: revokingDeleteAuthority }), (error: unknown) => error instanceof ProtectedEvidenceError && error.code === 'unauthorized');
  const saved = await ProtectedEvidence.findOne({ evidenceId: result.evidenceId }).orFail();
  assert.equal(saved.status, 'available');
  assert.deepEqual((await service.readAvailable({ actor, evidenceId: result.evidenceId, authorize: ownerAllow })).content, pdf);
});

test('competing deletion requests are fenced by metadata revision compare-and-set', async () => {
  const result = await service.ingest(input());
  const deleteAuth: DomainEvidenceAuthorizer = async request => request.action === 'delete';
  const settled = await Promise.allSettled([
    service.requestDeletion({ actor, evidenceId: result.evidenceId, authorize: deleteAuth }),
    service.requestDeletion({ actor, evidenceId: result.evidenceId, authorize: deleteAuth }),
  ]);
  assert.ok(settled.filter(item => item.status === 'fulfilled').length >= 1);
  for (const item of settled) if (item.status === 'fulfilled') assert.equal(item.value.status, 'deleted');
  assert.equal((await ProtectedEvidence.findOne({ evidenceId: result.evidenceId }))?.status, 'deleted');
});
