import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import {
  state,
  parentState,
  put,
  oid,
} from './helpers/parent-workspace.fixture';
import { apiHttp } from './helpers/student-workspace.fixture';
import User from '../src/models/user';
import Branch from '../src/models/branch';
import Session from '../src/models/session';
import Subject from '../src/models/subject';
import Section from '../src/models/section';
import TeacherAssignment from '../src/models/teacherAssignment';
import { StudentEnrollment } from '../src/models/studentEnrollment';
import { ParentStudentLink } from '../src/models/parentStudentLink';
import {
  ChatConversation,
  ChatMessage,
  ensureChatIndexes,
} from '../src/models/chat';
import { generateAccessToken } from '../src/services/jwt.service';
import { registerSession } from '../src/services/session.service';

let teacher: { user: Awaited<ReturnType<typeof put>>; token: string };
let assignment: InstanceType<typeof TeacherAssignment>;
before(ensureChatIndexes);
beforeEach(async () => {
  const user = await put(User, {
    fullName: 'Assigned Teacher',
    role: 'teacher',
    isActive: true,
    branchId: state.branch._id,
    email: 'private-teacher@test.invalid',
  });
  const token = generateAccessToken(String(user._id), 'teacher');
  await registerSession(String(user._id), token, 'teacher');
  teacher = { user, token };
  const subject = await put(Subject, {
    branchId: state.branch._id,
    name: 'Mathematics',
    isActive: true,
  });
  assignment = await TeacherAssignment.create({
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
});
const create = (recipient = state.user._id, token = teacher.token) =>
  apiHttp('/chat/conversations', token, { recipientUserId: String(recipient) });
async function conversation(recipient = state.user._id, token = teacher.token) {
  const response = await create(recipient, token);
  assert.equal(response.status, 200, JSON.stringify(response));
  return response.json.data.conversationId as string;
}
const send = (
  id: string,
  token = teacher.token,
  operation = 'chat_send_operation_0001',
  body = 'School question',
) =>
  apiHttp(`/chat/conversations/${id}/messages`, token, {
    body,
    clientOperationId: operation,
  });
const history = (id: string, query = '', token = teacher.token) =>
  apiHttp(`/chat/conversations/${id}/messages${query}`, token);
const read = (id: string, messageId: string, token = state.token) =>
  apiHttp(`/chat/conversations/${id}/messages/${messageId}/read`, token, {});

test('all four F3 edges can create and send with safe runtime DTO keys', async () => {
  let edge = 0;
  for (const [token, recipient] of [
    [teacher.token, state.user._id],
    [state.token, teacher.user._id],
    [teacher.token, parentState.parent._id],
    [parentState.token, teacher.user._id],
  ]) {
    const created = await create(recipient, token);
    assert.equal(created.status, 200);
    const data = created.json.data;
    assert.deepEqual(
      Object.keys(data).sort(),
      [
        'conversationId',
        'otherParticipant',
        'createdAt',
        'updatedAt',
        'unread',
      ].sort(),
    );
    assert.deepEqual(
      Object.keys(data.otherParticipant).sort(),
      ['userId', 'displayName', 'role', 'relationshipType'].sort(),
    );
    const response = await send(
      data.conversationId,
      token,
      `edge_operation_00000${edge++}`,
    );
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.deepEqual(
      Object.keys(response.json.data).sort(),
      [
        'messageId',
        'conversationId',
        'senderUserId',
        'body',
        'sequence',
        'createdAt',
        'ownReadAt',
      ].sort(),
    );
    assert.doesNotMatch(
      JSON.stringify(response.json),
      /fingerprint|operationId|enrollmentId|assignmentId|parentStudentLinkId|branchId|email|password|verifiedBy/,
    );
  }
  assert.equal(await ChatConversation.countDocuments(), 2);
  assert.equal(await ChatMessage.countDocuments(), 4);
});

test('concurrent opposite-order pair creation converges on one indexed conversation', async () => {
  const responses = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      i % 2 ? create(teacher.user._id, state.token) : create(),
    ),
  );
  responses.forEach(response =>
    assert.equal(response.status, 200, JSON.stringify(response)),
  );
  assert.equal(
    new Set(responses.map(response => response.json.data.conversationId)).size,
    1,
  );
  assert.equal(await ChatConversation.countDocuments(), 1);
  const row = await ChatConversation.findOne();
  assert.ok(String(row!.participantLow) < String(row!.participantHigh));
  await assert.rejects(
    () =>
      ChatConversation.collection.insertOne({ ...row!.toObject(), _id: oid() }),
    error => (error as { code: number }).code === 11000,
  );
});

