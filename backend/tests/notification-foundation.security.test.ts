import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
import { createHash } from 'node:crypto';
import {
  state,
  parentState,
  finance,
  apiHttp,
  put,
  oid,
} from './helpers/finance.fixture';
import User from '../src/models/user';
import Session from '../src/models/session';
import Subject from '../src/models/subject';
import TeacherAssignment from '../src/models/teacherAssignment';
import SchoolNotice from '../src/models/schoolNotice';
import { ParentStudentLink } from '../src/models/parentStudentLink';
import { StudentEnrollment } from '../src/models/studentEnrollment';
import {
  Notification,
  NotificationReadOperation,
} from '../src/models/notification';
import {
  createInternalNotification,
  markOwnNotificationRead,
  type NotificationDelivery,
} from '../src/services/notification.service';
import { ensureTeacherNotificationIndexes } from '../src/services/teacher-notification.service';
import { generateAccessToken } from '../src/services/jwt.service';
import { registerSession } from '../src/services/session.service';
import { ROLE_PERMISSIONS } from '../src/constants/rolePermissions';
import { PERMISSIONS } from '../src/constants/permissions';

let teacher: { user: { _id: unknown }; token: string };
let assignmentId: string;
const baseInput = (
  extra: Partial<NotificationDelivery> = {},
): NotificationDelivery => ({
  recipientUserId: String(finance.maker.user._id),
  recipientRole: 'finance',
  branchId: String(state.branch._id),
  sourceType: 'system',
  sourceId: String(oid()),
  sourceRevision: 1,
  eventType: 'foundation_update',
  category: 'system',
  title: 'Update',
  body: 'Open the app',
  deepLinkType: 'none',
  availableAt: new Date(),
  ...extra,
});
const teacherInput = () =>
  baseInput({
    recipientUserId: String(teacher.user._id),
    recipientRole: 'teacher',
    sourceType: 'teacher_assignment',
    sourceId: assignmentId,
  });
const studentInput = () =>
  baseInput({
    recipientUserId: String(state.user._id),
    recipientRole: 'student',
    sourceType: 'student_enrollment',
    sourceId: String(state.enrollment._id),
  });
const parentInput = () =>
  baseInput({
    recipientUserId: String(parentState.parent._id),
    recipientRole: 'parent',
    sourceType: 'parent_student_link',
    sourceId: String(parentState.link._id),
  });
const own = (id: unknown, token = finance.maker.token) =>
  apiHttp('/notifications/' + id, token);
const read = (
  id: unknown,
  token = finance.maker.token,
  operation = 'foundation_read_operation_001',
) =>
  apiHttp('/notifications/' + id + '/read', token, {
    clientOperationId: operation,
  });
const blocked = (error: unknown) =>
  !!error &&
  typeof error === 'object' &&
  'status' in error &&
  [401, 403, 404].includes(Number(error.status));

before(async () => {
  await ensureTeacherNotificationIndexes();
});
beforeEach(async () => {
  for (const model of [
    Notification,
    NotificationReadOperation,
    TeacherAssignment,
  ])
    await model.collection.deleteMany({});
  const user = await User.create({
    fullName: 'Assigned Teacher',
    email: 'foundation-teacher@test.invalid',
    password: 'private-test',
    role: 'teacher',
    branchId: state.branch._id,
  });
  const token = generateAccessToken(String(user._id), 'teacher');
  await registerSession(String(user._id), token, 'teacher');
  teacher = { user, token };
  const subject = await put(Subject, {
    branchId: state.branch._id,
    name: 'Science',
    isActive: true,
  });
  const assignment = await TeacherAssignment.create({
    teacherId: user._id,
    branchId: state.branch._id,
    classId: state.cls._id,
    sectionId: state.section._id,
    subjectId: subject._id,
    validFrom: new Date(Date.now() - 86400000),
    isActive: true,
    createdBy: parentState.verifier._id,
    updatedBy: parentState.verifier._id,
  });
  assignmentId = String(assignment._id);
});

