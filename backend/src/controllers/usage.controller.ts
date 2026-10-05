import {Request, Response} from 'express';

import {getUsageStatus} from '../services/usage.service';

export const getUsageStatusController = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const usageStatus = await getUsageStatus();

    res.status(200).json({
      success: true,
      message: 'Usage status fetched successfully',
      data: usageStatus,
    });
  } catch (error) {
    console.error('Usage status error:', error);

    res.status(500).json({
      success: false,
      message: 'Failed to fetch usage status',
    });
  }
};