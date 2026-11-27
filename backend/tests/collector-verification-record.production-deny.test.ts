import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authorizeCollectorVerificationRecord, readCollectorVerificationEvidence } from '../src/services/collector-verification-record.trusted-dependencies';

test('production trusted dependencies are fixed deny-by-default and unavailable evidence cannot be read', async () => {
  assert.equal(await authorizeCollectorVerificationRecord({} as never), false);
  await assert.rejects(readCollectorVerificationEvidence({} as never), /not configured/);
});
