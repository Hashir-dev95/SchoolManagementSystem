import { Types, type ClientSession } from 'mongoose';
import { PERMISSIONS } from '../constants/permissions';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import User from '../models/user';
import {
  objectBody,
  objectIdField,
  RequestContractError,
} from '../utils/request-validation';
import {
  ApprovalAccessError,
  assertApprovalAuthority,
} from './approval-authority.policy';

export const PARENT_LEAVE_ROUTE = 'shared_branch_principal' as const;
const unavailable = () =>
  new RequestContractError(
    503,
    'Leave submission is unavailable for this school.',
  );

export function readParentLeaveRouting(
  branchId: string,
  raw = process.env.PARENT_LEAVE_ROUTING_POLICY,
) {
  try {
    const value = objectBody(JSON.parse(raw ?? '{}'), [
      'policy',
      'version',
      'enabled',
      'branchIds',
    ]);
    if (
      value.policy !== PARENT_LEAVE_ROUTE ||
      value.enabled !== true ||
      typeof value.version !== 'number' ||
      !Number.isSafeInteger(value.version) ||
      value.version < 1 ||
      !Array.isArray(value.branchIds)
    )
      throw unavailable();
    const branches = value.branchIds.map(id =>
      objectIdField(id, 'routing Branch'),
    );
    if (
      new Set(branches).size !== branches.length ||
      !branches.includes(branchId)
    )
      throw unavailable();
    return { policy: PARENT_LEAVE_ROUTE, version: value.version };
  } catch {
    throw unavailable();
  }
}

/** Verify the shared queue has eligible members without assigning a reviewer. */
export async function verifyParentLeaveQueue(
  branchId: string,
  session: ClientSession,
) {
  const routing = readParentLeaveRouting(branchId);
  if (
    !ROLE_PERMISSIONS.principal.includes(
      PERMISSIONS.PRINCIPAL_APPROVALS_VIEW,
    ) ||
    !ROLE_PERMISSIONS.principal.includes(PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE)
  )
    throw unavailable();
  const candidates = await User.find({ role: 'principal', isActive: true })
    .where('branchId')
    .equals(branchId)
    .select('_id')
    .session(session)
    .lean();
  const eligible = candidates.filter(candidate => {
    try {
      assertApprovalAuthority(String(candidate._id), branchId, {
        approvalType: 'leave',
      });
      return true;
    } catch (error) {
      if (error instanceof ApprovalAccessError) return false;
      throw error;
    }
  });
  if (eligible.length === 0) throw unavailable();
  // A concurrent role/Branch update to an eligible member conflicts with this
  // transaction. This records no assignee or delegation on the application.
  const result = await User.collection.updateMany(
    {
      _id: { $in: eligible.map(candidate => candidate._id) },
      branchId: new Types.ObjectId(branchId),
      role: 'principal',
      isActive: true,
    },
    { $inc: { __v: 1 } },
    { session },
  );
  if (result.matchedCount !== eligible.length) throw unavailable();
  return routing;
}
