import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import {
  state,
  parentState,
  put,
  oid,
} from './helpers/parent-workspace.fixture';
import { apiHttp } from './helpers/student-workspace.fixture';
import User from '../src/models/user';
import Student from '../src/models/student';
import Branch from '../src/models/branch';
import SchoolClass from '../src/models/schoolClass';
import Section from '../src/models/section';
import Subject from '../src/models/subject';
import Session from '../src/models/session';
import TeacherAssignment from '../src/models/teacherAssignment';
import { AcademicPeriod } from '../src/models/academicPeriod';
import { StudentEnrollment } from '../src/models/studentEnrollment';
import { ParentStudentLink } from '../src/models/parentStudentLink';
import { SubstituteAssignment } from '../src/models/timetable';
import { authorizeChatRecipient } from '../src/services/chat-authority.service';
import {
  generateAccessToken,
  type JwtPayload,
} from '../src/services/jwt.service';
import { registerSession } from '../src/services/session.service';
import { RequestContractError } from '../src/utils/request-validation';

async function makeTeacher(name: string, branchId = state.branch._id) {
  const user = await put(User, {
    fullName: name,
    role: 'teacher',
    branchId,
    isActive: true,
    email: `${name}@private.test`,
    phone: 'private-contact',
  });
  const token = generateAccessToken(String(user._id), 'teacher');
  await registerSession(String(user._id), token, 'teacher');
  return { user, token };
}
let teacher: Awaited<ReturnType<typeof makeTeacher>>,
  unrelated: Awaited<ReturnType<typeof makeTeacher>>,
  foreign: Awaited<ReturnType<typeof makeTeacher>>;
let assignment: InstanceType<typeof TeacherAssignment>;
let otherClass: Awaited<ReturnType<typeof put>>,
  otherSection: Awaited<ReturnType<typeof put>>;
const identity = (userId: unknown, role: JwtPayload['role']): JwtPayload => ({
  userId: String(userId),
  role,
});
const auth = (sender: unknown, role: JwtPayload['role'], recipient: unknown) =>
  authorizeChatRecipient(identity(sender, role), String(recipient));
const discover = (query = '', token = teacher.token) =>
  apiHttp('/chat/me/recipients' + query, token);
const denied = (error: unknown) =>
  error instanceof RequestContractError &&
  error.status === 403 &&
  error.message === 'Chat recipient is unavailable in your current scope';
const teacherStudent = () => auth(teacher.user._id, 'teacher', state.user._id);
const studentTeacher = () => auth(state.user._id, 'student', teacher.user._id);
const teacherParent = () =>
  auth(teacher.user._id, 'teacher', parentState.parent._id);
const parentTeacher = () =>
  auth(parentState.parent._id, 'parent', teacher.user._id);

beforeEach(async () => {
  teacher = await makeTeacher('Assigned Teacher');
  unrelated = await makeTeacher('Unrelated Teacher');
  foreign = await makeTeacher('Foreign Teacher', state.foreign._id);
  const subject = await put(Subject, {
    branchId: state.branch._id,
    name: 'Mathematics',
    isActive: true,
  });
  assignment = await TeacherAssignment.create({
    teacherId: teacher.user._id,
    branchId: state.branch._id,
    classId: state.cls._id,
    sectionId: state.section._id,
    subjectId: subject._id,
    isActive: true,
    validFrom: new Date(Date.now() - 86400000),
    createdBy: parentState.verifier._id,
    updatedBy: parentState.verifier._id,
  });
  otherClass = await put(SchoolClass, {
    branchId: state.branch._id,
    academicPeriodId: state.period._id,
    name: 'Other Class',
    isActive: true,
  });
  otherSection = await put(Section, {
    branchId: state.branch._id,
    classId: otherClass._id,
    name: 'Other Section',
    isActive: true,
  });
  await StudentEnrollment.collection.updateOne(
    { studentId: state.otherStudent._id },
    { $set: { classId: otherClass._id, sectionId: otherSection._id } },
  );
});

test('four allowed edges return current server witness and minimal recipient DTO', async () => {
  for (const [action, relationship] of [
    [teacherStudent, 'assigned_student'],
    [studentTeacher, 'assigned_teacher'],
    [teacherParent, 'verified_parent_of_assigned_student'],
    [parentTeacher, 'linked_child_teacher'],
  ] as const) {
    const result = await action();
    assert.equal(result.branchId, String(state.branch._id));
    assert.equal(result.recipient.relationshipType, relationship);
    assert.equal(result.relationship.studentId, String(state.student._id));
    assert.equal(result.relationship.assignmentId, String(assignment._id));
    assert.equal(
      result.relationship.enrollmentId,
      String(state.enrollment._id),
    );
    assert.deepEqual(
      Object.keys(result.recipient).sort(),
      ['userId', 'displayName', 'role', 'relationshipType'].sort(),
    );
  }
});

