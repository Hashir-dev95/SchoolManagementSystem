import {Response} from 'express';

import {BranchScopedRequest} from '../middleware/branch.middleware';
import {
  getBranchSafetyAlerts,
  processSafetyAlertAction,
} from '../services/safety-alert.service';

export const getSafetyAlertsController = async (
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

    const data = await getBranchSafetyAlerts(req.branchId);

    res.status(200).json({
      success: true,
      message: 'Safety alerts fetched successfully',
      data,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to fetch safety alerts';

    if (message === 'Invalid branch ID') {
      res.status(400).json({
        success: false,
        message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: 'Failed to fetch safety alerts',
    });
  }
};

export const processSafetyAlertActionController = async (
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

    const alertIdParam = req.params.alertId;
    const alertId = Array.isArray(alertIdParam)
      ? alertIdParam[0]
      : alertIdParam;

    if (!alertId) {
      res.status(400).json({
        success: false,
        message: 'Safety alert ID is required',
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

    const {action, assignedTo} = req.body as {
      action?: string;
      assignedTo?: string;
    };

    if (
      action !== 'assign' &&
      action !== 'resolve' &&
      action !== 'escalate'
    ) {
      res.status(400).json({
        success: false,
        message: 'Invalid safety alert action',
      });
      return;
    }

    await processSafetyAlertAction({
      alertId,
      actorId,
      branchId: req.branchId,
      action,
      ...(assignedTo ? {assignedTo} : {}),
    });

    res.status(200).json({
      success: true,
      message: 'Safety alert action completed successfully',
      data: null,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to process safety alert action';

    if (
      message === 'Invalid alert ID' ||
      message === 'Invalid assigned user ID'
    ) {
      res.status(400).json({
        success: false,
        message,
      });
      return;
    }

    if (
      message === 'Safety alert not found' ||
      message ===
        'Safety alert was already resolved or no longer available'
    ) {
      res.status(404).json({
        success: false,
        message,
      });
      return;
    }

    if (
      message === 'Resolved safety alert cannot be modified' ||
      message === 'Assigned user is required' ||
      message === 'Assigned user not found' ||
      message === 'Assigned user account is inactive' ||
      message === 'Assigned user is outside branch scope' ||
      message === 'Actor not found' ||
      message === 'Actor account is inactive' ||
      message === 'Actor is outside branch scope'
    ) {
      res.status(403).json({
        success: false,
        message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: 'Failed to process safety alert action',
    });
  }
};
