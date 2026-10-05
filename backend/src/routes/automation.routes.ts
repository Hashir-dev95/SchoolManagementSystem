import {Router} from 'express';
import {authenticateToken} from '../middleware/auth.middleware';
import {requireRole} from '../middleware/rbac.middleware';
import {
  getAutomationsController,
  toggleAutomationPauseController,
} from '../controllers/automation.controller';

const router = Router();

router.get(
  '/',
  authenticateToken,
  requireRole('super_admin'),
  getAutomationsController,
);

router.patch(
  '/:key/pause',
  authenticateToken,
  requireRole('super_admin'),
  toggleAutomationPauseController,
);

export default router;