test('concurrent duplicate sends and later retry produce one logical message and sequence', async () => {
  const id = await conversation();
  const responses = await Promise.all(
    Array.from({ length: 8 }, () => send(id)),
  );
  responses.forEach(response =>
    assert.equal(response.status, 200, JSON.stringify(response)),
  );
  responses.forEach(response =>
    assert.deepEqual(response.json.data, responses[0].json.data),
  );
  assert.deepEqual((await send(id)).json.data, responses[0].json.data);
  assert.equal(await ChatMessage.countDocuments(), 1);
  assert.equal((await ChatConversation.findById(id))!.lastSequence, 1);
});

test('conflicting operation content or conversation returns 409 without another message', async () => {
  const id = await conversation(),
    other = await conversation(parentState.parent._id);
  const responses = await Promise.all([
    send(id, teacher.token, 'same_operation_123456', 'First'),
    send(id, teacher.token, 'same_operation_123456', 'Different'),
  ]);
  assert.deepEqual(
    responses.map(response => response.status).sort(),
    [200, 409],
  );
  assert.equal(
    (await send(other, teacher.token, 'same_operation_123456', 'First')).status,
    409,
  );
  assert.equal(await ChatMessage.countDocuments(), 1);
  assert.equal((await ChatConversation.findById(other))!.lastSequence, 0);
});

test('different concurrent operations have unique ordered server sequences', async () => {
  const id = await conversation();
  const responses = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      send(id, teacher.token, `different_operation_${i}`, `Message ${i}`),
    ),
  );
  responses.forEach(response => assert.equal(response.status, 200));
  assert.deepEqual(
    responses.map(response => response.json.data.sequence).sort(),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    (await history(id)).json.data.items.map(
      (row: { sequence: number }) => row.sequence,
    ),
    [5, 4, 3, 2, 1],
  );
});

test('unrelated, foreign, unsupported and self recipients cannot create conversations', async () => {
  const unrelated = await put(User, {
    fullName: 'Unrelated Teacher',
    role: 'teacher',
    branchId: state.branch._id,
    isActive: true,
  });
  const foreign = await put(User, {
    fullName: 'Foreign Student',
    role: 'student',
    branchId: state.foreign._id,
    isActive: true,
  });
  for (const [recipient, token] of [
    [unrelated._id, state.token],
    [foreign._id, teacher.token],
    [state.other._id, state.token],
    [parentState.otherParent._id, parentState.token],
    [teacher.user._id, teacher.token],
    [oid(), teacher.token],
  ])
    assert.equal((await create(recipient, token)).status, 403);
  assert.equal(await ChatConversation.countDocuments(), 0);
});

test('foreign users and guessed IDs cannot access conversation, history, send or read', async () => {
  const id = await conversation(),
    message = (await send(id)).json.data;
  for (const token of [parentState.token, parentState.otherToken]) {
    assert.equal(
      (await apiHttp('/chat/conversations/' + id, token)).status,
      404,
    );
    assert.equal((await history(id, '', token)).status, 404);
    assert.equal((await send(id, token)).status, 404);
    assert.equal((await read(id, message.messageId, token)).status, 404);
  }
  assert.equal((await history(String(oid()))).status, 404);
});

