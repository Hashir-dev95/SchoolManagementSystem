import { Types } from 'mongoose';
import {
  FinancePaymentIntent,
  FinanceTransaction,
  FinanceProviderObservation,
  FinanceAudit,
} from '../models/finance';
import User from '../models/user';
import Session from '../models/session';
import Student from '../models/student';
import { StudentEnrollment } from '../models/studentEnrollment';
import { ParentStudentLink } from '../models/parentStudentLink';
import { PERMISSIONS } from '../constants/permissions';
import { withTimetablePublication } from './teacher-timetable.service';
import { verifiedChild } from './parent-scope.service';
import {
  financeActor,
  financeWrite,
  feeRecord,
  feeDTO,
  financialDenied,
  audit,
  priorOperation,
  fingerprint,
  operationKey,
  reservedStates,
  moneyLabel,
} from './finance-authority.service';
import { paymentProvider, type PaymentProvider } from './payment-provider';
import type { JwtPayload } from './jwt.service';
import {
  RequestContractError,
  objectBody,
  textField,
  enumField,
  objectIdField,
} from '../utils/request-validation';

export function intentDTO(row: any, actorId?: unknown) {
  return {
    id: String(row._id),
    feeId: String(row.obligationId),
    amountMinor: row.amountMinor,
    amountLabel: moneyLabel(row.amountMinor),
    currency: row.currency,
    method: row.method,
    reference: row.reference,
    status: row.status,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    expired: row.expiresAt <= new Date(),
    canVerify:
      row.channel === 'manual' &&
      row.status === 'awaiting_verification' &&
      String(row.actorId) !== String(actorId),
  };
}
const receiptDTO = (row: any) => ({
  id: String(row._id),
  reference: row.receiptReference,
  feeId: String(row.obligationId),
  amountMinor: row.amountMinor,
  amountLabel: moneyLabel(row.amountMinor),
  paymentReference: row.reference,
  method: row.method,
  paidAt: row.paidAt.toISOString(),
  status: 'settled' as const,
});
async function reserve(
  branchId: string,
  actorId: unknown,
  feeId: string,
  channel: 'manual' | 'online',
  method: string,
  reference: string,
  session: import('mongoose').ClientSession,
  provider?: PaymentProvider,
) {
  const fee = await feeRecord(branchId, feeId, session, true),
    current = await feeDTO(fee, session);
  if (current.availableMinor <= 0) {
    throw new RequestContractError(409, 'No unreserved balance is payable');
  }
  const [row] = await FinancePaymentIntent.create(
    [
      {
        branchId,
        actorId: String(actorId),
        obligationId: fee._id,
        studentId: fee.studentId,
        amountMinor: current.availableMinor,
        currency: fee.currency,
        channel,
        method,
        reference,
        status: channel === 'manual' ? 'awaiting_verification' : 'reserved',
        expiresAt: new Date(Date.now() + 30 * 60000),
        ...(provider
          ? { provider: provider.id, merchantId: provider.merchantId }
          : {}),
      },
    ],
    { session },
  );
  return row!;
}
export async function recordManualPayment(
  identity: JwtPayload | undefined,
  token: string,
  feeId: unknown,
  body: unknown,
) {
  const input = objectBody(body, ['method', 'reference', 'operationId']);
  const id = objectIdField(feeId, 'fee ID'),
    method = enumField(input.method, 'payment method', [
      'cash',
      'bank_transfer',
    ] as const),
    reference = textField(
      input.reference,
      'external payment reference',
      120,
      3,
    ),
    op = operationKey(input.operationId),
    hash = fingerprint(['manual', id, method, reference]);
  return financeWrite(
    identity,
    token,
    PERMISSIONS.PAYMENT_RECORD,
    async (ctx, session) => {
      const prior = await priorOperation(
        ctx.branchId,
        ctx.actor._id,
        op,
        hash,
        session,
      );
      if (prior) {
        const existing = await FinancePaymentIntent.findOne({
          _id: prior.targetId,
          branchId: ctx.branchId,
          actorId: ctx.actor._id,
          obligationId: id,
          channel: 'manual',
        }).session(session);
        if (!existing)
          throw new RequestContractError(503, 'Reservation requires review');
        return intentDTO(existing, ctx.actor._id);
      }
      const row = await reserve(
        ctx.branchId,
        ctx.actor._id,
        id,
        'manual',
        method,
        reference,
        session,
      );
      await audit(
        ctx.branchId,
        ctx.actor._id,
        op,
        'payment.recorded',
        hash,
        row._id,
        session,
        {
          amountMinor: row.amountMinor,
          reference,
          beforeState: 'unreserved',
          afterState: row.status,
        },
      );
      return intentDTO(row, ctx.actor._id);
    },
  );
}
export async function verifyManualPayment(
  identity: JwtPayload | undefined,
  token: string,
  paymentId: unknown,
  body: unknown,
  reject = false,
) {
  const input = objectBody(body, ['operationId', 'revision', 'reviewNote']);
  const id = objectIdField(paymentId, 'payment ID'),
    op = operationKey(input.operationId),
    note = textField(input.reviewNote, 'verification note', 500, 3),
    hash = fingerprint(['manual.verify', id, input.revision, note, reject]);
  if (!Number.isSafeInteger(input.revision) || Number(input.revision) < 1) {
    throw new RequestContractError(400, 'Payment revision required');
  }
  return financeWrite(
    identity,
    token,
    PERMISSIONS.PAYMENT_VERIFY,
    async (ctx, session) => {
      const prior = await priorOperation(
        ctx.branchId,
        ctx.actor._id,
        op,
        hash,
        session,
      );
      const row = await FinancePaymentIntent.findOne({
        _id: id,
        branchId: ctx.branchId,
      }).session(session);
      if (
        !row ||
        row.channel !== 'manual' ||
        String(row.actorId) === String(ctx.actor._id)
      ) {
        throw financialDenied();
      }
      const fee = await feeRecord(
        ctx.branchId,
        String(row.obligationId),
        session,
        true,
      );
      // Validate the original reservation before either settlement or receipt replay.
      // A corrupted intent must not credit a different Student/currency or amount.
      const reservationAudit = await FinanceAudit.exists({
        branchId: ctx.branchId,
        actorId: row.actorId,
        targetId: row._id,
        action: 'payment.recorded',
        amountMinor: row.amountMinor,
        fingerprint: fingerprint([
          'manual',
          String(fee._id),
          row.method,
          row.reference,
        ]),
      }).session(session);
      if (
        String(row.studentId) !== String(fee.studentId) ||
        row.currency !== 'PKR' ||
        row.currency !== fee.currency ||
        !Number.isSafeInteger(row.amountMinor) ||
        row.amountMinor <= 0 ||
        !reservationAudit
      )
        throw new RequestContractError(
          503,
          'Reservation requires reconciliation',
        );
      if (row.status === 'settled' && !reject) {
        const receipt = await FinanceTransaction.findOne({
          intentId: row._id,
          branchId: ctx.branchId,
          obligationId: fee._id,
          studentId: row.studentId,
          amountMinor: row.amountMinor,
          currency: row.currency,
          method: row.method,
          reference: row.reference,
          actorId: row.actorId,
          verifiedBy: row.verifiedBy,
          state: 'settled',
        }).session(session);
        const verificationAudit =
          row.verifiedBy &&
          (await FinanceAudit.exists({
            branchId: ctx.branchId,
            actorId: row.verifiedBy,
            targetId: row._id,
            action: 'payment.verified',
            amountMinor: row.amountMinor,
            afterState: 'settled',
          }).session(session));
        if (!receipt || !verificationAudit) {
          throw new RequestContractError(
            503,
            'Settlement requires reconciliation',
          );
        }
        return receiptDTO(receipt);
      }
      if (prior) {
        return intentDTO(row, ctx.actor._id);
      }
      if (
        row.status !== 'awaiting_verification' ||
        row.revision !== input.revision
      ) {
        throw new RequestContractError(409, 'Payment state changed');
      }
      const current = await feeDTO(fee, session);
      if (current.balanceMinor < row.amountMinor) {
        throw new RequestContractError(
          409,
          'Payment exceeds current obligation',
        );
      }
      const before = row.status;
      row.status = reject ? 'rejected' : 'settled';
      row.revision += 1;
      row.verifiedBy = ctx.actor._id;
      row.verifiedAt = new Date();
      await row.save({ session });
      await audit(
        ctx.branchId,
        ctx.actor._id,
        op,
        reject ? 'payment.rejected' : 'payment.verified',
        hash,
        row._id,
        session,
        {
          amountMinor: row.amountMinor,
          reference: `${row.reference}: ${note}`,
          beforeState: before,
          afterState: row.status,
        },
      );
      if (reject) {
        return intentDTO(row, ctx.actor._id);
      }
      const [transaction] = await FinanceTransaction.create(
        [
          {
            branchId: ctx.branchId,
            obligationId: row.obligationId,
            intentId: row._id,
            studentId: row.studentId,
            amountMinor: row.amountMinor,
            currency: row.currency,
            method: row.method,
            reference: row.reference,
            receiptReference: `RC-${row._id}`,
            state: 'settled',
            actorId: row.actorId,
            verifiedBy: ctx.actor._id,
            paidAt: new Date(),
          },
        ],
        { session },
      );
      return receiptDTO(transaction);
    },
  );
}
export async function startParentCheckout(
  identity: JwtPayload | undefined,
  token: string,
  childId: unknown,
  feeId: unknown,
  body: unknown,
  provider: PaymentProvider = paymentProvider,
) {
  const input = objectBody(body, ['operationId']),
    op = operationKey(input.operationId),
    id = objectIdField(feeId, 'fee ID');
  const ctx = await verifiedChild(identity, childId),
    fee = await feeRecord(ctx.parent.branchId, id);
  if (
    String(fee.studentId) !== String(ctx.scope.student._id) ||
    String(fee.recipientUserId) !== String(ctx.scope.actor._id)
  ) {
    throw financialDenied();
  }
  if (!provider.enabled || !provider.id || !provider.merchantId) {
    throw new RequestContractError(
      503,
      'Online payments unavailable — provider validation pending',
    );
  }
  const hash = fingerprint(['checkout', id, provider.id]);
  const reserved = await withTimetablePublication(
    ctx.parent.branchId,
    undefined,
    async session => {
      await User.collection.updateOne(
        { _id: ctx.parent.actor._id },
        { $inc: { __v: 1 } },
        { session },
      );
      await ParentStudentLink.collection.updateOne(
        { _id: ctx.link._id },
        { $inc: { __v: 1 } },
        { session },
      );
      await Student.collection.updateOne(
        { _id: ctx.scope.student._id },
        { $inc: { __v: 1 } },
        { session },
      );
      await User.collection.updateOne(
        { _id: ctx.scope.actor._id },
        { $inc: { __v: 1 } },
        { session },
      );
      await StudentEnrollment.collection.updateOne(
        { _id: ctx.scope.enrollment._id },
        { $inc: { __v: 1 } },
        { session },
      );
      const login = await Session.collection.updateOne(
        {
          token,
          userId: ctx.parent.actor._id,
          role: 'parent',
          isRevoked: false,
        },
        { $inc: { __v: 1 } },
        { session },
      );
      if (!login.matchedCount) {
        throw new RequestContractError(401, 'Session unavailable');
      }
      await verifiedChild(identity, childId);
      const prior = await priorOperation(
        ctx.parent.branchId,
        ctx.parent.actor._id,
        op,
        hash,
        session,
      );
      if (prior) {
        return {
          row: await FinancePaymentIntent.findById(prior.targetId).session(
            session,
          ),
          fresh: false,
        };
      }
      const row = await reserve(
        ctx.parent.branchId,
        ctx.parent.actor._id,
        id,
        'online',
        'online',
        `ORDER-${new Types.ObjectId()}`,
        session,
        provider,
      );
      await audit(
        ctx.parent.branchId,
        ctx.parent.actor._id,
        op,
        'checkout.reserved',
        hash,
        row._id,
        session,
        {
          amountMinor: row.amountMinor,
          reference: row.reference,
          afterState: row.status,
        },
      );
      return { row, fresh: true };
    },
  );
  const row = reserved.row!;
  if (reserved.fresh) {
    try {
      const checkout = await provider.checkout({
        orderRef: String(row._id),
        amountMinor: row.amountMinor,
        currency: row.currency,
        idempotencyKey: String(row._id),
      });
      if (
        !/^https:\/\/[^\s]+$/.test(checkout.url) ||
        !checkout.transactionRef ||
        checkout.transactionRef.length > 160
      ) {
        throw new Error('Invalid provider binding');
      }
      await FinancePaymentIntent.updateOne(
        { _id: row._id, status: 'reserved' },
        {
          $set: {
            status: 'provider_pending',
            providerTransactionRef: checkout.transactionRef,
            checkoutUrl: checkout.url,
          },
          $inc: { revision: 1 },
        },
      );
    } catch {
      await FinancePaymentIntent.updateOne(
        { _id: row._id, status: 'reserved' },
        { $set: { status: 'reconciliation_required' }, $inc: { revision: 1 } },
      );
    }
  }
  const current = await FinancePaymentIntent.findById(row._id).read('primary');
  return { ...intentDTO(current), checkoutUrl: current?.checkoutUrl ?? null };
}
export async function processProviderCallback(
  raw: Buffer,
  headers: Record<string, unknown>,
  provider: PaymentProvider = paymentProvider,
) {
  if (!provider.enabled || !provider.id || !provider.merchantId) {
    throw new RequestContractError(503, 'Provider validation pending');
  }
  if (!Buffer.isBuffer(raw) || raw.length === 0 || raw.length > 64 * 1024)
    throw new RequestContractError(400, 'Invalid provider evidence');
  let event;
  try {
    event = await provider.verifyCallback(raw, headers);
  } catch (error) {
    // Adapters distinguish temporary verification outages from unauthentic evidence.
    if (error instanceof RequestContractError && error.status >= 500)
      throw new RequestContractError(
        503,
        'Provider verification unavailable; retry required',
      );
    throw financialDenied();
  }
  try {
    objectBody(event, [
      'eventId',
      'orderRef',
      'transactionRef',
      'merchantId',
      'amountMinor',
      'currency',
      'state',
    ]);
  } catch {
    throw financialDenied();
  }
  if (
    !event ||
    event.merchantId !== provider.merchantId ||
    !Number.isSafeInteger(event.amountMinor) ||
    event.amountMinor <= 0 ||
    event.amountMinor > 1000000000 ||
    event.currency !== 'PKR' ||
    !['paid', 'failed', 'pending'].includes(event.state) ||
    typeof event.eventId !== 'string' ||
    !/^[A-Za-z0-9_.:-]{1,160}$/.test(event.eventId) ||
    typeof event.transactionRef !== 'string' ||
    !event.transactionRef ||
    event.transactionRef.length > 160 ||
    typeof event.orderRef !== 'string' ||
    !/^[a-fA-F0-9]{24}$/.test(event.orderRef)
  ) {
    throw financialDenied();
  }
  await FinanceProviderObservation.updateOne(
    { provider: provider.id, eventId: event.eventId },
    { $setOnInsert: { provider: provider.id, ...event, outcome: 'received' } },
    { upsert: true },
  ).catch(error => {
    if (error.code !== 11000) {
      throw error;
    }
  });
  const recordedEvent = await FinanceProviderObservation.findOne({
    provider: provider.id,
    eventId: event.eventId,
  }).read('primary');
  if (
    !recordedEvent ||
    recordedEvent.orderRef !== event.orderRef ||
    recordedEvent.transactionRef !== event.transactionRef ||
    recordedEvent.amountMinor !== event.amountMinor ||
    recordedEvent.currency !== event.currency ||
    recordedEvent.merchantId !== event.merchantId ||
    recordedEvent.state !== event.state
  ) {
    throw new RequestContractError(
      409,
      'Provider event ID was reused for different input',
    );
  }
  const initial = await FinancePaymentIntent.findById(event.orderRef).read(
    'primary',
  );
  if (!initial) {
    await FinanceProviderObservation.updateOne(
      { provider: provider.id, eventId: event.eventId },
      { $set: { outcome: 'unmatched' } },
    );
    throw financialDenied();
  }
  const observation = { provider: provider.id, eventId: event.eventId };
  await FinanceProviderObservation.updateOne(observation, {
    $set: { branchId: initial.branchId },
  });
  if (
    initial.provider !== provider.id ||
    initial.merchantId !== event.merchantId ||
    initial.providerTransactionRef !== event.transactionRef ||
    initial.amountMinor !== event.amountMinor ||
    initial.currency !== event.currency
  ) {
    await FinanceProviderObservation.updateOne(observation, {
      $set: { branchId: initial.branchId, outcome: 'binding_mismatch' },
    });
    throw financialDenied();
  }
  const result = await withTimetablePublication(
    String(initial.branchId),
    undefined,
    async session => {
      const fee = await feeRecord(
        String(initial.branchId),
        String(initial.obligationId),
        session,
        true,
      );
      const row = await FinancePaymentIntent.findById(initial._id).session(
        session,
      );
      if (
        !row ||
        row.channel !== 'online' ||
        String(row.studentId) !== String(fee.studentId) ||
        String(row.branchId) !== String(fee.branchId) ||
        String(row.obligationId) !== String(fee._id) ||
        row.provider !== provider.id ||
        row.merchantId !== event.merchantId ||
        row.providerTransactionRef !== event.transactionRef ||
        row.amountMinor !== event.amountMinor ||
        row.currency !== event.currency
      ) {
        throw financialDenied();
      }
      const reservationAudit = await FinanceAudit.exists({
        branchId: row.branchId,
        actorId: row.actorId,
        targetId: row._id,
        action: 'checkout.reserved',
        amountMinor: row.amountMinor,
        fingerprint: fingerprint(['checkout', String(fee._id), provider.id]),
      }).session(session);
      if (!reservationAudit) throw financialDenied();
      if (row.status === 'settled') {
        if (event.state !== 'paid') {
          return { status: 'inconsistent', intentId: String(row._id) };
        }
        const effect = await FinanceTransaction.exists({
          intentId: row._id,
          obligationId: fee._id,
          branchId: row.branchId,
          studentId: row.studentId,
          amountMinor: row.amountMinor,
          currency: row.currency,
          provider: provider.id,
          providerTransactionRef: event.transactionRef,
          state: 'settled',
        }).session(session);
        if (!effect)
          throw new RequestContractError(
            503,
            'Payment requires reconciliation',
          );
        return { status: 'settled', intentId: String(row._id) };
      }
      if (!reservedStates.includes(row.status)) {
        return { status: 'inconsistent', intentId: String(row._id) };
      }
      if (
        !(row.expiresAt instanceof Date) ||
        !Number.isFinite(row.expiresAt.getTime()) ||
        row.expiresAt <= new Date()
      ) {
        // A late capture is evidence for review, never authority to resurrect a hold.
        if (row.status !== 'reconciliation_required') {
          row.status = 'reconciliation_required';
          row.revision += 1;
          await row.save({ session });
        }
        return { status: 'reconciliation_required', intentId: String(row._id) };
      }
      if (event.state === 'pending') {
        return { status: 'pending', intentId: String(row._id) };
      }
      const current = await feeDTO(fee, session);
      if (current.balanceMinor < row.amountMinor) {
        throw new RequestContractError(409, 'Payment requires reconciliation');
      }
      const beforeState = row.status;
      row.status = event.state === 'paid' ? 'settled' : 'failed';
      row.revision += 1;
      await row.save({ session });
      if (event.state === 'paid') {
        await FinanceTransaction.create(
          [
            {
              branchId: row.branchId,
              obligationId: row.obligationId,
              intentId: row._id,
              studentId: row.studentId,
              amountMinor: row.amountMinor,
              currency: row.currency,
              method: 'online',
              reference: event.transactionRef,
              receiptReference: `RC-${row._id}`,
              state: 'settled',
              actorId: row.actorId,
              paidAt: new Date(),
              provider: provider.id,
              providerTransactionRef: event.transactionRef,
            },
          ],
          { session },
        );
      }
      await audit(
        String(row.branchId),
        row.actorId,
        `provider_${row._id}`,
        'provider.' + event.state,
        fingerprint(event),
        row._id,
        session,
        {
          amountMinor: row.amountMinor,
          reference: event.transactionRef,
          beforeState,
          afterState: row.status,
        },
      );
      return { status: row.status, intentId: String(row._id) };
    },
  ).catch(async error => {
    await FinanceProviderObservation.updateOne(observation, {
      $set: { outcome: 'reconciliation_required' },
    });
    await FinancePaymentIntent.updateOne(
      {
        _id: initial._id,
        channel: 'online',
        provider: provider.id,
        status: { $in: reservedStates },
      },
      { $set: { status: 'reconciliation_required' }, $inc: { revision: 1 } },
    );
    if ((error as { code?: number }).code === 11000) {
      throw new RequestContractError(
        409,
        'Provider transaction already credited; reconciliation required',
      );
    }
    throw error;
  });
  await FinanceProviderObservation.updateOne(observation, {
    $set: { branchId: initial.branchId, outcome: result.status },
  });
  return result;
}
export async function financePayments(identity: JwtPayload | undefined) {
  const ctx = await financeActor(identity);
  const items = await FinancePaymentIntent.find({ branchId: ctx.branchId })
    .sort({ createdAt: -1 })
    .limit(100)
    .read('primary')
    .lean();
  return { items: items.map(row => intentDTO(row, ctx.actor._id)) };
}
