import { Types, type ClientSession } from 'mongoose';
import User from '../models/user';
import Session from '../models/session';
import Student from '../models/student';
import SchoolClass from '../models/schoolClass';
import Section from '../models/section';
import { AcademicPeriod } from '../models/academicPeriod';
import { StudentEnrollment } from '../models/studentEnrollment';
import { ParentStudentLink } from '../models/parentStudentLink';
import { ParentLeaveApplication } from '../models/parentLeaveApplication';
import { verifiedChild } from './parent-scope.service';
import { verifyAccessToken, type JwtPayload } from './jwt.service';
import { withAcademicCatalogLock } from './academic-catalog-lock.service';
import { communicationFence } from './teacher-communication-access.service';
import {
  normalizeParentLeaveDraft,
  parentLeaveFingerprint,
} from './parent-leave-application.policy';
import {
  objectIdField,
  RequestContractError,
} from '../utils/request-validation';

const unavailable = () =>
  new RequestContractError(404, 'Application or child access is unavailable');
const badSession = () =>
  new RequestContractError(401, 'Session is unavailable');

function tokenIdentity(identity: JwtPayload | undefined, token: string) {
  let decoded: JwtPayload;
  try {
    decoded = verifyAccessToken(token);
  } catch {
    throw badSession();
  }
  if (
    !identity ||
    decoded.userId !== identity.userId ||
    decoded.role !== identity.role ||
    decoded.role !== 'parent'
  )
    throw badSession();
  return decoded;
}

/** Internal boundary. The identity must originate from canonical JWT middleware. */
export async function authorizeParentApplication(
  identity: JwtPayload | undefined,
  token: string,
  studentId: string,
  applicationId?: string,
) {
  const decoded = tokenIdentity(identity, token);
  // Same first matching token record semantics as isTokenRevoked.
  const login = await Session.findOne({ token }).read('primary').lean();
  if (
    !login ||
    login.isRevoked ||
    String(login.userId) !== decoded.userId ||
    login.role !== 'parent'
  )
    throw badSession();
  let child: Awaited<ReturnType<typeof verifiedChild>>;
  try {
    child = await verifiedChild(identity, studentId);
  } catch (error) {
    if (error instanceof RequestContractError && error.status === 403)
      throw unavailable();
    throw error;
  }
  const { parent, link, scope } = child;
  const provenance = {
    requesterId: String(parent.actor._id),
    studentId: String(scope.student._id),
    branchId: parent.branchId,
    parentStudentLinkId: String(link._id),
    enrollmentId: String(scope.enrollment._id),
    academicPeriodId: String(scope.enrollment.academicPeriodId),
    classId: String(scope.enrollment.classId),
    sectionId: String(scope.enrollment.sectionId),
  };
  if (applicationId !== undefined) {
    let id: string;
    try {
      id = objectIdField(applicationId, 'application ID');
    } catch {
      throw unavailable();
    }
    // Origin and original requester must still match current canonical scope.
    const application = await ParentLeaveApplication.exists({
      _id: id,
      ...provenance,
    }).read('primary');
    if (!application) throw unavailable();
  }
  tokenIdentity(identity, token);
  return { ...child, provenance, loginId: String(login._id) };
}

type Access = Awaited<ReturnType<typeof authorizeParentApplication>>;
const witness = (scope: Access) =>
  JSON.stringify([
    scope.provenance,
    scope.loginId,
    String(scope.link.verifiedBy),
    scope.link.verifiedAt?.toISOString(),
  ]);

/** No application decision authority. Callback is trusted internal code only. */
export async function withParentApplicationWriteAuthority<T>(
  identity: JwtPayload | undefined,
  token: string,
  studentId: string,
  write: (session: ClientSession, access: Access) => Promise<T>,
  applicationId?: string,
) {
  const initial = await authorizeParentApplication(
    identity,
    token,
    studentId,
    applicationId,
  );
  return withAcademicCatalogLock(initial.provenance.branchId, async session => {
    tokenIdentity(identity, token);
    const login = await Session.collection.updateOne(
      {
        _id: new Types.ObjectId(initial.loginId),
        token,
        userId: initial.parent.actor._id,
        role: 'parent',
        isRevoked: false,
      },
      { $inc: { __v: 1 } },
      { session },
    );
    if (!login.matchedCount) throw badSession();
    const p = initial.provenance;
    const dependencies: [string, string][] = [
      [User.collection.name, p.requesterId],
      [User.collection.name, String(initial.scope.actor._id)],
      [User.collection.name, String(initial.link.verifiedBy)],
      [Student.collection.name, p.studentId],
      [ParentStudentLink.collection.name, p.parentStudentLinkId],
      [StudentEnrollment.collection.name, p.enrollmentId],
      [AcademicPeriod.collection.name, p.academicPeriodId],
      [SchoolClass.collection.name, p.classId],
      [Section.collection.name, p.sectionId],
    ];
    const unique = new Map(dependencies.map(pair => [pair.join(':'), pair]));
    for (const [, [collection, id]] of [...unique].sort(([a], [b]) =>
      a.localeCompare(b),
    ))
      await communicationFence(session, collection, id);
    const current = await authorizeParentApplication(
      identity,
      token,
      studentId,
      applicationId,
    );
    if (witness(initial) !== witness(current)) throw unavailable();
    const result = await write(session, current);
    const final = await authorizeParentApplication(
      identity,
      token,
      studentId,
      applicationId,
    );
    if (witness(current) !== witness(final)) throw unavailable();
    tokenIdentity(identity, token);
    return result;
  });
}

/**
 * Internal G1 persistence exercise: creates unlinked drafts only, no routes.
 * The draft itself is the immutable create-operation receipt. Editing or submit
 * will need separate operation receipts; never recompute this fingerprint from
 * subsequently edited content. Overlapping drafts do not reserve leave dates.
 */
export async function createParentLeaveDraft(
  identity: JwtPayload | undefined,
  token: string,
  studentId: string,
  raw: unknown,
) {
  const { payload, clientOperationId } = normalizeParentLeaveDraft(raw);
  const fingerprint = parentLeaveFingerprint(studentId, payload);
  return withParentApplicationWriteAuthority(
    identity,
    token,
    studentId,
    async (session, access) => {
      const previous = await ParentLeaveApplication.findOne({
        requesterId: access.provenance.requesterId,
        clientOperationId,
      })
        .select('+fingerprint')
        .session(session);
      if (previous) {
        const matches = Object.entries(access.provenance).every(
          ([key, value]) => String(previous.get(key)) === value,
        );
        if (!matches) throw unavailable();
        if (previous.fingerprint !== fingerprint)
          throw new RequestContractError(409, 'Operation was used differently');
        return { applicationId: String(previous._id), replayed: true };
      }
      const [draft] = await ParentLeaveApplication.create(
        [
          {
            ...access.provenance,
            ...payload,
            clientOperationId,
            fingerprint,
            state: 'draft',
            revision: 0,
            history: [
              {
                action: 'draft_created',
                actorId: access.provenance.requesterId,
                revision: 0,
                at: new Date(),
              },
            ],
          },
        ],
        { session },
      );
      return { applicationId: String(draft!._id), replayed: false };
    },
  );
}