test('Teacher discovery is own, sorted, deduplicated and safe; Student and Parent expose only assigned Teacher', async () => {
  const response = await discover();
  assert.equal(response.status, 200);
  assert.deepEqual(
    response.json.data.items.map(
      (row: Awaited<ReturnType<typeof authorizeChatRecipient>>['recipient']) =>
        row.userId,
    ),
    [String(state.user._id), String(parentState.parent._id)].sort(),
  );
  for (const item of response.json.data.items)
    assert.deepEqual(
      Object.keys(item).sort(),
      ['userId', 'displayName', 'role', 'relationshipType'].sort(),
    );
  for (const token of [state.token, parentState.token]) {
    const own = await discover('', token);
    assert.equal(own.status, 200);
    assert.deepEqual(
      own.json.data.items.map(
        (
          row: Awaited<ReturnType<typeof authorizeChatRecipient>>['recipient'],
        ) => row.userId,
      ),
      [String(teacher.user._id)],
    );
  }
  assert.doesNotMatch(
    JSON.stringify(response.json),
    /email|phone|verifiedBy|assignmentId|enrollmentId|parentStudentLinkId|session|password/,
  );
});

test('same-Branch unassigned Student and unrelated Parent/Teacher fail closed in both directions', async () => {
  for (const request of [
    () => auth(teacher.user._id, 'teacher', state.other._id),
    () => auth(teacher.user._id, 'teacher', parentState.otherParent._id),
    () => auth(state.user._id, 'student', unrelated.user._id),
    () => auth(parentState.parent._id, 'parent', unrelated.user._id),
  ])
    await assert.rejects(request, denied);
});

test('same Class but different Section is not assigned scope', async () => {
  const section = await put(Section, {
    branchId: state.branch._id,
    classId: state.cls._id,
    name: 'B',
    isActive: true,
  });
  await StudentEnrollment.collection.updateOne(
    { _id: state.enrollment._id },
    { $set: { sectionId: section._id } },
  );
  await assert.rejects(teacherStudent, denied);
  await assert.rejects(studentTeacher, denied);
});

test('foreign Branch recipient IDs never grant any allowed edge', async () => {
  await assert.rejects(
    () => auth(state.user._id, 'student', foreign.user._id),
    denied,
  );
  await assert.rejects(
    () => auth(parentState.parent._id, 'parent', foreign.user._id),
    denied,
  );
  await User.collection.updateOne(
    { _id: state.user._id },
    { $set: { branchId: state.foreign._id } },
  );
  await assert.rejects(teacherStudent, denied);
  await assert.rejects(teacherParent, denied);
});

for (const change of [
  'inactive',
  'deleted',
  'expired',
  'future',
  'revokedAt',
] as const) {
  test(`assignment ${change} immediately revokes all four edges without login refresh`, async () => {
    assert.equal((await discover()).json.data.total, 2);
    if (change === 'deleted')
      await TeacherAssignment.deleteOne({ _id: assignment._id });
    else
      await TeacherAssignment.collection.updateOne(
        { _id: assignment._id },
        {
          $set:
            change === 'inactive'
              ? { isActive: false }
              : change === 'expired'
              ? { validUntil: new Date(Date.now() - 1) }
              : change === 'future'
              ? { validFrom: new Date(Date.now() + 60000) }
              : { revokedAt: new Date() },
        },
      );
    for (const action of [
      teacherStudent,
      studentTeacher,
      teacherParent,
      parentTeacher,
    ])
      await assert.rejects(action, denied);
    assert.equal((await discover()).json.data.total, 0);
    assert.equal((await discover('', state.token)).json.data.total, 0);
  });
}