for (const change of [
  'assignment revoked',
  'assignment expired',
  'parent link revoked',
  'parent link unverified',
  'enrollment closed',
  'enrollment transferred',
] as const) {
  test(`permanent history policy: ${change} conceals access, retains records, and restores without duplicates`, async () => {
    const guardian = change.startsWith('parent link');
    const recipient = guardian ? parentState.parent._id : state.user._id;
    const recipientToken = guardian ? parentState.token : state.token;
    const id = await conversation(recipient);
    const first = await send(id);
    assert.equal(first.status, 200);
    const messageId = first.json.data.messageId as string;
    const conversationFilter = { _id: new mongoose.Types.ObjectId(id) };
    const messageFilter = { _id: new mongoose.Types.ObjectId(messageId) };
    const storedConversation = await ChatConversation.collection.findOne(
      conversationFilter,
    );
    const storedMessage = await ChatMessage.collection.findOne(messageFilter);
    for (const token of [teacher.token, recipientToken]) {
      assert.equal((await history(id, '', token)).status, 200);
      assert.equal(
        (await apiHttp('/chat/conversations/' + id, token)).status,
        200,
      );
    }
    let transferredId: mongoose.Types.ObjectId | null = null;
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
            status:
              change === 'enrollment closed' ? 'withdrawn' : 'transferred',
            effectiveTo: new Date(),
          },
        },
      );
    if (change === 'enrollment transferred') {
      const section = await put(Section, {
        branchId: state.branch._id,
        classId: state.cls._id,
        name: 'B',
        isActive: true,
      });
      const moved = await StudentEnrollment.create({
        studentId: state.student._id,
        branchId: state.branch._id,
        academicPeriodId: state.period._id,
        classId: state.cls._id,
        sectionId: section._id,
        status: 'active',
        effectiveFrom: new Date(),
        previousEnrollmentId: state.enrollment._id,
        reason: 'Transfer to another Section',
        createdBy: parentState.verifier._id,
        updatedBy: parentState.verifier._id,
      });
      transferredId = moved._id;
    }
    if (change === 'parent link revoked')
      await ParentStudentLink.collection.updateOne(
        { _id: parentState.link._id },
        { $set: { status: 'revoked', isActive: false, revokedAt: new Date() } },
      );
    if (change === 'parent link unverified')
      await ParentStudentLink.collection.updateOne(
        { _id: parentState.link._id },
        { $set: { status: 'pending' } },
      );
    assert.equal(
      (await send(id, teacher.token, 'new_operation_1234567')).status,
      403,
    );
    assert.equal((await send(id)).status, 403); // Replay is not an authority bypass.
    assert.equal((await create(recipient)).status, 403);
    for (const token of [teacher.token, recipientToken]) {
      assert.equal((await history(id, '', token)).status, 403);
      assert.equal(
        (await apiHttp('/chat/conversations/' + id, token)).status,
        403,
      );
      assert.equal((await read(id, messageId, token)).status, 403);
      assert.equal(
        (await send(id, token, 'blocked_operation_12345')).status,
        403,
      );
      assert.equal(
        (await apiHttp('/chat/conversations', token)).json.data.total,
        0,
      );
    }
    assert.equal(await ChatMessage.countDocuments(), 1);
    assert.equal((await ChatMessage.findOne())!.body, 'School question');
    assert.equal(await ChatConversation.countDocuments(), 1);
    assert.deepEqual(
      await ChatConversation.collection.findOne(conversationFilter),
      storedConversation,
    );
    assert.deepEqual(
      await ChatMessage.collection.findOne(messageFilter),
      storedMessage,
    );

    // Restore current authority through canonical records, without reviving an
    // obsolete assignment/enrollment or replacing any chat record.
    if (change.startsWith('assignment')) {
      await TeacherAssignment.collection.updateOne(
        { _id: assignment._id },
        { $set: { isActive: false, revokedAt: new Date() } },
      );
      await TeacherAssignment.create({
        teacherId: teacher.user._id,
        branchId: state.branch._id,
        classId: state.cls._id,
        sectionId: state.section._id,
        subjectId: assignment.subjectId,
        validFrom: new Date(),
        isActive: true,
        createdBy: parentState.verifier._id,
        updatedBy: parentState.verifier._id,
      });
    }
    if (guardian) {
      await ParentStudentLink.collection.updateOne(
        { _id: parentState.link._id },
        {
          $set: {
            status: 'verified',
            isActive: true,
            verifiedBy: parentState.verifier._id,
            verifiedAt: new Date(),
          },
          $unset: { revokedAt: 1, revokedBy: 1 },
        },
      );
    }
    if (change.startsWith('enrollment')) {
      if (transferredId)
        await StudentEnrollment.collection.updateOne(
          { _id: transferredId },
          { $set: { status: 'transferred', effectiveTo: new Date() } },
        );
      await StudentEnrollment.create({
        studentId: state.student._id,
        branchId: state.branch._id,
        academicPeriodId: state.period._id,
        classId: state.cls._id,
        sectionId: state.section._id,
        status: 'active',
        effectiveFrom: new Date(),
        previousEnrollmentId: transferredId ?? state.enrollment._id,
        reason: 'Restore current enrollment in assigned Section',
        createdBy: parentState.verifier._id,
        updatedBy: parentState.verifier._id,
      });
    }
    const reused = await create(recipient),
      reversed = await create(teacher.user._id, recipientToken);
    assert.equal(reused.status, 200);
    assert.equal(reused.json.data.conversationId, id);
    assert.equal(reversed.status, 200);
    assert.equal(reversed.json.data.conversationId, id);
    for (const token of [teacher.token, recipientToken]) {
      const restored = await history(id, '', token);
      assert.equal(restored.status, 200);
      assert.equal(restored.json.data.items[0].messageId, messageId);
      assert.equal(
        (await apiHttp('/chat/conversations/' + id, token)).status,
        200,
      );
    }
    const replay = await send(id);
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.json.data, first.json.data);
    assert.equal(await ChatConversation.countDocuments(), 1);
    assert.equal(await ChatMessage.countDocuments(), 1);
    assert.deepEqual(
      await ChatConversation.collection.findOne(conversationFilter),
      storedConversation,
    );
    assert.deepEqual(
      await ChatMessage.collection.findOne(messageFilter),
      storedMessage,
    );
    assert.equal((await read(id, messageId, recipientToken)).status, 200);
    assert.equal(await ChatMessage.countDocuments(), 1);
  });
}

