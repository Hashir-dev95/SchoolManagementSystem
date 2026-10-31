import { Router, type Response } from 'express';
import {
  authenticateToken,
  type AuthenticatedRequest,
} from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import {
  parentActor,
  getParentChildren,
  getParentChild,
  verifiedChild,
} from '../services/parent-scope.service';
import { studentEnrollmentDTO } from '../services/student-self-scope.service';
import { RequestContractError } from '../utils/request-validation';
import User from '../models/user';
import {
  readStudentTimetable,
  readStudentPhysicalAttendance,
} from '../services/student-occurrence-read.service';

export const parentRead =
  (
    action: (request: AuthenticatedRequest) => Promise<unknown>,
    query: string[] = [],
  ) =>
  async (request: AuthenticatedRequest, response: Response) => {
    try {
      if (
        request.body !== undefined ||
        Object.keys(request.query).some(key => !query.includes(key))
      ) {
        throw new RequestContractError(
          403,
          'Parent or child scope cannot be selected',
        );
      }
      const data = await action(request);
      // Observe relationship revocation/identity changes occurring during a slow read.
      if (request.params.studentId) {
        await verifiedChild(request.user, request.params.studentId);
      }
      response.json({ success: true, data });
    } catch (error) {
      response
        .status(error instanceof RequestContractError ? error.status : 500)
        .json({
          success: false,
          message:
            error instanceof RequestContractError
              ? error.message
              : 'Parent workspace is unavailable. Please retry.',
        });
    }
  };
const router = Router();
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
router.use(authenticateToken, requireRole('parent'));
router.get(
  '/',
  parentRead(async request => {
    const { actor } = await parentActor(request.user);
    const user = await User.findById(actor._id)
      .select('fullName')
      .read('primary')
      .lean();
    return { fullName: user?.fullName ?? '' };
  }),
);
router.get(
  '/children',
  parentRead(request => getParentChildren(request.user)),
);
router.get(
  '/children/:studentId',
  parentRead(request => getParentChild(request.user, request.params.studentId)),
);
router.get(
  '/children/:studentId/enrollment',
  parentRead(async request =>
    studentEnrollmentDTO(
      (await verifiedChild(request.user, request.params.studentId)).scope,
    ),
  ),
);
router.get(
  '/children/:studentId/timetable',
  parentRead(
    async request =>
      readStudentTimetable(
        (await verifiedChild(request.user, request.params.studentId)).scope,
        request.query.date,
      ),
    ['date'],
  ),
);
router.get(
  '/children/:studentId/attendance',
  parentRead(
    async request =>
      readStudentPhysicalAttendance(
        (await verifiedChild(request.user, request.params.studentId)).scope,
        request.query.date,
      ),
    ['date'],
  ),
);
export default router;
