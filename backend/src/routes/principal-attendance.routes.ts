import { Router, type Response } from 'express';
import {
  authenticateToken,
  type AuthenticatedRequest,
} from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { RequestContractError } from '../utils/request-validation';
import {
  listPrincipalAttendance,
  getPrincipalAttendanceOccurrence,
  principalAttendanceFilters,
  principalAttendancePatterns,
} from '../services/principal-attendance.service';
const router = Router();
router.use(authenticateToken, requireRole('principal'));
const handle =
  (action: (req: AuthenticatedRequest) => Promise<unknown>) =>
  async (req: AuthenticatedRequest, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (req.body !== undefined)
        throw new RequestContractError(
          400,
          'Unsupported attendance request body',
        );
      res.json({ success: true, data: await action(req) });
    } catch (error) {
      res
        .status(error instanceof RequestContractError ? error.status : 500)
        .json({
          success: false,
          message:
            error instanceof RequestContractError
              ? error.message
              : 'Unable to load attendance. Please retry.',
        });
    }
  };
router.get(
  '/',
  handle(req => listPrincipalAttendance(req.user, req.query)),
);
router.get(
  '/filters',
  handle(req => principalAttendanceFilters(req.user, req.query)),
);
router.get(
  '/patterns',
  handle(req => principalAttendancePatterns(req.user, req.query)),
);
router.get(
  '/occurrences/:periodId',
  handle(req =>
    getPrincipalAttendanceOccurrence(req.user, req.params.periodId, req.query),
  ),
);
export default router;