test('Branch transfer conceals history even if both participants move to the other Branch', async () => {
  const id = await conversation();
  const first = await send(id);
  const messageId = first.json.data.messageId as string;
  const storedConversation = await ChatConversation.collection.findOne({
    _id: new mongoose.Types.ObjectId(id),
  });
  const storedMessage = await ChatMessage.collection.findOne({
    _id: new mongoose.Types.ObjectId(messageId),
  });
  await User.collection.updateMany(
    { _id: { $in: [teacher.user._id, state.user._id] } },
    { $set: { branchId: state.foreign._id } },
  );
  assert.equal((await history(id)).status, 404);
  assert.equal((await history(id, '', state.token)).status, 404);
  for (const token of [teacher.token, state.token]) {
    assert.equal(
      (await apiHttp('/chat/conversations/' + id, token)).status,
      404,
    );
    assert.equal((await read(id, messageId, token)).status, 404);
    assert.equal((await send(id, token)).status, 404);
    assert.equal(
      (await apiHttp('/chat/conversations', token)).json.data.total,
      0,
    );
  }
  assert.equal(
    (await apiHttp('/chat/conversations', teacher.token)).json.data.total,
    0,
  );
  assert.equal(await ChatMessage.countDocuments(), 1);
  assert.equal(await ChatConversation.countDocuments(), 1);
  assert.deepEqual(
    await ChatConversation.collection.findOne({
      _id: new mongoose.Types.ObjectId(id),
    }),
    storedConversation,
  );
  assert.deepEqual(
    await ChatMessage.collection.findOne({
      _id: new mongoose.Types.ObjectId(messageId),
    }),
    storedMessage,
  );
  await User.collection.updateMany(
    { _id: { $in: [teacher.user._id, state.user._id] } },
    { $set: { branchId: state.branch._id } },
  );
  assert.equal((await create()).json.data.conversationId, id);
  const replay = await send(id);
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.json.data, first.json.data);
  assert.equal((await history(id)).status, 200);
  assert.equal(await ChatConversation.countDocuments(), 1);
  assert.equal(await ChatMessage.countDocuments(), 1);
});

