import { Router } from 'express';

import { authenticateToken } from '../middleware/auth.middleware';
import { requireBranchScope } from '../middleware/branch.middleware';
import { requirePermission } from '../middleware/permission.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import { getPrincipalDashboardController } from '../controllers/principal-dashboard.controller';
import { getSafetyAlertsController } from '../controllers/safety-alert.controller';
import { processSafetyAlertActionController } from '../controllers/safety-alert.controller';
import {
  getSchoolNoticesController,
  getSchoolNoticeByIdController,
} from '../controllers/school-notice.controller';
import {
  getPrincipalTasksController,
  getPrincipalTaskByIdController,
  createPrincipalTaskController,
  processPrincipalTaskActionController,
} from '../controllers/principal-task.controller';
const router = Router();

router.get(
  '/dashboard',
  authenticateToken,
  requireRole('principal'),
  requirePermission(PERMISSIONS.PRINCIPAL_DASHBOARD_VIEW),
  requireBranchScope,
  getPrincipalDashboardController,
);
router.get(
  '/safety-alerts',
  authenticateToken,
  requireRole('principal'),
  requirePermission(PERMISSIONS.PRINCIPAL_DASHBOARD_VIEW),
  requireBranchScope,
  getSafetyAlertsController,
);
router.patch(
  '/safety-alerts/:alertId',
  authenticateToken,
  requireRole('principal'),
  requirePermission(PERMISSIONS.PRINCIPAL_TASKS_MANAGE),
  requireBranchScope,
  processSafetyAlertActionController,
);
router.get(
  '/notices',
  authenticateToken,
  requireRole('principal'),
  requirePermission(PERMISSIONS.PRINCIPAL_DASHBOARD_VIEW),
  requireBranchScope,
  getSchoolNoticesController,
);

router.get(
  '/notices/:noticeId',
  authenticateToken,
  requireRole('principal'),
  requirePermission(PERMISSIONS.PRINCIPAL_DASHBOARD_VIEW),
  requireBranchScope,
  getSchoolNoticeByIdController,
);

router.get(
  '/tasks',
  authenticateToken,
  requireRole('principal'),
  requirePermission(PERMISSIONS.PRINCIPAL_DASHBOARD_VIEW),
  requireBranchScope,
  getPrincipalTasksController,
);

router.get(
  '/tasks/:taskId',
  authenticateToken,
  requireRole('principal'),
  requirePermission(PERMISSIONS.PRINCIPAL_DASHBOARD_VIEW),
  requireBranchScope,
  getPrincipalTaskByIdController,
);

router.post(
  '/tasks',
  authenticateToken,
  requireRole('principal'),
  requirePermission(PERMISSIONS.PRINCIPAL_TASKS_MANAGE),
  requireBranchScope,
  createPrincipalTaskController,
);

router.patch(
  '/tasks/:taskId',
  authenticateToken,
  requireRole('principal'),
  requirePermission(PERMISSIONS.PRINCIPAL_TASKS_MANAGE),
  requireBranchScope,
  processPrincipalTaskActionController,
);

export default router;
