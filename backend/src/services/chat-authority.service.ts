import User from '../models/user';
import Student from '../models/student';
import TeacherAssignment from '../models/teacherAssignment';
import {
  StudentEnrollment,
  activeEnrollmentFilter,
} from '../models/studentEnrollment';
import { ParentStudentLink } from '../models/parentStudentLink';
import {
  currentAcademicActor,
  getTeacherScope,
  requireActiveAcademicBranch,
} from './teacher-scope.service';
import {
  resolveStudentReadScope,
  type StudentReadScope,
} from './student-self-scope.service';
import { verifiedChild } from './parent-scope.service';
import type { JwtPayload } from './jwt.service';
import {
  objectBody,
  objectIdField,
  RequestContractError,
} from '../utils/request-validation';

const roles = ['teacher', 'student', 'parent'] as const;
type ChatRole = (typeof roles)[number];
const supported = (role: string): role is ChatRole =>
  roles.includes(role as ChatRole);
const denied = () =>
  new RequestContractError(
    403,
    'Chat recipient is unavailable in your current scope',
  );
const MAX_CANDIDATES = 1000;
const tooMany = () =>
  new RequestContractError(
    409,
    'Recipient scope requires administrator review',
  );

async function senderContext(identity: JwtPayload | undefined) {
  const actor = await currentAcademicActor(identity);
  if (!supported(actor.role)) throw denied();
  const branchId = await requireActiveAcademicBranch(
    actor.branchId?.toString(),
  );
  return { actor, branchId };
}

async function parentChildren(identity: JwtPayload, branchId: string) {
  const links = await ParentStudentLink.find({
    parentUserId: identity.userId,
    branchId,
    status: 'verified',
    isActive: true,
  })
    .sort({ studentId: 1, _id: 1 })
    .limit(101)
    .select('studentId')
    .read('primary')
    .lean();
  // Reuse the existing verified-child safety bound, not a second guardian policy.
  if (links.length > 100) throw tooMany();
  const children: Awaited<ReturnType<typeof verifiedChild>>[] = [];
  for (const link of links) {
    try {
      children.push(await verifiedChild(identity, String(link.studentId)));
    } catch (error) {
      if (!(error instanceof RequestContractError && error.status === 403))
        throw error;
    }
  }
  return children;
}

async function assignmentFor(
  scope: Awaited<ReturnType<typeof getTeacherScope>>,
  student: StudentReadScope,
) {
  if (scope.branchId !== student.branchId) return null;
  const tuples = scope.tuples.filter(
    tuple =>
      tuple.classId === String(student.enrollment.classId) &&
      tuple.sectionId === String(student.enrollment.sectionId),
  );
  if (!tuples.length) return null;
  // getTeacherScope validates class/section/subject references. Check the exact
  // witness again, including contradictory imported revokedAt and clock expiry.
  const at = new Date();
  return TeacherAssignment.findOne({
    _id: { $in: tuples.map(tuple => tuple.assignmentId) },
    teacherId: scope.actorId,
    branchId: scope.branchId,
    isActive: true,
    revokedAt: null,
    validFrom: { $lte: at },
    $or: [{ validUntil: { $exists: false } }, { validUntil: { $gt: at } }],
  })
    .sort({ _id: 1 })
    .select('_id')
    .read('primary')
    .lean();
}

/** Read-only current authority, never a reusable permission ticket.
 * Identity is server context from authenticateToken, not a client sender/Branch.
 * F4 must call this again under its commit-time relationship/session fences.
 */
export async function authorizeChatRecipient(
  identity: JwtPayload | undefined,
  recipientUserId: unknown,
) {
  try {
    return await resolveRecipient(identity, recipientUserId);
  } catch (error) {
    // Valid guessed IDs never distinguish an existing but unrelated recipient.
    if (error instanceof RequestContractError && error.status === 403)
      throw denied();
    throw error;
  }
}

async function resolveRecipient(
  identity: JwtPayload | undefined,
  recipientUserId: unknown,
) {
  const ctx = await senderContext(identity);
  const id = objectIdField(recipientUserId, 'recipient ID');
  const recipient = await User.findOne({ isActive: true })
    .where('_id')
    .equals(id)
    .where('branchId')
    .equals(ctx.branchId)
    .select('_id fullName role')
    .read('primary')
    .lean();
  if (!recipient || !supported(recipient.role) || String(ctx.actor._id) === id)
    throw denied();
  const teacherIsSender = ctx.actor.role === 'teacher';
  const otherRole = teacherIsSender ? recipient.role : ctx.actor.role;
  if (
    !(teacherIsSender
      ? ['student', 'parent'].includes(otherRole)
      : recipient.role === 'teacher' &&
        ['student', 'parent'].includes(otherRole))
  )
    throw denied();
  const teacherId = teacherIsSender ? String(ctx.actor._id) : id;
  const otherId = teacherIsSender ? id : String(ctx.actor._id);
  const teacher = await getTeacherScope({ userId: teacherId, role: 'teacher' });
  if (teacher.branchId !== ctx.branchId) throw denied();
  const witnesses =
    otherRole === 'student'
      ? [
          {
            scope: await resolveStudentReadScope(otherId, ctx.branchId),
            link: null,
          },
        ]
      : await parentChildren({ userId: otherId, role: 'parent' }, ctx.branchId);
  for (const witness of witnesses) {
    const assignment = await assignmentFor(teacher, witness.scope);
    if (!assignment) continue;
    const relationshipType = teacherIsSender
      ? otherRole === 'student'
        ? 'assigned_student'
        : 'verified_parent_of_assigned_student'
      : otherRole === 'student'
      ? 'assigned_teacher'
      : 'linked_child_teacher';
    return {
      senderUserId: String(ctx.actor._id),
      branchId: ctx.branchId,
      recipient: {
        userId: id,
        displayName: recipient.fullName,
        role: recipient.role,
        relationshipType,
      },
      // Internal witness IDs only. Discovery must never serialize this object.
      relationship: {
        studentId: String(witness.scope.student._id),
        enrollmentId: String(witness.scope.enrollment._id),
        assignmentId: String(assignment._id),
        parentStudentLinkId: witness.link ? String(witness.link._id) : null,
      },
    };
  }
  throw denied();
}