// These barriers pause AFTER the real initial F3 check and BEFORE the first
// transaction fence. The revocation is a real committed write on the replica set.
for (const change of [
  'assignment',
  'enrollment',
  'parent link',
  'recipient',
  'session',
  'Branch',
] as const) {
  test(`real revoke-wins race: ${change} changed after initial authority commits zero messages`, async t => {
    const id = await conversation(
      change === 'parent link' ? parentState.parent._id : state.user._id,
    );
    let entered!: () => void, resume!: () => void;
    const paused = new Promise<void>(resolve => {
        entered = resolve;
      }),
      released = new Promise<void>(resolve => {
        resume = resolve;
      });
    const original = Branch.collection.updateOne.bind(Branch.collection);
    let stopped = false;
    t.mock.method(
      Branch.collection,
      'updateOne',
      async (...args: Parameters<typeof original>) => {
        if (!stopped && args[2]?.session) {
          stopped = true;
          entered();
          await released;
        }
        return original(...args);
      },
    );
    const pending = send(id);
    await paused;
    try {
      if (change === 'assignment')
        await TeacherAssignment.collection.updateOne(
          { _id: assignment._id },
          { $set: { isActive: false, revokedAt: new Date() } },
        );
      if (change === 'enrollment')
        await StudentEnrollment.collection.updateOne(
          { _id: state.enrollment._id },
          { $set: { status: 'transferred', effectiveTo: new Date() } },
        );
      if (change === 'parent link')
        await ParentStudentLink.collection.updateOne(
          { _id: parentState.link._id },
          {
            $set: { isActive: false, status: 'revoked', revokedAt: new Date() },
          },
        );
      if (change === 'recipient')
        await User.collection.updateOne(
          { _id: state.user._id },
          { $set: { isActive: false } },
        );
      if (change === 'session')
        await Session.collection.updateOne(
          { token: teacher.token },
          { $set: { isRevoked: true } },
        );
      if (change === 'Branch')
        await Branch.collection.updateOne(
          { _id: state.branch._id },
          { $set: { isActive: false } },
        );
    } finally {
      resume();
    }
    const response = await pending;
    assert.equal(
      response.status,
      change === 'session' ? 401 : change === 'Branch' ? 404 : 403,
      JSON.stringify(response),
    );
    assert.equal(await ChatMessage.countDocuments(), 0);
    assert.equal((await ChatConversation.findById(id))!.lastSequence, 0);
  });
}

test('real overlapping revocation conflicts with acquired assignment fence and commits after the send', async t => {
  const id = await conversation();
  let entered!: () => void, resume!: () => void;
  const paused = new Promise<void>(resolve => {
      entered = resolve;
    }),
    released = new Promise<void>(resolve => {
      resume = resolve;
    });
  const original = ChatMessage.create.bind(ChatMessage);
  t.mock.method(ChatMessage, 'create', async (...args: unknown[]) => {
    entered();
    await released;
    return Reflect.apply(original, ChatMessage, args);
  });
  const pending = send(id);
  await paused;
  let revoked = false;
  const revocation = TeacherAssignment.collection
    .updateOne(
      { _id: assignment._id },
      { $set: { isActive: false, revokedAt: new Date() } },
    )
    .then(value => {
      revoked = true;
      return value;
    });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(revoked, false); // A revocation cannot commit through the held fence.
  resume();
  assert.equal((await pending).status, 200);
  await revocation;
  assert.equal(await ChatMessage.countDocuments(), 1);
  assert.equal(
    (await send(id, teacher.token, 'after_revocation_12345')).status,
    403,
  );
});

test('assignment expiry after message insertion rolls back both message and sequence', async t => {
  const id = await conversation(),
    expires = Date.now() + 1500;
  await TeacherAssignment.collection.updateOne(
    { _id: assignment._id },
    { $set: { validUntil: new Date(expires) } },
  );
  const original = ChatMessage.create.bind(ChatMessage);
  t.mock.method(ChatMessage, 'create', async (...args: unknown[]) => {
    const rows = await Reflect.apply(original, ChatMessage, args);
    await new Promise(resolve =>
      setTimeout(resolve, Math.max(0, expires - Date.now() + 50)),
    );
    return rows;
  });
  assert.equal((await send(id)).status, 403);
  assert.equal(await ChatMessage.countDocuments(), 0);
  assert.equal((await ChatConversation.findById(id))!.lastSequence, 0);
});

