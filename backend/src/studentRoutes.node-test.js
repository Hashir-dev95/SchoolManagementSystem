const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');

const databasePath = require.resolve('./database');
let linkedStudent;
let studentLookup;

require.cache[databasePath] = {
  id: databasePath,
  filename: databasePath,
  loaded: true,
  exports: {
    getDatabase: () => ({
      collection: name => {
        assert.equal(name, 'students');
        return {
          findOne: async query => {
            studentLookup = query;
            return linkedStudent;
          },
        };
      },
    }),
  },
};

const {
  MAX_SUBMISSION_FILE_BYTES,
  ownedStudentFilter,
  publishedFilter,
  requireStudentContext,
  submissionDeadline,
  studentClassFilter,
  validateSubmissionFile,
} = require('./studentRoutes').__test;

beforeEach(() => {
  linkedStudent = { id: '002', userId: 'user-002', classId: 'CLASS-A' };
  studentLookup = null;
});

function authorize(user) {
  return new Promise((resolve, reject) => {
    const req = { user };
    let status = 200;
    let payload;
    const res = {
      status(code) {
        status = code;
        return res;
      },
      json(value) {
        payload = value;
        resolve({ req, status, payload, passed: false });
        return res;
      },
    };
    requireStudentContext(req, res, error => {
      if (error) reject(error);
      else resolve({ req, status, payload, passed: true });
    });
  });
}

test('student context is resolved only from the authenticated user id', async () => {
  const result = await authorize({ id: 'user-002', role: 'student' });
  assert.equal(result.passed, true);
  assert.deepEqual(studentLookup, { userId: 'user-002' });
  assert.equal(result.req.studentRecord.id, '002');
});

test('another role cannot enter Student routes', async () => {
  const result = await authorize({ id: 'finance-user', role: 'finance' });
  assert.equal(result.status, 403);
  assert.equal(result.passed, false);
  assert.equal(studentLookup, null);
});

test('an unlinked Student account is rejected', async () => {
  linkedStudent = null;
  const result = await authorize({ id: 'unlinked-user', role: 'student' });
  assert.equal(result.status, 403);
  assert.equal(result.passed, false);
});

test('owned record filters cannot be redirected to another student', () => {
  const filter = ownedStudentFilter(
    { id: '002' },
    { studentId: 'OTHER', subject: 'Mathematics' },
  );
  assert.equal(filter.studentId, '002');
  assert.equal(filter.subject, 'Mathematics');
});

test('results and progress require both ownership and publication', () => {
  const filter = ownedStudentFilter({ id: '002' }, publishedFilter());
  assert.equal(filter.studentId, '002');
  assert.deepEqual(filter.$or, [
    { published: true },
    { status: 'published' },
  ]);
});

test('timetable scope is derived from the linked Student record', () => {
  assert.deepEqual(studentClassFilter(linkedStudent), {
    $or: [
      { studentId: '002' },
      { studentIds: '002' },
      { classId: 'CLASS-A' },
    ],
  });
});

test('homework deadlines use the end of a date-only due date', () => {
  const result = submissionDeadline('2026-10-07');
  assert.equal(result.error, undefined);
  assert.equal(result.deadline.toISOString(), '2026-10-07T23:59:59.999Z');
  assert.match(submissionDeadline('not-a-date').error, /invalid deadline/i);
});

test('homework uploads are capped at exactly 5 MB', () => {
  assert.equal(MAX_SUBMISSION_FILE_BYTES, 5 * 1024 * 1024);
});

test('homework file validation accepts matching signatures only', () => {
  const pdf = validateSubmissionFile({
    originalname: 'answer.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7 real content'),
  });
  assert.equal(pdf.error, undefined);
  assert.equal(pdf.type.mime, 'application/pdf');

  const spoofed = validateSubmissionFile({
    originalname: 'answer.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from('not a pdf'),
  });
  assert.match(spoofed.error, /content, extension, and MIME type/i);

  const mismatched = validateSubmissionFile({
    originalname: 'answer.png',
    mimetype: 'image/jpeg',
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
  });
  assert.match(mismatched.error, /must match/i);
});