test('one canonical record supports recipient-owned safe unread/read primitives', async () => {
  const row = await createInternalNotification(baseInput());
  const first = await own(row._id);
  assert.equal(first.status, 200);
  assert.equal(first.json.data.readAt, null);
  assert.deepEqual(
    Object.keys(first.json.data).sort(),
    [
      'availableAt',
      'body',
      'category',
      'createdAt',
      'deepLink',
      'notificationId',
      'priority',
      'readAt',
      'source',
      'title',
    ].sort(),
  );
  const marked = await read(row._id),
    retry = await read(row._id);
  assert.equal(marked.status, 200);
  assert.ok(marked.json.data.readAt);
  assert.deepEqual(retry, marked);
  assert.equal(await Notification.countDocuments(), 1);
  assert.equal(await NotificationReadOperation.countDocuments(), 1);
  assert.equal((await own(row._id)).json.data.readAt, marked.json.data.readAt);
});

test('other recipients, foreign Branches and guessed IDs cannot read or mark notifications', async () => {
  const row = await createInternalNotification(baseInput());
  for (const token of [
    finance.checker.token,
    finance.foreign.token,
    state.token,
    parentState.token,
  ]) {
    assert.equal((await own(row._id, token)).status, 404);
    assert.equal((await read(row._id, token)).status, 404);
  }
  assert.equal((await own(oid())).status, 404);
  assert.equal((await read(oid())).status, 404);
  assert.equal(
    (await own(row._id + '?branchId=' + state.foreign._id)).status,
    400,
  );
  assert.equal(await NotificationReadOperation.countDocuments(), 0);
});

test('read state changes only read metadata and preserves source/content/scope', async () => {
  const row = await createInternalNotification(studentInput());
  const original = await Notification.findById(row._id).lean();
  assert.equal((await read(row._id, state.token)).status, 200);
  const after = await Notification.findById(row._id).lean();
  const strip = (value: unknown) => {
    const result = { ...(value as object) } as Record<string, unknown>;
    delete result.readAt;
    delete result.updatedAt;
    return result;
  };
  assert.deepEqual(strip(after), strip(original));
  assert.equal(
    (await StudentEnrollment.findById(state.enrollment._id))!.status,
    'active',
  );
});

test('concurrent reads keep one timestamp and conflicting read-operation reuse is rejected', async () => {
  const a = await createInternalNotification(baseInput()),
    b = await createInternalNotification(baseInput());
  const results = await Promise.all(
    Array.from({ length: 5 }, () => read(a._id)),
  );
  assert.deepEqual(
    results.map(result => result.status),
    [200, 200, 200, 200, 200],
  );
  assert.equal(new Set(results.map(result => result.json.data.readAt)).size, 1);
  assert.equal((await read(b._id)).status, 409);
  assert.equal((await own(b._id)).json.data.readAt, null);
});

test('failed mark-read rolls back its operation record and timestamp', async t => {
  const row = await createInternalNotification(baseInput());
  t.mock.method(Notification, 'findOneAndUpdate', async () => {
    throw new Error('injected read failure');
  });
  assert.equal((await read(row._id)).status, 500);
  assert.equal(await NotificationReadOperation.countDocuments(), 0);
  assert.equal((await own(row._id)).json.data.readAt, null);
});

test('revoked session and inactive recipient cannot mutate read state or receive future delivery', async () => {
  const input = baseInput(),
    row = await createInternalNotification(input);
  await Session.updateOne(
    { token: finance.maker.token },
    { $set: { isRevoked: true } },
  );
  assert.equal((await read(row._id)).status, 401);
  await assert.rejects(
    markOwnNotificationRead(
      { userId: input.recipientUserId, role: 'finance' },
      String(row._id),
      { clientOperationId: 'revoked_read_operation_001' },
      finance.maker.token,
    ),
    blocked,
  );
  await User.updateOne(
    { _id: finance.maker.user._id },
    { $set: { isActive: false } },
  );
  await assert.rejects(
    createInternalNotification({ ...input, sourceRevision: 2 }),
    blocked,
  );
  assert.equal(await NotificationReadOperation.countDocuments(), 0);
});

