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
import { readParentPickups } from '../services/pickup-authorization-read.service';
import { writeParentPickup } from '../services/pickup-authorization-write.service';
import {
  decidePickup,
  readPrincipalPickups,
} from '../services/pickup-authorization-review.service';

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
      if (
        (read && req.body !== undefined) ||
        (!read && Object.keys(req.query).length)
      )
        throw new RequestContractError(400, 'Unsupported request fields');
      res.status(status).json({ success: true, data: await run(req) });
    } catch (error) {
      res
        .status(
          error instanceof RequestContractError ||
            error instanceof ApprovalAccessError
            ? error.status
            : 500,
        )
        .json({
          success: false,
          message:
            error instanceof RequestContractError ||
            error instanceof ApprovalAccessError
              ? error.message
              : 'Pickup authorization request is unavailable',
        });
    }
  };
export const parentPickupRouter = Router({ mergeParams: true });
parentPickupRouter.get(
  '/',
  handle(
    req =>
      readParentPickups(
        req.user,
        token(req),
        param(req, 'studentId'),
        undefined,
        req.query,
      ),
    true,
  ),
);
parentPickupRouter.get(
  '/:authorizationId',
  handle(
    req =>
      readParentPickups(
        req.user,
        token(req),
        param(req, 'studentId'),
        param(req, 'authorizationId'),
        req.query,
      ),
    true,
  ),
);
parentPickupRouter.post(
  '/',
  handle(
    req =>
      writeParentPickup(
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
parentPickupRouter.patch(
  '/:authorizationId',
  handle(req =>
    writeParentPickup(
      'edit',
      req.user,
      token(req),
      param(req, 'studentId'),
      param(req, 'authorizationId'),
      req.body,
    ),
  ),
);
for (const kind of ['submit', 'withdraw', 'resubmit'] as const)
  parentPickupRouter.post(
    `/:authorizationId/${kind}`,
    handle(req =>
      writeParentPickup(
        kind,
        req.user,
        token(req),
        param(req, 'studentId'),
        param(req, 'authorizationId'),
        req.body,
      ),
    ),
  );

export const principalPickupRouter = Router();
principalPickupRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
principalPickupRouter.use(
  authenticateToken,
  requireRole('principal'),
  requirePermission(PERMISSIONS.PRINCIPAL_APPROVALS_VIEW),
);
principalPickupRouter.get(
  '/',
  handle(
    req => readPrincipalPickups(req.user, token(req), undefined, req.query),
    true,
  ),
);
principalPickupRouter.get(
  '/:approvalId',
  handle(
    req =>
      readPrincipalPickups(
        req.user,
        token(req),
        param(req, 'approvalId'),
        req.query,
      ),
    true,
  ),
);
principalPickupRouter.post(
  '/:approvalId/decisions',
  requirePermission(PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE),
  handle(req =>
    decidePickup(req.user, token(req), param(req, 'approvalId'), req.body),
  ),
);
export const pickupParseError: ErrorRequestHandler = (
  error,
  _req,
  res,
  next,
) => {
  if (
    error?.type === 'entity.parse.failed' ||
    error?.type === 'entity.too.large'
  ) {
    res.status(400).json({
      success: false,
      message: 'Invalid pickup authorization request',
    });
    return;
  }
  next(error);
};
