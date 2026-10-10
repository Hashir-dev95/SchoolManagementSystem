import {Router} from 'express';

import {authenticateToken} from '../middleware/auth.middleware';
import {requireRole} from '../middleware/rbac.middleware';
import {requirePermission} from '../middleware/permission.middleware';
import {requireBranchScope} from '../middleware/branch.middleware';
import {PERMISSIONS} from '../constants/permissions';

import {
  getPendingApprovalRequestsController,
   getApprovalRequestByIdController,
  processApprovalRequestController,
} from '../controllers/approval-request.controller';

const router = Router();

router.get(
  '/pending',
  authenticateToken,
  requireRole('principal'),
  requirePermission(PERMISSIONS.PRINCIPAL_APPROVALS_VIEW),
  requireBranchScope,
  getPendingApprovalRequestsController,
);

router.get(
  '/:requestId',
  authenticateToken,
  requireRole('principal'),
  requirePermission(PERMISSIONS.PRINCIPAL_APPROVALS_VIEW),
  requireBranchScope,
  getApprovalRequestByIdController,
);

router.patch(
  '/:requestId',
  authenticateToken,
  requireRole('principal'),
  requirePermission(PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE),
  requireBranchScope,
  processApprovalRequestController,
);

export default router;