for (const change of [
  'revoked',
  'pending',
  'inactive',
  'future verification',
  'inactive verifier',
  'foreign verifier',
  'self verification',
] as const) {
  test(`Parent link ${change} removes Teacher/Parent authority and discovery immediately`, async () => {
    await teacherParent();
    await parentTeacher();
    if (change === 'inactive verifier')
      await User.collection.updateOne(
        { _id: parentState.verifier._id },
        { $set: { isActive: false } },
      );
    else if (change === 'foreign verifier')
      await User.collection.updateOne(
        { _id: parentState.verifier._id },
        { $set: { branchId: state.foreign._id } },
      );
    else
      await ParentStudentLink.collection.updateOne(
        { _id: parentState.link._id },
        {
          $set:
            change === 'revoked'
              ? { status: 'revoked', revokedAt: new Date() }
              : change === 'pending'
              ? { status: 'pending' }
              : change === 'inactive'
              ? { isActive: false }
              : change === 'future verification'
              ? { verifiedAt: new Date(Date.now() + 60000) }
              : { verifiedBy: parentState.parent._id },
        },
      );
    await assert.rejects(teacherParent, denied);
    await assert.rejects(parentTeacher, denied);
    assert.equal((await discover('', parentState.token)).json.data.total, 0);
    assert.ok(
      !(await discover()).json.data.items.some(
        (
          row: Awaited<ReturnType<typeof authorizeChatRecipient>>['recipient'],
        ) => row.userId === String(parentState.parent._id),
      ),
    );
  });
}

test('shared phone/email/guardian snapshot does not authorize unrelated Parent', async () => {
  await User.collection.updateOne(
    { _id: parentState.otherParent._id },
    { $set: { email: parentState.parent.email, phone: 'same-contact' } },
  );
  await Student.collection.updateOne(
    { _id: state.student._id },
    {
      $set: {
        guardianPhone: 'same-contact',
        guardianName: parentState.otherParent.fullName,
      },
    },
  );
  await assert.rejects(
    () => auth(teacher.user._id, 'teacher', parentState.otherParent._id),
    denied,
  );
});

for (const change of [
  'closed',
  'future',
  'duplicate',
  'missing',
  'inactive Student',
  'inactive period',
  'inactive Class',
  'inactive Section',
  'inactive Subject',
] as const) {
  test(`invalid current academic membership/reference: ${change}`, async () => {
    if (change === 'closed')
      await StudentEnrollment.collection.updateOne(
        { _id: state.enrollment._id },
        { $set: { status: 'transferred', effectiveTo: new Date() } },
      );
    if (change === 'future')
      await StudentEnrollment.collection.updateOne(
        { _id: state.enrollment._id },
        { $set: { effectiveFrom: new Date(Date.now() + 60000) } },
      );
    if (change === 'duplicate') {
      const current = await StudentEnrollment.findById(
        state.enrollment._id,
      ).lean();
      await StudentEnrollment.collection.insertOne({ ...current!, _id: oid() });
    }
    if (change === 'missing')
      await StudentEnrollment.deleteOne({ _id: state.enrollment._id });
    if (change === 'inactive Student')
      await Student.collection.updateOne(
        { _id: state.student._id },
        { $set: { isActive: false } },
      );
    if (change === 'inactive period')
      await AcademicPeriod.collection.updateOne(
        { _id: state.period._id },
        { $set: { status: 'closed' } },
      );
    if (change === 'inactive Class')
      await SchoolClass.collection.updateOne(
        { _id: state.cls._id },
        { $set: { isActive: false } },
      );
    if (change === 'inactive Section')
      await Section.collection.updateOne(
        { _id: state.section._id },
        { $set: { isActive: false } },
      );
    if (change === 'inactive Subject')
      await Subject.collection.updateOne(
        { _id: assignment.subjectId },
        { $set: { isActive: false } },
      );
    for (const action of [
      teacherStudent,
      studentTeacher,
      teacherParent,
      parentTeacher,
    ])
      await assert.rejects(action, denied);
  });
}

test('Student transfer immediately changes discovery; stale Student.classId never restores old Teacher', async () => {
  assert.equal((await discover('', state.token)).json.data.total, 1);
  await StudentEnrollment.collection.updateOne(
    { _id: state.enrollment._id },
    { $set: { classId: otherClass._id, sectionId: otherSection._id } },
  );
  await assert.rejects(studentTeacher, denied);
  await assert.rejects(parentTeacher, denied);
  assert.equal((await discover('', state.token)).json.data.total, 0);
  assert.equal((await discover()).json.data.total, 0);
});

test('inactive recipient or persisted role change revokes eligibility', async () => {
  await User.collection.updateOne(
    { _id: state.user._id },
    { $set: { isActive: false } },
  );
  await assert.rejects(teacherStudent, denied);
  await User.collection.updateOne(
    { _id: state.user._id },
    { $set: { isActive: true, role: 'parent' } },
  );
  await assert.rejects(teacherStudent, denied);
  await User.collection.updateOne(
    { _id: state.user._id },
    { $set: { role: 'student' } },
  );
  await User.collection.updateOne(
    { _id: teacher.user._id },
    { $set: { isActive: false } },
  );
  await assert.rejects(studentTeacher, denied);
  await assert.rejects(parentTeacher, denied);
});

