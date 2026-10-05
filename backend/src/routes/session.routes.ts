import {Router} from 'express';
import {authenticateToken} from '../middleware/auth.middleware';
import {requireRole} from '../middleware/rbac.middleware';
import {
  getSessionsController,
  revokeSessionController,
} from '../controllers/session.controller';

const router = Router();

router.get(
  '/',
  authenticateToken,
  requireRole('super_admin'),
  getSessionsController,
);

router.patch(
  '/:sessionId/revoke',
  authenticateToken,
  requireRole('super_admin'),
  revokeSessionController,
);

export default router;
