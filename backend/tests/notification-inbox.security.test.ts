import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import mongoose, { type InferSchemaType } from 'mongoose';
import jwt from 'jsonwebtoken';
import {
  state,
  parentState,
  finance,
  apiHttp,
  oid,
} from './helpers/finance.fixture';
import User from '../src/models/user';
import Branch from '../src/models/branch';
import Session from '../src/models/session';
import {
  Notification,
  NotificationReadOperation,
} from '../src/models/notification';
import { StudentEnrollment } from '../src/models/studentEnrollment';
import { ParentStudentLink } from '../src/models/parentStudentLink';
import { createInternalNotification } from '../src/services/notification.service';
import { ensureTeacherNotificationIndexes } from '../src/services/teacher-notification.service';
import { generateAccessToken } from '../src/services/jwt.service';
import { registerSession } from '../src/services/session.service';

before(ensureTeacherNotificationIndexes);
const list = (query = '', token = finance.maker.token) =>
  apiHttp('/notifications/me' + query, token);
const seed = (
  extra: Partial<InferSchemaType<typeof Notification.schema>> = {},
) => ({
  recipientUserId: finance.maker.user._id,
  recipientRole: 'finance' as const,
  branchId: state.branch._id,
  sourceType: 'system' as const,
  sourceId: oid(),
  sourceRevision: 1,
  eventType: 'existing_delivery',
  category: 'system' as const,
  title: 'School update',
  body: 'Open your school app.',
  deepLinkType: 'none' as const,
  availableAt: new Date(Date.now() - 60000),
  operationId: String(oid()),
  fingerprint: 'private-test-fingerprint',
  ...extra,
});
async function login(role: 'teacher' | 'principal' | 'super_admin') {
  const user = await User.create({
    fullName: role,
    email: `${role}@inbox.test`,
    password: 'private-test',
    role,
    branchId: state.branch._id,
  });
  const token = generateAccessToken(String(user._id), role);
  await registerSession(String(user._id), token, role);
  return { user, token };
}

test('own list uses F1 safe DTO; excludes foreign recipients/Branches and guessed foreign detail', async () => {
  const row = await Notification.create(seed());
  const foreign = await Notification.create(
    seed({ recipientUserId: finance.checker.user._id }),
  );
  await Notification.create(seed({ branchId: state.foreign._id }));
  const response = await list();
  assert.equal(response.status, 200);
  assert.equal(response.json.data.total, 1);
  assert.equal(response.json.data.unread, 1);
  assert.deepEqual(response.json.data.items, [
    (await apiHttp('/notifications/' + row._id, finance.maker.token)).json.data,
  ]);
  assert.equal(
    (await apiHttp('/notifications/' + foreign._id, finance.maker.token))
      .status,
    404,
  );
  assert.deepEqual(
    Object.keys(response.json.data.items[0]).sort(),
    [
      'notificationId',
      'category',
      'title',
      'body',
      'priority',
      'createdAt',
      'availableAt',
      'readAt',
      'source',
      'deepLink',
    ].sort(),
  );
});

test('default page is bounded to 25 and repeated pages have stable timestamp/ObjectId ordering', async () => {
  const at = new Date(Date.now() - 60000);
  const rows = await Notification.insertMany(
    Array.from({ length: 53 }, () => seed({ availableAt: at })),
  );
  const newer = await Notification.create(
    seed({ availableAt: new Date(at.getTime() + 1000) }),
  );
  const expected = [
    String(newer._id),
    ...rows
      .map(row => String(row._id))
      .sort()
      .reverse(),
  ];
  const first = await list(),
    repeat = await list(),
    second = await list('?offset=25'),
    last = await list('?offset=50');
  assert.equal(first.json.data.limit, 25);
  assert.equal(first.json.data.offset, 0);
  assert.equal(first.json.data.status, 'all');
  assert.equal(first.json.data.items.length, 25);
  assert.equal(first.json.data.nextOffset, 25);
  assert.deepEqual(first, repeat);
  assert.deepEqual(
    [
      ...first.json.data.items,
      ...second.json.data.items,
      ...last.json.data.items,
    ].map(row => row.notificationId),
    expected,
  );
  assert.equal(last.json.data.nextOffset, null);
  assert.equal(last.json.data.unread, 54);
});

