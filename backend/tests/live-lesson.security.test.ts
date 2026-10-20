import assert from 'node:assert/strict';
import { after, before, beforeEach, test, mock } from 'node:test';
import { createDecipheriv } from 'node:crypto';
import { fork } from 'node:child_process';
import { join as pathJoin } from 'node:path';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import express from 'express';
import { liveLessonRouter } from '../src/routes/live-lesson.routes';
import User from '../src/models/user';
import Branch from '../src/models/branch';
import SchoolClass from '../src/models/schoolClass';
import Section from '../src/models/section';
import Subject from '../src/models/subject';
import TeacherAssignment from '../src/models/teacherAssignment';
import Student from '../src/models/student';
import Session from '../src/models/session';
import { AcademicPeriod } from '../src/models/academicPeriod';
import { ClassSubject } from '../src/models/classSubject';
import { StudentEnrollment } from '../src/models/studentEnrollment';
import {
  TimetableVersion,
  TimetablePeriod,
  SubstituteAssignment,
  ensureTimetableIndexes,
} from '../src/models/timetable';
import {
  LiveLessonSession,
  ensureLiveLessonIndexes,
} from '../src/models/liveLessonSession';
import {
  createLiveLessonService,
  lessonInstant,
} from '../src/services/live-lesson.service';
import { ZegoRtcProvider } from '../src/services/rtc/zego-rtc-provider';
import type {
  RtcCredentialRequest,
  RtcProvider,
} from '../src/services/rtc/rtc-provider';
import {
  generateAccessToken,
  type JwtPayload,
} from '../src/services/jwt.service';
import { PERMISSIONS } from '../src/constants/permissions';
import { ROLE_PERMISSIONS } from '../src/constants/rolePermissions';
import {
  schoolDateTime,
  scheduleWeekday,
  addScheduleDays,
} from '../src/services/school-date.service';
import { withAcademicCatalogLock } from '../src/services/academic-catalog-lock.service';
import { withTimetablePublication } from '../src/services/teacher-timetable.service';

const previousSecret = process.env.JWT_SECRET;
let db: MongoMemoryReplSet;
let branch: mongoose.Types.ObjectId,
  cls: mongoose.Types.ObjectId,
  section: mongoose.Types.ObjectId,
  subject: mongoose.Types.ObjectId;
let academic: mongoose.Types.ObjectId,
  period: mongoose.Types.ObjectId,
  version: mongoose.Types.ObjectId;
let teacher: JwtPayload,
  student: JwtPayload,
  other: JwtPayload,
  teacherToken: string,
  studentToken: string,
  otherToken: string;
let date: string, startTime: string, endTime: string;
let calls: RtcCredentialRequest[] = [];
const fake: RtcProvider = {
  name: 'fake',
  roomId: id => 'room_' + id,
  issueCredential(input) {
    calls.push(input);
    return {
      provider: 'fake',
      appId: 123,
      roomId: input.roomId,
      userId: 'opaque',
      role: input.role,
      token: 'test-only-token',
      expiresAt: new Date(
        Math.min(Date.now() + 300000, input.expiresAt.getTime()),
      ).toISOString(),
    };
  },
};
const service = createLiveLessonService(() => fake);
const start = (identity = teacher, token = teacherToken) =>
  service.start(identity, token, String(period), date);
