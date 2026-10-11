import { Response } from 'express';

import { BranchScopedRequest } from '../middleware/branch.middleware';
import {objectIdField, RequestContractError, writeFailure, writeScope} from '../utils/request-validation';
import {taskActionBody, taskCreateBody} from '../utils/principal-write.validation';
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
    if (error instanceof RequestContractError) {writeFailure(res, error); return;}
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
    if (error instanceof RequestContractError) {writeFailure(res, error); return;}
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

export const createPrincipalTaskController = async (req: BranchScopedRequest, res: Response): Promise<void> => {
  try {
    const actor = writeScope(req);
    const input = taskCreateBody(req.body);
    const data = await createPrincipalTask({...actor, ...input});
    res.status(201).json({success: true, message: 'Principal task created successfully', data});
  } catch (error) {writeFailure(res, error);}
};

export const processPrincipalTaskActionController = async (req: BranchScopedRequest, res: Response): Promise<void> => {
  try {
    const actor = writeScope(req);
    const input = taskActionBody(req.body);
    const taskId = objectIdField(req.params.taskId, 'task ID');
    const data = await processPrincipalTaskAction({...actor, ...input, taskId});
    res.status(200).json({success: true, message: 'Principal task action completed successfully', data});
  } catch (error) {writeFailure(res, error);}
};
