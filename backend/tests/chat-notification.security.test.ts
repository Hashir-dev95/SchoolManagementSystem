import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { before, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { state, parentState, put } from './helpers/parent-workspace.fixture';
import { apiHttp } from './helpers/student-workspace.fixture';
import User from '../src/models/user';
import Branch from '../src/models/branch';
import Subject from '../src/models/subject';
import SchoolNotice from '../src/models/schoolNotice';
import TeacherAssignment from '../src/models/teacherAssignment';
import { StudentEnrollment } from '../src/models/studentEnrollment';
import { ParentStudentLink } from '../src/models/parentStudentLink';
import {
  ChatConversation,
  ChatMessage,
  ensureChatIndexes,
} from '../src/models/chat';
import { Notification } from '../src/models/notification';
import { generateAccessToken } from '../src/services/jwt.service';
import { registerSession } from '../src/services/session.service';
import { authorizeChatRecipient } from '../src/services/chat-authority.service';
import { createChatMessageNotification } from '../src/services/notification.service';

let teacher: Awaited<ReturnType<typeof put>>, token: string;
let assignment: InstanceType<typeof TeacherAssignment>;
before(async () => {
  await ensureChatIndexes();
  await Notification.createIndexes();
});
beforeEach(async () => {
  teacher = await put(User, {
    fullName: 'Private Sender',
    role: 'teacher',
    isActive: true,
    branchId: state.branch._id,
    email: 'private@test.invalid',
  });
  token = generateAccessToken(String(teacher._id), 'teacher');
  await registerSession(String(teacher._id), token, 'teacher');
  const subject = await put(Subject, {
    branchId: state.branch._id,
    name: 'Math',
    isActive: true,
  });
  assignment = await TeacherAssignment.create({
    teacherId: teacher._id,
    branchId: state.branch._id,
    classId: state.cls._id,
    sectionId: state.section._id,
    subjectId: subject._id,
    validFrom: new Date(Date.now() - 86400000),
    isActive: true,
    createdBy: parentState.verifier._id,
    updatedBy: parentState.verifier._id,
  });
});
const identity = () => ({
  userId: String(teacher._id),
  role: 'teacher' as const,
});
const create = async (recipient = state.user._id, bearer = token) => {
  const response = await apiHttp('/chat/conversations', bearer, {
    recipientUserId: String(recipient),
  });
  assert.equal(response.status, 200, JSON.stringify(response));
  return response.json.data.conversationId as string;
};
const send = (
  id: string,
  operation = 'f6_message_operation_0001',
  body = 'Private message body',
  bearer = token,
  extra = {},
) =>
  apiHttp(`/chat/conversations/${id}/messages`, bearer, {
    body,
    clientOperationId: operation,
    ...extra,
  });
const counts = async (messages: number, notifications: number) => {
  assert.equal(await ChatMessage.countDocuments(), messages);
  assert.equal(
    await Notification.countDocuments({ sourceType: 'chat_message' }),
    notifications,
  );
};
async function event(id: string) {
  return Notification.findOne({
    sourceType: 'chat_message',
    deepLinkTargetId: id,
  }).lean();
}

test('all four supported edges persist one message and one exact recipient event per new send', async () => {
  let index = 0;
  for (const [bearer, recipient] of [
    [token, state.user._id],
    [state.token, teacher._id],
    [token, parentState.parent._id],
    [parentState.token, teacher._id],
  ]) {
    const id = await create(recipient, bearer);
    const response = await send(
      id,
      `f6_edge_operation_000${index++}`,
      'Private body',
      bearer,
    );
    assert.equal(response.status, 200, JSON.stringify(response));
    const rows = await Notification.find({
      sourceId: response.json.data.messageId,
    }).lean();
    assert.equal(rows.length, 1);
    assert.equal(String(rows[0]!.recipientUserId), String(recipient));
    assert.equal(String(rows[0]!.branchId), String(state.branch._id));
  }
  await counts(4, 4);
});
test('same operation replay and simultaneous duplicates converge; conflicting reuse remains 409', async () => {
  const id = await create();
  const responses = await Promise.all(
    Array.from({ length: 5 }, () => send(id)),
  );
  responses.forEach(response => {
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.deepEqual(response.json.data, responses[0]!.json.data);
  });
  const replay = await send(id);
  assert.deepEqual(replay.json.data, responses[0]!.json.data);
  assert.equal(
    (await send(id, 'f6_message_operation_0001', 'Different body')).status,
    409,
  );
  const other = await create(parentState.parent._id);
  assert.equal((await send(other)).status, 409);
  await counts(1, 1);
});
test('notification insertion error rolls back message, notification and sequence; retry succeeds', async t => {
  const id = await create();
  const original = Notification.create.bind(Notification);
  const stub = t.mock.method(
    Notification,
    'create',
    async (...args: unknown[]) => {
      await Reflect.apply(original, Notification, args);
      throw new Error('isolated notification failure after insert');
    },
  );
  assert.equal((await send(id)).status, 500);
  await counts(0, 0);
  assert.equal((await ChatConversation.findById(id))!.lastSequence, 0);
  stub.mock.restore();
  assert.equal((await send(id)).status, 200);
  await counts(1, 1);
});
test('final assignment expiry after notification insert rolls back both records', async t => {
  const id = await create(),
    until = Date.now() + 1500;
  await TeacherAssignment.collection.updateOne(
    { _id: assignment._id },
    { $set: { validUntil: new Date(until) } },
  );
  const original = Notification.create.bind(Notification);
  let inserted = false;
  t.mock.method(Notification, 'create', async (...args: unknown[]) => {
    const rows = await Reflect.apply(original, Notification, args);
    inserted = true;
    await new Promise(resolve =>
      setTimeout(resolve, Math.max(0, until - Date.now() + 50)),
    );
    return rows;
  });
  assert.equal((await send(id)).status, 403);
  assert.equal(inserted, true);
  await counts(0, 0);
  assert.equal((await ChatConversation.findById(id))!.lastSequence, 0);
});

const changes = [
  'assignment revoked',
  'assignment expired',
  'enrollment closed',
  'enrollment transferred',
  'parent link revoked',
  'parent link unverified',
  'Branch transfer',
] as const;
type Change = (typeof changes)[number];
async function changeAuthority(change: Change) {
  if (change === 'assignment revoked')
    await TeacherAssignment.collection.updateOne(
      { _id: assignment._id },
      { $set: { isActive: false, revokedAt: new Date() } },
    );
  if (change === 'assignment expired')
    await TeacherAssignment.collection.updateOne(
      { _id: assignment._id },
      { $set: { validUntil: new Date(Date.now() - 1) } },
    );
  if (change.startsWith('enrollment'))
    await StudentEnrollment.collection.updateOne(
      { _id: state.enrollment._id },
      {
        $set: {
          status: change.endsWith('closed') ? 'closed' : 'transferred',
          effectiveTo: new Date(),
        },
      },
    );
  if (change.startsWith('parent link'))
    await ParentStudentLink.collection.updateOne(
      { _id: parentState.link._id },
      {
        $set: {
          status: change.endsWith('revoked') ? 'revoked' : 'pending',
          isActive: false,
        },
      },
    );
  if (change === 'Branch transfer')
    await User.collection.updateOne(
      { _id: state.user._id },
      { $set: { branchId: state.foreign._id } },
    );
}
for (const change of changes) {
  test(`${change}: existing conversation membership cannot authorize either new record`, async () => {
    const id = await create(
      change.startsWith('parent link')
        ? parentState.parent._id
        : state.user._id,
    );
    await changeAuthority(change);
    assert.equal((await send(id)).status, 403);
    await counts(0, 0);
  });
  test(`real replica-set race ${change} wins after initial F3 check: neither record commits`, async t => {
    const id = await create(
      change.startsWith('parent link')
        ? parentState.parent._id
        : state.user._id,
    );
    let enter!: () => void, resume!: () => void;
    const entered = new Promise<void>(resolve => {
      enter = resolve;
    });
    const released = new Promise<void>(resolve => {
      resume = resolve;
    });
    const original = Branch.collection.updateOne.bind(Branch.collection);
    let paused = false;
    t.mock.method(
      Branch.collection,
      'updateOne',
      async (...args: Parameters<typeof original>) => {
        if (!paused && args[2]?.session) {
          paused = true;
          enter();
          await released;
        }
        return original(...args);
      },
    );
    const pending = send(id);
    await entered;
    try {
      await changeAuthority(change);
    } finally {
      resume();
    }
    assert.equal((await pending).status, 403);
    await counts(0, 0);
    assert.equal((await ChatConversation.findById(id))!.lastSequence, 0);
  });
}
test('cross-Branch guessed targets and unsupported pairs/roles create neither record', async () => {
  const id = await create();
  assert.equal(
    (
      await send(
        id,
        'unsupported_operation_001',
        'No peer chat',
        parentState.token,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await apiHttp('/chat/conversations', state.token, {
        recipientUserId: String(parentState.parent._id),
      })
    ).status,
    403,
    'Student to Parent must be rejected',
  );
  // The shared Parent fixture enrolls the second Student in this Teacher's
  // class. Close that membership to create a genuinely out-of-scope target.
  await StudentEnrollment.collection.updateOne(
    { studentId: state.otherStudent._id },
    { $set: { status: 'closed', effectiveTo: new Date() } },
  );
  assert.equal(
    (
      await apiHttp('/chat/conversations', token, {
        recipientUserId: String(state.other._id),
      })
    ).status,
    403,
    'Teacher to Student without active enrollment must be rejected',
  );
  const foreign = await put(User, {
    role: 'student',
    isActive: true,
    branchId: state.foreign._id,
    fullName: 'Foreign',
  });
  assert.equal(
    (
      await apiHttp('/chat/conversations', token, {
        recipientUserId: String(foreign._id),
      })
    ).status,
    403,
    'Foreign Branch target must be rejected',
  );
  const principalToken = generateAccessToken(
    String(parentState.verifier._id),
    'principal',
  );
  await registerSession(
    String(parentState.verifier._id),
    principalToken,
    'principal',
  );
  assert.equal(
    (
      await apiHttp('/chat/conversations', principalToken, {
        recipientUserId: String(teacher._id),
      })
    ).status,
    403,
    'Principal chat must be rejected',
  );
  await counts(0, 0);
});
test('DTO exposes only approved fixed content and typed conversation target, no private message identity', async () => {
  const id = await create(),
    sent = await send(id);
  assert.equal(sent.status, 200);
  const notification = (await event(id))!;
  assert.equal(String(notification.sourceId), sent.json.data.messageId);
  assert.equal(notification.eventType, 'chat_message_created');
  const response = await apiHttp(
    `/notifications/${notification._id}`,
    state.token,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(
    Object.keys(response.json.data).sort(),
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
  assert.deepEqual(response.json.data, {
    notificationId: String(notification._id),
    category: 'communication',
    title: 'New message',
    body: 'Open Messages to view your conversation.',
    priority: 'normal',
    createdAt: notification.createdAt.toISOString(),
    availableAt: (await ChatMessage.findById(
      sent.json.data.messageId,
    ))!.createdAt.toISOString(),
    readAt: null,
    source: { type: 'chat_message', revision: 1 },
    deepLink: { type: 'chat_conversation', targetId: id },
  });
  assert.doesNotMatch(
    JSON.stringify(response.json),
    /Private|private@|senderUserId|recipientUserId|branchId|messageId|clientOperationId|assignmentId|enrollmentId|parentStudentLinkId|sessionId/,
  );
  assert.equal(
    (await apiHttp(`/notifications/${notification._id}`, token)).status,
    404,
  );
});
test('revocation after committed send retains generic notification but detail/history/read still deny chat', async () => {
  const id = await create(),
    sent = await send(id),
    notification = (await event(id))!;
  await changeAuthority('assignment revoked');
  assert.equal(
    (await apiHttp(`/notifications/${notification._id}`, state.token)).status,
    200,
  );
  assert.equal(
    (await apiHttp(`/chat/conversations/${id}`, state.token)).status,
    403,
  );
  assert.equal(
    (await apiHttp(`/chat/conversations/${id}/messages`, state.token)).status,
    403,
  );
  assert.equal(
    (
      await apiHttp(
        `/chat/conversations/${id}/messages/${sent.json.data.messageId}/read`,
        state.token,
        {},
      )
    ).status,
    403,
  );
  await counts(1, 1);
});
test('client recipient/Branch/notification metadata is rejected before any event production', async () => {
  const id = await create();
  for (const extra of [
    { branchId: String(state.foreign._id) },
    { recipientUserId: String(parentState.parent._id) },
    { notification: { title: 'Spoof' } },
    { sourceType: 'chat_message' },
    { deepLinkTargetId: id },
  ]) {
    assert.equal(
      (await send(id, 'spoof_operation_0001', 'No injection', token, extra))
        .status,
      400,
    );
  }
  await counts(0, 0);
});
test('historical message replay is not backfilled', async () => {
  const id = await create(),
    body = 'Retained old message',
    operationId = 'historical_operation_001';
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ conversationId: id, body }))
    .digest('hex');
  const old = await ChatMessage.create({
    conversationId: id,
    branchId: state.branch._id,
    senderUserId: teacher._id,
    recipientUserId: state.user._id,
    body,
    operationId,
    fingerprint,
    sequence: 1,
  });
  await ChatConversation.updateOne({ _id: id }, { $set: { lastSequence: 1 } });
  const response = await send(id, operationId, body);
  assert.equal(response.status, 200);
  assert.equal(response.json.data.messageId, String(old._id));
  await counts(1, 0);
});
test('read and all canonical GETs are zero-event; legacy Teacher reconciliation creates no chat event', async () => {
  const id = await create(),
    sent = await send(id),
    notification = (await event(id))!;
  const snapshot = async () =>
    JSON.stringify(await Notification.find().sort({ _id: 1 }).lean());
  const original = await snapshot();
  const paths = [
    `/chat/me/recipients`,
    '/chat/conversations',
    `/chat/conversations/${id}`,
    `/chat/conversations/${id}/messages`,
    '/notifications/me',
    `/notifications/${notification._id}`,
  ];
  for (const path of paths)
    assert.equal((await apiHttp(path, state.token)).status, 200);
  assert.equal(await snapshot(), original);
  assert.equal(
    (
      await apiHttp(
        `/chat/conversations/${id}/messages/${sent.json.data.messageId}/read`,
        state.token,
        {},
      )
    ).status,
    200,
  );
  assert.equal(await snapshot(), original);
  await SchoolNotice.create({
    branchId: state.branch._id,
    title: 'Published notice',
    message: 'Existing Teacher publication',
    status: 'published',
    audienceRoles: ['teacher'],
    publishedAt: new Date(),
    priority: 'normal',
    createdBy: parentState.verifier._id,
  });
  assert.equal((await apiHttp('/teacher/notifications', token)).status, 200);
  assert.equal(
    await Notification.countDocuments({ sourceType: 'school_notice' }),
    1,
  );
  assert.equal((await apiHttp('/teacher/notifications', token)).status, 200);
  assert.equal(
    await Notification.countDocuments({ sourceType: 'school_notice' }),
    1,
  );
  await counts(1, 1);
});

test('Branch transfer after delivery conceals the old Branch notification and chat without deleting either', async () => {
  const id = await create(),
    sent = await send(id),
    notification = (await event(id))!;
  await changeAuthority('Branch transfer');
  assert.equal(
    (await apiHttp(`/notifications/${notification._id}`, state.token)).status,
    404,
  );
  assert.equal(
    (await apiHttp(`/chat/conversations/${id}`, state.token)).status,
    404,
  );
  assert.equal(
    (
      await apiHttp(
        `/chat/conversations/${id}/messages/${sent.json.data.messageId}/read`,
        state.token,
        {},
      )
    ).status,
    404,
  );
  await counts(1, 1);
});

test('session-bound producer replays the canonical event and rejects conflicting stored fingerprint', async () => {
  const id = await create(),
    sent = await send(id);
  const authority = await authorizeChatRecipient(
    identity(),
    String(state.user._id),
  );
  const session = await mongoose.startSession();
  try {
    const replay = await session.withTransaction(() =>
      createChatMessageNotification(
        session,
        identity(),
        sent.json.data.messageId,
        authority,
      ),
    );
    assert.equal(String(replay!._id), String((await event(id))!._id));
    await Notification.collection.updateOne(
      { sourceId: new mongoose.Types.ObjectId(sent.json.data.messageId) },
      { $set: { fingerprint: 'conflicting-event' } },
    );
    await assert.rejects(
      session.withTransaction(() =>
        createChatMessageNotification(
          session,
          identity(),
          sent.json.data.messageId,
          authority,
        ),
      ),
      /reused for different content/,
    );
  } finally {
    await session.endSession();
  }
  await counts(1, 1);
});
test('producer rejects calls outside a transaction', async () => {
  const id = await create(),
    sent = await send(id);
  const authority = await authorizeChatRecipient(
    identity(),
    String(state.user._id),
  );
  const session = await mongoose.startSession();
  try {
    await assert.rejects(
      createChatMessageNotification(
        session,
        identity(),
        sent.json.data.messageId,
        authority,
      ),
      /authority is unavailable/,
    );
  } finally {
    await session.endSession();
  }
  await counts(1, 1);
});
