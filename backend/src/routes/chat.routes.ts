import { Router } from 'express';
import {
  authenticateToken,
  type AuthenticatedRequest,
} from '../middleware/auth.middleware';
import { RequestContractError } from '../utils/request-validation';
import { discoverChatRecipients } from '../services/chat-authority.service';
import {
  createChatConversation,
  listChatConversations,
  getChatConversation,
  sendChatMessage,
  chatMessageHistory,
  markChatMessageRead,
} from '../services/chat-persistence.service';

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
const handle =
  (
    action: (request: AuthenticatedRequest) => Promise<unknown>,
    queryFields: string[] = [],
  ) =>
  async (
    request: AuthenticatedRequest,
    response: import('express').Response,
  ) => {
    try {
      if (
        Object.keys(request.query).some(key => !queryFields.includes(key)) ||
        (request.method === 'GET' && request.body !== undefined)
      )
        throw new RequestContractError(400, 'Unsupported request fields');
      response.json({ success: true, data: await action(request) });
    } catch (error) {
      response
        .status(error instanceof RequestContractError ? error.status : 500)
        .json({
          success: false,
          message:
            error instanceof RequestContractError
              ? error.message
              : 'Chat operation failed. Please retry.',
        });
    }
  };
const token = (request: AuthenticatedRequest) =>
  request.headers.authorization!.slice(7);
router.post(
  '/conversations',
  handle(request =>
    createChatConversation(request.user, token(request), request.body),
  ),
);
router.get(
  '/conversations',
  handle(
    request => listChatConversations(request.user, request.query),
    ['offset', 'limit'],
  ),
);
router.get(
  '/conversations/:conversationId',
  handle(request =>
    getChatConversation(request.user, request.params.conversationId),
  ),
);
router.post(
  '/conversations/:conversationId/messages',
  handle(request =>
    sendChatMessage(
      request.user,
      token(request),
      request.params.conversationId,
      request.body,
    ),
  ),
);
router.get(
  '/conversations/:conversationId/messages',
  handle(
    request =>
      chatMessageHistory(
        request.user,
        request.params.conversationId,
        request.query,
      ),
    ['beforeSequence', 'limit'],
  ),
);
router.post(
  '/conversations/:conversationId/messages/:messageId/read',
  handle(request =>
    markChatMessageRead(
      request.user,
      token(request),
      request.params.conversationId,
      request.params.messageId,
      request.body,
    ),
  ),
);
// No arbitrary-user probe, group chat, attachment or realtime API.
router.use((_request, response) => {
  response
    .status(403)
    .json({ success: false, message: 'Chat operation is not permitted' });
});
export default router;
