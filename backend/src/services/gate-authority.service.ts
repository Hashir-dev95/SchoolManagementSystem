import type { ClientSession } from 'mongoose';
import User from '../models/user';
import Session from '../models/session';
import Branch from '../models/branch';
import {
  Gate,
  GateStaffAssignment,
  GATE_DUTIES,
  type GateDuty,
} from '../models/gateFoundation';
import { PERMISSIONS, type Permission } from '../constants/permissions';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import { verifyAccessToken, type JwtPayload } from './jwt.service';
import { withAcademicCatalogLock } from './academic-catalog-lock.service';
import { communicationFence } from './teacher-communication-access.service';
import {
  objectIdField,
  RequestContractError,
} from '../utils/request-validation';

export const gateUnavailable = () =>
  new RequestContractError(404, 'Gate context is unavailable');
export const gateConflict = () =>
  new RequestContractError(409, 'Record changed; refresh before retrying');
const forbidden = () =>
  new RequestContractError(403, 'Gate capability is unavailable');
const invalidSession = () =>
  new RequestContractError(401, 'Session or identity is unavailable');

async function currentIdentity(
  identity: JwtPayload | undefined,
  token: string,
  session?: ClientSession,
) {
  let decoded: JwtPayload;
  try {
    decoded = verifyAccessToken(token);
  } catch {
    throw invalidSession();
  }
  if (
    !identity ||
    decoded.userId !== identity.userId ||
    decoded.role !== identity.role
  )
    throw invalidSession();
  const login = await Session.findOne({ token })
    .session(session ?? null)
    .read('primary')
    .lean();
  const actor = await User.findById(objectIdField(identity.userId, 'identity'))
    .session(session ?? null)
    .read('primary')
    .lean();
  if (
    !login ||
    login.isRevoked ||
    String(login.userId) !== decoded.userId ||
    login.role !== decoded.role ||
    !actor ||
    !actor.isActive ||
    actor.role !== decoded.role
  )
    throw invalidSession();
  return { actor, login };
}

function adminBranch(
  actor: Awaited<ReturnType<typeof currentIdentity>>['actor'],
  branchId: string,
  permission: Permission,
) {
  if (
    actor.role !== 'super_admin' ||
    actor.branchId ||
    !ROLE_PERMISSIONS.super_admin.includes(permission)
  )
    throw forbidden();
  let allowed: unknown;
  try {
    allowed = JSON.parse(process.env.GATE_ADMIN_BRANCH_IDS ?? 'null');
  } catch {
    throw forbidden();
  }
  if (
    !Array.isArray(allowed) ||
    allowed.length === 0 ||
    allowed.some(id => typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) ||
    new Set(allowed).size !== allowed.length ||
    !allowed.includes(branchId)
  )
    throw forbidden();
}

async function fenceIdentity(
  context: Awaited<ReturnType<typeof currentIdentity>>,
  session: ClientSession,
) {
  await communicationFence(
    session,
    User.collection.name,
    String(context.actor._id),
  );
  const login = await Session.collection.updateOne(
    { _id: context.login._id, isRevoked: false },
    { $inc: { __v: 1 } },
    { session },
  );
  if (!login.matchedCount) throw invalidSession();
}

export async function withGateAdministration<T>(
  identity: JwtPayload | undefined,
  token: string,
  rawBranch: unknown,
  permission: Permission,
  write: (
    session: ClientSession,
    branchId: string,
    actorId: string,
  ) => Promise<T>,
) {
  const branchId = objectIdField(rawBranch, 'Branch ID');
  const initial = await currentIdentity(identity, token);
  adminBranch(initial.actor, branchId, permission);
  return withAcademicCatalogLock(branchId, async session => {
    await fenceIdentity(initial, session);
    const current = await currentIdentity(identity, token, session);
    adminBranch(current.actor, branchId, permission);
    const result = await write(session, branchId, String(current.actor._id));
    const final = await currentIdentity(identity, token, session);
    adminBranch(final.actor, branchId, permission);
    return result;
  });
}

