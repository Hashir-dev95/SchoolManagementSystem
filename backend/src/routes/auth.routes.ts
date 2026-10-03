import {Router} from 'express';

import {
  getCurrentUser,
  login,
  register,
  rbacTest,
} from '../controllers/auth.controller';
import {authenticateToken} from '../middleware/auth.middleware';
import {requireRole} from '../middleware/rbac.middleware';


const router = Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', authenticateToken, getCurrentUser);
router.get(
  '/rbac-test',
  authenticateToken,
  requireRole('principal'),
  rbacTest,
);

export default router;