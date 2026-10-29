import assert from 'node:assert/strict';
import { before, beforeEach, after, afterEach, mock, test } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Server } from 'node:http';
import app from '../src/app';
import User from '../src/models/user';
import Branch from '../src/models/branch';
import Session from '../src/models/session';
import SchoolClass from '../src/models/schoolClass';
import Section from '../src/models/section';
import Subject from '../src/models/subject';
import TeacherAssignment from '../src/models/teacherAssignment';
import Room from '../src/models/room';
import {
  TimetableVersion,
  TimetablePeriod,
  SubstituteAssignment,
  ensureTimetableIndexes,
} from '../src/models/timetable';
import { seedCurriculumFixtures } from './helpers/curriculum-fixtures';
import { generateAccessToken } from '../src/services/jwt.service';
import { registerSession } from '../src/services/session.service';
import { ROLE_PERMISSIONS } from '../src/constants/rolePermissions';
import { PERMISSIONS } from '../src/constants/permissions';
import {
  getTeacherTimetable,
  mutateOccurrence,
} from '../src/services/teacher-timetable.service';
import {
  substitutionOverview,
  substitutionCandidates,
  mutateSubstitution,
} from '../src/services/principal-substitution.service';
type Id = mongoose.Types.ObjectId;
let db: MongoMemoryReplSet, server: Server, base: string;
let branch: Id,
  foreign: Id,
  principal: Id,
  teacher: Id,
  substitute: Id,
  other: Id,
  period: Id,
  token: string;
const date = '2026-10-27',
  permissions = [...ROLE_PERMISSIONS.principal],
  savedSecret = process.env.JWT_SECRET;