test('unsupported peers, staff, self and guessed valid IDs return the same safe forbidden result', async () => {
  const cases: [unknown, JwtPayload['role'], unknown][] = [
    [state.user._id, 'student', state.other._id],
    [parentState.parent._id, 'parent', parentState.otherParent._id],
    [teacher.user._id, 'teacher', unrelated.user._id],
    [teacher.user._id, 'teacher', parentState.verifier._id],
    [parentState.verifier._id, 'principal', teacher.user._id],
    [teacher.user._id, 'teacher', teacher.user._id],
    [teacher.user._id, 'teacher', oid()],
  ];
  for (const [sender, role, recipient] of cases)
    await assert.rejects(() => auth(sender, role, recipient), denied);
});

test('inactive Parent recipient and changed Teacher role do not survive a prior discovery', async () => {
  assert.equal((await discover()).json.data.total, 2);
  await User.collection.updateOne(
    { _id: parentState.parent._id },
    { $set: { isActive: false } },
  );
  await assert.rejects(teacherParent, denied);
  assert.equal((await discover()).json.data.total, 1);
  await User.collection.updateOne(
    { _id: teacher.user._id },
    { $set: { role: 'finance' } },
  );
  await assert.rejects(studentTeacher, denied);
});

test('Finance and Super Admin have no recipient directory, even in an active Branch', async () => {
  for (const role of ['finance', 'super_admin'] as const) {
    const actor = await put(User, {
      fullName: role,
      role,
      branchId: state.branch._id,
      isActive: true,
    });
    const token = generateAccessToken(String(actor._id), role);
    await registerSession(String(actor._id), token, role);
    assert.equal((await discover('', token)).status, 403);
  }
});

test('canonical Session, persisted sender role/account and active Branch gate discovery', async () => {
  assert.equal((await discover('', '')).status, 401);
  await Session.updateOne(
    { token: teacher.token },
    { $set: { isRevoked: true } },
  );
  assert.equal((await discover()).status, 401);
  await Session.updateOne(
    { token: teacher.token },
    { $set: { isRevoked: false } },
  );
  await User.collection.updateOne(
    { _id: teacher.user._id },
    { $set: { isActive: false } },
  );
  assert.equal((await discover()).status, 401);
  await User.collection.updateOne(
    { _id: teacher.user._id },
    { $set: { isActive: true, role: 'principal' } },
  );
  assert.equal((await discover()).status, 401);
  const token = generateAccessToken(String(teacher.user._id), 'principal');
  await registerSession(String(teacher.user._id), token, 'principal');
  assert.equal((await discover('', token)).status, 403);
  await Branch.collection.updateOne(
    { _id: state.branch._id },
    { $set: { isActive: false } },
  );
  assert.equal((await discover('', state.token)).status, 403);
});

for (const query of [
  'branchId=aaaaaaaaaaaaaaaaaaaaaaaa',
  'senderUserId=aaaaaaaaaaaaaaaaaaaaaaaa',
  'recipientUserId=aaaaaaaaaaaaaaaaaaaaaaaa',
  'studentId=aaaaaaaaaaaaaaaaaaaaaaaa',
  'childId=aaaaaaaaaaaaaaaaaaaaaaaa',
  'role=teacher',
  'search=Teacher',
  'offset=-1',
  'offset=1.5',
  'offset=1001',
  'offset=',
  'offset=1e2',
  'offset=1&offset=2',
  'limit=0',
  'limit=101',
  'limit=1.2',
  'limit=',
  'limit=1&limit=2',
  'limit[x]=1',
]) {
  test(`rejects malformed filters and client authority selector: ${query}`, async () => {
    assert.equal((await discover('?' + query, parentState.token)).status, 400);
  });
}

