import { createHash } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import { Types } from 'mongoose';
import { ChatConversation, ChatMessage } from '../models/chat';
import { authorizeChatRecipient } from './chat-authority.service';
import {
  Notification,
  NotificationReadOperation,
  NOTIFICATION_RECIPIENT_ROLES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_SOURCE_TYPES,
  NOTIFICATION_DEEP_LINKS,
} from '../models/notification';
import User from '../models/user';
import Session from '../models/session';
import SchoolNotice from '../models/schoolNotice';
import TeacherAssignment from '../models/teacherAssignment';
import Student from '../models/student';
import SchoolClass from '../models/schoolClass';
import Section from '../models/section';
import Subject from '../models/subject';
import { AcademicPeriod } from '../models/academicPeriod';
import { StudentEnrollment } from '../models/studentEnrollment';
import { ParentStudentLink } from '../models/parentStudentLink';
import {
  currentAcademicActor,
  getTeacherScope,
  requireActiveAcademicBranch,
} from './teacher-scope.service';
import { resolveStudentReadScope } from './student-self-scope.service';
import { verifiedChild } from './parent-scope.service';
import { communicationPermission } from './teacher-communication-access.service';
import { PERMISSIONS } from '../constants/permissions';
import { withTimetablePublication } from './teacher-timetable.service';
import { verifyAccessToken, type JwtPayload } from './jwt.service';
import {
  objectBody,
  objectIdField,
  textField,
  enumField,
  RequestContractError,
} from '../utils/request-validation';

const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const denied = () =>
  new RequestContractError(
    403,
    'Notification recipient or source authority is unavailable',
  );
const missing = () =>
  new RequestContractError(
    404,
    'Notification is unavailable or outside your scope',
  );

/** F4-only producer: join the caller's transaction; never deliver on replay/GET.
 * F3 remains the relationship authority. The outer writer holds its document
 * fences and repeats its final relationship/JWT checks after this insertion.
 */
export async function createChatMessageNotification(
  session: ClientSession,
  identity: JwtPayload | undefined,
  messageId: string,
  authority: Awaited<ReturnType<typeof authorizeChatRecipient>>,
) {
  if (!session.inTransaction()) throw denied();
  const message = await ChatMessage.findById(
    objectIdField(messageId, 'message'),
  )
    .session(session)
    .lean();
  if (
    !message ||
    String(message.senderUserId) !== identity?.userId ||
    String(message.senderUserId) !== authority.senderUserId ||
    String(message.recipientUserId) !== authority.recipient.userId ||
    String(message.branchId) !== authority.branchId
  )
    throw denied();
  const current = await authorizeChatRecipient(
    identity,
    String(message.recipientUserId),
  );
  if (
    current.senderUserId !== authority.senderUserId ||
    current.branchId !== authority.branchId ||
    current.recipient.userId !== authority.recipient.userId ||
    current.recipient.role !== authority.recipient.role ||
    JSON.stringify(current.relationship) !==
      JSON.stringify(authority.relationship)
  )
    throw denied();
  const conversation = await ChatConversation.findOne({
    _id: message.conversationId,
    branchId: message.branchId,
    participantLow: { $in: [message.senderUserId, message.recipientUserId] },
    participantHigh: { $in: [message.senderUserId, message.recipientUserId] },
  })
    .session(session)
    .lean();
  if (!conversation) throw denied();
  const key = {
    recipientUserId: message.recipientUserId,
    sourceType: 'chat_message' as const,
    sourceId: message._id,
    sourceRevision: 1,
    eventType: 'chat_message_created',
  };
  const content = {
    ...key,
    branchId: message.branchId,
    recipientRole: current.recipient.role,
    category: 'communication' as const,
    title: 'New message',
    body: 'Open Messages to view your conversation.',
    priority: 'normal' as const,
    availableAt: message.createdAt,
    deepLinkType: 'chat_conversation' as const,
    deepLinkTargetId: message.conversationId,
  };
  const fingerprint = hash(content);
  const prior = await Notification.findOne(key)
    .select('+fingerprint')
    .session(session);
  if (prior) {
    if (
      prior.fingerprint !== fingerprint ||
      String(prior.branchId) !== current.branchId ||
      prior.recipientRole !== current.recipient.role
    )
      throw new RequestContractError(
        409,
        'Notification event identity was reused for different content',
      );
    return prior;
  }
  const [row] = await Notification.create(
    [
      {
        ...content,
        fingerprint,
        operationId: `${key.eventType}:${message._id}:1:${message.recipientUserId}`,
      },
    ],
    { session },
  );
  return row!;
}
type Role = (typeof NOTIFICATION_RECIPIENT_ROLES)[number];
export interface NotificationDelivery {
  recipientUserId: string;
  /** Expected role, never a replacement for persisted User authority. Legacy Teacher callers omit it. */
  recipientRole?: Role;
  branchId: string;
  sourceType: (typeof NOTIFICATION_SOURCE_TYPES)[number];
  sourceId: string;
  sourceRevision: number;
  eventType: string;
  category: (typeof NOTIFICATION_CATEGORIES)[number];
  title: string;
  body: string;
  deepLinkType: (typeof NOTIFICATION_DEEP_LINKS)[number];
  deepLinkTargetId?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  availableAt: Date;
}

