import express, { Router, type Response } from 'express';
import {
  authenticateToken,
  type AuthenticatedRequest,
} from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import {
  RequestContractError,
  objectIdField,
  textField,
} from '../utils/request-validation';
import {
  FeeStructure,
  FeeObligation,
  FinancePaymentIntent,
  FinanceProviderObservation,
} from '../models/finance';
import Student from '../models/student';
import User from '../models/user';
import {
  financeActor,
  createFeeStructure,
  assignFee,
  feeRecord,
  feeDTO,
  branchFinanceSummary,
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
    async request => {
      const ctx = await financeActor(request.user),
        search = textField(request.query.search ?? '', 'search', 80);
      const filter = search
        ? {
            admissionNumber: {
              $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
              $options: 'i',
            },
          }
        : {};
      const students = await Student.find({ isActive: true, ...filter })
        .where('branchId')
        .equals(ctx.branchId)
        .select('_id userId admissionNumber')
        .limit(50)
        .lean();
      const items = [];
      for (const row of students) {
        const user = await User.findOne({ isActive: true, role: 'student' })
          .where('_id')
          .equals(row.userId)
          .where('branchId')
          .equals(ctx.branchId)
          .select('fullName')
          .lean();
        if (user) {
          items.push({
            id: String(row._id),
            fullName: user.fullName,
            admissionNumber: row.admissionNumber,
          });
        }
      }
      return { items };
    },
    ['search'],
  ),
);
router.get(
  '/fees',
  handle(
    async request => {
      const ctx = await financeActor(request.user),
        studentId =
          request.query.studentId === undefined
            ? undefined
            : objectIdField(request.query.studentId, 'Student ID');
      if (
        studentId &&
        !(await Student.exists({ isActive: true })
          .where('_id')
          .equals(studentId)
          .where('branchId')
          .equals(ctx.branchId))
      ) {
        throw new RequestContractError(
          403,
          'Student is outside financial scope',
        );
      }
      const rows = await FeeObligation.find({
        branchId: ctx.branchId,
        ...(studentId ? { studentId } : {}),
      })
        .sort({ createdAt: -1 })
        .limit(100)
        .read('primary')
        .lean();
      return {
        items: await Promise.all(rows.map(row => feeDTO(row))),
        limit: 100,
      };
    },
    ['studentId'],
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
