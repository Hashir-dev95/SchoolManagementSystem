import { Router, type ErrorRequestHandler, type Response } from 'express';
import {
  authenticateToken,
  type AuthenticatedRequest,
} from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { RequestContractError } from '../utils/request-validation';
import { readGateAssignment } from '../services/gate-authority.service';
import {
  assignGateOperator,
  createGate,
  provisionGateOperator,
  readStudentCustody,
  revokeGateAssignment,
  updateGate,
  updateStudentCustody,
} from '../services/gate-administration.service';

const respond =
  (run: (req: AuthenticatedRequest) => Promise<unknown>, status = 200) =>
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      res.status(status).json({ success: true, data: await run(req) });
    } catch (error) {
      res
        .status(error instanceof RequestContractError ? error.status : 500)
        .json({
          success: false,
          message:
            error instanceof RequestContractError
              ? error.message
              : 'Gate foundation request failed',
        });
    }
  };
const token = (req: AuthenticatedRequest) =>
  req.headers.authorization!.slice(7);
const noStore = (
  _req: AuthenticatedRequest,
  res: Response,
  next: () => void,
) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

export const gateAdministrationRouter = Router();
gateAdministrationRouter.use(
  noStore,
  authenticateToken,
  requireRole('super_admin'),
);
gateAdministrationRouter.post(
  '/branches/:branchId/operators',
  respond(
    req =>
      provisionGateOperator(
        req.user,
        token(req),
        req.params.branchId,
        req.body,
      ),
    201,
  ),
);
gateAdministrationRouter.post(
  '/branches/:branchId/gates',
  respond(
    req => createGate(req.user, token(req), req.params.branchId, req.body),
    201,
  ),
);
gateAdministrationRouter.post(
  '/branches/:branchId/gates/:gateId',
  respond(req =>
    updateGate(
      req.user,
      token(req),
      req.params.branchId,
      req.params.gateId,
      req.body,
    ),
  ),
);
gateAdministrationRouter.post(
  '/branches/:branchId/gates/:gateId/assignments',
  respond(
    req =>
      assignGateOperator(
        req.user,
        token(req),
        req.params.branchId,
        req.params.gateId,
        req.body,
      ),
    201,
  ),
);
gateAdministrationRouter.post(
  '/branches/:branchId/assignments/:assignmentId/revoke',
  respond(req =>
    revokeGateAssignment(
      req.user,
      token(req),
      req.params.branchId,
      req.params.assignmentId,
      req.body,
    ),
  ),
);
gateAdministrationRouter.get(
  '/branches/:branchId/students/:studentId/custody',
  respond(req =>
    readStudentCustody(
      req.user,
      token(req),
      req.params.branchId,
      req.params.studentId,
    ),
  ),
);
gateAdministrationRouter.post(
  '/branches/:branchId/students/:studentId/custody',
  respond(req =>
    updateStudentCustody(
      req.user,
      token(req),
      req.params.branchId,
      req.params.studentId,
      req.body,
    ),
  ),
);

export const gateFoundationRouter = Router();
gateFoundationRouter.use(noStore, authenticateToken, requireRole('gate_staff'));
gateFoundationRouter.get(
  '/me/gates/:gateId/assignments/:assignmentId',
  respond(req =>
    readGateAssignment(
      req.user,
      token(req),
      req.params.gateId,
      req.params.assignmentId,
    ),
  ),
);

export const gateFoundationParseError: ErrorRequestHandler = (
  error,
  _req,
  res,
  next,
) => {
  if (
    error?.type === 'entity.parse.failed' ||
    error?.type === 'entity.too.large'
  ) {
    res
      .status(400)
      .json({ success: false, message: 'Invalid gate foundation request' });
    return;
  }
  next(error);
};
