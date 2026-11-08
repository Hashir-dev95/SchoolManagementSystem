import { Router, type Response, type ErrorRequestHandler } from 'express';
import {
  authenticateToken,
  type AuthenticatedRequest,
} from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { requirePermission } from '../middleware/permission.middleware';
import { PERMISSIONS } from '../constants/permissions';
import { RequestContractError } from '../utils/request-validation';
import { ApprovalAccessError } from '../services/approval-authority.policy';
import {
  readParentExits,
  readPrincipalExits,
} from '../services/early-exit-read.service';
import {
  writeParentExit,
  decideEarlyExit,
} from '../services/early-exit-write.service';
const param = (req: AuthenticatedRequest, key: string) => {
  const value = req.params[key];
  if (typeof value !== 'string')
    throw new RequestContractError(400, 'Invalid request identifier');
  return value;
};
const token = (req: AuthenticatedRequest) =>
  req.headers.authorization!.slice(7);
const handle =
  (
    run: (req: AuthenticatedRequest) => Promise<unknown>,
    read = false,
    status = 200,
  ) =>
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (read ? req.body !== undefined : Object.keys(req.query).length > 0)
        throw new RequestContractError(400, 'Unsupported request fields');
      res.status(status).json({ success: true, data: await run(req) });
    } catch (error) {
      const typed =
        error instanceof RequestContractError ||
        error instanceof ApprovalAccessError;
      res
        .status(typed ? error.status : 500)
        .json({
          success: false,
          message: typed ? error.message : 'Early Exit request is unavailable',
        });
    }
  };
export const parentEarlyExitRouter = Router({ mergeParams: true });
parentEarlyExitRouter.get(
  '/',
  handle(
    req =>
      readParentExits(
        req.user,
        token(req),
        param(req, 'studentId'),
        undefined,
        req.query,
      ),
    true,
  ),
);
parentEarlyExitRouter.get(
  '/:requestId',
  handle(
    req =>
      readParentExits(
        req.user,
        token(req),
        param(req, 'studentId'),
        param(req, 'requestId'),
        req.query,
      ),
    true,
  ),
);
parentEarlyExitRouter.post(
  '/',
  handle(
    req =>
      writeParentExit(
        'create',
        req.user,
        token(req),
        param(req, 'studentId'),
        undefined,
        req.body,
      ),
    false,
    201,
  ),
);
parentEarlyExitRouter.patch(
  '/:requestId',
  handle(req =>
    writeParentExit(
      'edit',
      req.user,
      token(req),
      param(req, 'studentId'),
      param(req, 'requestId'),
      req.body,
    ),
  ),
);
for (const kind of ['submit', 'withdraw', 'resubmit'] as const)
  parentEarlyExitRouter.post(
    `/:requestId/${kind}`,
    handle(req =>
      writeParentExit(
        kind,
        req.user,
        token(req),
        param(req, 'studentId'),
        param(req, 'requestId'),
        req.body,
      ),
    ),
  );
export const principalEarlyExitRouter = Router();
principalEarlyExitRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
principalEarlyExitRouter.use(
  authenticateToken,
  requireRole('principal'),
  requirePermission(PERMISSIONS.PRINCIPAL_APPROVALS_VIEW),
);
principalEarlyExitRouter.get(
  '/',
  handle(
    req => readPrincipalExits(req.user, token(req), undefined, req.query),
    true,
  ),
);
principalEarlyExitRouter.get(
  '/:approvalId',
  handle(
    req =>
      readPrincipalExits(
        req.user,
        token(req),
        param(req, 'approvalId'),
        req.query,
      ),
    true,
  ),
);
principalEarlyExitRouter.post(
  '/:approvalId/decisions',
  requirePermission(PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE),
  handle(req =>
    decideEarlyExit(req.user, token(req), param(req, 'approvalId'), req.body),
  ),
);
export const earlyExitParseError: ErrorRequestHandler = (
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
      .json({ success: false, message: 'Invalid Early Exit request' });
    return;
  }
  next(error);
};
