import {Router} from 'express';

import {
  createBranchController,
  getBranches,
} from '../controllers/branch.controller';

import {authenticateToken} from '../middleware/auth.middleware';
import {requireRole} from '../middleware/rbac.middleware';
import {requireBranchScope} from '../middleware/branch.middleware';
import {getMyBranch} from '../controllers/branch.controller';

const router = Router();

router.post(
  '/',
  authenticateToken,
  requireRole('super_admin'),
  createBranchController,
);

router.get(
  '/',
  authenticateToken,
  requireRole('super_admin'),
  getBranches,
);
router.get(
  '/my-branch',
  authenticateToken,
  requireBranchScope,
  getMyBranch,
);
export default router;