const deny = async (action: Promise<unknown>) => {
  const beforeCalls = calls.length;
  await assert.rejects(action);
  assert.equal(calls.length, beforeCalls);
};
before(async () => {
  process.env.JWT_SECRET = 'isolated-live-lesson-test';
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri(), {
    dbName: 'live_lesson_tests',
    autoIndex: false,
  });
  await Promise.all([
    ensureLiveLessonIndexes(),
    ensureTimetableIndexes(),
    TeacherAssignment.createIndexes(),
    StudentEnrollment.createIndexes(),
  ]);
});
after(async () => {
  mock.restoreAll();
  await mongoose.disconnect();
  if (db) await db.stop();
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});
beforeEach(async () => {
  mock.restoreAll();
  calls = [];
  for (const collection of Object.values(mongoose.connection.collections))
    await collection.deleteMany({});
  // Owned fixture clock is fixed at midday so operational tests work at midnight.
  const actualNow = Date.now();
  date = schoolDateTime(new Date(actualNow)).date;
  const instant = lessonInstant(date, '12:00').getTime();
  mock.method(Date, 'now', () => instant);
  startTime = '11:55';
  endTime = '12:55';
  branch = (
    await Branch.create({
      name: 'Branch A',
      code: 'AA',
      address: 'Private',
      city: 'City',
    })
  )._id;
  async function actor(name: string, role: 'teacher' | 'student') {
    const row = await User.create({
      fullName: name,
      email: name + '@test.invalid',
      password: 'fixture-hash',
      role,
      branchId: branch,
    });
    const identity = { userId: String(row._id), role };
    const token = generateAccessToken(identity.userId, role);
    await Session.create({ userId: row._id, role, token });
    return { identity, token };
  }
  ({ identity: teacher, token: teacherToken } = await actor(
    'teacher',
    'teacher',
  ));
  ({ identity: other, token: otherToken } = await actor('other', 'teacher'));
  ({ identity: student, token: studentToken } = await actor(
    'student',
    'student',
  ));
  academic = (
    await AcademicPeriod.create({
      branchId: branch,
      name: 'Year',
      code: '2026',
      startDate: '2020-01-01',
      endDate: '2035-01-01',
      status: 'active',
      createdBy: teacher.userId,
      updatedBy: teacher.userId,
    })
  )._id;
  cls = (
    await SchoolClass.create({
      branchId: branch,
      name: 'Class 8',
      code: '8',
      academicYear: '2026',
      academicPeriodId: academic,
    })
  )._id;
  section = (
    await Section.create({
      branchId: branch,
      classId: cls,
      name: 'A',
      code: 'A',
    })
  )._id;
  subject = (await Subject.create({ branchId: branch, name: 'Math' }))._id;
  await ClassSubject.create({
    branchId: branch,
    academicPeriodId: academic,
    classId: cls,
    subjectId: subject,
    createdBy: teacher.userId,
    updatedBy: teacher.userId,
  });
  await TeacherAssignment.create({
    branchId: branch,
    teacherId: teacher.userId,
    classId: cls,
    sectionId: section,
    subjectId: subject,
    validFrom: new Date(0),
    createdBy: teacher.userId,
    updatedBy: teacher.userId,
  });
  version = (
    await TimetableVersion.create({
      branchId: branch,
      versionNumber: 1,
      status: 'approved',
      effectiveFrom: addScheduleDays(date, -1),
      effectiveUntil: addScheduleDays(date, 2),
      periodCount: 1,
      createdBy: teacher.userId,
    })
  )._id;
  period = (
    await TimetablePeriod.create({
      branchId: branch,
      timetableVersionId: version,
      teacherId: teacher.userId,
      classId: cls,
      sectionId: section,
      subjectId: subject,
      dayOfWeek: scheduleWeekday(date),
      startTime,
      endTime,
      room: 'A',
    })
  )._id;
  const person = await Student.create({
    userId: student.userId,
    branchId: branch,
    classId: cls,
    sectionId: section,
    admissionNumber: 'TEST1',
  });
  await StudentEnrollment.create({
    studentId: person._id,
    branchId: branch,
    academicPeriodId: academic,
    classId: cls,
    sectionId: section,
    effectiveFrom: new Date(0),
    reason: 'Fixture',
    createdBy: teacher.userId,
    updatedBy: teacher.userId,
  });
});