// Use the established optimistic authority fence. Concurrent role/link/assignment/
// enrollment/reference changes must conflict with delivery, not race its validation.
async function fence(
  model: {
    collection: {
      updateOne: (
        filter: object,
        update: object,
        options: object,
      ) => Promise<{ matchedCount: number }>;
    };
  },
  id: unknown,
  session: ClientSession,
) {
  const key = objectIdField(String(id), 'authority reference');
  const result = await model.collection.updateOne(
    { _id: new Types.ObjectId(key) },
    { $inc: { __v: 1 } },
    { session },
  );
  if (!result.matchedCount) throw denied();
}

async function enrollmentFences(studentId: unknown, session: ClientSession) {
  const student = await Student.findById(studentId).session(session).lean();
  if (!student) throw denied();
  await fence(Student, student._id, session);
  await fence(User, student.userId, session);
  const enrollments = await StudentEnrollment.find({
    studentId: student._id,
    status: 'active',
  })
    .limit(2)
    .session(session)
    .lean();
  if (enrollments.length !== 1) throw denied();
  const enrollment = enrollments[0];
  for (const [model, id] of [
    [StudentEnrollment, enrollment._id],
    [SchoolClass, enrollment.classId],
    [Section, enrollment.sectionId],
    [AcademicPeriod, enrollment.academicPeriodId],
  ] as const)
    await fence(model, id, session);
  return { student, enrollment };
}

/** Trusted backend-only producer. No HTTP create/send API and no event bus.
 * Unsupported domain sources fail closed until their canonical F6 policy exists. */
