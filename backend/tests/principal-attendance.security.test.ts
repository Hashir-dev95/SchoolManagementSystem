import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { Server } from 'node:http';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import app from '../src/app';
import User from '../src/models/user';
import Branch from '../src/models/branch';
import Session from '../src/models/session';
import SchoolClass from '../src/models/schoolClass';
import Section from '../src/models/section';
import Subject from '../src/models/subject';
import Student from '../src/models/student';
import TeacherAssignment from '../src/models/teacherAssignment';
import LegacyAttendance from '../src/models/attendance';
import ApprovalRequest from '../src/models/approvalRequest';
import {
  AttendanceSession,
  PeriodAttendanceRecord,
  AttendanceOperation,
  ensureAttendanceIndexes,
} from '../src/models/periodAttendance';
import {
  AttendanceCorrection,
  StudentLeave,
} from '../src/models/attendanceAmendment';
import {
  TimetablePeriod,
  TimetableVersion,
  SubstituteAssignment,
  TimetableIssue,
} from '../src/models/timetable';
import { StudentEnrollment } from '../src/models/studentEnrollment';
import { ROLE_PERMISSIONS } from '../src/constants/rolePermissions';
import { PERMISSIONS } from '../src/constants/permissions';
import { generateAccessToken } from '../src/services/jwt.service';
import { registerSession } from '../src/services/session.service';
import {
  schoolToday,
  scheduleWeekday,
  addScheduleDays,
} from '../src/services/school-date.service';
import { seedCurriculumFixtures } from './helpers/curriculum-fixtures';
import { LiveLessonPresence } from '../src/models/liveLessonPresence';
import { schoolDateTime } from '../src/services/school-date.service';

let db: MongoMemoryReplSet, server: Server, base: string;
let branch: any,
  foreign: any,
  principal: any,
  peer: any,
  teacher: any,
  pupil: any,
  cls: any,
  section: any,
  subject: any,
  version: any,
  period: any,
  student: any;
const permissions = [...ROLE_PERMISSIONS.principal],
  oldSecret = process.env.JWT_SECRET,
  oldPolicy = process.env.PRINCIPAL_APPROVAL_AUTHORITY,
  oldTimezone = process.env.SCHOOL_TIMEZONE;
const oid = () => new mongoose.Types.ObjectId();
const actor = async (role: any, branchId = branch) => {
  const row = await User.create({
    fullName: role + ' Name',
    email: oid() + '@test.invalid',
    password: 'private',
    role,
    branchId,
  });
  const token = generateAccessToken(String(row._id), role);
  await registerSession(String(row._id), token, role);
  return { id: row._id, token };
};
const http = async (path: string, person = principal, body?: unknown) => {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: 'Bearer ' + person.token,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    json = { raw };
  }
  return {
    status: response.status,
    json,
    cache: response.headers.get('cache-control'),
  };
};
const overview = (query = '') =>
  http('/principal/attendance' + (query ? '?' + query : ''));
const detail = (query = '') =>
  http(
    '/principal/attendance/occurrences/' +
      period._id +
      '?date=' +
      schoolToday() +
      (query ? '&' + query : ''),
  );