test('scheduled host, enrolled student, opaque adapter boundary and bounded window', async () => {
  const result = await start();
  assert.equal(result.session.status, 'live');
  assert.equal(calls[0].actorId, teacher.userId);
  const joined = await service.join(student, studentToken, result.session.id);
  assert.equal(joined.connection.role, 'participant');
  assert.equal(calls[1].actorId, student.userId);
  assert.equal(calls[1].roomId, calls[0].roomId);
  assert.ok(Date.parse(joined.connection.expiresAt) <= Date.now() + 300000);
  const raw = JSON.stringify(await service.read(teacher, result.session.id));
  for (const field of [
    'token',
    'providerRoomId',
    'history',
    'password',
    'email',
    '__v',
  ])
    assert.ok(!raw.includes(field));
});
test('wrong teacher, unauthenticated identity, student start and principal host denied', async () => {
  await deny(start(other, otherToken));
  await deny(service.start(undefined, '', String(period), date));
  await deny(start(student, studentToken));
  await User.updateOne({ _id: other.userId }, { role: 'principal' });
  await deny(start({ ...other, role: 'principal' }, otherToken));
});
for (const [name, mutation] of Object.entries({
  'inactive teacher': () =>
    User.updateOne({ _id: teacher.userId }, { isActive: false }),
  'foreign branch': () =>
    User.updateOne(
      { _id: teacher.userId },
      { branchId: new mongoose.Types.ObjectId() },
    ),
  'revoked assignment': () =>
    TeacherAssignment.updateMany({}, { isActive: false }),
  'wrong class assignment': () =>
    TeacherAssignment.collection.updateMany(
      {},
      { $set: { classId: new mongoose.Types.ObjectId() } },
    ),
  'wrong section': () =>
    Section.collection.updateOne(
      { _id: section },
      { $set: { classId: new mongoose.Types.ObjectId() } },
    ),
  'inactive academic period': () =>
    AcademicPeriod.updateOne({ _id: academic }, { status: 'closed' }),
  'invalid curriculum': () => ClassSubject.updateMany({}, { isActive: false }),
  'retired timetable': () =>
    TimetableVersion.updateOne({ _id: version }, { status: 'retired' }),
  'revoked login': () =>
    Session.updateOne({ token: teacherToken }, { isRevoked: true }),
}))
  test(name + ' denies start before signer', async () => {
    await mutation();
    await deny(start());
  });
test('missing start permission denied at service boundary', async () => {
  const permissions = ROLE_PERMISSIONS.teacher;
  try {
    ROLE_PERMISSIONS.teacher = permissions.filter(
      p => p !== PERMISSIONS.LIVE_LESSON_START,
    );
    await deny(start());
  } finally {
    ROLE_PERMISSIONS.teacher = permissions;
  }
});
async function substitute(extra: Record<string, unknown> = {}) {
  return SubstituteAssignment.create({
    branchId: branch,
    periodId: period,
    originalTeacherId: teacher.userId,
    substituteTeacherId: other.userId,
    date,
    startTime,
    endTime,
    room: 'A',
    status: 'approved',
    createdBy: teacher.userId,
    ...extra,
  });
}
test('approved exact substitute replaces original operational host', async () => {
  const sub = await substitute();
  await deny(start());
  const result = await start(other, otherToken);
  assert.equal(result.connection.role, 'host');
  const stored = await LiveLessonSession.findById(result.session.id);
  assert.equal(String(stored!.substituteId), String(sub._id));
});
for (const kind of ['other-date', 'other-period', 'draft', 'expired'])
  test(kind + ' substitute denied', async () => {
    await substitute(
      kind === 'other-date'
        ? { date: addScheduleDays(date, 1) }
        : kind === 'other-period'
        ? { periodId: new mongoose.Types.ObjectId() }
        : kind === 'draft'
        ? { status: 'draft' }
        : { startTime: '09:00', endTime: '10:00' },
    );
    await deny(start(other, otherToken));
  });
for (const [name, mutation] of Object.entries({
  'wrong class': () =>
    StudentEnrollment.collection.updateMany(
      {},
      { $set: { classId: new mongoose.Types.ObjectId() } },
    ),
  'wrong section': () =>
    StudentEnrollment.collection.updateMany(
      {},
      { $set: { sectionId: new mongoose.Types.ObjectId() } },
    ),
  'wrong academic period': () =>
    StudentEnrollment.collection.updateMany(
      {},
      { $set: { academicPeriodId: new mongoose.Types.ObjectId() } },
    ),
  'foreign student branch': () =>
    User.updateOne(
      { _id: student.userId },
      { branchId: new mongoose.Types.ObjectId() },
    ),
  'withdrawn enrollment': () =>
    StudentEnrollment.updateMany(
      {},
      { status: 'withdrawn', effectiveTo: new Date() },
    ),
  'promoted enrollment': () =>
    StudentEnrollment.updateMany(
      {},
      { status: 'promoted', effectiveTo: new Date() },
    ),
  'inactive student account': () =>
    User.updateOne({ _id: student.userId }, { isActive: false }),
  'inactive student profile': () => Student.updateMany({}, { isActive: false }),
  'future enrollment': () =>
    StudentEnrollment.collection.updateMany(
      {},
      { $set: { effectiveFrom: new Date(Date.now() + 86400000) } },
    ),
  'zero enrollment legacy': () => StudentEnrollment.deleteMany({}),
}))
  test(name + ' denies student credential', async () => {
    const result = await start();
    await mutation();
    await deny(service.join(student, studentToken, result.session.id));
  });