export async function createInternalNotification(input: NotificationDelivery) {
  objectBody(input, [
    'recipientUserId',
    'recipientRole',
    'branchId',
    'sourceType',
    'sourceId',
    'sourceRevision',
    'eventType',
    'category',
    'title',
    'body',
    'deepLinkType',
    'deepLinkTargetId',
    'priority',
    'availableAt',
  ]);
  const recipient = objectIdField(input.recipientUserId, 'recipient'),
    branchId = objectIdField(input.branchId, 'Branch'),
    sourceId = objectIdField(input.sourceId, 'source'),
    role = enumField(
      input.recipientRole ?? 'teacher',
      'recipient role',
      NOTIFICATION_RECIPIENT_ROLES,
    ),
    eventType = textField(input.eventType, 'event type', 80, 1);
  if (
    !/^[A-Za-z0-9_.:-]+$/.test(eventType) ||
    !Number.isSafeInteger(input.sourceRevision) ||
    input.sourceRevision < 1 ||
    !(input.availableAt instanceof Date) ||
    !Number.isFinite(input.availableAt.getTime()) ||
    input.availableAt > new Date()
  )
    throw new RequestContractError(
      400,
      'Invalid notification delivery identity/time',
    );
  textField(input.title, 'notification title', 150, 1);
  textField(input.body, 'notification summary', 2000, 1);
  enumField(input.category, 'category', NOTIFICATION_CATEGORIES);
  enumField(input.deepLinkType, 'typed reference', NOTIFICATION_DEEP_LINKS);
  const priority = enumField(input.priority ?? 'normal', 'priority', [
    'low',
    'normal',
    'high',
    'urgent',
  ] as const);
  const key = {
    recipientUserId: new Types.ObjectId(recipient),
    sourceType: input.sourceType,
    sourceId: new Types.ObjectId(sourceId),
    sourceRevision: input.sourceRevision,
    eventType,
  };
  try {
    return await withTimetablePublication(
      branchId,
      undefined,
      async session => {
        await fence(User, recipient, session);
        const actor = await currentAcademicActor(
          { userId: recipient, role },
          session,
        );
        if (String(actor.branchId) !== branchId) throw denied();
        await requireActiveAcademicBranch(branchId);
        let title = 'School update',
          body = 'Open the school app to view an authorized update.';
        let deepLinkType: 'none' | 'inbox_notice' = 'none';
        let target: string | undefined;
        let recheckTimeAuthority = async () => {};
        if (input.sourceType === 'school_notice') {
          if (role !== 'teacher') throw denied(); // Current canonical notice audience is Teacher-only.
          communicationPermission(PERMISSIONS.TEACHER_NOTICES_VIEW);
          await fence(SchoolNotice, sourceId, session);
          const notice = await SchoolNotice.findOne({
            status: 'published',
            audienceRoles: 'teacher',
            publishedAt: { $lte: new Date() },
            $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
          })
            .where('_id')
            .equals(sourceId)
            .where('branchId')
            .equals(branchId)
            .session(session)
            .lean();
          if (
            !notice ||
            !notice.publishedAt ||
            input.sourceRevision !==
              Math.max(1, notice.publishedAt.getTime()) ||
            input.availableAt.getTime() !== notice.publishedAt.getTime() ||
            input.category !== 'notice' ||
            input.deepLinkType !== 'inbox_notice' ||
            input.deepLinkTargetId !== sourceId
          )
            throw denied();
          title = notice.title;
          body = notice.message.replace(/\s+/g, ' ').trim().slice(0, 280);
          deepLinkType = 'inbox_notice';
          target = sourceId;
          recheckTimeAuthority = async () => {
            communicationPermission(PERMISSIONS.TEACHER_NOTICES_VIEW);
            if (notice.expiresAt && notice.expiresAt <= new Date())
              throw denied();
          };
        } else {
          if (
            input.category !== 'system' ||
            input.deepLinkType !== 'none' ||
            input.deepLinkTargetId !== undefined
          )
            throw denied();
          if (input.sourceType === 'system') {
            if (!['teacher', 'principal', 'finance'].includes(role))
              throw denied();
          } else if (
            input.sourceType === 'teacher_assignment' &&
            role === 'teacher'
          ) {
            await fence(TeacherAssignment, sourceId, session);
            const assignment = await TeacherAssignment.findOne({
              _id: sourceId,
              teacherId: recipient,
              branchId,
            })
              .session(session)
              .lean();
            if (!assignment) throw denied();
            for (const [model, id] of [
              [SchoolClass, assignment.classId],
              [Section, assignment.sectionId],
              [Subject, assignment.subjectId],
            ] as const)
              await fence(model, id, session);
            recheckTimeAuthority = async () => {
              const scope = await getTeacherScope({
                userId: recipient,
                role: 'teacher',
              });
              if (!scope.tuples.some(tuple => tuple.assignmentId === sourceId))
                throw denied();
            };
            await recheckTimeAuthority();
          } else if (
            input.sourceType === 'student_enrollment' &&
            role === 'student'
          ) {
            const enrollment = await StudentEnrollment.findById(sourceId)
              .session(session)
              .lean();
            if (!enrollment) throw denied();
            const fenced = await enrollmentFences(
              enrollment.studentId,
              session,
            );
            const scope = await resolveStudentReadScope(recipient, branchId);
            if (
              String(scope.enrollment._id) !== sourceId ||
              String(scope.student._id) !== String(fenced.student._id)
            )
              throw denied();
          } else if (
            input.sourceType === 'parent_student_link' &&
            role === 'parent'
          ) {
            await fence(ParentStudentLink, sourceId, session);
            const link = await ParentStudentLink.findOne({
              _id: sourceId,
              parentUserId: recipient,
              branchId,
            })
              .session(session)
              .lean();
            if (!link) throw denied();
            await fence(User, link.verifiedBy, session);
            await enrollmentFences(link.studentId, session);
            const scope = await verifiedChild(
              { userId: recipient, role: 'parent' },
              String(link.studentId),
            );
            if (String(scope.link._id) !== sourceId) throw denied();
          } else throw denied();
        }
        const content = {
          ...key,
          branchId,
          recipientRole: role,
          category: input.category,
          title,
          body,
          deepLinkType,
          ...(target ? { deepLinkTargetId: target } : {}),
          priority,
          availableAt: input.availableAt,
        };
        const fingerprint = hash({
          ...content,
          intentTitle: input.title,
          intentBody: input.body,
        });
        const prior = await Notification.findOne(key)
          .select('+fingerprint')
          .session(session);
        if (prior) {
          const legacyFingerprint = hash({
            ...input,
            availableAt: input.availableAt.toISOString(),
          });
          if (
            String(prior.branchId) !== branchId ||
            prior.recipientRole !== role ||
            (prior.fingerprint !== fingerprint &&
              prior.fingerprint !== legacyFingerprint)
          )
            throw new RequestContractError(
              409,
              'Notification event identity was reused for different content',
            );
          await recheckTimeAuthority();
          return prior; // Never rewrite a legitimately delivered historical record.
        }
        const [row] = await Notification.create(
          [
            {
              ...content,
              operationId: `${eventType}:${sourceId}:${input.sourceRevision}:${recipient}`,
              fingerprint,
            },
          ],
          { session },
        );
        // Fences protect document changes; the clock can still cross a validity
        // boundary while Mongo writes are in flight. Roll back stale delivery.
        await recheckTimeAuthority();
        return row!;
      },
    );
  } catch (error) {
    if ((error as { code?: number }).code === 11000)
      throw new RequestContractError(
        409,
        'Notification event already exists; retry',
      );
    throw error;
  }
}