const start = async () => {
  const response = await http(
    '/teacher/attendance/occurrences/' + period._id + '?date=' + schoolToday(),
    teacher,
  );
  assert.equal(response.status, 200, JSON.stringify(response.json));
  return response.json.data;
};
const submit = async (status = 'present') => {
  const row = await start();
  const response = await http(
    '/teacher/attendance/sessions/' + row.sessionId + '/submit',
    teacher,
    {
      revision: row.revision,
      rosterVersion: row.rosterVersion,
      clientOperationId: 'submit_attendance_operation_001',
      marks: row.students.map((s: any) => ({ studentId: s.studentId, status })),
    },
  );
  assert.equal(response.status, 200, JSON.stringify(response.json));
  return row;
};
before(async () => {
  process.env.JWT_SECRET = 'principal-attendance-test';
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri(), {
    dbName: 'principal_attendance',
    autoIndex: false,
  });
  await ensureAttendanceIndexes();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base =
    'http://127.0.0.1:' + (server.address() as { port: number }).port + '/api';
});
beforeEach(async () => {
  process.env.SCHOOL_TIMEZONE = 'Asia/Karachi';
  await LiveLessonPresence.deleteMany({});
  ROLE_PERMISSIONS.principal = [...permissions];
  for (const model of [
    AttendanceOperation,
    PeriodAttendanceRecord,
    AttendanceSession,
    AttendanceCorrection,
    StudentLeave,
    ApprovalRequest,
    StudentEnrollment,
    SubstituteAssignment,
    TimetableIssue,
    TimetablePeriod,
    TimetableVersion,
    TeacherAssignment,
    LegacyAttendance,
    Student,
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
      name: 'Own',
      code: 'OW',
      address: 'fixture',
      city: 'fixture',
    })
  )._id;
  foreign = (
    await Branch.create({
      name: 'Foreign',
      code: 'FO',
      address: 'fixture',
      city: 'fixture',
    })
  )._id;
  principal = await actor('principal');
  peer = await actor('principal', foreign);
  teacher = await actor('teacher');
  pupil = await actor('student');
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify({
    [String(principal.id)]: {
      branchId: String(branch),
      types: ['attendance_correction', 'leave'],
    },
  });
  cls = await SchoolClass.create({
    branchId: branch,
    name: 'Grade 8',
    code: '8',
    academicYear: '2026-27',
  });
  section = await Section.create({
    branchId: branch,
    classId: cls._id,
    name: 'A',
    code: 'A',
  });
  subject = await Subject.create({ branchId: branch, name: 'Science' });
  await TeacherAssignment.create({
    branchId: branch,
    teacherId: teacher.id,
    classId: cls._id,
    sectionId: section._id,
    subjectId: subject._id,
    validFrom: new Date(Date.now() - 86400000 * 60),
    createdBy: principal.id,
    updatedBy: principal.id,
  });
  version = await TimetableVersion.create({
    branchId: branch,
    versionNumber: 1,
    status: 'approved',
    effectiveFrom: addScheduleDays(schoolToday(), -40),
    effectiveUntil: addScheduleDays(schoolToday(), 40),
    periodCount: 1,
    createdBy: principal.id,
  });
  period = await TimetablePeriod.create({
    branchId: branch,
    timetableVersionId: version._id,
    teacherId: teacher.id,
    classId: cls._id,
    sectionId: section._id,
    subjectId: subject._id,
    dayOfWeek: scheduleWeekday(schoolToday()),
    startTime: '00:00',
    endTime: '23:59',
    room: 'Room A',
  });
  student = await Student.create({
    userId: pupil.id,
    branchId: branch,
    classId: cls._id,
    sectionId: section._id,
    admissionNumber: 'A-1',
  });
  await seedCurriculumFixtures();
  cls = await SchoolClass.findById(cls._id);
});
after(async () => {
  ROLE_PERMISSIONS.principal = permissions;
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await mongoose.disconnect();
  if (db) await db.stop();
  if (oldSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = oldSecret;
  if (oldPolicy === undefined) delete process.env.PRINCIPAL_APPROVAL_AUTHORITY;
  else process.env.PRINCIPAL_APPROVAL_AUTHORITY = oldPolicy;
  if (oldTimezone === undefined) delete process.env.SCHOOL_TIMEZONE;
  else process.env.SCHOOL_TIMEZONE = oldTimezone;
});

test('scheduled occurrence without attendance is visible as unmarked, never absent', async () => {
  const response = await overview();
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.equal(response.json.data.summary.expected, 1);
  assert.equal(response.json.data.summary.unmarked, 1);
  assert.equal(response.json.data.items[0].state, 'unmarked');
  const row = await detail();
  assert.equal(row.status, 200, JSON.stringify(row.json));
  assert.equal(row.json.data.counts.absent, 0);
  assert.equal(row.json.data.counts.unmarked, 1);
});
test('Principal Home uses canonical expected sessions instead of legacy daily marks', async () => {
  await LegacyAttendance.create({
    branchId: branch,
    studentId: student._id,
    classId: cls._id,
    sectionId: section._id,
    date: new Date(),
    status: 'absent',
    markedBy: teacher.id,
  });
  const response = await http('/principal/dashboard');
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.equal(response.json.data.attendance.expected, 1);
  assert.equal(response.json.data.attendance.unmarked, 1);
  assert.equal(response.json.data.attendance.attendancePercentage, undefined);
});

test('opening and partly marking a session is In Progress and unmarked never inflates absent', async () => {
  const opened = await start();
  assert.equal((await overview()).json.data.items[0].state, 'in_progress');
  const draft = await http(
    '/teacher/attendance/sessions/' + opened.sessionId + '/draft',
    teacher,
    {
      revision: 0,
      rosterVersion: opened.rosterVersion,
      clientOperationId: 'save_partial_draft_operation001',
      marks: [{ studentId: String(student._id), status: null }],
    },
  );
  assert.equal(draft.status, 200, JSON.stringify(draft.json));
  const response = await detail();
  assert.equal(response.json.data.counts.unmarked, 1);
  assert.equal(response.json.data.counts.absent, 0);
  assert.ok(response.json.data.occurrence.issues.includes('partial_roster'));
});
test('Teacher submission changes the same expected row to Submitted and never creates legacy marks', async () => {
  const previousOccurrence = (await overview()).json.data.items[0];
  assert.equal(previousOccurrence.state, 'unmarked');
  await submit('present');
  const response = await overview();
  assert.equal(
    response.json.data.items[0].periodId,
    previousOccurrence.periodId,
  );
  assert.equal(response.json.data.summary.submitted, 1);
  assert.equal(response.json.data.summary.unmarked, 0);
  assert.equal(response.json.data.items[0].state, 'submitted');
  const row = await detail();
  assert.equal(row.json.data.counts.present, 1);
  assert.equal(row.json.data.counts.total, 1);
  assert.ok(row.json.data.occurrence.submittedAt);
  assert.equal(row.json.data.operationHistory[0].action, 'submit');
  assert.equal(await LegacyAttendance.countDocuments(), 0);
  assert.equal(
    (await http('/principal/dashboard')).json.data.attendance.submitted,
    1,
  );
});
for (const status of ['present', 'absent', 'late', 'leave'])
  test('explicit ' + status + ' marks are counted exactly once', async () => {
    await submit(status);
    const row = (await detail()).json.data;
    assert.equal(row.counts[status], 1);
    assert.equal(row.counts.total, 1);
    assert.equal(row.counts.unmarked, 0);
    assert.equal(
      row.counts.present +
        row.counts.absent +
        row.counts.late +
        row.counts.leave,
      1,
    );
  });
test('no matching weekday produces no expected occurrence', async () => {
  await TimetablePeriod.collection.updateOne(
    { _id: period._id },
    { $set: { dayOfWeek: (scheduleWeekday(schoolToday()) + 1) % 7 } },
  );
  assert.equal((await overview()).json.data.summary.expected, 0);
  assert.equal((await detail()).status, 404);
});
for (const status of ['draft', 'retired'])
  test(status + ' timetable is excluded from expected attendance', async () => {
    await TimetableVersion.updateOne(
      { _id: version._id },
      { $set: { status } },
    );
    assert.equal((await overview()).json.data.summary.expected, 0);
  });
test('only the highest approved timetable version wins, not the latest draft', async () => {
  const copy = await TimetableVersion.findById(version._id).lean();
  await TimetableVersion.collection.insertMany([
    { ...copy, _id: oid(), versionNumber: 2, status: 'approved' },
    { ...copy, _id: oid(), versionNumber: 3, status: 'draft' },
  ]);
  assert.equal((await overview()).json.data.summary.expected, 0); // winning approved version has no periods
});
test('effective window includes start date and excludes end date', async () => {
  await TimetableVersion.collection.updateOne(
    { _id: version._id },
    {
      $set: {
        effectiveFrom: schoolToday(),
        effectiveUntil: addScheduleDays(schoolToday(), 1),
      },
    },
  );
  assert.equal((await overview()).json.data.summary.expected, 1);
  await TimetableVersion.collection.updateOne(
    { _id: version._id },
    { $set: { effectiveUntil: schoolToday() } },
  );
  assert.equal((await overview()).json.data.summary.expected, 0);
});
test('approved substitute supplies effective Teacher and room; retired replacement does not', async () => {
  const replacement = await actor('teacher');
  const sub = await SubstituteAssignment.create({
    branchId: branch,
    periodId: period._id,
    originalTeacherId: teacher.id,
    substituteTeacherId: replacement.id,
    date: schoolToday(),
    startTime: '08:00',
    endTime: '09:00',
    room: 'Sub Room',
    status: 'approved',
    createdBy: principal.id,
  });
  let row = (await overview()).json.data.items[0];
  assert.equal(row.teacherId, String(replacement.id));
  assert.equal(row.isSubstitute, true);
  assert.equal(row.room, 'Sub Room');
  assert.equal((await overview('teacherId=' + teacher.id)).json.data.total, 0);
  assert.equal(
    (await overview('teacherId=' + replacement.id)).json.data.total,
    1,
  );
  await SubstituteAssignment.updateOne(
    { _id: sub._id },
    { $set: { status: 'retired' } },
  );
  row = (await overview()).json.data.items[0];
  assert.equal(row.teacherId, String(teacher.id));
  assert.equal(row.room, 'Room A');
});
for (const role of ['teacher', 'student', 'super_admin'])
  test(role + ' cannot read Principal oversight APIs', async () => {
    const person = await actor(role);
    for (const path of [
      '/principal/attendance',
      '/principal/attendance/filters?kind=class',
      '/principal/attendance/patterns',
      '/principal/attendance/occurrences/' +
        period._id +
        '?date=' +
        schoolToday(),
    ])
      assert.equal((await http(path, person)).status, 403);
  });
test('foreign Principal cannot see own Branch occurrence or escape using filters', async () => {
  assert.equal((await http('/principal/attendance', peer)).json.data.total, 0);
  assert.equal(
    (
      await http(
        '/principal/attendance/occurrences/' +
          period._id +
          '?date=' +
          schoolToday(),
        peer,
      )
    ).status,
    404,
  );
  for (const [key, value] of Object.entries({
    classId: cls._id,
    sectionId: section._id,
    subjectId: subject._id,
    teacherId: teacher.id,
  }))
    assert.equal(
      (await http('/principal/attendance?' + key + '=' + value, peer)).status,
      404,
    );
});
for (const change of [
  'disabled',
  'demoted',
  'revoked',
  'inactive Branch',
  'permission',
])
  test('oversight rejects ' + change + ' persisted authority', async () => {
    if (change === 'disabled')
      await User.updateOne(
        { _id: principal.id },
        { $set: { isActive: false } },
      );
    if (change === 'demoted')
      await User.updateOne(
        { _id: principal.id },
        { $set: { role: 'teacher' } },
      );
    if (change === 'revoked')
      await Session.updateMany(
        { token: principal.token },
        { $set: { isRevoked: true } },
      );
    if (change === 'inactive Branch')
      await Branch.updateOne({ _id: branch }, { $set: { isActive: false } });
    if (change === 'permission')
      ROLE_PERMISSIONS.principal = permissions.filter(
        p => p !== PERMISSIONS.ATTENDANCE_VIEW,
      );
    for (const path of [
      '/principal/attendance',
      '/principal/attendance/filters?kind=class',
      '/principal/attendance/patterns',
      '/principal/attendance/occurrences/' +
        period._id +
        '?date=' +
        schoolToday(),
    ])
      assert.equal(
        (await http(path)).status,
        ['inactive Branch', 'permission'].includes(change) ? 403 : 401,
      );
  });
for (const query of [
  'branchId=forged',
  'date=2026-02-30',
  'date[x]=bad',
  'offset=-1',
  'offset=1.2',
  'state=absent',
  'mode=other',
  'classId=bad',
  'search[x]=bad',
])
  test('oversight rejects invalid/forged query ' + query, async () => {
    assert.equal((await overview(query)).status, 400);
  });
test('missing attendance permission withholds Home operational summary without losing other cards', async () => {
  ROLE_PERMISSIONS.principal = permissions.filter(
    p => p !== PERMISSIONS.ATTENDANCE_VIEW,
  );
  const response = await http('/principal/dashboard');
  assert.equal(response.status, 200);
  assert.equal(response.json.data.attendance, null);
  assert.equal(response.json.data.branch.id, String(branch));
});
test('invalid foreign academic reference is a safe configuration issue, never foreign contextual data', async () => {
  const subjectB = await Subject.create({
    branchId: foreign,
    name: 'FOREIGN PRIVATE Subject',
  });
  await TimetablePeriod.collection.updateOne(
    { _id: period._id },
    { $set: { subjectId: subjectB._id } },
  );
  const response = await overview();
  assert.equal(response.status, 200);
  assert.equal(response.json.data.summary.needsAttention, 1);
  assert.equal(response.json.data.items[0].subjectName, 'Unavailable');
  assert.equal(
    JSON.stringify(response.json).includes('FOREIGN PRIVATE'),
    false,
  );
});
test('filters and session search use bounded own-Branch server pages', async () => {
  for (let n = 0; n < 23; n++)
    await SchoolClass.create({
      branchId: branch,
      name: 'Long Class ' + n,
      code: 'C' + n,
      academicYear: '2026-27',
    });
  const first = await http('/principal/attendance/filters?kind=class');
  assert.equal(first.json.data.items.length, 20);
  assert.equal(first.json.data.nextOffset, 20);
  const second = await http(
    '/principal/attendance/filters?kind=class&offset=20',
  );
  assert.equal(second.json.data.items.length, 4);
  assert.equal((await overview('search=SCIENCE')).json.data.total, 1);
  assert.equal((await overview('search=none')).json.data.total, 0);
  assert.equal(
    (await http('/principal/attendance/filters?kind=teacher&search=%5B')).json
      .data.total,
    0,
  );
  const source = await TimetablePeriod.findById(period._id).lean();
  for (let n = 0; n < 23; n++)
    await TimetablePeriod.collection.insertOne({ ...source, _id: oid() });
  const page = await overview();
  assert.equal(page.json.data.items.length, 20);
  assert.equal(page.json.data.total, 24);
  assert.equal(page.json.data.nextOffset, 20);
  assert.equal((await overview('offset=20')).json.data.items.length, 4);
});
const enroll = async (overrides: Record<string, unknown> = {}) =>
  StudentEnrollment.create({
    branchId: branch,
    studentId: student._id,
    academicPeriodId: cls.academicPeriodId,
    classId: cls._id,
    sectionId: section._id,
    effectiveFrom: new Date(Date.now() - 86400000 * 20),
    reason: 'Fixture membership',
    createdBy: principal.id,
    updatedBy: principal.id,
    ...overrides,
  });
test('managed enrollment includes eligible Student despite stale compatibility placement', async () => {
  await enroll();
  await Student.collection.updateOne(
    { _id: student._id },
    { $set: { classId: oid(), sectionId: oid() } },
  );
  const row = (await detail()).json.data;
  assert.equal(row.counts.total, 1);
  assert.equal(row.students[0].studentId, String(student._id));
});
for (const field of ['classId', 'sectionId', 'academicPeriodId', 'branchId'])
  test(
    'managed wrong ' + field + ' never falls back to compatibility placement',
    async () => {
      await enroll({ [field]: field === 'branchId' ? foreign : oid() });
      assert.equal((await detail()).json.data.counts.total, 0);
    },
  );
test('withdrawn enrollment is excluded today but eligible on an earlier occurrence date', async () => {
  await enroll({
    status: 'withdrawn',
    effectiveTo: new Date(Date.now() - 86400000),
  });
  assert.equal((await detail()).json.data.counts.total, 0);
  const past = addScheduleDays(schoolToday(), -7);
  const response = await http(
    '/principal/attendance/occurrences/' + period._id + '?date=' + past,
  );
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.equal(response.json.data.counts.total, 1);
});
test('submitted roster snapshot retains genuine attendance after promotion and schedule retirement', async () => {
  await enroll();
  await submit('late');
  await StudentEnrollment.updateOne(
    { studentId: student._id },
    { $set: { status: 'promoted', effectiveTo: new Date() } },
  );
  await Student.collection.updateOne(
    { _id: student._id },
    { $set: { classId: oid(), sectionId: oid() } },
  );
  await TimetableVersion.updateOne(
    { _id: version._id },
    { $set: { status: 'retired' } },
  );
  assert.equal((await overview()).json.data.summary.expected, 0);
  const history = await overview('mode=history');
  assert.equal(history.json.data.total, 1);
  assert.equal(history.json.data.items[0].state, 'submitted');
  const row = await detail('mode=history');
  assert.equal(row.status, 200, JSON.stringify(row.json));
  assert.equal(row.json.data.counts.late, 1);
  assert.equal(row.json.data.students[0].studentId, String(student._id));
});
test('unmarked overdue occurrence is attention, not absence; live/media cannot supply marks', async () => {
  const date = addScheduleDays(schoolToday(), -7);
  const response = await overview('date=' + date);
  assert.equal(response.json.data.summary.unmarked, 1);
  assert.equal(response.json.data.summary.needsAttention, 1);
  assert.ok(response.json.data.items[0].issues.includes('overdue'));
  const row = await http(
    '/principal/attendance/occurrences/' + period._id + '?date=' + date,
  );
  assert.equal(row.json.data.counts.absent, 0);
  assert.equal(row.json.data.counts.unmarked, 1);
});
const requestAmendment = async (
  kind: 'corrections' | 'leaves',
  row: any,
  extra: Record<string, unknown> = {},
) => {
  const body =
    kind === 'corrections'
      ? { requestedStatus: 'late', submittedRevision: 1, effectiveRevision: 0 }
      : {
          fromDate: schoolToday(),
          untilDate: schoolToday(),
          category: 'illness',
        };
  const response = await http(
    '/teacher/attendance/sessions/' +
      row.sessionId +
      '/students/' +
      student._id +
      '/' +
      kind,
    teacher,
    {
      ...body,
      reason: 'Verified attendance evidence for Principal review',
      clientOperationId: 'request_' + kind + '_operation001',
      ...extra,
    },
  );
  assert.equal(response.status, 200, JSON.stringify(response.json));
  return response.json.data;
};
const approveAmendment = async (request: any) => {
  const response = await http(
    '/attendance-review/' + request.approvalId + '/decision',
    principal,
    {
      action: 'approved',
      reviewNote: 'Evidence verified by Principal',
      revision: 0,
      clientOperationId: 'approve_' + request.requestId + '_operation001',
    },
  );
  assert.equal(response.status, 200, JSON.stringify(response.json));
};
test('existing correction review updates effective marks, exceptions, history and patterns without rewriting original', async () => {
  const row = await submit('absent'),
    request = await requestAmendment('corrections', row);
  let current = (await detail()).json.data;
  assert.equal(current.counts.absent, 1);
  assert.equal(current.amendments[0].approvalId, request.approvalId);
  assert.equal(current.amendments[0].canOpenReview, true);
  assert.ok(current.occurrence.issues.includes('pending_correction'));
  assert.equal(
    (await http('/attendance-review/' + request.approvalId)).status,
    200,
  );
  await approveAmendment(request);
  current = (await detail()).json.data;
  assert.equal(current.counts.absent, 0);
  assert.equal(current.counts.late, 1);
  assert.equal(current.students[0].originalStatus, 'absent');
  assert.equal(current.amendments[0].state, 'approved');
  assert.equal(current.occurrence.issues.includes('pending_correction'), false);
  const patterns = await http('/principal/attendance/patterns');
  assert.equal(patterns.json.data.items[0].late, 1);
  assert.equal(patterns.json.data.items[0].absent, 0);
  assert.equal(
    (await PeriodAttendanceRecord.findOne({
      attendanceSessionId: row.sessionId,
    }))!.status,
    'absent',
  );
});
test('leave review preserves explicit marks and flags approved-leave mismatch until a correction', async () => {
  const row = await submit('absent'),
    leave = await requestAmendment('leaves', row);
  assert.ok(
    (await detail()).json.data.occurrence.issues.includes('pending_leave'),
  );
  await approveAmendment(leave);
  let current = (await detail()).json.data;
  assert.equal(current.counts.approvedLeave, 1);
  assert.equal(current.counts.absent, 1);
  assert.equal(current.counts.leave, 0);
  assert.ok(current.occurrence.issues.includes('approved_leave_mismatch'));
  assert.equal((await overview()).json.data.summary.needsAttention, 1);
  const correction = await requestAmendment('corrections', row, {
    requestedStatus: 'leave',
    leaveId: leave.requestId,
  });
  await approveAmendment(correction);
  current = (await detail()).json.data;
  assert.equal(current.counts.leave, 1);
  assert.equal(current.counts.absent, 0);
  assert.equal(current.counts.leaveMismatch, 0);
  assert.equal(
    (await http('/principal/attendance/patterns')).json.data.total,
    0,
  );
});
test('oversight never grants amendment-review authority from attendance permission alone', async () => {
  const row = await submit('absent');
  await requestAmendment('corrections', row);
  ROLE_PERMISSIONS.principal = permissions.filter(
    p => p !== PERMISSIONS.PRINCIPAL_APPROVALS_VIEW,
  );
  assert.equal((await detail()).json.data.amendments[0].canOpenReview, false);
});
test('absence patterns count only submitted effective marks and stay separate from unmarked sessions', async () => {
  assert.equal(
    (await http('/principal/attendance/patterns')).json.data.total,
    0,
  );
  await submit('absent');
  const response = await http('/principal/attendance/patterns');
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.equal(response.json.data.items[0].absent, 1);
  assert.equal(response.json.data.items[0].sessions, 1);
  assert.equal(
    (await http('/principal/attendance/patterns?studentId=' + oid())).status,
    404,
  );
});
for (const query of [
  'from=2020-01-01',
  'from=2099-01-01',
  'until=2099-01-01',
  'branchId=forged',
  'offset=-1',
])
  test('patterns reject invalid range/filter ' + query, async () => {
    assert.equal(
      (await http('/principal/attendance/patterns?' + query)).status,
      400,
    );
  });
test('oversight response omits sessions, credentials, approval reasons and operation fingerprints', async () => {
  await submit('present');
  const row = await detail();
  assert.equal(row.cache, 'no-store');
  const data = JSON.stringify(row.json.data);
  for (const key of [
    'password',
    'token',
    'fingerprint',
    'clientOperationId',
    'rosterVersion',
    'reason',
  ])
    assert.equal(data.includes('"' + key + '"'), false);
});

test('missing eligible roster is an overview configuration exception as well as a detail exception', async () => {
  await enroll({ sectionId: oid() });
  const response = await overview();
  assert.equal(response.json.data.summary.needsAttention, 1);
  assert.ok(response.json.data.items[0].issues.includes('empty_roster'));
  assert.equal((await detail()).json.data.counts.total, 0);
});
test('live lesson connection does not change unmarked physical attendance or absence patterns', async () => {
  await LiveLessonPresence.create({
    liveLessonSessionId: oid(),
    branchId: branch,
    actorId: pupil.id,
    role: 'participant',
    admission: 'admitted',
    connectionState: 'connected',
    firstJoinedAt: new Date(),
  });
  assert.equal((await overview()).json.data.summary.unmarked, 1);
  const current = (await detail()).json.data;
  assert.equal(current.counts.present, 0);
  assert.equal(current.counts.absent, 0);
  assert.equal(current.counts.unmarked, 1);
  assert.equal(
    (await http('/principal/attendance/patterns')).json.data.total,
    0,
  );
});
test('school civil date and timezone align overview, Home and timetable boundaries', async () => {
  assert.equal(
    schoolDateTime(new Date('2026-10-24T20:30:00Z')).date,
    '2026-10-25',
  );
  const current = await overview(),
    home = await http('/principal/dashboard');
  assert.equal(current.json.data.date, schoolToday());
  assert.equal(current.json.data.timezone, 'Asia/Karachi');
  assert.equal(home.json.data.attendance.date, current.json.data.date);
  process.env.SCHOOL_TIMEZONE = 'UTC';
  assert.equal(
    schoolDateTime(new Date('2026-10-24T20:30:00Z')).date,
    '2026-10-24',
  );
});
test('Principal oversight exposes no direct attendance marking mutation', async () => {
  const response = await http('/principal/attendance', principal, {
    state: 'submitted',
    marks: [{ studentId: String(student._id), status: 'absent' }],
  });
  assert.equal(response.status, 404);
  assert.equal(await AttendanceSession.countDocuments(), 0);
  assert.equal(await PeriodAttendanceRecord.countDocuments(), 0);
});
test('roster and request history pages are bounded independently', async () => {
  const source = await Student.findById(student._id).lean();
  for (let n = 0; n < 52; n++) {
    const identity = await actor('student');
    await Student.collection.insertOne({
      ...source,
      _id: oid(),
      userId: identity.id,
      admissionNumber: 'P-' + n,
    });
  }
  const first = (await detail()).json.data;
  assert.equal(first.students.length, 50);
  assert.equal(first.counts.total, 53);
  assert.equal(first.nextOffset, 50);
  const next = (await detail('offset=50')).json.data;
  assert.equal(next.students.length, 3);
  assert.equal(next.nextOffset, null);
});

test('submitted history keeps the actual substitute context after a newer replacement is approved', async () => {
  const original = teacher,
    replacement = await actor('teacher');
  const oldSub = await SubstituteAssignment.create({
    branchId: branch,
    periodId: period._id,
    originalTeacherId: original.id,
    substituteTeacherId: replacement.id,
    date: schoolToday(),
    startTime: '08:00',
    endTime: '09:00',
    room: 'Original Sub Room',
    status: 'approved',
    createdBy: principal.id,
  });
  teacher = replacement;
  await submit('present');
  await SubstituteAssignment.updateOne(
    { _id: oldSub._id },
    { $set: { status: 'retired' } },
  );
  const nextTeacher = await actor('teacher');
  await SubstituteAssignment.create({
    branchId: branch,
    periodId: period._id,
    originalTeacherId: original.id,
    substituteTeacherId: nextTeacher.id,
    date: schoolToday(),
    startTime: '10:00',
    endTime: '11:00',
    room: 'New Sub Room',
    status: 'approved',
    createdBy: principal.id,
  });
  const operational = (await overview()).json.data.items[0];
  assert.equal(operational.teacherId, String(nextTeacher.id));
  assert.equal(operational.room, 'New Sub Room');
  assert.ok(operational.issues.includes('teacher_changed'));
  const recorded = (await detail('mode=history')).json.data.occurrence;
  assert.equal(recorded.teacherId, String(replacement.id));
  assert.equal(recorded.room, 'Original Sub Room');
  assert.equal(recorded.startTime, '08:00');
  assert.equal(recorded.isSubstitute, true);
});