test('end is host-only, idempotent, denies joins and history survives retirement/period close', async () => {
  const result = await start();
  await deny(service.end(other, otherToken, result.session.id));
  const ended = await service.end(teacher, teacherToken, result.session.id);
  assert.equal(ended.status, 'ended');
  assert.ok(ended.endedAt);
  assert.deepEqual(
    await service.end(teacher, teacherToken, result.session.id),
    ended,
  );
  await deny(service.join(student, studentToken, result.session.id));
  await deny(start());
  await TimetableVersion.updateOne({ _id: version }, { status: 'retired' });
  await AcademicPeriod.updateOne({ _id: academic }, { status: 'closed' });
  assert.equal(
    (await service.read(teacher, result.session.id)).status,
    'ended',
  );
  assert.equal(
    (await service.read(student, result.session.id)).status,
    'ended',
  );
});
test('managed enrollment wins over stale legacy student class and section', async () => {
  const result = await start();
  await Student.collection.updateMany(
    {},
    {
      $set: {
        classId: new mongoose.Types.ObjectId(),
        sectionId: new mongoose.Types.ObjectId(),
      },
    },
  );
  assert.equal(
    (await service.join(student, studentToken, result.session.id)).connection
      .role,
    'participant',
  );
});
test('join permission and current host assignment are revalidated', async () => {
  const result = await start();
  const permissions = ROLE_PERMISSIONS.student;
  try {
    ROLE_PERMISSIONS.student = permissions.filter(
      p => p !== PERMISSIONS.LIVE_LESSON_JOIN,
    );
    await deny(service.join(student, studentToken, result.session.id));
  } finally {
    ROLE_PERMISSIONS.student = permissions;
  }
  await TeacherAssignment.updateMany({}, { isActive: false });
  await deny(service.join(student, studentToken, result.session.id));
});
test('database unique indexes reject duplicate occurrence and provider room identities', async () => {
  await start();
  const row = await LiveLessonSession.findOne().lean();
  assert.ok(row);
  await assert.rejects(
    LiveLessonSession.collection.insertOne({
      ...row,
      _id: new mongoose.Types.ObjectId(),
      providerRoomId: 'different',
    }),
    (error: { code?: number }) => error.code === 11000,
  );
  await assert.rejects(
    LiveLessonSession.collection.insertOne({
      ...row,
      _id: new mongoose.Types.ObjectId(),
      date: addScheduleDays(date, 1),
    }),
    (error: { code?: number }) => error.code === 11000,
  );
});
test('parallel independent service starts converge on one database session', async () => {
  const second = createLiveLessonService(() => fake);
  const results = await Promise.all([
    start(),
    second.start(teacher, teacherToken, String(period), date),
    start(),
  ]);
  assert.equal(new Set(results.map(r => r.session.id)).size, 1);
  assert.equal(await LiveLessonSession.countDocuments(), 1);
  assert.equal((await LiveLessonSession.findOne())!.history.length, 3);
});
async function worker() {
  const child = fork(
    pathJoin(__dirname, 'helpers/live-lesson-worker.ts'),
    [db.getUri('live_lesson_tests'), String(Date.now())],
    {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    },
  );
  const wait = (type: string) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Worker timed out: ' + type));
      }, 20000);
      const listener = (value: Record<string, unknown>) => {
        if (value.type === type || value.type === 'failure') {
          clearTimeout(timeout);
          child.off('message', listener);
          if (value.type === 'failure') reject(new Error('Worker failed'));
          else resolve(value);
        }
      };
      child.on('message', listener);
    });
  await wait('ready');
  return {
    child,
    wait,
    close: async () => {
      if (child.exitCode !== null) return;
      await new Promise<void>(resolve => {
        child.once('exit', () => resolve());
        child.send({ action: 'shutdown' });
      });
    },
  };
}
test('separate Node instances concurrently start exactly one logical session', async () => {
  const second = await worker();
  try {
    const remote = second.wait('result');
    second.child.send({
      action: 'start',
      identity: teacher,
      token: teacherToken,
      id: String(period),
      date,
    });
    const local = await start();
    const result = await remote;
    assert.equal(result.ok, true);
    assert.equal(result.id, local.session.id);
    assert.equal(await LiveLessonSession.countDocuments(), 1);
  } finally {
    await second.close();
  }
});
test('signer failure rolls back all lifecycle writes and retries safely', async () => {
  const failed = createLiveLessonService(() => ({
    ...fake,
    issueCredential() {
      throw new Error('private-provider-error');
    },
  }));
  await assert.rejects(
    failed.start(teacher, teacherToken, String(period), date),
    /credential issuance failed/,
  );
  assert.equal(await LiveLessonSession.countDocuments(), 0);
  assert.equal((await start()).session.status, 'live');
});
test('historical/future starts and post-window joins denied', async () => {
  await deny(
    service.start(
      teacher,
      teacherToken,
      String(period),
      addScheduleDays(date, -7),
    ),
  );
  await deny(
    service.start(
      teacher,
      teacherToken,
      String(period),
      addScheduleDays(date, 7),
    ),
  );
  const result = await start();
  mock.method(Date, 'now', () => lessonInstant(date, '13:00').getTime());
  await deny(service.join(student, studentToken, result.session.id));
});