type NotificationRecord = {
  _id: unknown;
  category: string;
  title: string;
  body: string;
  priority: string;
  createdAt: Date;
  availableAt: Date;
  readAt?: Date | null;
  sourceType: string;
  sourceRevision: number;
  deepLinkType: string;
  deepLinkTargetId?: unknown;
};
export const notificationDTO = (row: NotificationRecord) => ({
  notificationId: String(row._id),
  category: row.category,
  title: row.title,
  body: row.body,
  priority: row.priority,
  createdAt: row.createdAt.toISOString(),
  availableAt: row.availableAt.toISOString(),
  readAt: row.readAt?.toISOString() ?? null,
  source: { type: row.sourceType, revision: row.sourceRevision },
  deepLink:
    row.deepLinkType === 'none'
      ? null
      : { type: row.deepLinkType, targetId: String(row.deepLinkTargetId) },
});
async function readContext(
  identity: JwtPayload | undefined,
  session?: ClientSession,
) {
  const actor = await currentAcademicActor(identity, session);
  if (!NOTIFICATION_RECIPIENT_ROLES.includes(actor.role as Role))
    throw denied();
  const branchId = await requireActiveAcademicBranch(
    actor.branchId?.toString(),
  );
  return { actor, branchId };
}

// Shared validation lets legacy Teacher reconciliation reject bad requests before
// running its existing producer, without issuing a throwaway inbox aggregation.
export function notificationInboxQuery(query: unknown, defaultLimit = 25) {
  const input = objectBody(query, ['status', 'offset', 'limit']);
  const status =
    input.status === undefined
      ? 'all'
      : enumField(input.status, 'notification status', [
          'all',
          'unread',
          'read',
        ] as const);
  const integer = (
    value: unknown,
    fallback: number,
    min: number,
    max: number,
    name: string,
  ) => {
    if (value === undefined) return fallback;
    if (
      (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) &&
      (typeof value !== 'number' || !Number.isSafeInteger(value))
    )
      throw new RequestContractError(400, `Invalid notification ${name}`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max)
      throw new RequestContractError(400, `Invalid notification ${name}`);
    return parsed;
  };
  const offset = integer(input.offset, 0, 0, 10000, 'offset');
  const limit = integer(input.limit, defaultLimit, 1, 100, 'limit');
  return { status, offset, limit };
}

