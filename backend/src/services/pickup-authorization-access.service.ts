import type { ClientSession } from 'mongoose';
import User from '../models/user';
import Session from '../models/session';
import Student from '../models/student';
import { StudentEnrollment } from '../models/studentEnrollment';
import { ParentStudentLink } from '../models/parentStudentLink';
import { AcademicPeriod } from '../models/academicPeriod';
import SchoolClass from '../models/schoolClass';
import Section from '../models/section';
import { PERMISSIONS } from '../constants/permissions';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import type { PickupAuthorizationDocument } from '../models/pickupAuthorization';
import { resolveVerifiedParentChild } from './parent-scope.service';
import {
  currentAcademicActor,
  requireActiveAcademicBranch,
} from './teacher-scope.service';
import { verifyAccessToken, type JwtPayload } from './jwt.service';
import { communicationFence } from './teacher-communication-access.service';
import { assertApprovalAuthority } from './approval-authority.policy';
import { RequestContractError } from '../utils/request-validation';
import {
  pickupUnavailable,
  readPickupRouting,
} from './pickup-authorization.policy';

export const PICKUP_PROVENANCE_FIELDS = [
  'requesterId',
  'studentId',
  'branchId',
  'parentStudentLinkId',
  'enrollmentId',
  'academicPeriodId',
  'classId',
  'sectionId',
] as const;
export async function pickupSubject(
  row: PickupAuthorizationDocument,
  session?: ClientSession,
) {
  const parent = await User.findOne({ role: 'parent', isActive: true })
    .where('_id')
    .equals(row.requesterId)
    .where('branchId')
    .equals(row.branchId)
    .session(session ?? null)
    .lean();
  if (!parent) throw pickupUnavailable();
  try {
    const proof = await resolveVerifiedParentChild(
      { actor: parent, branchId: String(row.branchId) },
      String(row.studentId),
      session,
    );
    const { scope, link } = proof;
    if (
      String(link._id) !== String(row.parentStudentLinkId) ||
      String(scope.enrollment._id) !== String(row.enrollmentId) ||
      String(scope.enrollment.academicPeriodId) !==
        String(row.academicPeriodId) ||
      String(scope.enrollment.classId) !== String(row.classId) ||
      String(scope.enrollment.sectionId) !== String(row.sectionId)
    )
      throw pickupUnavailable();
    return proof;
  } catch (error) {
    if (error instanceof RequestContractError && error.status === 403)
      throw pickupUnavailable();
    throw error;
  }
}

export async function fencePickupSubject(
  row: PickupAuthorizationDocument,
  proof: Awaited<ReturnType<typeof pickupSubject>>,
  session: ClientSession,
) {
  const dependencies: [string, string][] = [
    [User.collection.name, String(row.requesterId)],
    [User.collection.name, String(proof.scope.actor._id)],
    [User.collection.name, String(proof.link.verifiedBy)],
    [Student.collection.name, String(row.studentId)],
    [ParentStudentLink.collection.name, String(row.parentStudentLinkId)],
    [StudentEnrollment.collection.name, String(row.enrollmentId)],
    [AcademicPeriod.collection.name, String(row.academicPeriodId)],
    [SchoolClass.collection.name, String(row.classId)],
    [Section.collection.name, String(row.sectionId)],
  ];
  for (const [collection, id] of [
    ...new Map(dependencies.map(pair => [pair.join(':'), pair])).values(),
  ].sort(([a, x], [b, y]) => (a + x).localeCompare(b + y)))
    await communicationFence(session, collection, id);
}

export async function pickupReviewer(
  identity: JwtPayload | undefined,
  token: string,
  session?: ClientSession,
  manage = false,
) {
  let decoded: JwtPayload;
  try {
    decoded = verifyAccessToken(token);
  } catch {
    throw new RequestContractError(401, 'Session is unavailable');
  }
  if (
    !identity ||
    decoded.userId !== identity.userId ||
    decoded.role !== identity.role
  )
    throw new RequestContractError(401, 'Session is unavailable');
  const actor = await currentAcademicActor(identity, session);
  if (
    actor.role !== 'principal' ||
    !ROLE_PERMISSIONS.principal.includes(
      PERMISSIONS.PRINCIPAL_APPROVALS_VIEW,
    ) ||
    (manage &&
      !ROLE_PERMISSIONS.principal.includes(
        PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE,
      ))
  )
    throw new RequestContractError(403, 'Pickup review is unavailable');
  const login = await Session.findOne({ token })
    .session(session ?? null)
    .read('primary')
    .lean();
  if (
    !login ||
    login.isRevoked ||
    String(login.userId) !== String(actor._id) ||
    login.role !== 'principal'
  )
    throw new RequestContractError(401, 'Session is unavailable');
  const branchId = await requireActiveAcademicBranch(
    actor.branchId?.toString(),
    session,
  );
  assertApprovalAuthority(String(actor._id), branchId, {
    approvalType: 'pickup_authorization',
  });
  const routing = readPickupRouting(branchId);
  return { actor, login, branchId, routing };
}
