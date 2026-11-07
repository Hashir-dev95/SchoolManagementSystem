import { Router } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth.middleware';
import { RequestContractError } from '../utils/request-validation';
import {
  editParentLeaveDraft,
  listParentLeaveDrafts,
  readParentLeaveDraft,
  saveNewParentLeaveDraft,
} from '../services/parent-leave-draft.service';
import { changeParentLeaveLifecycle } from '../services/parent-leave-lifecycle.service';
import { resubmitParentLeave } from '../services/parent-leave-resubmission.service';

// Mounted exclusively inside the JWT/Parent guarded, no-store Parent router.
const router = Router({ mergeParams: true });
const param = (req: AuthenticatedRequest, key: string) => {
  const value = req.params[key];
  if (typeof value !== 'string')
    throw new RequestContractError(400, 'Invalid request identifier');
  return value;
};
const handle =
  (
    action: (req: AuthenticatedRequest, token: string) => Promise<unknown>,
    read = false,
    page = false,
  ) =>
  async (req: AuthenticatedRequest, res: import('express').Response) => {
    try {
      if (
        (read && req.body !== undefined) ||
        (!page && Object.keys(req.query).length)
      )
        throw new RequestContractError(400, 'Unsupported request fields');
      res.json({
        success: true,
        data: await action(req, req.headers.authorization!.slice(7)),
      });
    } catch (error) {
      res
        .status(error instanceof RequestContractError ? error.status : 500)
        .json({
          success: false,
          message:
            error instanceof RequestContractError
              ? error.message
              : 'Leave drafts are unavailable. Please retry.',
        });
    }
  };
router.get(
  '/',
  handle(
    (req, token) =>
      listParentLeaveDrafts(
        req.user,
        token,
        param(req, 'studentId'),
        req.query,
      ),
    true,
    true,
  ),
);
router.post(
  '/',
  handle((req, token) =>
    saveNewParentLeaveDraft(req.user, token, param(req, 'studentId'), req.body),
  ),
);
router.get(
  '/:applicationId',
  handle(
    (req, token) =>
      readParentLeaveDraft(
        req.user,
        token,
        param(req, 'studentId'),
        param(req, 'applicationId'),
      ),
    true,
  ),
);
router.patch(
  '/:applicationId',
  handle((req, token) =>
    editParentLeaveDraft(
      req.user,
      token,
      param(req, 'studentId'),
      param(req, 'applicationId'),
      req.body,
    ),
  ),
);
for (const kind of ['submit', 'withdraw'] as const) {
  router.post(
    `/:applicationId/${kind}`,
    handle((req, token) =>
      changeParentLeaveLifecycle(
        kind,
        req.user,
        token,
        param(req, 'studentId'),
        param(req, 'applicationId'),
        req.body,
      ),
    ),
  );
}
router.post(
  '/:applicationId/resubmit',
  handle((req, token) =>
    resubmitParentLeave(
      req.user,
      token,
      param(req, 'studentId'),
      param(req, 'applicationId'),
      req.body,
    ),
  ),
);
export default router;