async function assignmentContext(
  identity: JwtPayload | undefined,
  token: string,
  gateId: string,
  assignmentId: string,
  session?: ClientSession,
) {
  const account = await currentIdentity(identity, token, session);
  if (account.actor.role !== 'gate_staff') throw forbidden();
  const branchId = account.actor.branchId;
  if (
    !branchId ||
    !(await Branch.exists({ isActive: true })
      .where('_id')
      .equals(branchId)
      .session(session ?? null))
  )
    throw gateUnavailable();
  const gate = await Gate.findOne({
    _id: gateId,
    branchId: String(branchId),
    isActive: true,
  })
    .session(session ?? null)
    .read('primary')
    .lean();
  const now = new Date();
  const assignment = await GateStaffAssignment.findOne({
    _id: assignmentId,
    gateId,
    branchId: String(branchId),
    operatorId: String(account.actor._id),
    status: 'active',
    revokedAt: null,
    revokedBy: null,
    validFrom: { $type: 'date', $lte: now },
    validUntil: { $type: 'date', $gt: now },
  })
    .session(session ?? null)
    .read('primary')
    .lean();
  if (
    !gate ||
    !assignment ||
    !assignment.duties.length ||
    !Number.isSafeInteger(gate.revision) ||
    gate.revision < 1 ||
    !Number.isSafeInteger(assignment.revision) ||
    assignment.revision < 1 ||
    assignment.duties.some(duty => !GATE_DUTIES.some(known => known === duty))
  )
    throw gateUnavailable();
  return { ...account, gate, assignment };
}

/** Foundation metadata only. Trusted callbacks cannot be selected by HTTP input.
 * Future Student operations also require fenced exact enrollment, current custody,
 * school-approved pickup person/authorization and release/challenge provenance.
 */
export async function withGateAssignmentContext<T>(
  identity: JwtPayload | undefined,
  token: string,
  rawGate: unknown,
  rawAssignment: unknown,
  inspect: (
    session: ClientSession,
    context: Awaited<ReturnType<typeof assignmentContext>>,
  ) => Promise<T>,
) {
  const gateId = objectIdField(rawGate, 'Gate ID');
  const assignmentId = objectIdField(rawAssignment, 'assignment ID');
  const initial = await assignmentContext(
    identity,
    token,
    gateId,
    assignmentId,
  );
  const branchId = String(initial.actor.branchId);
  return withAcademicCatalogLock(branchId, async session => {
    await fenceIdentity(initial, session);
    await communicationFence(session, Gate.collection.name, gateId);
    await communicationFence(
      session,
      GateStaffAssignment.collection.name,
      assignmentId,
    );
    const current = await assignmentContext(
      identity,
      token,
      gateId,
      assignmentId,
      session,
    );
    if (String(current.actor.branchId) !== branchId) throw gateUnavailable();
    const result = await inspect(session, current);
    await assignmentContext(identity, token, gateId, assignmentId, session);
    return result;
  });
}

const dutyPermissions: Record<GateDuty, Permission> = {
  tasks_view: PERMISSIONS.GATE_TASKS_VIEW,
  entry_record: PERMISSIONS.GATE_ENTRY_RECORD,
  pickup_verify: PERMISSIONS.GATE_PICKUP_VERIFY,
  exit_confirm: PERMISSIONS.GATE_EXIT_CONFIRM,
  incident_escalate: PERMISSIONS.GATE_INCIDENT_ESCALATE,
};
export function requireGateDuty(
  context: { assignment: { duties: readonly string[] } },
  duty: GateDuty,
) {
  if (
    !context.assignment.duties.includes(duty) ||
    !ROLE_PERMISSIONS.gate_staff.includes(dutyPermissions[duty])
  )
    throw forbidden();
  // Deliberate G4b phase gate. A permission-map change cannot enable a release API.
  throw forbidden();
}

export function requireAutomatedReleaseAuthority(): never {
  throw new RequestContractError(
    403,
    'Automated release is unavailable pending school policy and typed pickup authority',
  );
}

export const readGateAssignment = (
  identity: JwtPayload | undefined,
  token: string,
  gateId: unknown,
  assignmentId: unknown,
) =>
  withGateAssignmentContext(
    identity,
    token,
    gateId,
    assignmentId,
    async (_session, context) => ({
      gate: {
        id: String(context.gate._id),
        name: context.gate.name,
        revision: context.gate.revision,
      },
      assignment: {
        id: String(context.assignment._id),
        revision: context.assignment.revision,
        validUntil: context.assignment.validUntil,
      },
      operationalActions: [],
    }),
  );
