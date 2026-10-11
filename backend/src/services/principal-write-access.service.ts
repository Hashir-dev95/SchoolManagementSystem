import User from '../models/user';
import {objectIdField, RequestContractError} from '../utils/request-validation';

export const principalWriteActor = async (actorId: string, branchId: string) => {
  objectIdField(actorId, 'actor ID');
  objectIdField(branchId, 'branch ID');
  const actor = await User.findById(actorId).where('branchId').equals(branchId)
    .where('role').equals('principal').where('isActive').equals(true).select('_id');
  if (!actor) throw new RequestContractError(403, 'Principal write actor is not authorized');
  return actor;
};

export const principalWriteAssignee = async (assignedTo: unknown, branchId: string) => {
  const id = objectIdField(assignedTo, 'assigned user ID');
  const user = await User.findById(id).where('branchId').equals(branchId).select('_id role isActive');
  // Conceal missing and cross-branch assignees with the same response.
  if (!user) throw new RequestContractError(404, 'Assigned user not found');
  if (!user.isActive || !['principal', 'teacher'].includes(user.role)) {
    throw new RequestContractError(403, 'Assigned user is not eligible');
  }
  return user;
};
