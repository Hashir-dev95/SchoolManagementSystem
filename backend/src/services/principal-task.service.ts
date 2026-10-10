import { Types } from 'mongoose';

import PrincipalTask, {
  IPrincipalTask,
  PRINCIPAL_TASK_STATUSES,
  PrincipalTaskStatus,
} from '../models/principalTask';
import User from '../models/user';

const validateObjectId = (value: string, fieldName: string): void => {
  if (!Types.ObjectId.isValid(value)) {
    throw new Error(`Invalid ${fieldName}`);
  }
};

export const getBranchPrincipalTasks = async (
  branchId: string,
): Promise<IPrincipalTask[]> => {
  validateObjectId(branchId, 'branch ID');

  const branchObjectId = new Types.ObjectId(branchId);

  const tasks = await PrincipalTask.collection
    .find({
      branchId: branchObjectId,
    })
    .sort({ createdAt: -1 })
    .toArray();

  return tasks as unknown as IPrincipalTask[];
};

export const getPrincipalTaskById = async (
  taskId: string,
  branchId: string,
): Promise<IPrincipalTask> => {
  validateObjectId(taskId, 'task ID');
  validateObjectId(branchId, 'branch ID');

  const task = await PrincipalTask.collection.findOne({
    _id: new Types.ObjectId(taskId),
    branchId: new Types.ObjectId(branchId),
  });

  if (!task) {
    throw new Error('Principal task not found');
  }

  return task as unknown as IPrincipalTask;
};

export interface CreatePrincipalTaskInput {
  branchId: string;
  actorId: string;
  title: string;
  description?: string;
  priority?: string;
  assignedTo: string;
  dueDate?: Date;
}

export const createPrincipalTask = async (
  data: CreatePrincipalTaskInput,
): Promise<IPrincipalTask> => {
  validateObjectId(data.branchId, 'branch ID');
  validateObjectId(data.actorId, 'actor ID');
  validateObjectId(data.assignedTo, 'assigned user ID');

  const title = data.title.trim();

  if (!title) {
    throw new Error('Task title is required');
  }

  const actor = await User.findById(data.actorId)
    .select('_id role branchId isActive')
    .exec();

  if (!actor) {
    throw new Error('Actor not found');
  }

  if (!actor.isActive) {
    throw new Error('Actor account is inactive');
  }

  if (!actor.branchId || actor.branchId.toString() !== data.branchId) {
    throw new Error('Actor is outside branch scope');
  }

  const assignedUser = await User.findById(data.assignedTo)
    .select('_id role branchId isActive')
    .exec();

  if (!assignedUser) {
    throw new Error('Assigned user not found');
  }

  if (!assignedUser.isActive) {
    throw new Error('Assigned user account is inactive');
  }

  if (
    !assignedUser.branchId ||
    assignedUser.branchId.toString() !== data.branchId
  ) {
    throw new Error('Assigned user is outside branch scope');
  }

  const taskDocument = {
    branchId: new Types.ObjectId(data.branchId),
    title,
    ...(data.description?.trim()
      ? { description: data.description.trim() }
      : {}),
    ...(data.priority ? { priority: data.priority } : {}),
    status: PRINCIPAL_TASK_STATUSES.PENDING,
    assignedTo: new Types.ObjectId(data.assignedTo),
    createdBy: new Types.ObjectId(data.actorId),
    ...(data.dueDate ? { dueDate: data.dueDate } : {}),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const result = await PrincipalTask.collection.insertOne(taskDocument);

  if (!result.insertedId) {
    throw new Error('Failed to create principal task');
  }

  const createdTask = await PrincipalTask.collection.findOne({
    _id: result.insertedId,
  });

  if (!createdTask) {
    throw new Error('Created principal task could not be retrieved');
  }

  return createdTask as unknown as IPrincipalTask;
};
export type PrincipalTaskAction =
  | 'start'
  | 'complete'
  | 'cancel';

export interface PrincipalTaskActionInput {
  taskId: string;
  actorId: string;
  branchId: string;
  action: PrincipalTaskAction;
}

export const processPrincipalTaskAction = async (
  data: PrincipalTaskActionInput,
): Promise<IPrincipalTask> => {
  validateObjectId(data.taskId, 'task ID');
  validateObjectId(data.actorId, 'actor ID');
  validateObjectId(data.branchId, 'branch ID');

  const taskId = new Types.ObjectId(data.taskId);
  const branchObjectId = new Types.ObjectId(data.branchId);
  const actorId = new Types.ObjectId(data.actorId);

  const task = await PrincipalTask.collection.findOne({
    _id: taskId,
    branchId: branchObjectId,
  });

  if (!task) {
    throw new Error('Principal task not found');
  }

  const actor = await User.findById(actorId)
    .select('_id role branchId isActive')
    .exec();

  if (!actor) {
    throw new Error('Actor not found');
  }

  if (!actor.isActive) {
    throw new Error('Actor account is inactive');
  }

  if (
    !actor.branchId ||
    actor.branchId.toString() !== data.branchId
  ) {
    throw new Error('Actor is outside branch scope');
  }

  if (
    data.action !== 'start' &&
    data.action !== 'complete' &&
    data.action !== 'cancel'
  ) {
    throw new Error('Invalid principal task action');
  }

  if (
    task.assignedTo.toString() !== data.actorId &&
    task.createdBy.toString() !== data.actorId
  ) {
    throw new Error('Actor is not authorized for this task');
  }

  const update: {
    status?: PrincipalTaskStatus;
    completedAt?: Date | null;
  } = {};

  if (data.action === 'start') {
    if (task.status !== PRINCIPAL_TASK_STATUSES.PENDING) {
      throw new Error('Only pending tasks can be started');
    }

    update.status = PRINCIPAL_TASK_STATUSES.IN_PROGRESS;
  }

  if (data.action === 'complete') {
    if (
      task.status !== PRINCIPAL_TASK_STATUSES.PENDING &&
      task.status !== PRINCIPAL_TASK_STATUSES.IN_PROGRESS
    ) {
      throw new Error('Only active tasks can be completed');
    }

    update.status = PRINCIPAL_TASK_STATUSES.COMPLETED;
    update.completedAt = new Date();
  }

  if (data.action === 'cancel') {
    if (
      task.status === PRINCIPAL_TASK_STATUSES.COMPLETED ||
      task.status === PRINCIPAL_TASK_STATUSES.CANCELLED
    ) {
      throw new Error('Completed or cancelled task cannot be cancelled');
    }

    update.status = PRINCIPAL_TASK_STATUSES.CANCELLED;
    update.completedAt = null;
  }

  const result = await PrincipalTask.collection.updateOne(
    {
      _id: taskId,
      branchId: branchObjectId,
      status: task.status,
    },
    {
      $set: {
        ...update,
        updatedAt: new Date(),
      },
    },
  );

  if (result.matchedCount === 0) {
    throw new Error(
      'Principal task was already modified or is no longer available',
    );
  }

  const updatedTask = await PrincipalTask.collection.findOne({
    _id: taskId,
    branchId: branchObjectId,
  });

  if (!updatedTask) {
    throw new Error('Principal task not found');
  }

  return updatedTask as unknown as IPrincipalTask;
};