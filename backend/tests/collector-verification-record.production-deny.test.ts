import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { authorizeCollectorVerificationRecord, readCollectorVerificationEvidence } from '../src/services/collector-verification-record.trusted-dependencies';
import { authorizeStudentCustodyRecord, readStudentCustodyEvidence } from '../src/services/student-custody-record.trusted-dependencies';
import { protectedEvidenceRuntime } from '../src/services/protected-evidence-runtime';

test('production integrations reject invalid authority contexts and keep evidence unavailable without deployment providers', async () => {
  assert.equal(await authorizeCollectorVerificationRecord({} as never), false);
  assert.equal(await authorizeStudentCustodyRecord({} as never), false);
  assert.equal(protectedEvidenceRuntime, null);
  await assert.rejects(readCollectorVerificationEvidence({} as never), /unavailable/);
  await assert.rejects(readStudentCustodyEvidence({} as never), /unavailable/);
});

test('cold service and application entry-point imports initialize in either domain order without a database connection', () => {
  const coldImports = [
    "await import('./src/services/collector-verification-record.service.ts'); await import('./src/services/student-custody-record.service.ts')",
    "await import('./src/services/student-custody-record.service.ts'); await import('./src/services/collector-verification-record.service.ts')",
    "await import('./src/models/collectorVerificationRecord.ts'); await import('./src/services/collector-verification-record.service.ts'); await import('./src/app.ts')",
    "const app = await import('./src/app.ts'); if (typeof app.default?.default !== 'function' && typeof app.default !== 'function') throw new Error('Express app failed to initialize')",
  ];
  for (const source of coldImports) {
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, NODE_ENV: 'test', JWT_SECRET: 'synthetic-module-init-only-secret', MONGODB_URI: '' },
    });
    assert.equal(child.error, undefined, child.error?.message ?? source);
    assert.equal(child.status, 0, `${source}\nstdout:\n${child.stdout}\nstderr:\n${child.stderr}`);
    assert.equal(child.signal, null);
  }
});
