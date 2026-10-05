import {Router} from 'express';

import {getSuperAdminDashboardController} from '../controllers/admin.controller';
import {authenticateToken} from '../middleware/auth.middleware';
import {requireRole} from '../middleware/rbac.middleware';

const router = Router();

router.get(
  '/dashboard',
  authenticateToken,
  requireRole('super_admin'),
  getSuperAdminDashboardController,
);

export default router;