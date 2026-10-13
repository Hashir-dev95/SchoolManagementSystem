import {Router} from 'express';
import {authenticateToken} from '../middleware/auth.middleware';
import {requireRole} from '../middleware/rbac.middleware';
import {requirePermission} from '../middleware/permission.middleware';
import {PERMISSIONS} from '../constants/permissions';
import {createAssignment, revokeAssignment} from '../controllers/teacher.controller';

const router = Router();
router.use((_req, res, next) => {res.setHeader('Cache-Control', 'no-store'); next();});
router.use(authenticateToken, requireRole('principal', 'super_admin'), requirePermission(PERMISSIONS.TEACHER_ASSIGNMENTS_MANAGE));
router.post('/', createAssignment);
router.patch('/:assignmentId/revoke', revokeAssignment);
export default router;
