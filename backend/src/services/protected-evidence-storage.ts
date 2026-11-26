import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, realpath, link, unlink, readdir } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';

export class EvidenceStorageError extends Error {
  constructor(readonly code: 'invalid_storage_root' | 'unsafe_object_key' | 'object_exists' | 'object_missing' | 'object_too_large' | 'storage_unavailable') {
    super(code);
    this.name = 'EvidenceStorageError';
  }
}

export type EvidenceInput = Uint8Array | AsyncIterable<Uint8Array>;
export type StagedEvidence = Readonly<{ temporaryKey: string; byteLength: number; sha256: string; prefix: Buffer; suffix: Buffer }>;

export interface ProtectedEvidenceStorage {
  stage(input: EvidenceInput, maxBytes: number): Promise<StagedEvidence>;
  /** Extend a process-local lease while ingestion owns staged bytes. */
  keepAlive?(staged: StagedEvidence): void;
  promote(staged: StagedEvidence, objectKey: string): Promise<void>;
  discard(staged: StagedEvidence): Promise<void>;
  read(objectKey: string, maxBytes: number): Promise<Buffer>;
  delete(objectKey: string): Promise<void>;
  cleanupStaged(olderThanMs: number): Promise<number>;
}

function inside(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

// Shared by adapters in this process so one adapter's cleanup cannot remove
// another adapter's in-flight stage. This is deliberately not a distributed
// lease; sharing one filesystem root across processes is unsupported.
const activeStagesByRoot = new Map<string, Map<string, { expiresAt: number; timer?: ReturnType<typeof setInterval> }>>();
const stageLeaseMs = 15 * 60 * 1000;

/** Development/test-only private filesystem adapter. It deliberately refuses
 * production mode; production must supply a separately reviewed provider. */
export async function createPrivateFilesystemEvidenceStorage(configuredRoot: string, options: Readonly<{ inputIdleTimeoutMs?: number }> = {}): Promise<ProtectedEvidenceStorage> {
  if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') throw new EvidenceStorageError('invalid_storage_root');
  if (!configuredRoot || !path.isAbsolute(configuredRoot)) throw new EvidenceStorageError('invalid_storage_root');
  const inputIdleTimeoutMs = options.inputIdleTimeoutMs ?? 30_000;
  if (!Number.isSafeInteger(inputIdleTimeoutMs) || inputIdleTimeoutMs < 10 || inputIdleTimeoutMs > 30_000) throw new EvidenceStorageError('invalid_storage_root');
  const resolved = path.resolve(configuredRoot);
  const publicRoots = [path.resolve(process.cwd(), 'public'), path.resolve(process.cwd(), 'backend', 'public')];
  if (publicRoots.some(publicRoot => inside(publicRoot, resolved))) throw new EvidenceStorageError('invalid_storage_root');
  try {
    await mkdir(resolved, { recursive: true, mode: 0o700 });
    const root = await realpath(resolved);
    const rootKey = process.platform === 'win32' ? root.toLocaleLowerCase('en-US') : root;
    let activeStages = activeStagesByRoot.get(rootKey);
    if (!activeStages) {
      activeStages = new Map<string, { expiresAt: number; timer?: ReturnType<typeof setInterval> }>();
      activeStagesByRoot.set(rootKey, activeStages);
    }
    const releaseStage = (key: string) => {
      const lease = activeStages!.get(key);
      if (lease?.timer) clearInterval(lease.timer);
      activeStages!.delete(key);
    };
    const isActiveStage = (key: string) => {
      const lease = activeStages!.get(key);
      if (!lease) return false;
      if (lease.expiresAt > Date.now()) return true;
      releaseStage(key);
      return false;
    };
    const normalizePath = (value: string) => process.platform === 'win32' ? value.toLocaleLowerCase('en-US') : value;
    const assertContainedRealPath = async (candidate: string) => {
      const currentRoot = await realpath(root);
      if (normalizePath(currentRoot) !== normalizePath(root)) throw new EvidenceStorageError('invalid_storage_root');
      const actual = await realpath(candidate);
      if (!inside(root, actual)) throw new EvidenceStorageError('unsafe_object_key');
      return actual;
    };
    for (const publicRoot of publicRoots) {
      try {
        const actualPublicRoot = await realpath(publicRoot);
        if (inside(actualPublicRoot, root)) throw new EvidenceStorageError('invalid_storage_root');
      } catch (error) {
        if (error instanceof EvidenceStorageError) throw error;
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    if (root === path.parse(root).root) throw new EvidenceStorageError('invalid_storage_root');
    await chmod(root, 0o700);
    const objectPath = (key: string) => {
      if (!/^[a-f0-9]{32}$/.test(key)) throw new EvidenceStorageError('unsafe_object_key');
      const target = path.resolve(root, key);
      if (!inside(root, target) || path.dirname(target) !== root) throw new EvidenceStorageError('unsafe_object_key');
      return target;
    };
    const temporaryPath = (key: string) => {
      if (!/^\.stage-[a-f0-9]{32}$/.test(key)) throw new EvidenceStorageError('unsafe_object_key');
      const target = path.resolve(root, key);
      if (!inside(root, target) || path.dirname(target) !== root) throw new EvidenceStorageError('unsafe_object_key');
      return target;
    };

    return {
      async stage(input, maxBytes) {
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 10_000_000) throw new EvidenceStorageError('object_too_large');
        const temporaryKey = `.stage-${randomUUID().replaceAll('-', '')}`;
        const temporaryTarget = temporaryPath(temporaryKey);
        activeStages.set(temporaryKey, { expiresAt: Date.now() + stageLeaseMs });
        let handle: FileHandle | undefined;
        try {
          await assertContainedRealPath(root);
          handle = await open(temporaryTarget, 'wx', 0o600);
          await assertContainedRealPath(temporaryTarget);
        } catch {
          await handle?.close().catch(() => undefined);
          await unlink(temporaryTarget).catch(() => undefined);
          releaseStage(temporaryKey);
          throw new EvidenceStorageError('storage_unavailable');
        }
        const digest = createHash('sha256');
        let byteLength = 0;
        let prefix = Buffer.alloc(0);
        let suffix = Buffer.alloc(0);
        let iterator: AsyncIterator<Uint8Array> | undefined;
        try {
          const chunks: AsyncIterable<Uint8Array> = input instanceof Uint8Array
            ? (async function* () { yield input; })()
            : input;
          iterator = chunks[Symbol.asyncIterator]();
          while (true) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const next = await Promise.race([
              iterator.next(),
              new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new EvidenceStorageError('storage_unavailable')), inputIdleTimeoutMs); }),
            ]).finally(() => { if (timer) clearTimeout(timer); });
            if (next.done) break;
            const raw = next.value;
            const chunk = Buffer.from(raw);
            if (chunk.length === 0) continue;
            if (byteLength + chunk.length > maxBytes) throw new EvidenceStorageError('object_too_large');
            if (prefix.length < 32) prefix = Buffer.concat([prefix, chunk.subarray(0, 32 - prefix.length)]);
            suffix = Buffer.concat([suffix, chunk]).subarray(-32);
            digest.update(chunk);
            let offset = 0;
            while (offset < chunk.length) {
              const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
              if (!bytesWritten) throw new EvidenceStorageError('storage_unavailable');
              offset += bytesWritten;
            }
            byteLength += chunk.length;
          }
          if (!byteLength) throw new EvidenceStorageError('object_missing');
          await handle.sync();
          await handle.close();
          return { temporaryKey, byteLength, sha256: digest.digest('hex'), prefix, suffix };
        } catch (error) {
          await handle.close().catch(() => undefined);
          await unlink(temporaryPath(temporaryKey)).catch(() => undefined);
          releaseStage(temporaryKey);
          if (iterator?.return) iterator.return().catch(() => undefined);
          if (error instanceof EvidenceStorageError) throw error;
          throw new EvidenceStorageError('storage_unavailable');
        } finally {
          await handle.close().catch(() => undefined);
        }
      },
      keepAlive(staged) {
        const lease = activeStages.get(staged.temporaryKey);
        if (!lease) return;
        lease.expiresAt = Date.now() + stageLeaseMs;
        if (!lease.timer) {
          lease.timer = setInterval(() => {
            const current = activeStages!.get(staged.temporaryKey);
            if (!current) return;
            current.expiresAt = Date.now() + stageLeaseMs;
          }, 60_000);
          lease.timer.unref?.();
        }
      },
      async promote(staged, objectKey) {
        const destination = objectPath(objectKey);
        let linked = false;
        try {
          const source = temporaryPath(staged.temporaryKey);
          await assertContainedRealPath(source);
          await assertContainedRealPath(root);
          await link(source, destination);
          linked = true;
          await assertContainedRealPath(destination);
        } catch (error) {
          if (linked) await unlink(destination).catch(() => undefined);
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new EvidenceStorageError('object_exists');
          throw new EvidenceStorageError('storage_unavailable');
        }
        await unlink(temporaryPath(staged.temporaryKey)).catch(() => undefined);
        releaseStage(staged.temporaryKey);
      },
      async discard(staged) {
        try {
          await unlink(temporaryPath(staged.temporaryKey)).catch(error => {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new EvidenceStorageError('storage_unavailable');
          });
        } finally { releaseStage(staged.temporaryKey); }
      },
      async read(objectKey, maxBytes) {
        const target = objectPath(objectKey);
        try {
          if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new EvidenceStorageError('object_too_large');
          const info = await lstat(target);
          if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > maxBytes) throw new EvidenceStorageError('object_too_large');
          const realTarget = await assertContainedRealPath(target);
          const handle = await open(target, 'r');
          try {
            const opened = await handle.stat();
            const openedPath = await assertContainedRealPath(target);
            if (normalizePath(realTarget) !== normalizePath(openedPath) || !opened.isFile() || opened.size !== info.size || opened.size > maxBytes || (info.ino !== 0 && opened.ino !== 0 && (info.dev !== opened.dev || info.ino !== opened.ino))) throw new EvidenceStorageError('storage_unavailable');
            const blocks: Buffer[] = [];
            let total = 0;
            while (total <= maxBytes) {
              const buffer = Buffer.alloc(Math.min(64 * 1024, maxBytes - total + 1));
              const { bytesRead } = await handle.read(buffer, 0, buffer.length, total);
              if (!bytesRead) break;
              total += bytesRead;
              if (total > maxBytes) throw new EvidenceStorageError('object_too_large');
              blocks.push(buffer.subarray(0, bytesRead));
            }
            return Buffer.concat(blocks, total);
          } finally { await handle.close(); }
        } catch (error) {
          if (error instanceof EvidenceStorageError) throw error;
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new EvidenceStorageError('object_missing');
          throw new EvidenceStorageError('storage_unavailable');
        }
      },
      async delete(objectKey) {
        try {
          const target = objectPath(objectKey);
          const info = await lstat(target);
          if (!info.isFile() || info.isSymbolicLink()) throw new EvidenceStorageError('storage_unavailable');
          await assertContainedRealPath(target);
          await unlink(target);
        }
        catch (error) {
          if (error instanceof EvidenceStorageError) throw error;
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new EvidenceStorageError('storage_unavailable');
        }
      },
      async cleanupStaged(olderThanMs) {
        // A grace period protects active uploads if a recovery pass runs
        // alongside ingestion. This method is explicit and never scheduled.
        if (!Number.isSafeInteger(olderThanMs) || olderThanMs < 15 * 60 * 1000) throw new EvidenceStorageError('invalid_storage_root');
        let removed = 0;
        const cutoff = Date.now() - olderThanMs;
        for (const entry of await readdir(root)) {
          if (!/^\.stage-[a-f0-9]{32}$/.test(entry)) continue;
          const target = temporaryPath(entry);
          try {
            if (isActiveStage(entry)) continue;
            const info = await lstat(target);
            if (info.isFile() && !info.isSymbolicLink() && info.mtimeMs <= cutoff && !isActiveStage(entry)) {
              await assertContainedRealPath(target);
              if (isActiveStage(entry)) continue;
              await unlink(target);
              removed += 1;
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new EvidenceStorageError('storage_unavailable');
          }
        }
        return removed;
      },
    };
  } catch (error) {
    if (error instanceof EvidenceStorageError) throw error;
    throw new EvidenceStorageError('invalid_storage_root');
  }
}