test('no client send API, arbitrary selectors, unsupported domain policy or insecure navigation exists', async () => {
  assert.equal(
    (
      await apiHttp('/notifications', finance.maker.token, {
        recipientUserId: state.user._id,
        branchId: state.foreign._id,
      })
    ).status,
    403,
  );
  const input = baseInput();
  await assert.rejects(
    createInternalNotification({ ...input, sourceType: 'academic_result' }),
    blocked,
  );
  await assert.rejects(
    createInternalNotification({
      ...input,
      deepLinkType: 'teacher_timetable',
      deepLinkTargetId: String(oid()),
    }),
    blocked,
  );
  await assert.rejects(
    createInternalNotification({
      ...input,
      branchId: String(state.foreign._id),
    }),
    blocked,
  );
  assert.equal(await Notification.countDocuments(), 0);
});

test('staff role removal and Branch transfer block stale future deliveries without deleting history', async () => {
  const input = baseInput(),
    row = await createInternalNotification(input);
  await User.updateOne(
    { _id: finance.maker.user._id },
    { $set: { role: 'principal' } },
  );
  await assert.rejects(
    createInternalNotification({ ...input, sourceRevision: 2 }),
    blocked,
  );
  assert.equal(await Notification.countDocuments({ _id: row._id }), 1);
  await User.updateOne(
    { _id: finance.maker.user._id },
    { $set: { role: 'finance', branchId: state.foreign._id } },
  );
  await assert.rejects(
    createInternalNotification({ ...input, sourceRevision: 3 }),
    blocked,
  );
  assert.equal((await own(row._id)).status, 404);
});

test('Principal Branch recipient uses the same canonical store and own read contract', async () => {
  const id = String(parentState.verifier._id),
    token = generateAccessToken(id, 'principal');
  await registerSession(id, token, 'principal');
  const row = await createInternalNotification(
    baseInput({ recipientUserId: id, recipientRole: 'principal' }),
  );
  assert.equal((await own(row._id, token)).status, 200);
  assert.equal((await read(row._id, token)).status, 200);
});

test('Teacher assignment revocation blocks new delivery but preserves legitimately delivered history', async () => {
  const input = teacherInput(),
    row = await createInternalNotification(input);
  await TeacherAssignment.updateOne(
    { _id: assignmentId },
    { $set: { isActive: false, revokedAt: new Date() } },
  );
  await assert.rejects(
    createInternalNotification({ ...input, sourceRevision: 2 }),
    blocked,
  );
  await assert.rejects(createInternalNotification(input), blocked);
  assert.equal((await own(row._id, teacher.token)).status, 200);
  assert.equal(await Notification.countDocuments(), 1);
});

test('expired permanent Teacher assignment cannot authorize new notification delivery', async () => {
  await TeacherAssignment.collection.updateOne(
    { _id: new (await import('mongoose')).Types.ObjectId(assignmentId) },
    { $set: { validUntil: new Date(Date.now() - 1000) } },
  );
  await assert.rejects(createInternalNotification(teacherInput()), blocked);
  assert.equal(await Notification.countDocuments(), 0);
});

test('assignment expiry during the delivery write rolls the notification back', async t => {
  const expires = new Date(Date.now() + 800);
  await TeacherAssignment.collection.updateOne(
    { _id: new (await import('mongoose')).Types.ObjectId(assignmentId) },
    { $set: { validUntil: expires } },
  );
  const originalCreate = Notification.create;
  let reachedWrite = false;
  t.mock.method(Notification, 'create', async (...args: unknown[]) => {
    reachedWrite = true;
    const result: unknown = await Reflect.apply(
      originalCreate,
      Notification,
      args,
    );
    await new Promise(resolve => setTimeout(resolve, 900));
    return result;
  });
  await assert.rejects(createInternalNotification(teacherInput()), blocked);
  assert.equal(reachedWrite, true);
  assert.equal(await Notification.countDocuments(), 0);
});

test('malformed delivery IDs, revisions, raw selectors and unknown content fields are rejected', async () => {
  const input = baseInput();
  for (const change of [
    { recipientUserId: 'bad-id' },
    { sourceRevision: 0 },
    { sourceRevision: 1.5 },
    { eventType: { $ne: null } },
    { branchId: { $ne: null } },
    { rawPayload: { protected: true } },
  ]) {
    await assert.rejects(
      createInternalNotification({
        ...input,
        ...change,
      } as NotificationDelivery),
      { status: 400 },
    );
  }
  assert.equal(await Notification.countDocuments(), 0);
});