const identity = () => ({
  userId: String(principal),
  role: 'principal' as const,
});
before(async () => {
  process.env.JWT_SECRET = 'principal-substitution-isolated-fixture';
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri(), {
    dbName: 'substitutions',
    autoIndex: false,
  });
  await ensureTimetableIndexes();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(r => server.once('listening', r));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}/api/timetables`;
});
async function user(name: string, role = 'teacher', branchId = branch) {
  return (
    await new User({
      fullName: name,
      email: name + '@fixture.invalid',
      password: 'private',
      role,
      branchId,
    }).save()
  )._id as Id;
}
beforeEach(async () => {
  mock.restoreAll();
  ROLE_PERMISSIONS.principal = [...permissions];
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-25T06:00:00Z') });
  for (const model of [
    SubstituteAssignment,
    TimetablePeriod,
    TimetableVersion,
    TeacherAssignment,
    Room,
    Section,
    SchoolClass,
    Subject,
    Session,
    User,
    Branch,
  ])
    await model.collection.deleteMany({});
  branch = (
    await Branch.create({
      name: 'Branch A',
      code: 'AA',
      address: 'fixture',
      city: 'fixture',
    })
  )._id;
  foreign = (
    await Branch.create({
      name: 'Branch B',
      code: 'BB',
      address: 'fixture',
      city: 'fixture',
    })
  )._id;
  principal = await user('principal', 'principal');
  teacher = await user('original');
  substitute = await user('replacement');
  other = await user('other');
  token = generateAccessToken(String(principal), 'principal');
  await registerSession(String(principal), token, 'principal');
  const c = await new SchoolClass({
    branchId: branch,
    name: 'Grade 8',
    code: '8',
    academicYear: '2026',
  }).save();
  const section = await new Section({
    branchId: branch,
    classId: c._id,
    name: 'A',
    code: 'A',
  }).save();
  const subject = await Subject.create({ branchId: branch, name: 'Science' });
  await seedCurriculumFixtures();
  await TeacherAssignment.create({
    branchId: branch,
    teacherId: teacher,
    classId: c._id,
    sectionId: section._id,
    subjectId: subject._id,
    validFrom: new Date('2026-01-01'),
    createdBy: principal,
    updatedBy: principal,
  });
  const room = await Room.create({
    branchId: branch,
    name: 'Room A',
    code: 'A',
    category: 'classroom',
    createdBy: principal,
    updatedBy: principal,
  });
  const version = await TimetableVersion.create({
    branchId: branch,
    versionNumber: 1,
    status: 'approved',
    effectiveFrom: '2026-10-01',
    effectiveUntil: '2026-11-01',
    periodCount: 1,
    createdBy: principal,
  });
  period = (
    await TimetablePeriod.create({
      branchId: branch,
      timetableVersionId: version._id,
      classId: c._id,
      sectionId: section._id,
      subjectId: subject._id,
      teacherId: teacher,
      dayOfWeek: 2,
      startTime: '09:00',
      endTime: '10:00',
      room: room.name,
      roomId: room._id,
    })
  )._id;
});
afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});
after(async () => {
  ROLE_PERMISSIONS.principal = permissions;
  if (server) await new Promise<void>(r => server.close(() => r()));
  await mongoose.disconnect();
  if (db) await db.stop();
  if (savedSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = savedSecret;
});
const overview = () => substitutionOverview(identity(), { date });
async function payload(id = period, target = substitute) {
  const row = (await overview()).items.find(r => r.periodId === String(id))!;
  return {
    date,
    revision: row.revision,
    teacherId: String(target),
    reason: 'Teacher absent',
  };
}
const assign = async (id = period, target = substitute) =>
  mutateSubstitution(identity(), token, String(id), await payload(id, target));
const rejects = (work: Promise<unknown>, status: number) =>
  assert.rejects(
    work,
    (e: unknown) => (e as { status: number }).status === status,
  );

test('available candidates follow documented temporary-duty policy, omit private fields and original Teacher', async () => {
  const foreignTeacher = await user('foreign', 'teacher', foreign);
  const inactive = await user('inactive');
  await User.collection.updateOne(
    { _id: inactive },
    { $set: { isActive: false } },
  );
  const result = await substitutionCandidates(identity(), String(period), {
    date,
  });
  assert.deepEqual(
    result.items.map(t => t.id).sort(),
    [String(substitute), String(other)].sort(),
  );
  assert.ok(!JSON.stringify(result).includes(String(foreignTeacher)));
  assert.ok(!JSON.stringify(result).includes('password'));
  assert.equal(
    await TeacherAssignment.countDocuments({ teacherId: substitute }),
    0,
  );
});
test('assign, replace and cancel preserve history and original assignment; Teacher queue follows effective owner', async () => {
  const assignmentCount = await TeacherAssignment.countDocuments();
  await assign();
  let row = (await overview()).items[0];
  assert.equal(row.originalTeacher.id, String(teacher));
  assert.equal(row.substituteTeacher?.id, String(substitute));
  assert.equal(
    (
      await getTeacherTimetable(
        { userId: String(substitute), role: 'teacher' },
        date,
      )
    ).periods.length,
    1,
  );
  assert.equal(
    (
      await getTeacherTimetable(
        { userId: String(teacher), role: 'teacher' },
        date,
      )
    ).periods.length,
    0,
  );
  await assign(period, other);
  row = (await overview()).items[0];
  assert.equal(row.history.length, 2);
  await mutateSubstitution(
    identity(),
    token,
    String(period),
    { date, revision: row.revision },
    true,
  );
  row = (await overview()).items[0];
  assert.equal(row.substituteTeacher, null);
  assert.ok(row.history.every(h => h.status === 'retired'));
  assert.equal(await TeacherAssignment.countDocuments(), assignmentCount);
});
test('same occurrence race has exactly one winner and one history entry', async () => {
  const input = await payload();
  const peer = await user('peer', 'principal'),
    peerToken = generateAccessToken(String(peer), 'principal');
  await registerSession(String(peer), peerToken, 'principal');
  const result = await Promise.allSettled([
    mutateSubstitution(identity(), token, String(period), input),
    mutateSubstitution(
      { userId: String(peer), role: 'principal' },
      peerToken,
      String(period),
      { ...input, teacherId: String(other) },
    ),
  ]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(
    (result.find(r => r.status === 'rejected') as PromiseRejectedResult).reason
      .status,
    409,
  );
  assert.equal(await SubstituteAssignment.countDocuments(), 1);
});
async function anotherPeriod(
  teacherId: Id,
  startTime = '09:30',
  endTime = '10:30',
) {
  const p = (await TimetablePeriod.findById(period).lean())!;
  const section = await new Section({
    branchId: branch,
    classId: p.classId,
    name: 'B',
    code: 'B',
  }).save();
  const room = await Room.create({
    branchId: branch,
    name: 'Room B',
    code: 'B',
    category: 'classroom',
    createdBy: principal,
    updatedBy: principal,
  });
  await TeacherAssignment.create({
    branchId: branch,
    teacherId,
    classId: p.classId,
    sectionId: section._id,
    subjectId: p.subjectId,
    validFrom: new Date('2026-01-01'),
    createdBy: principal,
    updatedBy: principal,
  });
  const fields = {...p, _id: new mongoose.Types.ObjectId()};
  return (
    await TimetablePeriod.create({
      ...fields,
      teacherId,
      sectionId: section._id,
      roomId: room._id,
      room: room.name,
      startTime,
      endTime,
    })
  )._id;
}
test('own timetable overlap excludes candidate and rejects forged write', async () => {
  await anotherPeriod(substitute);
  const candidates = await substitutionCandidates(identity(), String(period), {
    date,
  });
  assert.ok(!candidates.items.some(t => t.id === String(substitute)));
  await rejects(assign(), 409);
  assert.equal(await SubstituteAssignment.countDocuments(), 0);
});
test('same replacement Teacher on overlapping lessons has one winner', async () => {
  const second = await anotherPeriod(other),
    a = await payload(),
    b = await payload(second);
  const results = await Promise.allSettled([
    mutateSubstitution(identity(), token, String(period), a),
    mutateSubstitution(identity(), token, String(second), b),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(
    (results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason
      .status,
    409,
  );
  assert.equal(await SubstituteAssignment.countDocuments(), 1);
});
test('overlapping substitution excluded while adjacent and other-day duties do not occupy candidate', async () => {
  const second = await anotherPeriod(other);
  await assign(second);
  assert.ok(
    !(
      await substitutionCandidates(identity(), String(period), { date })
    ).items.some(t => t.id === String(substitute)),
  );
  await SubstituteAssignment.collection.updateMany(
    {},
    { $set: { date: '2026-10-20' } },
  );
  assert.ok(
    (
      await substitutionCandidates(identity(), String(period), { date })
    ).items.some(t => t.id === String(substitute)),
  );
});
test('stale revision after assignment/cancellation cannot create an ABA overwrite', async () => {
  const old = await payload();
  await assign();
  const row = (await overview()).items[0];
  await mutateSubstitution(
    identity(),
    token,
    String(period),
    { date, revision: row.revision },
    true,
  );
  await rejects(
    mutateSubstitution(identity(), token, String(period), old),
    409,
  );
});
test('superseded timetable and revoked academic assignment reject stale occurrence', async () => {
  const old = await payload();
  await TeacherAssignment.updateMany({}, { $set: { isActive: false } });
  await rejects(
    mutateSubstitution(identity(), token, String(period), old),
    409,
  );
  await TimetableVersion.updateMany({}, { $set: { status: 'retired' } });
  await rejects(
    mutateSubstitution(identity(), token, String(period), old),
    404,
  );
});
test('foreign period and Teacher are rejected; bounded search and pagination validate input', async () => {
  const outside = await user('outside', 'teacher', foreign);
  await rejects(assign(period, outside), 404);
  await rejects(
    substitutionCandidates(
      identity(),
      new mongoose.Types.ObjectId().toString(),
      { date },
    ),
    404,
  );
  await rejects(
    substitutionCandidates(identity(), String(period), { date, offset: -1 }),
    400,
  );
  await rejects(
    substitutionCandidates(identity(), String(period), {
      date,
      search: 'x'.repeat(81),
    }),
    400,
  );
  assert.equal(
    (
      await substitutionCandidates(identity(), String(period), {
        date,
        search: 'replacement',
      })
    ).items.length,
    1,
  );
  assert.equal(
    (
      await substitutionCandidates(identity(), String(period), {
        date,
        search: '.*',
      })
    ).items.length,
    0,
  );
});
test('invalid Subject context fails candidates and assignment', async () => {
  await Subject.updateMany({}, { $set: { isActive: false } });
  await rejects(
    substitutionCandidates(identity(), String(period), { date }),
    404,
  );
  await rejects(assign(), 404);
});
test('started lesson cannot be assigned or cancelled and future substitution does not grant another date', async () => {
  await assign();
  assert.equal(
    (
      await getTeacherTimetable(
        { userId: String(substitute), role: 'teacher' },
        '2026-10-20',
      )
    ).periods.length,
    0,
  );
  mock.timers.setTime(new Date('2026-10-27T04:00:00Z').getTime());
  token = generateAccessToken(String(principal), 'principal');
  await registerSession(String(principal), token, 'principal');
  await rejects(assign(period, other), 409);
  const row = (await overview()).items[0];
  assert.equal(row.canManage, false);
  await rejects(
    mutateSubstitution(
      identity(),
      token,
      String(period),
      { date, revision: row.revision },
      true,
    ),
    409,
  );
});
for (const change of [
  'transfer',
  'demote',
  'disable',
  'revoke',
  'permission',
  'branch',
] as const) {
  test(`commit-time ${change} rolls back substitution and history`, async () => {
    const body = await payload();
    let fired = false;
    const perform = async () => {
      if (fired) return;
      fired = true;
      if (change === 'transfer')
        await User.collection.updateOne(
          { _id: principal },
          { $set: { branchId: foreign } },
        );
      if (change === 'demote')
        await User.collection.updateOne(
          { _id: principal },
          { $set: { role: 'teacher' } },
        );
      if (change === 'disable')
        await User.collection.updateOne(
          { _id: principal },
          { $set: { isActive: false } },
        );
      if (change === 'revoke')
        await Session.collection.updateMany(
          { token },
          { $set: { isRevoked: true } },
        );
      if (change === 'permission')
        ROLE_PERMISSIONS.principal = permissions.filter(
          p => p !== PERMISSIONS.TIMETABLE_MANAGE,
        );
      if (change === 'branch')
        await Branch.collection.updateOne(
          { _id: branch },
          { $set: { isActive: false } },
        );
    };
    if (change === 'branch') {
      const original = Branch.collection.updateOne.bind(Branch.collection);
      mock.method(
        Branch.collection,
        'updateOne',
        async (...args: Parameters<typeof original>) => {
          if (!fired) {
            fired = true;
            await original({ _id: branch }, { $set: { isActive: false } });
          }
          return original(...args);
        },
      );
    } else {
      const original = SubstituteAssignment.collection.insertOne.bind(
        SubstituteAssignment.collection,
      );
      mock.method(
        SubstituteAssignment.collection,
        'insertOne',
        async (...args: Parameters<typeof original>) => {
          await perform();
          return original(...args);
        },
      );
    }
    await assert.rejects(
      mutateSubstitution(identity(), token, String(period), body),
    );
    assert.equal(fired, true);
    assert.equal(await SubstituteAssignment.countDocuments(), 0);
  });
}
test('HTTP rejects unknown fields and unauthenticated requests and returns no-store DTO', async () => {
  let response = await fetch(base + '/occurrences?date=' + date);
  assert.equal(response.status, 401);
  response = await fetch(base + '/occurrences?date=' + date, {
    headers: { Authorization: 'Bearer ' + token },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  response = await fetch(base + '/occurrences?branchId=' + foreign, {
    headers: { Authorization: 'Bearer ' + token },
  });
  assert.equal(response.status, 400);
});

for (const state of [
  'demoted',
  'disabled',
  'branch inactive',
  'permission removed',
] as const)
  test(`read authority fails for ${state}`, async () => {
    if (state === 'demoted')
      await User.collection.updateOne(
        { _id: principal },
        { $set: { role: 'teacher' } },
      );
    if (state === 'disabled')
      await User.collection.updateOne(
        { _id: principal },
        { $set: { isActive: false } },
      );
    if (state === 'branch inactive')
      await Branch.collection.updateOne(
        { _id: branch },
        { $set: { isActive: false } },
      );
    if (state === 'permission removed')
      ROLE_PERMISSIONS.principal = permissions.filter(
        p => p !== PERMISSIONS.TIMETABLE_MANAGE,
      );
    await assert.rejects(overview());
    await assert.rejects(
      substitutionCandidates(identity(), String(period), { date }),
    );
  });
test('foreign existing period is concealed from own-Branch Principal', async () => {
  await TimetablePeriod.collection.updateOne(
    { _id: period },
    { $set: { branchId: foreign } },
  );
  assert.equal((await overview()).items.length, 0);
  await rejects(
    substitutionCandidates(identity(), String(period), { date }),
    404,
  );
});
for (const field of ['sectionId', 'roomId'] as const)
  test(`${field} overlap rejects assignment without history`, async () => {
    const second = await anotherPeriod(other),
      original = (await TimetablePeriod.findById(period).lean())!;
    await TimetablePeriod.collection.updateOne(
      { _id: second },
      { $set: { [field]: original[field] } },
    );
    await rejects(assign(), 409);
    assert.equal(await SubstituteAssignment.countDocuments(), 0);
  });
test('cancellation cannot restore a now occupied original Teacher', async () => {
  await assign();
  await anotherPeriod(teacher);
  const row = (await overview()).items[0];
  await rejects(
    mutateSubstitution(
      identity(),
      token,
      String(period),
      { date, revision: row.revision },
      true,
    ),
    409,
  );
  assert.equal(
    await SubstituteAssignment.countDocuments({ status: 'approved' }),
    1,
  );
});
test('bounded pagination returns at most 30 available Teachers per page', async () => {
  for (let i = 0; i < 32; i++)
    await user('candidate-' + String(i).padStart(2, '0'));
  const first = await substitutionCandidates(identity(), String(period), {
    date,
    search: 'candidate-',
  });
  assert.equal(first.items.length, 30);
  assert.equal(first.nextOffset, 30);
  const second = await substitutionCandidates(identity(), String(period), {
    date,
    search: 'candidate-',
    offset: 30,
  });
  assert.equal(second.items.length, 2);
  assert.equal(second.nextOffset, null);
});
test('expired temporary duty permits historical timetable visibility but no new attendance/delivery write', async () => {
  await assign();
  mock.timers.setTime(new Date('2026-10-28T06:00:00Z').getTime());
  for (const permission of [
    PERMISSIONS.TEACHER_ATTENDANCE_MANAGE,
    PERMISSIONS.TEACHER_LESSONS_MANAGE,
  ]) {
    let wrote = false;
    await rejects(
      mutateOccurrence(
        { userId: String(substitute), role: 'teacher' },
        String(period),
        date,
        permission,
        async () => {
          wrote = true;
          return undefined;
        },
      ),
      404,
    );
    assert.equal(wrote, false);
  }
  assert.equal(
    await TeacherAssignment.countDocuments({ teacherId: substitute }),
    0,
  );
});

test('replacing legacy override preserves its explicit time and Room; cancelling restores original window', async () => {
  await assign();
  const room = await Room.create({
    branchId: branch,
    name: 'Legacy Room',
    code: 'LEG',
    createdBy: principal,
    updatedBy: principal,
  });
  await SubstituteAssignment.collection.updateMany(
    {},
    {
      $set: {
        startTime: '12:00',
        endTime: '13:00',
        roomId: room._id,
        room: room.name,
      },
    },
  );
  let row = (await overview()).items[0];
  assert.equal(row.startTime, '12:00');
  assert.equal(row.originalWindow.startTime, '09:00');
  await assign(period, other);
  row = (await overview()).items[0];
  assert.equal(row.startTime, '12:00');
  assert.equal(row.room, room.name);
  await mutateSubstitution(
    identity(),
    token,
    String(period),
    { date, revision: row.revision },
    true,
  );
  row = (await overview()).items[0];
  assert.equal(row.startTime, '09:00');
  assert.equal(row.room, 'Room A');
});

test('disabled replacement can be cancelled without deleting its history', async () => {
  await assign();
  await User.collection.updateOne(
    { _id: substitute },
    { $set: { isActive: false } },
  );
  const row = (await overview()).items[0];
  await mutateSubstitution(
    identity(),
    token,
    String(period),
    { date, revision: row.revision },
    true,
  );
  assert.equal(
    await SubstituteAssignment.countDocuments({ status: 'retired' }),
    1,
  );
});