test('message insert failure rolls back the server sequence and retry succeeds', async t => {
  const id = await conversation();
  const stub = t.mock.method(ChatMessage, 'create', async () => {
    throw new Error('isolated database failure');
  });
  const response = await send(id);
  assert.equal(response.status, 500);
  assert.doesNotMatch(
    JSON.stringify(response.json),
    /isolated database failure/,
  );
  assert.equal((await ChatConversation.findById(id))!.lastSequence, 0);
  assert.equal(await ChatMessage.countDocuments(), 0);
  stub.mock.restore();
  assert.equal((await send(id)).json.data.sequence, 1);
});

test('bounded deterministic history is stable across new arrivals and does not accept client sequence/time', async () => {
  const id = await conversation(),
    at = new Date();
  await ChatMessage.insertMany(
    Array.from({ length: 105 }, (_, i) => ({
      conversationId: id,
      branchId: state.branch._id,
      senderUserId: teacher.user._id,
      recipientUserId: state.user._id,
      body: `Message ${i + 1}`,
      sequence: i + 1,
      operationId: `fixture_operation_${i + 1}`,
      fingerprint: 'fixture',
      createdAt: at,
    })),
  );
  await ChatConversation.updateOne(
    { _id: id },
    { $set: { lastSequence: 105 } },
  );
  const first = await history(id),
    repeat = await history(id),
    max = await history(id, '?limit=100');
  assert.equal(first.json.data.items.length, 50);
  assert.equal(max.json.data.items.length, 100);
  assert.deepEqual(first, repeat);
  assert.equal(first.json.data.nextBeforeSequence, 56);
  assert.equal(
    (await send(id, teacher.token, 'arrival_operation_12345')).json.data
      .sequence,
    106,
  );
  const second = await history(id, '?beforeSequence=56'),
    last = await history(id, '?beforeSequence=6');
  const sequences = [
    ...first.json.data.items,
    ...second.json.data.items,
    ...last.json.data.items,
  ].map((row: { sequence: number }) => row.sequence);
  assert.deepEqual(
    sequences,
    Array.from({ length: 105 }, (_, i) => 105 - i),
  );
  assert.equal(last.json.data.nextBeforeSequence, null);
  assert.equal(
    (
      await apiHttp(`/chat/conversations/${id}/messages`, teacher.token, {
        body: 'Text',
        clientOperationId: 'spoof_operation_12345',
        sequence: 1,
        createdAt: at.toISOString(),
      })
    ).status,
    400,
  );
});

test('read state is recipient-owned, idempotent and independent from notifications', async () => {
  const id = await conversation(),
    message = (await send(id)).json.data;
  assert.equal(
    (await apiHttp('/chat/conversations/' + id, state.token)).json.data.unread,
    1,
  );
  assert.equal((await read(id, message.messageId, teacher.token)).status, 404);
  const marked = await read(id, message.messageId),
    replay = await read(id, message.messageId);
  assert.equal(marked.status, 200);
  assert.ok(marked.json.data.ownReadAt);
  assert.deepEqual(marked, replay);
  const concurrent = await Promise.all(
    Array.from({ length: 3 }, () => read(id, message.messageId)),
  );
  concurrent.forEach(response => assert.deepEqual(response, marked));
  assert.equal(
    (await apiHttp('/chat/conversations/' + id, state.token)).json.data.unread,
    0,
  );
  assert.equal(
    (await history(id, '', teacher.token)).json.data.items[0].ownReadAt,
    null,
  );
  assert.equal((await read(id, String(oid()))).status, 404);
});

test('conversation listing pages only authorized own conversations and rejects scope overrides', async () => {
  const firstId = await conversation(),
    secondId = await conversation(parentState.parent._id);
  const first = await apiHttp('/chat/conversations?limit=1', teacher.token);
  const second = await apiHttp(
    '/chat/conversations?limit=1&offset=1',
    teacher.token,
  );
  assert.equal(first.status, 200);
  assert.equal(first.json.data.total, 2);
  assert.equal(first.json.data.nextOffset, 1);
  assert.equal(second.json.data.nextOffset, null);
  assert.deepEqual(
    [
      first.json.data.items[0].conversationId,
      second.json.data.items[0].conversationId,
    ].sort(),
    [firstId, secondId].sort(),
  );
  assert.deepEqual(
    await apiHttp('/chat/conversations?limit=1', teacher.token),
    first,
  );
  for (const query of [
    'branchId=x',
    'offset=-1',
    'limit=101',
    'offset=1&offset=2',
  ])
    assert.equal(
      (await apiHttp('/chat/conversations?' + query, teacher.token)).status,
      400,
    );
  assert.equal(
    (await apiHttp('/chat/conversations', parentState.otherToken)).json.data
      .total,
    0,
  );
});