test('unassigned or foreign Teacher cannot use another assignment as delivery authority', async () => {
  await assert.rejects(
    createInternalNotification({
      ...teacherInput(),
      recipientUserId: String(state.user._id),
    }),
    blocked,
  );
  const other = await User.create({
    fullName: 'Other Teacher',
    email: 'other-foundation@test.invalid',
    password: 'private',
    role: 'teacher',
    branchId: state.branch._id,
  });
  await assert.rejects(
    createInternalNotification({
      ...teacherInput(),
      recipientUserId: String(other._id),
    }),
    blocked,
  );
  assert.equal(await Notification.countDocuments(), 0);
});

test('assignment revocation races cannot enable future stale delivery', async () => {
  const input = teacherInput();
  await Promise.allSettled([
    createInternalNotification(input),
    TeacherAssignment.updateOne(
      { _id: assignmentId },
      { $set: { isActive: false } },
    ),
  ]);
  const count = await Notification.countDocuments();
  await assert.rejects(
    createInternalNotification({ ...input, sourceRevision: 2 }),
    blocked,
  );
  assert.equal(await Notification.countDocuments(), count);
});

test('Student enrollment ends or transfers without authorizing stale future class/Branch delivery', async () => {
  const input = studentInput(),
    row = await createInternalNotification(input);
  await StudentEnrollment.updateOne(
    { _id: state.enrollment._id },
    { $set: { status: 'withdrawn', effectiveTo: new Date() } },
  );
  await assert.rejects(
    createInternalNotification({ ...input, sourceRevision: 2 }),
    blocked,
  );
  assert.equal((await own(row._id, state.token)).status, 200);
  await User.updateOne(
    { _id: state.user._id },
    { $set: { branchId: state.foreign._id } },
  );
  await assert.rejects(
    createInternalNotification({ ...input, sourceRevision: 3 }),
    blocked,
  );
  assert.equal((await own(row._id, state.token)).status, 404);
});

test('another Student cannot receive a notification through someone else enrollment', async () => {
  await assert.rejects(
    createInternalNotification({
      ...studentInput(),
      recipientUserId: String(state.other._id),
    }),
    blocked,
  );
  assert.equal(await Notification.countDocuments(), 0);
});

test('Parent must have the exact verified link and revocation blocks future child delivery', async () => {
  const input = parentInput(),
    row = await createInternalNotification(input);
  await assert.rejects(
    createInternalNotification({
      ...input,
      recipientUserId: String(parentState.otherParent._id),
    }),
    blocked,
  );
  await ParentStudentLink.updateOne(
    { _id: parentState.link._id },
    { $set: { isActive: false, revokedAt: new Date() } },
  );
  await assert.rejects(
    createInternalNotification({ ...input, sourceRevision: 2 }),
    blocked,
  );
  assert.equal((await own(row._id, parentState.token)).status, 200);
  assert.equal(await Notification.countDocuments(), 1);
});

test('concurrent retry dedupes per event and recipient; different events and recipients stay separate', async () => {
  const input = baseInput();
  const results = await Promise.all(
    Array.from({ length: 6 }, () => createInternalNotification(input)),
  );
  assert.equal(new Set(results.map(row => String(row._id))).size, 1);
  await createInternalNotification({
    ...input,
    recipientUserId: String(finance.checker.user._id),
  });
  await createInternalNotification({ ...input, eventType: 'different_update' });
  await assert.rejects(
    createInternalNotification({ ...input, body: 'conflicting intent' }),
    { status: 409 },
  );
  assert.equal(await Notification.countDocuments(), 3);
});

test('dedupe never returns a historical record with inconsistent Branch metadata', async () => {
  const input = baseInput(),
    row = await createInternalNotification(input);
  await Notification.collection.updateOne(
    { _id: row._id },
    { $set: { branchId: state.foreign._id } },
  );
  await assert.rejects(createInternalNotification(input), { status: 409 });
  assert.equal((await own(row._id)).status, 404);
  assert.equal(await Notification.countDocuments(), 1);
});

