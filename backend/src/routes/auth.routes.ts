import {Router} from 'express';

import {
  getCurrentUser,
  login,
  register,
} from '../controllers/auth.controller';
import {authenticateToken} from '../middleware/auth.middleware';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', authenticateToken, getCurrentUser);

export default router;