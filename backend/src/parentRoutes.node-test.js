const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const databasePath = require.resolve('./database');
let links;
let students;
let lastLinkQuery;
let studentLookupCount;

require.cache[databasePath] = {
  id: databasePath,
  filename: databasePath,
  loaded: true,
  exports: {
    getDatabase: () => ({
      collection: name => ({
        findOne: async query => {
          if (name === 'parentChildLinks') {
            lastLinkQuery = query;
            return links.find(
              link =>
                link.parentUserId === query.parentUserId &&
                link.studentId === query.studentId &&
                link.revokedAt === null &&
                link.status !== 'revoked' &&
                (link.status === 'verified' || link.verified === true),
            );
          }
          if (name === 'students') {
            studentLookupCount += 1;
            return students.find(student => student.id === query.id) || null;
          }
          throw new Error(`Unexpected collection ${name}`);
        },
      }),
    }),
  },
};

const {
  getVerifiedChild,
  ownedChildFilter,
  publishedFilter,
  requireParentContext,
  verifiedLinkFilter,
} = require('./parentRoutes').__test;

beforeEach(() => {
  links = [
    {
      parentUserId: 'parent-a',
      studentId: '002',
      status: 'verified',
      verified: true,
      revokedAt: null,
    },
    {
      parentUserId: 'parent-b',
      studentId: '003',
      status: 'verified',
      verified: true,
      revokedAt: null,
    },
  ];
  students = [
    { id: '002', fullName: 'Student Two', classId: 'CLASS-A' },
    { id: '003', fullName: 'Student Three', classId: 'CLASS-B' },
  ];
  lastLinkQuery = null;
  studentLookupCount = 0;
});

test('verified link filters bind both parent and child and exclude revocations', () => {
  assert.deepEqual(verifiedLinkFilter('parent-a', '002'), {
    parentUserId: 'parent-a',
    studentId: '002',
    revokedAt: null,
    status: { $ne: 'revoked' },
    $or: [{ status: 'verified' }, { verified: true }],
  });
});

test('a parent can resolve their own verified child', async () => {
  const child = await getVerifiedChild('parent-a', '002');
  assert.equal(child.id, '002');
  assert.equal(lastLinkQuery.parentUserId, 'parent-a');
  assert.equal(lastLinkQuery.studentId, '002');
  assert.equal(studentLookupCount, 1);
});

test('another parent cannot resolve a child they are not linked to', async () => {
  const child = await getVerifiedChild('parent-b', '002');
  assert.equal(child, null);
  assert.equal(studentLookupCount, 0);
});

test('revoked and unverified links cannot resolve a child', async () => {
  links[0] = { ...links[0], revokedAt: new Date(), status: 'revoked', verified: false };
  assert.equal(await getVerifiedChild('parent-a', '002'), null);
  assert.equal(studentLookupCount, 0);
});

test('revoked status wins over a stale legacy verified flag', async () => {
  links[0] = { ...links[0], status: 'revoked', verified: true, revokedAt: null };
  assert.equal(await getVerifiedChild('parent-a', '002'), null);
  assert.equal(studentLookupCount, 0);
});

test('child record filters cannot be redirected to another student', () => {
  const filter = ownedChildFilter(
    { id: '002' },
    { studentId: '003', ...publishedFilter() },
  );
  assert.equal(filter.studentId, '002');
  assert.deepEqual(filter.$or, [
    { published: true },
    { status: 'published' },
  ]);
});

test('non-parent roles cannot enter Parent routes', () => {
  const req = { user: { id: 'finance-user', role: 'finance' } };
  let status = 200;
  let passed = false;
  const res = {
    status(code) {
      status = code;
      return res;
    },
    json() {
      return res;
    },
  };
  requireParentContext(req, res, () => {
    passed = true;
  });
  assert.equal(status, 403);
  assert.equal(passed, false);
});
