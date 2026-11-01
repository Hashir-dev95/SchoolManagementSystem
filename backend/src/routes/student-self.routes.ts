import { Router, type Response } from 'express';
import {
  authenticateToken,
  type AuthenticatedRequest,
} from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import {
  getStudentSelf,
  getStudentEnrollment,
} from '../services/student-self-scope.service';
import { RequestContractError } from '../utils/request-validation';
import { readStudentFees } from '../services/finance-authority.service';
import { resolveStudentSelf } from '../services/student-self-scope.service';
import {
  getStudentAssignedReads,
  getStudentAssignedRead,
  getStudentPublishedReads,
  getStudentPublishedRead,
} from '../services/student-academic-read.service';
import {
  getStudentTimetable,
  getStudentPhysicalAttendance,
} from '../services/student-occurrence-read.service';

export const studentSelfRead =
  (
    action: (request: AuthenticatedRequest) => Promise<unknown>,
    allowedQuery: string[] = [],
  ) =>
  async (request: AuthenticatedRequest, response: Response) => {
    try {
      // A self endpoint never accepts alternate identity/scope in any input channel.
      if (
        request.body !== undefined ||
        Object.keys(request.query).some(key => !allowedQuery.includes(key))
      ) {
        throw new RequestContractError(
          403,
          'Student identity and scope cannot be selected',
        );
      }
      response.json({ success: true, data: await action(request) });
    } catch (error) {
      response
        .status(error instanceof RequestContractError ? error.status : 500)
        .json({
          success: false,
          message:
            error instanceof RequestContractError
              ? error.message
              : 'Student workspace is unavailable. Please retry.',
        });
    }
  };

const router = Router();
router.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'no-store');
  next();
});
router.use(authenticateToken, requireRole('student'));
router.get(
  '/',
  studentSelfRead(request => getStudentSelf(request.user)),
);
router.get(
  '/enrollment',
  studentSelfRead(request => getStudentEnrollment(request.user)),
);
// No ID-based alias, write or arbitrary scope selector exists under /me.
router.get(
  '/fees',
  studentSelfRead(async request =>
    readStudentFees(await resolveStudentSelf(request.user)),
  ),
);
router.get(
  '/homework',
  studentSelfRead(request => getStudentAssignedReads(request.user, 'homework')),
);
router.get(
  '/quizzes',
  studentSelfRead(request => getStudentAssignedReads(request.user, 'quiz')),
);
router.get(
  '/homework/:id',
  studentSelfRead(request =>
    getStudentAssignedRead(request.user, 'homework', String(request.params.id)),
  ),
);
router.get(
  '/quizzes/:id',
  studentSelfRead(request =>
    getStudentAssignedRead(request.user, 'quiz', String(request.params.id)),
  ),
);
router.get(
  '/results',
  studentSelfRead(request => getStudentPublishedReads(request.user)),
);
router.get(
  '/results/:id',
  studentSelfRead(request =>
    getStudentPublishedRead(request.user, request.params.id),
  ),
);
router.get(
  '/timetable',
  studentSelfRead(
    request => getStudentTimetable(request.user, request.query.date),
    ['date'],
  ),
);
router.get(
  '/attendance',
  studentSelfRead(
    request => getStudentPhysicalAttendance(request.user, request.query.date),
    ['date'],
  ),
);
router.use((_request, response) => {
  response.status(403).json({
    success: false,
    message: 'Student self-service operation is not permitted',
  });
});
export default router;
