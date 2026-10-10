import { Response } from 'express';

import { BranchScopedRequest } from '../middleware/branch.middleware';
import {
  createPrincipalTask,
  getBranchPrincipalTasks,
  getPrincipalTaskById,
  processPrincipalTaskAction,
} from '../services/principal-task.service';

export const getPrincipalTasksController = async (
  req: BranchScopedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.branchId) {
      res.status(403).json({
        success: false,
        message: 'Branch scope is required',
      });
      return;
    }

    const data = await getBranchPrincipalTasks(req.branchId);

    res.status(200).json({
      success: true,
      message: 'Principal tasks fetched successfully',
      data,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to fetch principal tasks';

    if (message === 'Invalid branch ID') {
      res.status(400).json({
        success: false,
        message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: 'Failed to fetch principal tasks',
    });
  }
};

export const getPrincipalTaskByIdController = async (
  req: BranchScopedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.branchId) {
      res.status(403).json({
        success: false,
        message: 'Branch scope is required',
      });
      return;
    }

    const taskIdParam = req.params.taskId;
    const taskId = Array.isArray(taskIdParam) ? taskIdParam[0] : taskIdParam;

    if (!taskId) {
      res.status(400).json({
        success: false,
        message: 'Principal task ID is required',
      });
      return;
    }

    const data = await getPrincipalTaskById(taskId, req.branchId);

    res.status(200).json({
      success: true,
      message: 'Principal task fetched successfully',
      data,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to fetch principal task';

    if (message === 'Invalid task ID' || message === 'Invalid branch ID') {
      res.status(400).json({
        success: false,
        message,
      });
      return;
    }

    if (message === 'Principal task not found') {
      res.status(404).json({
        success: false,
        message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: 'Failed to fetch principal task',
    });
  }
};

export const createPrincipalTaskController = async (
  req: BranchScopedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.branchId) {
      res.status(403).json({
        success: false,
        message: 'Branch scope is required',
      });
      return;
    }

    const actorId = req.user?.userId;

    if (!actorId) {
      res.status(401).json({
        success: false,
        message: 'Authenticated user is required',
      });
      return;
    }

    const { title, description, priority, assignedTo, dueDate } = req.body as {
      title?: string;
      description?: string;
      priority?: string;
      assignedTo?: string;
      dueDate?: string;
    };

    if (!title?.trim()) {
      res.status(400).json({
        success: false,
        message: 'Task title is required',
      });
      return;
    }

    if (!assignedTo) {
      res.status(400).json({
        success: false,
        message: 'Assigned user is required',
      });
      return;
    }

    const data = await createPrincipalTask({
      branchId: req.branchId,
      actorId,
      title,
      ...(description ? { description } : {}),
      ...(priority ? { priority } : {}),
      assignedTo,
      ...(dueDate ? { dueDate: new Date(dueDate) } : {}),
    });

    res.status(201).json({
      success: true,
      message: 'Principal task created successfully',
      data,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to create principal task';

    if (
      message === 'Invalid branch ID' ||
      message === 'Invalid actor ID' ||
      message === 'Invalid assigned user ID' ||
      message === 'Task title is required'
    ) {
      res.status(400).json({
        success: false,
        message,
      });
      return;
    }

    if (
      message === 'Actor not found' ||
      message === 'Actor account is inactive' ||
      message === 'Actor is outside branch scope' ||
      message === 'Assigned user not found' ||
      message === 'Assigned user account is inactive' ||
      message === 'Assigned user is outside branch scope'
    ) {
      res.status(403).json({
        success: false,
        message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create principal task',
    });
  }
};

export const processPrincipalTaskActionController = async (
  req: BranchScopedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.branchId) {
      res.status(403).json({
        success: false,
        message: 'Branch scope is required',
      });
      return;
    }

    const taskIdParam = req.params.taskId;
    const taskId = Array.isArray(taskIdParam) ? taskIdParam[0] : taskIdParam;

    if (!taskId) {
      res.status(400).json({
        success: false,
        message: 'Principal task ID is required',
      });
      return;
    }

    const actorId = req.user?.userId;

    if (!actorId) {
      res.status(401).json({
        success: false,
        message: 'Authenticated user is required',
      });
      return;
    }

    const { action } = req.body as {
      action?: string;
    };

    if (action !== 'start' && action !== 'complete' && action !== 'cancel') {
      res.status(400).json({
        success: false,
        message: 'Invalid principal task action',
      });
      return;
    }

    const data = await processPrincipalTaskAction({
      taskId,
      actorId,
      branchId: req.branchId,
      action,
    });

    res.status(200).json({
      success: true,
      message: 'Principal task action completed successfully',
      data,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to process principal task action';

    if (
      message === 'Invalid task ID' ||
      message === 'Invalid actor ID' ||
      message === 'Invalid branch ID' ||
      message === 'Invalid principal task action'
    ) {
      res.status(400).json({
        success: false,
        message,
      });
      return;
    }

    if (
      message === 'Principal task not found' ||
      message ===
        'Principal task was already modified or is no longer available'
    ) {
      res.status(404).json({
        success: false,
        message,
      });
      return;
    }

    if (
      message === 'Actor not found' ||
      message === 'Actor account is inactive' ||
      message === 'Actor is outside branch scope' ||
      message === 'Actor is not authorized for this task' ||
      message === 'Only pending tasks can be started' ||
      message === 'Only active tasks can be completed' ||
      message === 'Completed or cancelled task cannot be cancelled'
    ) {
      res.status(403).json({
        success: false,
        message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: 'Failed to process principal task action',
    });
  }
};
