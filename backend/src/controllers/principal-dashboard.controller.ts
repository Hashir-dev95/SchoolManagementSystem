import {Response} from 'express';

import {BranchScopedRequest} from '../middleware/branch.middleware';
import {getPrincipalDashboard} from '../services/principal-dashboard.service';

export const getPrincipalDashboardController = async (
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

    const data = await getPrincipalDashboard(req.branchId);

    res.status(200).json({
      success: true,
      message: 'Principal dashboard fetched successfully',
      data,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to fetch principal dashboard';

    if (message === 'Invalid branch ID') {
      res.status(400).json({
        success: false,
        message,
      });
      return;
    }

    if (message === 'Branch not found') {
      res.status(404).json({
        success: false,
        message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: 'Failed to fetch principal dashboard',
    });
  }
};