// Candidate queries are server-derived hints only. Every returned recipient is
// independently resolved by the same current-authority primitive above.
async function candidateIds(
  identity: JwtPayload,
  ctx: Awaited<ReturnType<typeof senderContext>>,
) {
  if (ctx.actor.role === 'teacher') {
    const teacher = await getTeacherScope(identity);
    if (!teacher.tuples.length) return [];
    const enrollments = await StudentEnrollment.find({
      branchId: ctx.branchId,
      ...activeEnrollmentFilter(),
      effectiveTo: null,
      $or: teacher.tuples.map(tuple => ({
        classId: tuple.classId,
        sectionId: tuple.sectionId,
      })),
    })
      .sort({ _id: 1 })
      .limit(MAX_CANDIDATES + 1)
      .select('studentId')
      .read('primary')
      .lean();
    if (enrollments.length > MAX_CANDIDATES) throw tooMany();
    const students = await Student.find({ isActive: true })
      .where('_id')
      .in(enrollments.map(row => row.studentId))
      .where('branchId')
      .equals(ctx.branchId)
      .select('userId')
      .read('primary')
      .lean();
    const links = await ParentStudentLink.find({
      studentId: { $in: students.map(row => row._id) },
      branchId: ctx.branchId,
      status: 'verified',
      isActive: true,
    })
      .sort({ _id: 1 })
      .limit(MAX_CANDIDATES + 1)
      .select('parentUserId')
      .read('primary')
      .lean();
    if (links.length > MAX_CANDIDATES) throw tooMany();
    return [
      ...students.map(row => row.userId),
      ...links.map(row => row.parentUserId),
    ];
  }
  const children =
    ctx.actor.role === 'student'
      ? [await resolveStudentReadScope(String(ctx.actor._id), ctx.branchId)]
      : (await parentChildren(identity, ctx.branchId)).map(
          child => child.scope,
        );
  if (!children.length) return [];
  const assignments = await TeacherAssignment.find({
    branchId: ctx.branchId,
    isActive: true,
    revokedAt: null,
    validFrom: { $lte: new Date() },
    $and: [
      {
        $or: children.map(child => ({
          classId: child.enrollment.classId,
          sectionId: child.enrollment.sectionId,
        })),
      },
      {
        $or: [
          { validUntil: { $exists: false } },
          { validUntil: { $gt: new Date() } },
        ],
      },
    ],
  })
    .sort({ _id: 1 })
    .limit(MAX_CANDIDATES + 1)
    .select('teacherId')
    .read('primary')
    .lean();
  if (assignments.length > MAX_CANDIDATES) throw tooMany();
  return assignments.map(row => row.teacherId);
}

export async function discoverChatRecipients(
  identity: JwtPayload | undefined,
  query: unknown,
) {
  const input = objectBody(query, ['offset', 'limit']);
  const integer = (
    value: unknown,
    fallback: number,
    min: number,
    max: number,
  ) => {
    if (value === undefined) return fallback;
    if (
      typeof value !== 'string' ||
      !/^(0|[1-9]\d*)$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) < min ||
      Number(value) > max
    )
      throw new RequestContractError(400, 'Invalid recipient pagination');
    return Number(value);
  };
  const offset = integer(input.offset, 0, 0, MAX_CANDIDATES),
    limit = integer(input.limit, 25, 1, 100);
  const ctx = await senderContext(identity);
  const ids = await candidateIds(identity!, ctx);
  const candidates = await User.find({ isActive: true, role: { $in: roles } })
    .where('_id')
    .in(ids)
    .where('branchId')
    .equals(ctx.branchId)
    .sort({ _id: 1 })
    .limit(MAX_CANDIDATES + 1)
    .select('_id')
    .read('primary')
    .lean();
  if (candidates.length > MAX_CANDIDATES) throw tooMany();
  const allowed: Awaited<
    ReturnType<typeof authorizeChatRecipient>
  >['recipient'][] = [];
  for (const candidate of candidates) {
    try {
      allowed.push(
        (await authorizeChatRecipient(identity, String(candidate._id)))
          .recipient,
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
    offset,
    limit,
    total: allowed.length,
    nextOffset: next < allowed.length ? next : null,
  };
}
