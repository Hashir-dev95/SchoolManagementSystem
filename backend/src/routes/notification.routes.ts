import { Router, type Response } from 'express';
import {
  authenticateToken,
  type AuthenticatedRequest,
} from '../middleware/auth.middleware';
import { RequestContractError } from '../utils/request-validation';
import {
  getOwnNotification,
  markOwnNotificationRead,
} from '../services/notification.service';

const handle =
  (action: (request: AuthenticatedRequest) => Promise<unknown>) =>
  async (request: AuthenticatedRequest, response: Response) => {
    try {
      if (Object.keys(request.query).length)
        throw new RequestContractError(400, 'Unsupported query fields');
      response.json({ success: true, data: await action(request) });
    } catch (error) {
      response
        .status(error instanceof RequestContractError ? error.status : 500)
        .json({
          success: false,
          message:
            error instanceof RequestContractError
              ? error.message
              : 'Notification operation failed. Please retry.',
        });
    }
  };
const router = Router();
router.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'no-store');
  next();
});
router.use(authenticateToken);
// F1 ownership primitives only. No list/inbox/create endpoint (F2/F6).
router.get(
  '/:notificationId',
  handle(request =>
    getOwnNotification(request.user, request.params.notificationId),
  ),
);
router.post(
  '/:notificationId/read',
  handle(request =>
    markOwnNotificationRead(
      request.user,
      request.params.notificationId,
      request.body,
      request.headers.authorization!.slice(7),
    ),
  ),
);
router.use((_request, response) => {
  response
    .status(403)
    .json({
      success: false,
      message: 'Notification operation is not permitted',
    });
});
export default router;
