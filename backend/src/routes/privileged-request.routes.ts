import {Router} from 'express';

import {authenticateToken} from '../middleware/auth.middleware';
import {requireRole} from '../middleware/rbac.middleware';
import {
  getPendingPrivilegedRequestsController,
  reviewPrivilegedRequestController,
} from '../controllers/privileged-request.controller';

const router = Router();

router.get(
  '/pending',
  authenticateToken,
  requireRole('super_admin'),
  getPendingPrivilegedRequestsController,
);

router.patch(
  '/:requestId/review',
  authenticateToken,
  requireRole('super_admin'),
  reviewPrivilegedRequestController,
);

export default router;