// Hold the same persisted publication/catalog fence as administrative writers.
// The credential request begins while that transaction is uncommitted, then
// must retry and observe revocation. No process-local lock participates.
async function race(
  mutate: (session: mongoose.ClientSession) => Promise<unknown>,
  identity = teacher,
  token = teacherToken,
  id = String(period),
  publication = false,
  action = 'start',
) {
  const remote = await worker();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(r => {
    release = r;
  });
  const acquired = new Promise<void>(r => {
    entered = r;
  });
  const writer = async (session: mongoose.ClientSession) => {
    await mutate(session);
    entered();
    await gate;
  };
  const winning = publication
    ? withTimetablePublication(String(branch), String(period), writer)
    : withAcademicCatalogLock(String(branch), writer);
  try {
    await acquired;
    const atFence = remote.wait('fence'),
      outcome = remote.wait('result');
    remote.child.send({ action, identity, token, id, date });
    // Prove the other process reaches the DB write fence before releasing it.
    await atFence;
    release();
    await winning;
    assert.equal((await outcome).ok, false);
  } finally {
    release();
    await remote.close();
  }
}
test('start versus timetable retirement observes winning commit', async () => {
  await race(
    s =>
      TimetableVersion.updateOne(
        { _id: version },
        { status: 'retired' },
        { session: s },
      ),
    teacher,
    teacherToken,
    String(period),
    true,
  );
  assert.equal(await LiveLessonSession.countDocuments(), 0);
});
test('start versus assignment revocation observes winning commit', async () => {
  await race(s =>
    TeacherAssignment.updateMany({}, { isActive: false }, { session: s }),
  );
  assert.equal(await LiveLessonSession.countDocuments(), 0);
});
test('substitute start versus revocation observes winning commit', async () => {
  const sub = await substitute();
  await race(
    s =>
      SubstituteAssignment.updateOne(
        { _id: sub._id },
        { status: 'retired' },
        { session: s },
      ),
    other,
    otherToken,
    String(period),
    true,
  );
  assert.equal(await LiveLessonSession.countDocuments(), 0);
});
test('join versus enrollment withdrawal observes winning commit', async () => {
  const result = await start();
  calls = [];
  await race(
    s =>
      StudentEnrollment.updateMany(
        {},
        { status: 'withdrawn', effectiveTo: new Date() },
        { session: s },
      ),
    student,
    studentToken,
    result.session.id,
    false,
    'join',
  );
  assert.equal(calls.length, 0);
});
test('join versus enrollment transfer observes winning commit', async () => {
  const result = await start();
  await race(
    s =>
      StudentEnrollment.updateMany(
        {},
        { status: 'transferred', effectiveTo: new Date() },
        { session: s },
      ),
    student,
    studentToken,
    result.session.id,
    false,
    'join',
  );
});
test('HTTP rejects spoofed teacher/student identities and administrative roles', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/live-lessons', liveLessonRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const url = `http://127.0.0.1:${address.port}/api/live-lessons`;
    const response = await fetch(`${url}/from-timetable/${period}/start`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${teacherToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ date, teacherId: other.userId }),
    });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const result = await start();
    const join = await fetch(`${url}/${result.session.id}/join-token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ studentId: student.userId }),
    });
    assert.equal(join.status, 400);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
test('production adapter Token04 decrypts to exact scoped role grants without secret leakage', () => {
  const secret = '0123456789abcdef0123456789abcdef'; // synthetic fixture, never production
  const provider = new ZegoRtcProvider({
    LIVE_LESSON_ENABLED: 'true',
    ZEGOCLOUD_ROOM_PRIVILEGES_ENABLED: 'true',
    ZEGOCLOUD_APP_ID: '123',
    ZEGOCLOUD_SERVER_SECRET: secret,
  });
  const roomId = provider.roomId('session-a');
  assert.notEqual(roomId, provider.roomId('session-b'));
  for (const role of ['host', 'participant'] as const) {
    const result = provider.issueCredential({
      sessionId: 'session-a',
      roomId,
      actorId: teacher.userId,
      role,
      expiresAt: new Date(Date.now() + 600000),
    });
    assert.ok(!JSON.stringify(result).includes(secret));
    assert.ok(!result.userId.includes(teacher.userId));
    const bytes = Buffer.from(result.token.slice(2), 'base64');
    assert.equal(
      bytes.readBigInt64BE(),
      BigInt(Math.floor(Date.now() / 1000) + 300),
    );
    const ivSize = bytes.readUInt16BE(8);
    assert.equal(ivSize, 16);
    const decipher = createDecipheriv(
      'aes-256-cbc',
      Buffer.from(secret),
      bytes.subarray(10, 10 + ivSize),
    );
    const claims = JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(12 + ivSize)),
        decipher.final(),
      ]).toString(),
    );
    assert.equal(claims.user_id, result.userId);
    assert.equal(claims.app_id, 123);
    assert.deepEqual(JSON.parse(claims.payload), {
      room_id: roomId,
      privilege: { 1: 1, 2: role === 'host' ? 1 : 0 },
      stream_id_list: [],
    });
  }
  for (const env of [
    {},
    { LIVE_LESSON_ENABLED: 'true' },
    { LIVE_LESSON_TOKEN_TTL_SECONDS: '9999' },
  ])
    assert.throws(() => new ZegoRtcProvider(env));
  const configured = {
    LIVE_LESSON_ENABLED: 'true',
    ZEGOCLOUD_ROOM_PRIVILEGES_ENABLED: 'true',
    ZEGOCLOUD_APP_ID: '123',
    ZEGOCLOUD_SERVER_SECRET: secret,
  };
  for (const ttl of ['0', '29', '601', 'NaN'])
    assert.throws(
      () =>
        new ZegoRtcProvider({
          ...configured,
          LIVE_LESSON_TOKEN_TTL_SECONDS: ttl,
        }),
    );
  assert.throws(
    () =>
      new ZegoRtcProvider({
        ...configured,
        ZEGOCLOUD_ROOM_PRIVILEGES_ENABLED: 'false',
      }),
  );
  const short = provider.issueCredential({
    sessionId: 'session',
    roomId,
    actorId: teacher.userId,
    role: 'participant',
    expiresAt: new Date(Date.now() + 10000),
  });
  assert.equal(Date.parse(short.expiresAt), Date.now() + 10000);
});
