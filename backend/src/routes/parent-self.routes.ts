import { Router, type Response } from 'express';
import parentLeaveDraftRoutes from './parent-leave-draft.routes';
import {parentPickupRouter} from './pickup-authorization.routes';
import {parentEarlyExitRouter} from './early-exit.routes';
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
import { readStudentFees } from '../services/finance-authority.service';
import { startParentCheckout } from '../services/finance-payment.service';
import { readStudentAssignedWork } from '../services/student-academic-read.service';
import { readPublishedResultsForVerifiedStudent } from '../services/academic-result.service';
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
router.use('/children/:studentId/pickup-authorizations', parentPickupRouter);
router.use('/children/:studentId/early-exit-requests', parentEarlyExitRouter);
router.use('/children/:studentId/leave-applications', parentLeaveDraftRoutes);
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
router.get(
  '/children/:studentId/homework',
  parentRead(async request =>
    readStudentAssignedWork(
      (await verifiedChild(request.user, request.params.studentId)).scope,
      'homework',
    ),
  ),
);
router.get(
  '/children/:studentId/quizzes',
  parentRead(async request =>
    readStudentAssignedWork(
      (await verifiedChild(request.user, request.params.studentId)).scope,
      'quiz',
    ),
  ),
);
router.get(
  '/children/:studentId/results',
  parentRead(async request =>
    readPublishedResultsForVerifiedStudent(
      (await verifiedChild(request.user, request.params.studentId)).scope.actor,
    ),
  ),
);
// No linking, submissions, attempts or arbitrary-ID aliases are public here.
router.get(
  '/children/:studentId/fees',
  parentRead(async request =>
    readStudentFees(
      (await verifiedChild(request.user, request.params.studentId)).scope,
    ),
  ),
);
router.post(
  '/children/:studentId/fees/:feeId/checkout',
  async (request: AuthenticatedRequest, response) => {
    try {
      if (Object.keys(request.query).length) {
        throw new RequestContractError(403, 'Scope cannot be selected');
      }
      const data = await startParentCheckout(
        request.user,
        request.headers.authorization!.slice(7),
        request.params.studentId,
        request.params.feeId,
        request.body,
      );
      await verifiedChild(request.user, request.params.studentId);
      response.json({ success: true, data });
    } catch (error) {
      response
        .status(error instanceof RequestContractError ? error.status : 500)
        .json({
          success: false,
          message:
            error instanceof RequestContractError
              ? error.message
              : 'Checkout unavailable',
        });
    }
  },
);
router.use((_req, res) => {
  res
    .status(403)
    .json({ success: false, message: 'Parent operation is not permitted' });
});
export default router;
