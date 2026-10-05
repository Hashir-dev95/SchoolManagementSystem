const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');
const { getDatabase } = require('./database');

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const PASSWORD_KEYLEN = 64;

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const passwordHash = crypto.scryptSync(password, salt, PASSWORD_KEYLEN).toString('hex');
  return { passwordHash, passwordSalt: salt };
}

function passwordMatches(password, user) {
  if (typeof password !== 'string' || !user?.passwordHash || !user?.passwordSalt) return false;
  const actual = crypto.scryptSync(password, user.passwordSalt, PASSWORD_KEYLEN);
  const expected = Buffer.from(user.passwordHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function authenticateRequest(req, res, next) {
  const header = typeof req.get('Authorization') === 'string' ? req.get('Authorization') : '';
  const match = /^Bearer\s+([A-Za-z0-9_-]{32,})$/.exec(header);
  if (!match) return res.status(401).json({ success: false, error: 'Authentication is required.' });
  try {
    const session = await getDatabase().collection('refreshTokens').findOne({
      tokenHash: tokenHash(match[1]),
      type: 'access',
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    });
    if (!session) return res.status(401).json({ success: false, error: 'Session is invalid or expired.' });
    const user = await getDatabase().collection('users').findOne({ id: session.userId, active: { $ne: false } });
    if (!user || !user.id || !user.role) return res.status(401).json({ success: false, error: 'Authenticated user was not found.' });
    req.user = { id: String(user.id), role: String(user.role).toLowerCase(), branchId: user.branchId ? String(user.branchId) : undefined, fullName: user.fullName || user.name || '', email: user.email };
    await getDatabase().collection('refreshTokens').updateOne({ _id: session._id }, { $set: { lastUsedAt: new Date() } });
    return next();
  } catch (error) { return next(error); }
}

async function login(email, password) {
  const emailLower = normalizeEmail(email);
  if (!emailLower || typeof password !== 'string' || !password) return null;
  const user = await getDatabase().collection('users').findOne({ emailLower, active: { $ne: false } });
  if (!user || !passwordMatches(password, user)) return null;
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await getDatabase().collection('refreshTokens').insertOne({ tokenHash: tokenHash(token), type: 'access', userId: String(user.id), createdAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS), revokedAt: null });
  return { token, expiresAt: expiresAt.toISOString(), user: { id: String(user.id), fullName: user.fullName || user.name || '', email: user.email, role: String(user.role).toLowerCase(), ...(user.branchId ? { branchId: String(user.branchId) } : {}) } };
}

async function logout(token) {
  if (!token) return;
  await getDatabase().collection('refreshTokens').updateOne({ tokenHash: tokenHash(token), type: 'access', revokedAt: null }, { $set: { revokedAt: new Date() } });
}

module.exports = { authenticateRequest, hashPassword, login, logout, normalizeEmail };
