import { Router } from 'express';
import {
  authenticateToken,
  type AuthenticatedRequest,
} from '../middleware/auth.middleware';
import { RequestContractError } from '../utils/request-validation';
import { discoverChatRecipients } from '../services/chat-authority.service';

const router = Router();
router.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'no-store');
  next();
});
router.use(authenticateToken);
router.get(
  '/me/recipients',
  async (request: AuthenticatedRequest, response) => {
    try {
      if (request.body !== undefined)
        throw new RequestContractError(400, 'Unsupported request body');
      response.json({
        success: true,
        data: await discoverChatRecipients(request.user, request.query),
      });
    } catch (error) {
      response
        .status(error instanceof RequestContractError ? error.status : 500)
        .json({
          success: false,
          message:
            error instanceof RequestContractError
              ? error.message
              : 'Recipient discovery failed. Please retry.',
        });
    }
  },
);
// No arbitrary-user lookup, authorization probe, conversation or message API.
router.use((_request, response) => {
  response
    .status(403)
    .json({ success: false, message: 'Chat operation is not permitted' });
});
export default router;
