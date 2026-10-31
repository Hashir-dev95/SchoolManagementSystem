import assert from 'node:assert/strict';
import { test } from 'node:test';
import { state, http, oid, put } from './helpers/student-workspace.fixture';
import {
  TimetablePeriod,
  TimetableVersion,
  SubstituteAssignment,
} from '../src/models/timetable';
import {
  AttendanceSession,
  PeriodAttendanceRecord,
} from '../src/models/periodAttendance';
import { AttendanceCorrection } from '../src/models/attendanceAmendment';
import Subject from '../src/models/subject';
import User from '../src/models/user';
import { ClassSubject } from '../src/models/classSubject';
import {
  scheduleWeekday,
  addScheduleDays,
} from '../src/services/school-date.service';

async function occurrence() {
  const version = await put(TimetableVersion, {
    branchId: state.branch._id,
    versionNumber: 1,
    status: 'approved',
    effectiveFrom: state.today,
    effectiveUntil: addScheduleDays(state.today, 10),
  });
  const subject = await put(Subject, {
    branchId: state.branch._id,
    name: 'Mathematics',
    isActive: true,
  });
  await put(ClassSubject, {
    branchId: state.branch._id,
    academicPeriodId: state.period._id,
    classId: state.cls._id,
    subjectId: subject._id,
    isActive: true,
  });
  const teacher = await put(User, {
    branchId: state.branch._id,
    fullName: 'Permanent Teacher',
    role: 'teacher',
    isActive: true,
  });
  const period = await put(TimetablePeriod, {
    branchId: state.branch._id,
    timetableVersionId: version._id,
    classId: state.cls._id,
    sectionId: state.section._id,
    subjectId: subject._id,
    teacherId: teacher._id,
    dayOfWeek: scheduleWeekday(state.today),
    startTime: '08:00',
    endTime: '08:45',
    room: 'Room 1',
  });
  return { version, period, teacher };
}
async function attendance() {
  const row = await occurrence();
  const session = await put(AttendanceSession, {
    branchId: state.branch._id,
    periodId: row.period._id,
    timetableVersionId: row.version._id,
    date: state.today,
    classId: state.cls._id,
    sectionId: state.section._id,
    rosterStudentIds: [state.student._id, state.otherStudent._id],
    state: 'submitted',
    revision: 1,
  });
  return { ...row, session };
}
test('only the current enrollment tuple in the winning approved version is visible', async () => {
  const { period } = await occurrence();
  await put(TimetablePeriod, { ...period, _id: oid(), sectionId: oid() });
  const r = await http('/timetable');
  assert.equal(r.status, 200);
  assert.equal(r.json.data.items.length, 1);
  assert.equal(r.json.data.items[0].subject, 'Mathematics');
});
test('draft or replaced versions cannot be used as Student timetable authority', async () => {
  const { version } = await occurrence();
  await TimetableVersion.updateOne(
    { _id: version._id },
    { $set: { status: 'draft' } },
  );
  assert.equal((await http('/timetable')).json.data.items.length, 0);
});
test('approved exact-date substitution overlays the occurrence without modifying permanence', async () => {
  const { period, teacher } = await occurrence();
  const substitute = await put(User, {
    branchId: state.branch._id,
    fullName: 'Substitute Teacher',
    role: 'teacher',
    isActive: true,
  });
  await put(SubstituteAssignment, {
    branchId: state.branch._id,
    periodId: period._id,
    originalTeacherId: teacher._id,
    substituteTeacherId: substitute._id,
    date: state.today,
    status: 'approved',
    startTime: '09:00',
    endTime: '09:45',
    room: 'Room 2',
  });
  const r = await http('/timetable');
  assert.equal(r.status, 200);
  assert.equal(r.json.data.items[0].teacher, 'Substitute Teacher');
  assert.equal(
    String((await TimetablePeriod.findById(period._id))!.teacherId),
    String(teacher._id),
  );
});
test('unmarked and draft marks do not imply absence or published attendance', async () => {
  const { session } = await attendance();
  await AttendanceSession.updateOne(
    { _id: session._id },
    { $set: { state: 'draft' } },
  );
  await put(PeriodAttendanceRecord, {
    branchId: state.branch._id,
    attendanceSessionId: session._id,
    studentId: state.student._id,
    status: 'absent',
    revision: 1,
  });
  let r = await http('/attendance');
  assert.equal(r.status, 200);
  assert.equal(r.json.data.items[0].status, null);
  await AttendanceSession.deleteMany({});
  r = await http('/attendance');
  assert.equal(r.json.data.items[0].state, 'unmarked');
});
test('only own submitted physical marks with approved corrections are returned', async () => {
  const { session } = await attendance();
  await put(PeriodAttendanceRecord, {
    branchId: state.branch._id,
    attendanceSessionId: session._id,
    studentId: state.student._id,
    status: 'absent',
    revision: 1,
  });
  await put(PeriodAttendanceRecord, {
    branchId: state.branch._id,
    attendanceSessionId: session._id,
    studentId: state.otherStudent._id,
    status: 'leave',
    revision: 1,
  });
  await put(AttendanceCorrection, {
    branchId: state.branch._id,
    attendanceSessionId: session._id,
    studentId: state.student._id,
    state: 'approved',
    originalStatus: 'absent',
    submittedRevision: 1,
    approvedVersion: 1,
    requestedStatus: 'present',
  });
  const r = await http('/attendance');
  assert.equal(r.status, 200);
  assert.equal(r.json.data.kind, 'physical');
  assert.equal(r.json.data.items[0].status, 'present');
  assert.equal(JSON.stringify(r.json).includes('leave'), false);
});
for (const path of ['/timetable', '/attendance']) {
  test(`${path} rejects Student/scope tampering`, async () => {
    assert.equal(
      (await http(path + '?studentId=' + state.otherStudent._id)).status,
      403,
    );
  });
}
test('foreign Teacher references fail closed and dates are validated', async () => {
  const { teacher } = await occurrence();
  await User.updateOne(
    { _id: teacher._id },
    { $set: { branchId: state.foreign._id } },
  );
  assert.equal((await http('/timetable')).status, 403);
  assert.equal((await http('/timetable?date=invalid')).status, 400);
});
