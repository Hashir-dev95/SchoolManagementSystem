import { Router } from 'express';

import { getSuperAdminDashboardController } from '../controllers/admin.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { createPrincipalController } from '../controllers/principal.controller';
import { requirePermission } from '../middleware/permission.middleware';
import { PERMISSIONS } from '../constants/permissions';

const router = Router();

router.get(
  '/dashboard',
  authenticateToken,
  requireRole('super_admin'),
  requirePermission(PERMISSIONS.BRANCHES_VIEW),
  getSuperAdminDashboardController,
);
router.post(
  '/principals',
  authenticateToken,
  requireRole('super_admin'),
  requirePermission(PERMISSIONS.PRINCIPALS_MANAGE),
  createPrincipalController,
);
export default router;