test('default/max limits, stable User ID ordering, complete pages and end offset', async () => {
  for (let index = 0; index < 27; index++) {
    const user = await put(User, {
      fullName: `Student ${index}`,
      role: 'student',
      branchId: state.branch._id,
      isActive: true,
    });
    const student = await put(Student, {
      userId: user._id,
      branchId: state.branch._id,
      isActive: true,
    });
    await put(StudentEnrollment, {
      studentId: student._id,
      branchId: state.branch._id,
      academicPeriodId: state.period._id,
      classId: state.cls._id,
      sectionId: state.section._id,
      status: 'active',
      effectiveFrom: new Date(Date.now() - 60000),
    });
  }
  const first = await discover(),
    repeat = await discover(),
    next = await discover('?offset=25'),
    full = await discover('?limit=100');
  assert.equal(first.status, 200);
  assert.equal(first.json.data.limit, 25);
  assert.equal(first.json.data.items.length, 25);
  assert.equal(first.json.data.nextOffset, 25);
  assert.deepEqual(first, repeat);
  const ids = [...first.json.data.items, ...next.json.data.items].map(
    (row: Awaited<ReturnType<typeof authorizeChatRecipient>>['recipient']) =>
      row.userId,
  );
  assert.equal(ids.length, 29);
  assert.equal(new Set(ids).size, 29);
  assert.deepEqual(ids, [...ids].sort());
  assert.deepEqual(
    full.json.data.items.map(
      (row: Awaited<ReturnType<typeof authorizeChatRecipient>>['recipient']) =>
        row.userId,
    ),
    ids,
  );
  assert.equal(next.json.data.nextOffset, null);
  const end = (await discover('?offset=1000')).json.data;
  assert.deepEqual(end.items, []);
  assert.equal(end.nextOffset, null);
});

test('multiple subjects and multiple verified child relationships collapse to one recipient', async () => {
  const subject = await put(Subject, {
    branchId: state.branch._id,
    name: 'Science',
    isActive: true,
  });
  await TeacherAssignment.collection.insertOne({
    ...assignment.toObject(),
    _id: oid(),
    subjectId: subject._id,
  });
  await StudentEnrollment.collection.updateOne(
    { studentId: state.otherStudent._id },
    { $set: { classId: state.cls._id, sectionId: state.section._id } },
  );
  await ParentStudentLink.collection.insertOne({
    ...parentState.link.toObject(),
    _id: oid(),
    studentId: state.otherStudent._id,
  });
  const response = await discover('', parentState.token);
  assert.equal(response.json.data.total, 1);
  assert.equal(response.json.data.items[0].userId, String(teacher.user._id));
  const own = await discover();
  assert.equal(
    own.json.data.items.filter(
      (row: Awaited<ReturnType<typeof authorizeChatRecipient>>['recipient']) =>
        row.userId === String(parentState.parent._id),
    ).length,
    1,
  );
});

test('substitution record alone never grants permanent Teacher chat scope', async () => {
  await put(SubstituteAssignment, {
    branchId: state.branch._id,
    substituteTeacherId: unrelated.user._id,
    teacherId: teacher.user._id,
    classId: state.cls._id,
    sectionId: state.section._id,
    subjectId: assignment.subjectId,
    date: state.today,
    startTime: '00:00',
    endTime: '23:59',
    isActive: true,
  });
  await assert.rejects(
    () => auth(state.user._id, 'student', unrelated.user._id),
    denied,
  );
  assert.equal((await discover('', unrelated.token)).json.data.total, 0);
});

test('oversized candidate scope fails explicitly rather than truncating recipient authority', async () => {
  await StudentEnrollment.collection.insertMany(
    Array.from({ length: 1001 }, () => ({
      studentId: oid(),
      branchId: state.branch._id,
      academicPeriodId: state.period._id,
      classId: state.cls._id,
      sectionId: state.section._id,
      status: 'active',
      effectiveFrom: new Date(Date.now() - 60000),
    })),
  );
  assert.equal((await discover()).status, 409);
});

test('recipient discovery and authorization cause zero domain/chat/notification/session writes', async () => {
  const snapshot = async () => {
    const collections = await mongoose.connection.db!.collections(),
      rows: Record<string, unknown> = {};
    for (const collection of collections.sort((a, b) =>
      a.collectionName.localeCompare(b.collectionName),
    ))
      rows[collection.collectionName] = await collection
        .find()
        .sort({ _id: 1 })
        .toArray();
    return JSON.stringify(rows);
  };
  const original = await snapshot();
  for (const token of [teacher.token, state.token, parentState.token])
    assert.equal((await discover('', token)).status, 200);
  await teacherParent();
  await studentTeacher();
  assert.equal(await snapshot(), original);
  for (const path of ['/chat/conversations', '/chat/messages', '/chat/socket'])
    assert.equal((await apiHttp(path, teacher.token, {})).status, 403);
  assert.equal(await snapshot(), original);
});
