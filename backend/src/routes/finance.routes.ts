import express, { Router, type Response } from 'express';
import {
  authenticateToken,
  type AuthenticatedRequest,
} from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { RequestContractError } from '../utils/request-validation';
import {
  FeeStructure,
  FinancePaymentIntent,
  FinanceProviderObservation,
} from '../models/finance';
import {
  financeActor,
  createFeeStructure,
  assignFee,
  feeRecord,
  feeDTO,
  branchFinanceSummary,
  searchFinanceStudents,
  listFinanceFees,
  lookupFinanceChallan,
} from '../services/finance-authority.service';
import {
  recordManualPayment,
  verifyManualPayment,
  financePayments,
  processProviderCallback,
} from '../services/finance-payment.service';
import {
  paymentProvider,
  type PaymentProvider,
} from '../services/payment-provider';

const fail = (response: Response, error: unknown) =>
  response
    .status(error instanceof RequestContractError ? error.status : 500)
    .json({
      success: false,
      message:
        error instanceof RequestContractError
          ? error.message
          : 'Finance operation failed. Please retry.',
    });
const handle =
  (
    action: (request: AuthenticatedRequest) => Promise<unknown>,
    queries: string[] = [],
  ) =>
  async (request: AuthenticatedRequest, response: Response) => {
    try {
      if (
        Object.keys(request.query).some(key => !queries.includes(key)) ||
        (request.method === 'GET' && request.body !== undefined)
      ) {
        throw new RequestContractError(
          403,
          'Financial scope cannot be selected',
        );
      }
      response.json({ success: true, data: await action(request) });
    } catch (error) {
      fail(response, error);
    }
  };
const token = (request: AuthenticatedRequest) =>
  request.headers.authorization!.slice(7);
const router = Router();
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
router.use(authenticateToken, requireRole('finance'));
router.get(
  '/summary',
  handle(async request =>
    branchFinanceSummary((await financeActor(request.user)).branchId),
  ),
);
router.get(
  '/structures',
  handle(async request => ({
    items: await FeeStructure.find({
      branchId: (await financeActor(request.user)).branchId,
    })
      .select('_id title amountMinor currency')
      .sort({ _id: -1 })
      .limit(100)
      .lean(),
  })),
);
router.post(
  '/structures',
  handle(request =>
    createFeeStructure(request.user, token(request), request.body),
  ),
);
router.get(
  '/students',
  handle(
    request => searchFinanceStudents(request.user, request.query),
    ['search', 'offset'],
  ),
);
router.get(
  '/fees',
  handle(
    request => listFinanceFees(request.user, request.query),
    ['studentId', 'search', 'status', 'offset', 'limit'],
  ),
);
router.get(
  '/fees/by-reference',
  handle(
    request => lookupFinanceChallan(request.user, request.query.reference),
    ['reference'],
  ),
);
router.post(
  '/fees',
  handle(request => assignFee(request.user, token(request), request.body)),
);
router.get(
  '/fees/:id',
  handle(async request =>
    feeDTO(
      await feeRecord(
        (
          await financeActor(request.user)
        ).branchId,
        request.params.id,
      ),
    ),
  ),
);
router.post(
  '/fees/:id/manual-payments',
  handle(request =>
    recordManualPayment(
      request.user,
      token(request),
      request.params.id,
      request.body,
    ),
  ),
);
router.get(
  '/payments',
  handle(request => financePayments(request.user)),
);
router.post(
  '/payments/:id/verify',
  handle(request =>
    verifyManualPayment(
      request.user,
      token(request),
      request.params.id,
      request.body,
    ),
  ),
);
router.post(
  '/payments/:id/reject',
  handle(request =>
    verifyManualPayment(
      request.user,
      token(request),
      request.params.id,
      request.body,
      true,
    ),
  ),
);
router.get(
  '/reconciliation',
  handle(async request => {
    const ctx = await financeActor(request.user);
    const intents = await FinancePaymentIntent.find({
      branchId: ctx.branchId,
      status: {
        $in: [
          'reserved',
          'awaiting_verification',
          'provider_pending',
          'reconciliation_required',
        ],
      },
    })
      .sort({ createdAt: 1 })
      .limit(100)
      .lean();
    const observations = await FinanceProviderObservation.find({
      branchId: ctx.branchId,
      outcome: { $nin: ['settled', 'failed'] },
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .select('eventId orderRef outcome state createdAt')
      .lean();
    return {
      items: intents.map(row => ({
        id: String(row._id),
        reference: row.reference,
        status: row.status,
        expired: row.expiresAt <= new Date(),
        expiresAt: row.expiresAt.toISOString(),
        reason:
          row.expiresAt <= new Date()
            ? 'Reservation expired; funds remain held pending verified review'
            : 'Awaiting verification or provider confirmation',
      })),
      observations,
    };
  }),
);
router.use((_req, res) => {
  res
    .status(403)
    .json({ success: false, message: 'Finance operation not permitted' });
});
export default router;

export function createProviderCallbackRouter(
  provider: PaymentProvider = paymentProvider,
) {
  const callbacks = Router();
  callbacks.post(
    '/callback',
    express.raw({ type: 'application/json', limit: '64kb' }),
    async (req, res) => {
      try {
        if (!Buffer.isBuffer(req.body)) {
          throw new RequestContractError(400, 'Raw event required');
        }
        res.json({
          success: true,
          data: await processProviderCallback(req.body, req.headers, provider),
        });
      } catch (error) {
        fail(res, error);
      }
    },
  );
  return callbacks;
}
