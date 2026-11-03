import { createHash } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import { ChatConversation, ChatMessage } from '../models/chat';
import {
  currentAcademicActor,
  requireActiveAcademicBranch,
} from './teacher-scope.service';
import { authorizeChatRecipient } from './chat-authority.service';
import { withChatWriteAuthority } from './chat-write-authority.service';
import type { JwtPayload } from './jwt.service';
import {
  objectBody,
  objectIdField,
  textField,
  RequestContractError,
} from '../utils/request-validation';

type Conversation = NonNullable<
  Awaited<ReturnType<typeof ChatConversation.findOne>>
>;
type Message = NonNullable<Awaited<ReturnType<typeof ChatMessage.findOne>>>;
type Recipient = Awaited<
  ReturnType<typeof authorizeChatRecipient>
>['recipient'];
const missing = () =>
  new RequestContractError(404, 'Conversation or message is unavailable');
const conflict = () =>
  new RequestContractError(
    409,
    'Operation ID was reused for different message content',
  );
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pair = (a: string, b: string) => {
  const [participantLow, participantHigh] = [a, b].sort();
  return { participantLow, participantHigh };
};
async function actorContext(identity: JwtPayload | undefined) {
  const actor = await currentAcademicActor(identity);
  if (!['teacher', 'student', 'parent'].includes(actor.role))
    throw new RequestContractError(403, 'Chat is unavailable for this role');
  const branchId = await requireActiveAcademicBranch(
    actor.branchId?.toString(),
  );
  return { actor, branchId };
}
async function ownedConversation(
  identity: JwtPayload | undefined,
  id: unknown,
) {
  const ctx = await actorContext(identity);
  const row = await ChatConversation.findOne({
    _id: objectIdField(id, 'conversation ID'),
    branchId: ctx.branchId,
    $or: [
      { participantLow: ctx.actor._id },
      { participantHigh: ctx.actor._id },
    ],
  }).read('primary');
  if (!row) throw missing();
  const otherId =
    String(row.participantLow) === String(ctx.actor._id)
      ? String(row.participantHigh)
      : String(row.participantLow);
  return { ...ctx, row, otherId };
}
async function conversationDTO(
  row: Conversation,
  recipient: Recipient,
  viewer: string,
  session?: ClientSession,
) {
  const unread = await ChatMessage.countDocuments({
    conversationId: row._id,
    branchId: row.branchId,
    recipientUserId: viewer,
    readAt: null,
  })
    .session(session ?? null)
    .read('primary');
  return {
    conversationId: String(row._id),
    otherParticipant: recipient,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    unread,
  };
}
const messageDTO = (row: Message, viewer: string) => ({
  messageId: String(row._id),
  conversationId: String(row.conversationId),
  senderUserId: String(row.senderUserId),
  body: row.body,
  sequence: row.sequence,
  createdAt: row.createdAt.toISOString(),
  ownReadAt:
    String(row.recipientUserId) === viewer
      ? row.readAt?.toISOString() ?? null
      : null,
});

// Permanent policy: active chat and historical access require current F3 authority.
// Revoked/expired/unverified/closed/transferred relationships conceal, never delete.
// Branch transfer conceals old-Branch conversations; membership is never authority.
async function historyAuthority(
  identity: JwtPayload | undefined,
  otherId: string,
) {
  return authorizeChatRecipient(identity, otherId);
}

export async function createChatConversation(
  identity: JwtPayload | undefined,
  token: string,
  body: unknown,
) {
  const input = objectBody(body, ['recipientUserId']);
  // Preserve F3's fail-closed empty write attempt; an explicit target is required.
  if (input.recipientUserId === undefined)
    throw new RequestContractError(403, 'Chat recipient is required');
  const recipientId = objectIdField(input.recipientUserId, 'recipient ID');
  return withChatWriteAuthority(
    identity,
    token,
    recipientId,
    async (session, authority) => {
      const key = {
        branchId: authority.branchId,
        ...pair(authority.senderUserId, recipientId),
      };
      let row = await ChatConversation.findOne(key).session(session);
      if (!row) [row] = await ChatConversation.create([key], { session });
      return conversationDTO(
        row!,
        authority.recipient,
        authority.senderUserId,
        session,
      );
    },
  );
}

export async function getChatConversation(
  identity: JwtPayload | undefined,
  id: unknown,
) {
  const ctx = await ownedConversation(identity, id);
  const authority = await historyAuthority(identity, ctx.otherId);
  if (authority.branchId !== ctx.branchId) throw missing();
  return conversationDTO(ctx.row, authority.recipient, String(ctx.actor._id));
}

