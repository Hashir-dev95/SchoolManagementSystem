import {Response} from 'express';

import {BranchScopedRequest} from '../middleware/branch.middleware';
import {objectIdField, writeFailure, writeScope} from '../utils/request-validation';
import {safetyActionBody} from '../utils/principal-write.validation';
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

export const processSafetyAlertActionController = async (req: BranchScopedRequest, res: Response): Promise<void> => {
  try {
    const actor = writeScope(req);
    const input = safetyActionBody(req.body);
    const alertId = objectIdField(req.params.alertId, 'alert ID');
    await processSafetyAlertAction({...actor, ...input, alertId});
    res.status(200).json({success: true, message: 'Safety alert action completed successfully', data: null});
  } catch (error) {writeFailure(res, error);}
};