for (const query of [
  'branchId=x',
  'senderUserId=x',
  'limit=0',
  'limit=101',
  'limit=1&limit=2',
  'beforeSequence=0',
  'beforeSequence=-1',
  'beforeSequence=1.5',
  'beforeSequence=1e2',
  'beforeSequence=9007199254740992',
  'beforeSequence=1&beforeSequence=2',
]) {
  test(`history rejects malformed query or authority override: ${query}`, async () => {
    const id = await conversation();
    assert.equal((await history(id, '?' + query)).status, 400);
  });
}

test('validation rejects malformed IDs, empty/oversized messages and invalid operations without persistence', async () => {
  const id = await conversation();
  for (const body of ['', '   ', 'x'.repeat(4001)])
    assert.equal(
      (await send(id, teacher.token, 'valid_operation_12345', body)).status,
      400,
    );
  assert.equal((await send(id, teacher.token, 'short')).status, 400);
  assert.equal(
    (await send(id, teacher.token, 'invalid operation 1234')).status,
    400,
  );
  assert.equal((await history('bad-id')).status, 400);
  assert.equal(
    (
      await apiHttp('/chat/conversations', teacher.token, {
        recipientUserId: String(state.user._id),
        branchId: String(state.foreign._id),
      })
    ).status,
    400,
  );
  assert.equal(await ChatMessage.countDocuments(), 0);
});

test('revoked/missing Session, inactive User and unsupported roles do not gain chat persistence', async () => {
  const id = await conversation();
  assert.equal((await send(id, '')).status, 401);
  await Session.updateOne(
    { token: teacher.token },
    { $set: { isRevoked: true } },
  );
  assert.equal((await send(id)).status, 401);
  await Session.deleteOne({ token: teacher.token });
  assert.equal((await history(id)).status, 401);
  await User.collection.updateOne(
    { _id: state.user._id },
    { $set: { isActive: false } },
  );
  assert.equal((await history(id, '', state.token)).status, 401);
  assert.equal(await ChatMessage.countDocuments(), 0);
  for (const role of ['finance', 'principal', 'super_admin'] as const) {
    const actor = await put(User, {
      fullName: role,
      role,
      isActive: true,
      branchId: state.branch._id,
    });
    const token = generateAccessToken(String(actor._id), role);
    await registerSession(String(actor._id), token, role);
    assert.equal((await create(state.user._id, token)).status, 403);
    assert.equal((await history(id, '', token)).status, 403);
    assert.equal((await apiHttp('/chat/conversations', token)).status, 403);
  }
});

test('ordinary conversation/history GETs cause zero chat/domain/notification/session writes', async () => {
  const id = await conversation();
  await send(id);
  const snapshot = async () => {
    const result: Record<string, unknown> = {};
    for (const collection of (await mongoose.connection.db!.collections()).sort(
      (a, b) => a.collectionName.localeCompare(b.collectionName),
    ))
      result[collection.collectionName] = await collection
        .find()
        .sort({ _id: 1 })
        .toArray();
    return JSON.stringify(result);
  };
  const original = await snapshot();
  for (const token of [teacher.token, state.token]) {
    assert.equal((await apiHttp('/chat/conversations', token)).status, 200);
    assert.equal(
      (await apiHttp('/chat/conversations/' + id, token)).status,
      200,
    );
    assert.equal((await history(id, '', token)).status, 200);
  }
  assert.equal(await snapshot(), original);
  assert.equal(
    (await apiHttp(`/chat/conversations/${id}/delete`, teacher.token, {}))
      .status,
    403,
  );
});
