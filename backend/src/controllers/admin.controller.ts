import {Request, Response} from 'express';
import {getSuperAdminDashboard} from '../services/admin.service';

export const getSuperAdminDashboardController = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const dashboard = await getSuperAdminDashboard();

    res.status(200).json({
      success: true,
      message: 'Super Admin dashboard fetched successfully',
      data: dashboard,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch Super Admin dashboard',
    });
  }
};