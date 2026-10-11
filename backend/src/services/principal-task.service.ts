import {Types} from 'mongoose';
import PrincipalTask, {IPrincipalTask, PRINCIPAL_TASK_PRIORITIES, PRINCIPAL_TASK_STATUSES} from '../models/principalTask';
import {principalWriteActor, principalWriteAssignee} from './principal-write-access.service';
import {enumField, validDate, objectIdField, RequestContractError, textField} from '../utils/request-validation';

export const getBranchPrincipalTasks = async (branchId: string): Promise<IPrincipalTask[]> => {
  objectIdField(branchId, 'branch ID');
  return PrincipalTask.find().where('branchId').equals(branchId).sort({createdAt: -1});
};

export const getPrincipalTaskById = async (taskId: string, branchId: string): Promise<IPrincipalTask> => {
  objectIdField(taskId, 'task ID');
  objectIdField(branchId, 'branch ID');
  const task = await PrincipalTask.findById(taskId).where('branchId').equals(branchId);
  if (!task) throw new RequestContractError(404, 'Principal task not found');
  return task;
};

export interface CreatePrincipalTaskInput {
  branchId: string; actorId: string; title: string; description?: string;
  priority?: string; assignedTo: string; dueDate?: Date;
}

export const createPrincipalTask = async (data: CreatePrincipalTaskInput): Promise<IPrincipalTask> => {
  const title = textField(data.title, 'task title', 150, 2);
  const description = data.description === undefined ? undefined : textField(data.description, 'task description', 2000);
  const priority = data.priority === undefined ? undefined : enumField(data.priority, 'task priority', Object.values(PRINCIPAL_TASK_PRIORITIES));
  const dueDate = data.dueDate === undefined ? undefined : validDate(data.dueDate, 'Due date');
  const actor = await principalWriteActor(data.actorId, data.branchId);
  const assignee = await principalWriteAssignee(data.assignedTo, data.branchId);
  // Explicit fields only: model validation/defaults/timestamps now run on save.
  return new PrincipalTask({
    branchId: new Types.ObjectId(data.branchId), createdBy: actor._id,
    assignedTo: assignee._id, title, description, priority, dueDate,
  }).save();
};

export type PrincipalTaskAction = 'start' | 'complete' | 'cancel';
export interface PrincipalTaskActionInput {
  taskId: string; actorId: string; branchId: string; action: PrincipalTaskAction;
}

export const processPrincipalTaskAction = async (data: PrincipalTaskActionInput): Promise<IPrincipalTask> => {
  objectIdField(data.taskId, 'task ID');
  const action = enumField(data.action, 'task action', ['start', 'complete', 'cancel'] as const);
  const actor = await principalWriteActor(data.actorId, data.branchId);
  const task = await PrincipalTask.findById(data.taskId).where('branchId').equals(data.branchId);
  if (!task) throw new RequestContractError(404, 'Principal task not found');
  if (String(task.assignedTo) !== actor._id.toString() && String(task.createdBy) !== actor._id.toString()) {
    throw new RequestContractError(403, 'Actor is not authorized for this task');
  }
  const active = [PRINCIPAL_TASK_STATUSES.PENDING, PRINCIPAL_TASK_STATUSES.IN_PROGRESS] as string[];
  if ((action === 'start' && task.status !== PRINCIPAL_TASK_STATUSES.PENDING) || !active.includes(task.status)) {
    throw new RequestContractError(409, 'Task action is not allowed in its current state');
  }
  const now = new Date();
  const status = action === 'start' ? 'in_progress' : action === 'complete' ? 'completed' : 'cancelled';
  const updated = await PrincipalTask.findOneAndUpdate({
    _id: task._id, branchId: task.branchId, status: task.status,
    assignedTo: task.assignedTo, createdBy: task.createdBy, updatedAt: task.updatedAt,
    __v: task.__v ?? {$exists: false},
  }, {
    $set: {status, ...(action === 'complete' ? {completedAt: now} : action === 'cancel' ? {completedAt: null} : {})},
    $push: {history: {action, performedBy: actor._id, createdAt: now}},
    $inc: {__v: 1},
  }, {returnDocument: 'after', runValidators: true});
  if (!updated) throw new RequestContractError(409, 'Principal task changed or was already processed');
  return updated;
};