test('generic payload is minimal and a notification cannot grant source access', async () => {
  const row = await createInternalNotification({
    ...studentInput(),
    body: 'Protected record details must not appear',
  });
  const response = await own(row._id, state.token);
  assert.equal(
    response.json.data.body,
    'Open the school app to view an authorized update.',
  );
  assert.equal(response.json.data.deepLink, null);
  assert.equal(
    (await apiHttp('/teacher/notifications/' + row._id, state.token)).status,
    403,
  );
});

test('future delivery is rejected and future historical rows cannot be read or marked early', async () => {
  const input = baseInput();
  await assert.rejects(
    createInternalNotification({
      ...input,
      availableAt: new Date('2099-01-01'),
    }),
    { status: 400 },
  );
  const row = await createInternalNotification(input);
  await Notification.collection.updateOne(
    { _id: row._id },
    { $set: { availableAt: new Date('2099-01-01') } },
  );
  assert.equal((await own(row._id)).status, 404);
  assert.equal((await read(row._id)).status, 404);
});

test('existing published-Teacher-notice event fingerprints replay without migration or historical rewrite', async () => {
  const publishedAt = new Date();
  const notice = await SchoolNotice.create({
    branchId: state.branch._id,
    title: 'Published policy',
    message: 'Safe Teacher announcement',
    status: 'published',
    priority: 'normal',
    audienceRoles: ['teacher'],
    createdBy: parentState.verifier._id,
    publishedAt,
  });
  const input = {
    recipientUserId: String(teacher.user._id),
    branchId: String(state.branch._id),
    sourceType: 'school_notice' as const,
    sourceId: String(notice._id),
    sourceRevision: publishedAt.getTime(),
    eventType: 'school_notice_published',
    category: 'notice' as const,
    title: notice.title,
    body: notice.message,
    deepLinkType: 'inbox_notice' as const,
    deepLinkTargetId: String(notice._id),
    priority: 'normal' as const,
    availableAt: publishedAt,
  };
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({ ...input, availableAt: publishedAt.toISOString() }),
    )
    .digest('hex');
  const legacy = await Notification.create({
    ...input,
    recipientRole: 'teacher',
    operationId: 'historical_notice_event',
    fingerprint,
  });
  assert.equal(
    String((await createInternalNotification(input))._id),
    String(legacy._id),
  );
  assert.equal(await Notification.countDocuments(), 1);
  await SchoolNotice.updateOne(
    { _id: notice._id },
    { $set: { title: 'Edited published title' } },
  );
  const list = await apiHttp('/teacher/notifications?offset=0', teacher.token);
  assert.equal(list.status, 200);
  assert.equal(list.json.data.items[0].title, 'Published policy');
  await SchoolNotice.updateOne(
    { _id: notice._id },
    { $set: { status: 'archived' } },
  );
  await assert.rejects(createInternalNotification(input), blocked);
  assert.equal((await own(legacy._id, teacher.token)).status, 200);
});

test('published notice delivery requires the current canonical Teacher notice permission', async () => {
  const publishedAt = new Date();
  const notice = await SchoolNotice.create({
    branchId: state.branch._id,
    title: 'Permission test',
    message: 'Published notice',
    status: 'published',
    priority: 'normal',
    audienceRoles: ['teacher'],
    createdBy: parentState.verifier._id,
    publishedAt,
  });
  const permissions = [...ROLE_PERMISSIONS.teacher];
  ROLE_PERMISSIONS.teacher = permissions.filter(
    permission => permission !== PERMISSIONS.TEACHER_NOTICES_VIEW,
  );
  try {
    await assert.rejects(
      createInternalNotification(
        baseInput({
          recipientUserId: String(teacher.user._id),
          recipientRole: 'teacher',
          sourceType: 'school_notice',
          sourceId: String(notice._id),
          sourceRevision: publishedAt.getTime(),
          availableAt: publishedAt,
          category: 'notice',
          title: notice.title,
          body: notice.message,
          deepLinkType: 'inbox_notice',
          deepLinkTargetId: String(notice._id),
        }),
      ),
      blocked,
    );
  } finally {
    ROLE_PERMISSIONS.teacher = permissions;
  }
  assert.equal(await Notification.countDocuments(), 0);
});
