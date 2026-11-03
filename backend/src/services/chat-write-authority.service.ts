import { Types, type ClientSession } from 'mongoose';
import User from '../models/user';
import Session from '../models/session';
import Student from '../models/student';
import TeacherAssignment from '../models/teacherAssignment';
import { StudentEnrollment } from '../models/studentEnrollment';
import { ParentStudentLink } from '../models/parentStudentLink';
import SchoolClass from '../models/schoolClass';
import Section from '../models/section';
import Subject from '../models/subject';
import { AcademicPeriod } from '../models/academicPeriod';
import { authorizeChatRecipient } from './chat-authority.service';
import { withAcademicCatalogLock } from './academic-catalog-lock.service';
import { communicationFence } from './teacher-communication-access.service';
import { verifyAccessToken, type JwtPayload } from './jwt.service';
import { RequestContractError } from '../utils/request-validation';

type Authority = Awaited<ReturnType<typeof authorizeChatRecipient>>;
const changed = () =>
  new RequestContractError(
    403,
    'Chat authority changed. Refresh before retrying.',
  );
const same = (a: Authority, b: Authority) =>
  a.branchId === b.branchId &&
  a.recipient.userId === b.recipient.userId &&
  a.recipient.role === b.recipient.role &&
  JSON.stringify(a.relationship) === JSON.stringify(b.relationship);

/** Derive lock dependencies from F3 witnesses. This function never grants eligibility. */
async function fenceWitness(authority: Authority, session: ClientSession) {
  const witness = authority.relationship;
  const dependencies: [string, string][] = [
    [User.collection.name, authority.senderUserId],
    [User.collection.name, authority.recipient.userId],
    [Student.collection.name, witness.studentId],
    [StudentEnrollment.collection.name, witness.enrollmentId],
    [TeacherAssignment.collection.name, witness.assignmentId],
  ];
  const assignment = await TeacherAssignment.findById(witness.assignmentId)
    .session(session)
    .lean();
  const enrollment = await StudentEnrollment.findById(witness.enrollmentId)
    .session(session)
    .lean();
  const student = await Student.findById(witness.studentId)
    .session(session)
    .select('userId')
    .lean();
  if (!assignment || !enrollment || !student) throw changed();
  dependencies.push(
    [User.collection.name, String(student.userId)],
    [SchoolClass.collection.name, String(assignment.classId)],
    [Section.collection.name, String(assignment.sectionId)],
    [Subject.collection.name, String(assignment.subjectId)],
    [AcademicPeriod.collection.name, String(enrollment.academicPeriodId)],
    [SchoolClass.collection.name, String(enrollment.classId)],
    [Section.collection.name, String(enrollment.sectionId)],
  );
  if (witness.parentStudentLinkId) {
    const link = await ParentStudentLink.findById(witness.parentStudentLinkId)
      .session(session)
      .select('verifiedBy')
      .lean();
    if (!link?.verifiedBy) throw changed();
    dependencies.push(
      [ParentStudentLink.collection.name, witness.parentStudentLinkId],
      [User.collection.name, String(link.verifiedBy)],
    );
  }
  const unique = new Map(
    dependencies.map(([collection, id]) => [
      collection + ':' + id,
      [collection, id] as const,
    ]),
  );
  for (const [, [collection, id]] of [...unique].sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    await communicationFence(session, collection, id);
}

export async function withChatWriteAuthority<T>(
  identity: JwtPayload | undefined,
  token: string,
  recipientId: string,
  write: (session: ClientSession, authority: Authority) => Promise<T>,
) {
  const initial = await authorizeChatRecipient(identity, recipientId);
  const validateToken = () => {
    let decoded: JwtPayload;
    try {
      decoded = verifyAccessToken(token);
    } catch {
      throw new RequestContractError(401, 'Session is unavailable');
    }
    if (decoded.userId !== identity?.userId || decoded.role !== identity.role)
      throw new RequestContractError(401, 'Session is unavailable');
  };
  validateToken();
  return withAcademicCatalogLock(initial.branchId, async session => {
    validateToken();
    const login = await Session.collection.updateOne(
      {
        token,
        userId: new Types.ObjectId(initial.senderUserId),
        role: identity!.role,
        isRevoked: false,
      },
      { $inc: { __v: 1 } },
      { session },
    );
    if (!login.matchedCount)
      throw new RequestContractError(401, 'Session is unavailable');
    await fenceWitness(initial, session);
    const current = await authorizeChatRecipient(identity, recipientId);
    if (!same(initial, current)) throw changed();
    const result = await write(session, current);
    // Primary reads after document fences observe current committed authority.
    // Assignment/JWT clock expiry is rechecked after the persistence work too.
    const final = await authorizeChatRecipient(identity, recipientId);
    if (!same(current, final)) throw changed();
    validateToken();
    return result;
  });
}
