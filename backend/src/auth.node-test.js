const { test } = require('node:test');
const assert = require('node:assert/strict');
const databasePath = require.resolve('./database');
let session;
let user;
let sessionQuery;
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: {
  getDatabase: () => ({ collection: name => ({
    findOne: async query => {
      if (name === 'users') return user;
      sessionQuery = query;
      return session && !session.revokedAt && session.expiresAt > query.expiresAt.$gt ? session : null;
    },
    updateOne: async (_query, update) => { Object.assign(session, update.$set); },
  }) }),
} };
const { authenticateRequest, logout } = require('./auth');
const token = 'a'.repeat(43);
async function authenticate(header) {
  const req = { get: () => header }; let status = 200; let passed = false;
  const res = { status: code => { status = code; return res; }, json: () => res };
  await authenticateRequest(req, res, error => { assert.equal(error, undefined); passed = true; });
  return { status, passed, req };
}
test('bearer enforcement, expiry and logout revocation', async () => {
  user = { id: 'test-user', role: 'student', active: true };
  session = { _id: 'test-session', userId: user.id, expiresAt: new Date(Date.now() + 60000), revokedAt: null };
  assert.equal((await authenticate('')).status, 401);
  assert.equal((await authenticate('Basic invalid')).status, 401);
  const valid = await authenticate(`Bearer ${token}`);
  assert.equal(valid.passed, true);
  assert.equal(valid.req.user.role, 'student');
  assert.equal(sessionQuery.type, 'access');
  assert.equal(sessionQuery.revokedAt, null);
  assert.notEqual(sessionQuery.tokenHash, token);
  session.expiresAt = new Date(Date.now() - 1);
  assert.equal((await authenticate(`Bearer ${token}`)).status, 401);
  session.expiresAt = new Date(Date.now() + 60000);
  await logout(token);
  assert.ok(session.revokedAt instanceof Date);
  assert.equal((await authenticate(`Bearer ${token}`)).status, 401);
});