test('max page is 100; explicit smaller page and end offset are read-only', async () => {
  await Notification.insertMany(Array.from({ length: 102 }, () => seed()));
  assert.equal((await list('?limit=100')).json.data.items.length, 100);
  const page = (await list('?limit=1&offset=1')).json.data;
  assert.equal(page.items.length, 1);
  assert.equal(page.nextOffset, 2);
  const end = (await list('?offset=10000')).json.data;
  assert.deepEqual(end.items, []);
  assert.equal(end.nextOffset, null);
  assert.equal(await NotificationReadOperation.countDocuments(), 0);
  assert.equal(
    await Notification.countDocuments({ readAt: { $type: 'date' } }),
    0,
  );
});

for (const query of [
  'offset=-1',
  'offset=1.5',
  'offset=10001',
  'offset=1e2',
  'offset=',
  'offset=NaN',
  'offset=1&offset=2',
  'limit=0',
  'limit=101',
  'limit=-1',
  'limit=1.1',
  'limit=',
  'limit=1&limit=2',
  'status=other',
  'status=read&status=unread',
  'userId=aaaaaaaaaaaaaaaaaaaaaaaa',
  'branchId=aaaaaaaaaaaaaaaaaaaaaaaa',
  'sort=createdAt',
  'status[x]=read',
]) {
  test(`rejects unsupported/ambiguous inbox query: ${query}`, async () => {
    assert.equal((await list('?' + query)).status, 400);
  });
}

test('read/unread filters use canonical dates/null/missing and server unread is independent of filter/page', async () => {
  const readAt = new Date();
  await Notification.create([
    seed(),
    seed({ readAt: null }),
    seed({ readAt }),
    seed({ availableAt: new Date(Date.now() + 86400000) }),
    seed({ recipientUserId: finance.checker.user._id }),
    seed({ branchId: state.foreign._id }),
  ]);
  const unread = (await list('?status=unread&limit=1')).json.data;
  assert.equal(unread.total, 2);
  assert.equal(unread.unread, 2);
  assert.equal(unread.items[0].readAt, null);
  assert.equal(unread.nextOffset, 1);
  const read = (await list('?status=read')).json.data;
  assert.equal(read.total, 1);
  assert.equal(read.unread, 2);
  assert.equal(read.items[0].readAt, readAt.toISOString());
  assert.equal((await list()).json.data.total, 3);
});

test('empty own inbox has truthful counts and paging metadata', async () => {
  const response = await list();
  assert.equal(response.status, 200);
  assert.deepEqual(response.json.data, {
    items: [],
    status: 'all',
    offset: 0,
    limit: 25,
    total: 0,
    unread: 0,
    nextOffset: null,
  });
});

test('supported Student/Parent accounts read their own records, never a child or another account inbox', async () => {
  await Notification.create([
    seed({ recipientUserId: state.user._id, recipientRole: 'student' }),
    seed({ recipientUserId: state.other._id, recipientRole: 'student' }),
    seed({ recipientUserId: parentState.parent._id, recipientRole: 'parent' }),
  ]);
  const student = await list('', state.token),
    parent = await list('', parentState.token);
  assert.equal(student.status, 200);
  assert.equal(parent.status, 200);
  assert.equal(student.json.data.items.length, 1);
  assert.equal(parent.json.data.items.length, 1);
  assert.notEqual(
    student.json.data.items[0].notificationId,
    parent.json.data.items[0].notificationId,
  );
  assert.equal(
    (await list('?userId=' + state.user._id, parentState.token)).status,
    400,
  );
});

test('Teacher and Principal use the same historical own-account list authority without assignment fallback', async () => {
  for (const role of ['teacher', 'principal'] as const) {
    const actor = await login(role);
    await Notification.create(
      seed({ recipientUserId: actor.user._id, recipientRole: role }),
    );
    const own = await list('', actor.token);
    assert.equal(own.status, 200);
    assert.equal(own.json.data.total, 1);
  }
});

test('Teacher legacy list delegates shared filters/count/DTO and retains default 50', async () => {
  const teacher = await login('teacher');
  await Notification.create([
    seed({ recipientUserId: teacher.user._id, recipientRole: 'teacher' }),
    seed({
      recipientUserId: teacher.user._id,
      recipientRole: 'teacher',
      readAt: new Date(),
    }),
  ]);
  const old = await apiHttp('/teacher/notifications', teacher.token);
  assert.equal(old.status, 200);
  assert.equal(old.json.data.limit, 50);
  const canonical = await list('?status=unread&limit=1', teacher.token);
  const compatible = await apiHttp(
    '/teacher/notifications?status=unread&limit=1',
    teacher.token,
  );
  assert.deepEqual(compatible, canonical);
});