function integer(value: unknown, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback;
  if (
    typeof value !== 'string' ||
    !/^(0|[1-9]\d*)$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < min ||
    Number(value) > max
  )
    throw new RequestContractError(400, 'Invalid chat pagination');
  return Number(value);
}
export async function listChatConversations(
  identity: JwtPayload | undefined,
  query: unknown,
) {
  const input = objectBody(query, ['offset', 'limit']);
  const offset = integer(input.offset, 0, 0, 1000),
    limit = integer(input.limit, 25, 1, 100);
  const ctx = await actorContext(identity);
  const rows = await ChatConversation.find({
    branchId: ctx.branchId,
    $or: [
      { participantLow: ctx.actor._id },
      { participantHigh: ctx.actor._id },
    ],
  })
    .sort({ updatedAt: -1, _id: -1 })
    .limit(1001)
    .read('primary');
  if (rows.length > 1000)
    throw new RequestContractError(
      409,
      'Conversation scope requires administrator review',
    );
  const allowed = [];
  for (const row of rows) {
    const otherId =
      String(row.participantLow) === String(ctx.actor._id)
        ? String(row.participantHigh)
        : String(row.participantLow);
    try {
      const authority = await historyAuthority(identity, otherId);
      if (authority.branchId === ctx.branchId)
        allowed.push(
          await conversationDTO(
            row,
            authority.recipient,
            String(ctx.actor._id),
          ),
        );
    } catch (error) {
      if (!(error instanceof RequestContractError && error.status === 403))
        throw error;
    }
  }
  const items = allowed.slice(offset, offset + limit),
    next = offset + items.length;
  return {
    items,
    total: allowed.length,
    offset,
    limit,
    nextOffset: next < allowed.length ? next : null,
  };
}

export async function sendChatMessage(
  identity: JwtPayload | undefined,
  token: string,
  id: unknown,
  body: unknown,
) {
  const input = objectBody(body, ['body', 'clientOperationId']);
  const text = textField(input.body, 'message', 4000, 1),
    operationId = textField(input.clientOperationId, 'operation ID', 80, 16);
  if (!/^[A-Za-z0-9_-]+$/.test(operationId))
    throw new RequestContractError(400, 'Invalid operation ID');
  const ctx = await ownedConversation(identity, id);
  const fingerprint = hash({ conversationId: String(ctx.row._id), body: text });
  return withChatWriteAuthority(
    identity,
    token,
    ctx.otherId,
    async (session, authority) => {
      if (authority.branchId !== ctx.branchId) throw missing();
      const conversation = await ChatConversation.findOne({
        _id: ctx.row._id,
        branchId: authority.branchId,
        ...pair(authority.senderUserId, ctx.otherId),
      }).session(session);
      if (!conversation) throw missing();
      const prior = await ChatMessage.findOne({
        senderUserId: ctx.actor._id,
        operationId,
      })
        .select('+fingerprint')
        .session(session);
      if (prior) {
        if (
          String(prior.conversationId) !== String(conversation._id) ||
          prior.fingerprint !== fingerprint
        )
          throw conflict();
        return messageDTO(prior, authority.senderUserId);
      }
      const advanced = await ChatConversation.findOneAndUpdate(
        {
          _id: conversation._id,
          lastSequence: { $lt: Number.MAX_SAFE_INTEGER },
        },
        { $inc: { lastSequence: 1 } },
        { session, returnDocument: 'after', runValidators: true },
      );
      if (!advanced)
        throw new RequestContractError(
          409,
          'Conversation sequence is unavailable',
        );
      const [message] = await ChatMessage.create(
        [
          {
            conversationId: conversation._id,
            branchId: authority.branchId,
            senderUserId: authority.senderUserId,
            recipientUserId: ctx.otherId,
            body: text,
            sequence: advanced.lastSequence,
            operationId,
            fingerprint,
          },
        ],
        { session },
      );
      return messageDTO(message!, authority.senderUserId);
    },
  );
}

export async function chatMessageHistory(
  identity: JwtPayload | undefined,
  id: unknown,
  query: unknown,
) {
  const input = objectBody(query, ['beforeSequence', 'limit']);
  const limit = integer(input.limit, 50, 1, 100),
    before =
      input.beforeSequence === undefined
        ? undefined
        : integer(input.beforeSequence, 0, 1, Number.MAX_SAFE_INTEGER);
  const ctx = await ownedConversation(identity, id);
  const authority = await historyAuthority(identity, ctx.otherId);
  if (authority.branchId !== ctx.branchId) throw missing();
  const rows = await ChatMessage.find({
    conversationId: ctx.row._id,
    branchId: ctx.branchId,
    ...(before === undefined ? {} : { sequence: { $lt: before } }),
  })
    .sort({ sequence: -1, _id: -1 })
    .limit(limit + 1)
    .read('primary');
  const items = rows
    .slice(0, limit)
    .map(row => messageDTO(row, String(ctx.actor._id)));
  return {
    items,
    limit,
    nextBeforeSequence:
      rows.length > limit ? items[items.length - 1]!.sequence : null,
  };
}

export async function markChatMessageRead(
  identity: JwtPayload | undefined,
  token: string,
  id: unknown,
  messageId: unknown,
  body: unknown,
) {
  objectBody(body, []);
  const target = objectIdField(messageId, 'message ID'),
    ctx = await ownedConversation(identity, id);
  return withChatWriteAuthority(
    identity,
    token,
    ctx.otherId,
    async (session, authority) => {
      if (authority.branchId !== ctx.branchId) throw missing();
      const filter = {
        _id: target,
        conversationId: ctx.row._id,
        branchId: ctx.branchId,
        recipientUserId: ctx.actor._id,
      };
      let row = await ChatMessage.findOne(filter).session(session);
      if (!row) throw missing();
      if (!row.readAt)
        row =
          (await ChatMessage.findOneAndUpdate(
            { ...filter, readAt: null },
            { $set: { readAt: new Date() } },
            { session, returnDocument: 'after' },
          )) ?? (await ChatMessage.findOne(filter).session(session));
      if (!row) throw missing();
      return messageDTO(row, authority.senderUserId);
    },
  );
}