// One read authority for every inbox, including the Teacher compatibility route.
// History belongs to the User, not a now-revoked assignment/link or former role.
export async function listOwnNotifications(
  identity: JwtPayload | undefined,
  query: unknown,
) {
  const { status, offset, limit } = notificationInboxQuery(query);
  const ctx = await readContext(identity);
  const readFilter =
    status === 'unread'
      ? { readAt: null }
      : status === 'read'
      ? { readAt: { $type: 'date' } }
      : {};
  // A single read-only aggregation gives items/counts the same visible scope.
  // Explicit ObjectIds are required because aggregate pipelines do not cast.
  const [result] = await Notification.aggregate<{
    items: NotificationRecord[];
    total: { count: number }[];
    unread: { count: number }[];
  }>([
    {
      $match: {
        recipientUserId: ctx.actor._id,
        branchId: new Types.ObjectId(ctx.branchId),
        availableAt: { $lte: new Date() },
      },
    },
    { $sort: { availableAt: -1, _id: -1 } },
    {
      $facet: {
        items: [
          { $match: readFilter },
          { $skip: offset },
          { $limit: limit },
          {
            $project: {
              category: 1,
              title: 1,
              body: 1,
              priority: 1,
              createdAt: 1,
              availableAt: 1,
              readAt: 1,
              sourceType: 1,
              sourceRevision: 1,
              deepLinkType: 1,
              deepLinkTargetId: 1,
            },
          },
        ],
        total: [{ $match: readFilter }, { $count: 'count' }],
        unread: [{ $match: { readAt: null } }, { $count: 'count' }],
      },
    },
  ]).read('primary');
  const items = result!.items.map(notificationDTO);
  const total = result!.total[0]?.count ?? 0;
  const next = offset + items.length;
  return {
    items,
    status,
    offset,
    limit,
    total,
    unread: result!.unread[0]?.count ?? 0,
    nextOffset: next < total && next <= 10000 ? next : null,
  };
}

export async function getOwnNotification(
  identity: JwtPayload | undefined,
  id: unknown,
) {
  const ctx = await readContext(identity);
  const row = await Notification.findOne({
    _id: objectIdField(id, 'notification ID'),
    recipientUserId: ctx.actor._id,
    branchId: ctx.branchId,
    availableAt: { $lte: new Date() },
  }).read('primary');
  if (!row) throw missing();
  return notificationDTO(row);
}
export async function markOwnNotificationRead(
  identity: JwtPayload | undefined,
  id: unknown,
  body: unknown,
  token: string,
) {
  const input = objectBody(body, ['clientOperationId']),
    operationId = textField(input.clientOperationId, 'operation ID', 80, 16),
    notificationId = objectIdField(id, 'notification ID'),
    fingerprint = hash({ notificationId, action: 'read' });
  if (!/^[A-Za-z0-9_-]+$/.test(operationId))
    throw new RequestContractError(400, 'Invalid operation ID');
  const ctx = await readContext(identity);
  const decoded = verifyAccessToken(token);
  if (
    decoded.userId !== String(ctx.actor._id) ||
    decoded.role !== ctx.actor.role
  )
    throw denied();
  return withTimetablePublication(ctx.branchId, undefined, async session => {
    await fence(User, ctx.actor._id, session);
    const login = await Session.collection.updateOne(
      { token, userId: ctx.actor._id, role: ctx.actor.role, isRevoked: false },
      { $inc: { __v: 1 } },
      { session },
    );
    if (!login.matchedCount)
      throw new RequestContractError(401, 'Session is unavailable');
    const current = await readContext(identity, session);
    if (current.branchId !== ctx.branchId) throw denied();
    const filter = {
      _id: notificationId,
      recipientUserId: ctx.actor._id,
      branchId: ctx.branchId,
      availableAt: { $lte: new Date() },
    };
    let row = await Notification.findOne(filter).session(session);
    if (!row) throw missing();
    const prior = await NotificationReadOperation.findOne({
      recipientUserId: ctx.actor._id,
      operationId,
    }).session(session);
    if (prior && prior.fingerprint !== fingerprint)
      throw new RequestContractError(409, 'Operation ID was reused');
    if (!prior)
      await NotificationReadOperation.create(
        [
          {
            recipientUserId: ctx.actor._id,
            notificationId,
            operationId,
            fingerprint,
          },
        ],
        { session },
      );
    if (!row.readAt)
      row =
        (await Notification.findOneAndUpdate(
          { ...filter, readAt: null },
          { $set: { readAt: new Date() } },
          { session, returnDocument: 'after', runValidators: true },
        )) ?? (await Notification.findOne(filter).session(session));
    if (!row) throw missing();
    verifyAccessToken(token); // Expiry during the transaction must roll back read state/operation together.
    return notificationDTO(row);
  });
}