test('missing/revoked Session, inactive/deleted user and changed persisted role deny list', async () => {
  assert.equal((await list('', '')).status, 401);
  await Session.updateOne(
    { token: finance.maker.token },
    { $set: { isRevoked: true } },
  );
  assert.equal((await list()).status, 401);
  await Session.deleteOne({ token: finance.maker.token });
  assert.equal((await list()).status, 401);
  await registerSession(
    String(finance.maker.user._id),
    finance.maker.token,
    'finance',
  );
  await User.updateOne(
    { _id: finance.maker.user._id },
    { $set: { isActive: false } },
  );
  assert.equal((await list()).status, 401);
  await User.updateOne(
    { _id: finance.maker.user._id },
    { $set: { isActive: true, role: 'principal' } },
  );
  assert.equal((await list()).status, 401);
  await User.deleteOne({ _id: finance.maker.user._id });
  assert.equal((await list()).status, 401);
});

test('expired JWT is rejected even with a registered Session', async () => {
  const token = jwt.sign(
    { userId: String(finance.maker.user._id), role: 'finance' },
    process.env.JWT_SECRET!,
    { expiresIn: -1 },
  );
  await registerSession(String(finance.maker.user._id), token, 'finance');
  assert.equal((await list('', token)).status, 401);
});

test('unsupported Super Admin and missing/inactive current Branch fail closed', async () => {
  const admin = await login('super_admin');
  assert.equal((await list('', admin.token)).status, 403);
  await Branch.collection.updateOne(
    { _id: state.branch._id },
    { $set: { isActive: false } },
  );
  assert.equal((await list()).status, 403);
  await Branch.collection.updateOne(
    { _id: state.branch._id },
    { $set: { isActive: true } },
  );
  await User.collection.updateOne(
    { _id: finance.maker.user._id },
    { $unset: { branchId: '' } },
  );
  assert.equal((await list()).status, 403);
});

test('Branch transfer conceals old-Branch delivery and supported role change preserves same-Branch history', async () => {
  const row = await Notification.create(seed());
  await User.updateOne(
    { _id: finance.maker.user._id },
    { $set: { branchId: state.foreign._id } },
  );
  assert.equal((await list()).json.data.total, 0);
  await User.updateOne(
    { _id: finance.maker.user._id },
    { $set: { branchId: state.branch._id, role: 'principal' } },
  );
  const token = generateAccessToken(
    String(finance.maker.user._id),
    'principal',
  );
  await registerSession(String(finance.maker.user._id), token, 'principal');
  assert.equal(
    (await list('', token)).json.data.items[0].notificationId,
    String(row._id),
  );
});

test('legitimate Student/Parent history survives relationship revocation without granting current child access', async () => {
  const common = {
    branchId: String(state.branch._id),
    sourceRevision: 1,
    eventType: 'existing_delivery',
    category: 'system' as const,
    title: 'School update',
    body: 'School update',
    deepLinkType: 'none' as const,
    availableAt: new Date(),
  };
  const student = await createInternalNotification({
    ...common,
    recipientUserId: String(state.user._id),
    recipientRole: 'student',
    sourceType: 'student_enrollment',
    sourceId: String(state.enrollment._id),
  });
  const parent = await createInternalNotification({
    ...common,
    recipientUserId: String(parentState.parent._id),
    recipientRole: 'parent',
    sourceType: 'parent_student_link',
    sourceId: String(parentState.link._id),
  });
  await StudentEnrollment.collection.deleteOne({ _id: state.enrollment._id });
  await ParentStudentLink.collection.deleteOne({ _id: parentState.link._id });
  assert.equal(
    (await list('', state.token)).json.data.items[0].notificationId,
    String(student._id),
  );
  assert.equal(
    (await list('', parentState.token)).json.data.items[0].notificationId,
    String(parent._id),
  );
  const child = await apiHttp(
    '/parent/me/children/' + state.student._id,
    parentState.token,
  );
  assert.ok([403, 404].includes(child.status));
});

test('generic inbox list/filter/page makes zero financial, academic, delivery, read-operation or session writes', async () => {
  await Notification.create(seed());
  const snapshot = async () => {
    const collections = await mongoose.connection.db!.collections();
    const result: Record<string, unknown> = {};
    for (const collection of collections.sort((a, b) =>
      a.collectionName.localeCompare(b.collectionName),
    ))
      result[collection.collectionName] = await collection
        .find()
        .sort({ _id: 1 })
        .toArray();
    return JSON.stringify(result);
  };
  const original = await snapshot();
  for (const query of ['', '?status=read', '?status=unread&offset=1&limit=1'])
    assert.equal((await list(query)).status, 200);
  assert.equal(await snapshot(), original);
});
