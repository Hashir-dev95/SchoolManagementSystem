import type { ClientSession } from 'mongoose';
import User from '../models/user';
import Session from '../models/session';
import {
  EARLY_EXIT_PROVENANCE,
  type EarlyExitDocument,
} from '../models/earlyExitRequest';
import {
  currentAcademicActor,
  requireActiveAcademicBranch,
} from './teacher-scope.service';
import { resolveVerifiedParentChild } from './parent-scope.service';
import { verifyAccessToken, type JwtPayload } from './jwt.service';
import { PERMISSIONS } from '../constants/permissions';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import {
  assertApprovalAuthority,
  ApprovalAccessError,
} from './approval-authority.policy';
import { communicationFence } from './teacher-communication-access.service';
import {
  objectBody,
  objectIdField,
  RequestContractError,
  textField,
} from '../utils/request-validation';
import { scheduleDate, schoolDateTime } from './school-date.service';
import type { StudentReadScope } from './student-self-scope.service';

export const exitUnavailable = () =>
  new RequestContractError(404, 'Early Exit request is unavailable');
export const exitConflict = () =>
  new RequestContractError(
    409,
    'Early Exit request changed; refresh and review again',
  );
export const exitRoutingUnavailable = () =>
  new RequestContractError(
    503,
    'Early Exit review routing is unavailable for this school',
  );
export function exitPayload(body: Record<string, unknown>) {
  return {
    exitDate: scheduleDate(body.exitDate),
    reason: textField(
      typeof body.reason === 'string'
        ? body.reason.normalize('NFC')
        : body.reason,
      'exit reason',
      500,
      1,
    ),
  };
}
export type ExitPayload = ReturnType<typeof exitPayload>;
export function exitRevision(value: unknown) {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) >= Number.MAX_SAFE_INTEGER
  )
    throw new RequestContractError(400, 'Invalid revision');
  return value as number;
}
export function assertExitDate(payload: ExitPayload, scope: StudentReadScope) {
  if (
    payload.exitDate < scheduleDate(scope.period.startDate) ||
    payload.exitDate > scheduleDate(scope.period.endDate) ||
    payload.exitDate < schoolDateTime(scope.enrollment.effectiveFrom).date
  )
    throw exitConflict();
}
export function readExitRouting(branchId: string) {
  try {
    const raw = objectBody(
      JSON.parse(process.env.EARLY_EXIT_ROUTING_POLICY ?? '{}'),
      ['policy', 'version', 'enabled', 'branchIds'],
    );
    if (
      raw.policy !== 'shared_branch_principal' ||
      raw.enabled !== true ||
      !Number.isSafeInteger(raw.version) ||
      (raw.version as number) < 1 ||
      !Array.isArray(raw.branchIds) ||
      !raw.branchIds.length ||
      raw.branchIds.some(id => objectIdField(id, 'routing Branch') !== id) ||
      new Set(raw.branchIds).size !== raw.branchIds.length ||
      !raw.branchIds.includes(branchId)
    )
      throw exitRoutingUnavailable();
    return { version: raw.version as number };
  } catch {
    throw exitRoutingUnavailable();
  }
}
export async function verifyExitQueue(
  branchId: string,
  session: ClientSession,
  lock = true,
) {
  const routing = readExitRouting(branchId);
  if (
    !ROLE_PERMISSIONS.principal.includes(
      PERMISSIONS.PRINCIPAL_APPROVALS_VIEW,
    ) ||
    !ROLE_PERMISSIONS.principal.includes(PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE)
  )
    throw exitRoutingUnavailable();
  const users = await User.find({ role: 'principal', isActive: true })
    .where('branchId')
    .equals(branchId)
    .select('_id')
    .session(session)
    .lean();
  const eligible = users.filter(user => {
    try {
      assertApprovalAuthority(String(user._id), branchId, {
        approvalType: 'early_exit_request',
      });
      return true;
    } catch (error) {
      if (error instanceof ApprovalAccessError) return false;
      throw error;
    }
  });
  if (!eligible.length) throw exitRoutingUnavailable();
  if (lock)
    for (const user of eligible)
      await communicationFence(session, User.collection.name, String(user._id));
  return routing;
}
export async function exitSubject(
  row: EarlyExitDocument,
  session?: ClientSession,
) {
  const actor = await User.findOne({ role: 'parent', isActive: true })
    .where('_id')
    .equals(row.requesterId)
    .where('branchId')
    .equals(row.branchId)
    .session(session ?? null)
    .lean();
  if (!actor) throw exitUnavailable();
  try {
    const proof = await resolveVerifiedParentChild(
      { actor, branchId: String(row.branchId) },
      String(row.studentId),
      session,
    );
    const current = {
      requesterId: actor._id,
      studentId: proof.scope.student._id,
      branchId: proof.parent.branchId,
      parentStudentLinkId: proof.link._id,
      enrollmentId: proof.scope.enrollment._id,
      academicPeriodId: proof.scope.enrollment.academicPeriodId,
      classId: proof.scope.enrollment.classId,
      sectionId: proof.scope.enrollment.sectionId,
    };
    if (
      EARLY_EXIT_PROVENANCE.some(
        key => String(row.get(key)) !== String(current[key]),
      )
    )
      throw exitUnavailable();
    return proof;
  } catch (error) {
    if (error instanceof RequestContractError && error.status === 403)
      throw exitUnavailable();
    throw error;
  }
}
export async function exitReviewer(
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
    throw new RequestContractError(403, 'Early Exit review is unavailable');
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
    approvalType: 'early_exit_request',
  });
  return { actor, login, branchId, routing: readExitRouting(branchId) };
}
export function requireEarlyExitApprovalPolicy(): never {
  throw new RequestContractError(
    403,
    'Early Exit approval is unavailable pending independently verified school policy',
  );
}
