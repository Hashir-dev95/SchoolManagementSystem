const crypto = require('node:crypto');
const express = require('express');
const { ObjectId } = require('mongodb');
const { getClient, getDatabase } = require('./database');
const studentRoutes = require('./studentRoutes');
const parentRoutes = require('./parentRoutes');
const { createUserNotificationRouter } = require('./userNotificationRoutes');

const router = express.Router();
let paymentIdempotencyIndexPromise;

function ensurePaymentIdempotencyIndex(payments) {
  if (!paymentIdempotencyIndexPromise) {
    paymentIdempotencyIndexPromise = payments.createIndex(
      { branchId: 1, createdByUserId: 1, idempotencyKey: 1 },
      {
        unique: true,
        partialFilterExpression: { idempotencyKey: { $type: 'string' } },
        name: 'finance_payment_idempotency_by_branch',
      },
    );
  }
  return paymentIdempotencyIndexPromise;
}

async function getInvoicePaymentTotals(payments, invoiceId, branchId, session) {
  const [totals] = await payments
    .aggregate(
      [
        { $match: { invoiceId, branchId } },
        {
          $group: {
            _id: null,
            paidAmount: {
              $sum: {
                $cond: [{ $eq: ['$status', 'confirmed'] }, '$amount', 0],
              },
            },
            pendingAmount: {
              $sum: {
                $cond: [
                  { $eq: ['$status', 'pending_verification'] },
                  '$amount',
                  0,
                ],
              },
            },
          },
        },
      ],
      session ? { session } : {},
    )
    .toArray();
  return {
    paidAmount: totals?.paidAmount || 0,
    pendingAmount: totals?.pendingAmount || 0,
  };
}

function requireFinanceContext(req, res, next) {
  const userId = typeof req.user?.id === 'string' ? req.user.id.trim() : '';
  const branchId =
    typeof req.user?.branchId === 'string' ? req.user.branchId.trim() : '';
  if (!userId) {
    return res
      .status(401)
      .json({ success: false, error: 'Trusted user context is required.' });
  }
  if (req.user.role !== 'finance') {
    return res
      .status(403)
      .json({ success: false, error: 'Finance access is required.' });
  }
  if (!branchId) {
    return res.status(403).json({
      success: false,
      error: 'Trusted Finance branch context is required.',
    });
  }
  req.financeContext = { userId, branchId };
  return next();
}

const notFound = (res, entity, id) =>
  res
    .status(404)
    .json({ success: false, error: `${entity} ${id} was not found` });

router.use('/students/me', studentRoutes);
router.use('/parents/me', parentRoutes);
router.use('/finance', requireFinanceContext);
router.use(
  '/finance/me/notifications',
  createUserNotificationRouter('finance'),
);

function dateRange(query) {
  const from = typeof query.from === 'string' ? query.from : '';
  const to = typeof query.to === 'string' ? query.to : '';
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if ((from && !datePattern.test(from)) || (to && !datePattern.test(to))) {
    return { error: 'from and to must use YYYY-MM-DD format.' };
  }
  const filter = {};
  if (from || to) {
    filter.$gte = from
      ? new Date(`${from}T00:00:00.000Z`)
      : new Date('1970-01-01T00:00:00.000Z');
    if (to) {
      const end = new Date(`${to}T00:00:00.000Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      filter.$lt = end;
    }
  }
  if (from && to && from > to)
    return { error: 'from must be on or before to.' };
  return {
    filter: from || to ? filter : null,
    from: from || null,
    to: to || null,
  };
}

function escapedRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

router.get('/students', async (req, res, next) => {
  try {
    const query = String(req.query.q || '').trim();
    const filter = query
      ? {
          $or: [
            { id: { $regex: query, $options: 'i' } },
            { name: { $regex: query, $options: 'i' } },
            { grade: { $regex: query, $options: 'i' } },
          ],
        }
      : {};
    const data = await getDatabase()
      .collection('students')
      .find(filter)
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/students/:id', async (req, res, next) => {
  try {
    const student = await getDatabase()
      .collection('students')
      .findOne({ id: req.params.id });
    return student
      ? res.json({ success: true, data: student })
      : notFound(res, 'Student', req.params.id);
  } catch (error) {
    return next(error);
  }
});

router.get('/parents', async (_req, res, next) => {
  try {
    const data = await getDatabase()
      .collection('parents')
      .aggregate([
        {
          $lookup: {
            from: 'students',
            localField: 'studentIds',
            foreignField: 'id',
            as: 'children',
          },
        },
      ])
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/parents/:id', async (req, res, next) => {
  try {
    const [parent] = await getDatabase()
      .collection('parents')
      .aggregate([
        { $match: { id: req.params.id } },
        {
          $lookup: {
            from: 'students',
            localField: 'studentIds',
            foreignField: 'id',
            as: 'children',
          },
        },
      ])
      .toArray();
    if (!parent) return notFound(res, 'Parent', req.params.id);
    const notices = await getDatabase()
      .collection('notices')
      .find({ active: { $ne: false } })
      .sort({ postedAt: -1 })
      .toArray();
    return res.json({ success: true, data: { ...parent, notices } });
  } catch (error) {
    return next(error);
  }
});

router.get('/finance/students', async (req, res, next) => {
  try {
    const query = String(req.query.q || '').trim();
    if (query.length > 100) {
      return res
        .status(400)
        .json({ success: false, error: 'Search query is too long.' });
    }
    const filter = { branchId: req.financeContext.branchId };
    if (query) {
      const pattern = escapedRegex(query);
      filter.$or = [
        { id: { $regex: pattern, $options: 'i' } },
        { name: { $regex: pattern, $options: 'i' } },
        { fullName: { $regex: pattern, $options: 'i' } },
        { email: { $regex: pattern, $options: 'i' } },
      ];
    }
    const data = await getDatabase()
      .collection('students')
      .find(filter, {
        projection: {
          _id: 0,
          id: 1,
          name: 1,
          fullName: 1,
          email: 1,
          grade: 1,
          section: 1,
          branchId: 1,
        },
      })
      .limit(100)
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/finance/summary', async (req, res, next) => {
  try {
    const range = dateRange(req.query);
    if (range.error)
      return res.status(400).json({ success: false, error: range.error });
    const invoices = getDatabase().collection('invoices');
    const payments = getDatabase().collection('payments');
    const invoiceFilter = { branchId: req.financeContext.branchId };
    if (range.from || range.to) {
      invoiceFilter.dueDate = {};
      if (range.from) invoiceFilter.dueDate.$gte = range.from;
      if (range.to) invoiceFilter.dueDate.$lte = range.to;
    }
    const collectionFilter = {
      branchId: req.financeContext.branchId,
      status: 'confirmed',
    };
    if (range.filter) collectionFilter.confirmedAt = range.filter;
    const [collected, unpaid, invoiceCount] = await Promise.all([
      payments
        .aggregate([
          { $match: collectionFilter },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ])
        .toArray(),
      invoices
        .aggregate([
          { $match: invoiceFilter },
          {
            $lookup: {
              from: 'payments',
              let: { invoiceId: '$id', branchId: '$branchId' },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ['$invoiceId', '$$invoiceId'] },
                        { $eq: ['$branchId', '$$branchId'] },
                        { $eq: ['$status', 'confirmed'] },
                      ],
                    },
                  },
                },
                { $group: { _id: null, total: { $sum: '$amount' } } },
              ],
              as: 'paid',
            },
          },
          {
            $addFields: {
              balanceDue: {
                $max: [
                  {
                    $subtract: [
                      '$amount',
                      { $ifNull: [{ $arrayElemAt: ['$paid.total', 0] }, 0] },
                    ],
                  },
                  0,
                ],
              },
            },
          },
          { $group: { _id: null, total: { $sum: '$balanceDue' } } },
        ])
        .toArray(),
      invoices.countDocuments(invoiceFilter),
    ]);
    return res.json({
      success: true,
      data: {
        currency: 'PKR',
        collected: collected[0]?.total || 0,
        outstanding: unpaid[0]?.total || 0,
        invoiceCount,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/finance/invoices', async (req, res, next) => {
  try {
    const status = String(req.query.status || '')
      .trim()
      .toLowerCase();
    if (status && !['due', 'overdue', 'partial', 'paid'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'status must be due, overdue, partial, or paid',
      });
    }
    const range = dateRange(req.query);
    if (range.error)
      return res.status(400).json({ success: false, error: range.error });
    const query = String(req.query.q || '').trim();
    if (query.length > 100) {
      return res
        .status(400)
        .json({ success: false, error: 'Search query is too long.' });
    }
    const match = {
      branchId: req.financeContext.branchId,
      ...(status ? { status } : {}),
    };
    if (range.from || range.to) {
      match.dueDate = {};
      if (range.from) match.dueDate.$gte = range.from;
      if (range.to) match.dueDate.$lte = range.to;
    }
    const pattern = query ? escapedRegex(query) : null;
    const data = await getDatabase()
      .collection('invoices')
      .aggregate([
        { $match: match },
        {
          $lookup: {
            from: 'students',
            let: { studentId: '$studentId', branchId: '$branchId' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$id', '$$studentId'] },
                      { $eq: ['$branchId', '$$branchId'] },
                    ],
                  },
                },
              },
            ],
            as: 'studentRecord',
          },
        },
        ...(pattern
          ? [
              {
                $match: {
                  $or: [
                    { id: { $regex: pattern, $options: 'i' } },
                    { voucherCode: { $regex: pattern, $options: 'i' } },
                    { studentId: { $regex: pattern, $options: 'i' } },
                    {
                      'studentRecord.name': { $regex: pattern, $options: 'i' },
                    },
                    {
                      'studentRecord.fullName': {
                        $regex: pattern,
                        $options: 'i',
                      },
                    },
                  ],
                },
              },
            ]
          : []),
        {
          $unwind: { path: '$studentRecord', preserveNullAndEmptyArrays: true },
        },
        {
          $addFields: {
            student: {
              $ifNull: ['$studentRecord.fullName', '$studentRecord.name'],
            },
          },
        },
        { $project: { studentRecord: 0 } },
        { $sort: { dueDate: 1 } },
        { $limit: 500 },
      ])
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/finance/dues', async (req, res, next) => {
  try {
    const range = dateRange(req.query);
    if (range.error)
      return res.status(400).json({ success: false, error: range.error });
    const studentId = String(req.query.studentId || '').trim();
    const query = String(req.query.q || '').trim();
    if (studentId.length > 120 || query.length > 100) {
      return res
        .status(400)
        .json({ success: false, error: 'Search filter is too long.' });
    }
    const match = { branchId: req.financeContext.branchId };
    if (studentId) match.studentId = studentId;
    if (range.from || range.to) {
      match.dueDate = {};
      if (range.from) match.dueDate.$gte = range.from;
      if (range.to) match.dueDate.$lte = range.to;
    }
    const pattern = query ? escapedRegex(query) : null;
    const records = await getDatabase()
      .collection('invoices')
      .aggregate([
        { $match: match },
        {
          $lookup: {
            from: 'payments',
            let: { invoiceId: '$id', branchId: '$branchId' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$invoiceId', '$$invoiceId'] },
                      { $eq: ['$branchId', '$$branchId'] },
                      {
                        $in: ['$status', ['confirmed', 'pending_verification']],
                      },
                    ],
                  },
                },
              },
              {
                $group: {
                  _id: null,
                  paidAmount: {
                    $sum: {
                      $cond: [{ $eq: ['$status', 'confirmed'] }, '$amount', 0],
                    },
                  },
                  pendingAmount: {
                    $sum: {
                      $cond: [
                        { $eq: ['$status', 'pending_verification'] },
                        '$amount',
                        0,
                      ],
                    },
                  },
                },
              },
            ],
            as: 'paymentTotals',
          },
        },
        {
          $lookup: {
            from: 'students',
            let: { studentId: '$studentId', branchId: '$branchId' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$id', '$$studentId'] },
                      { $eq: ['$branchId', '$$branchId'] },
                    ],
                  },
                },
              },
              { $project: { id: 1, name: 1, fullName: 1 } },
            ],
            as: 'studentRecord',
          },
        },
        {
          $unwind: { path: '$studentRecord', preserveNullAndEmptyArrays: true },
        },
        {
          $addFields: {
            paidAmount: {
              $ifNull: [{ $arrayElemAt: ['$paymentTotals.paidAmount', 0] }, 0],
            },
            pendingAmount: {
              $ifNull: [
                { $arrayElemAt: ['$paymentTotals.pendingAmount', 0] },
                0,
              ],
            },
            student: {
              $ifNull: ['$studentRecord.fullName', '$studentRecord.name'],
            },
          },
        },
        {
          $addFields: {
            balanceDue: {
              $max: [{ $subtract: ['$amount', '$paidAmount'] }, 0],
            },
            availableBalance: {
              $max: [
                {
                  $subtract: [
                    '$amount',
                    { $add: ['$paidAmount', '$pendingAmount'] },
                  ],
                },
                0,
              ],
            },
          },
        },
        ...(pattern
          ? [
              {
                $match: {
                  $or: [
                    { id: { $regex: pattern, $options: 'i' } },
                    { studentId: { $regex: pattern, $options: 'i' } },
                    { student: { $regex: pattern, $options: 'i' } },
                  ],
                },
              },
            ]
          : []),
        { $match: { balanceDue: { $gt: 0 } } },
        { $sort: { dueDate: 1, id: 1 } },
        { $limit: 500 },
        { $project: { paymentTotals: 0, studentRecord: 0 } },
      ])
      .toArray();
    const today = new Date().toISOString().slice(0, 10);
    const data = records.map(invoice => ({
      ...invoice,
      status:
        invoice.paidAmount > 0
          ? String(invoice.dueDate || '').slice(0, 10) < today
            ? 'overdue'
            : 'partial'
          : String(invoice.dueDate || '').slice(0, 10) < today
          ? 'overdue'
          : 'due',
    }));
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/finance/vouchers/:code/verify', async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim();
    if (!code)
      return res
        .status(400)
        .json({ success: false, error: 'Voucher code is required.' });
    const invoice = await getDatabase()
      .collection('invoices')
      .findOne({ voucherCode: code, branchId: req.financeContext.branchId });
    if (!invoice)
      return res.status(404).json({
        success: false,
        verified: false,
        error: 'Voucher was not found.',
      });
    const student = await getDatabase()
      .collection('students')
      .findOne(
        { id: invoice.studentId, branchId: req.financeContext.branchId },
        { projection: { name: 1, fullName: 1 } },
      );
    const totals = await getInvoicePaymentTotals(
      getDatabase().collection('payments'),
      invoice.id,
      req.financeContext.branchId,
    );
    const { paidAmount, pendingAmount } = totals;
    const balanceDue = Math.max(Number(invoice.amount) - paidAmount, 0);
    const availableBalance = Math.max(
      Number(invoice.amount) - paidAmount - pendingAmount,
      0,
    );
    return res.json({
      success: true,
      verified: true,
      data: {
        invoiceId: invoice.id,
        voucherCode: invoice.voucherCode,
        student: student?.fullName || student?.name || null,
        amount: invoice.amount,
        paidAmount,
        pendingAmount,
        balanceDue,
        availableBalance,
        currency: invoice.currency || 'PKR',
        invoiceStatus: invoice.status,
        paymentStatus:
          balanceDue === 0
            ? 'paid'
            : paidAmount > 0
            ? pendingAmount > 0
              ? 'partial_pending'
              : 'partial'
            : pendingAmount > 0
            ? 'pending_verification'
            : 'unpaid',
        dueDate: invoice.dueDate,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/finance/payments', async (req, res, next) => {
  try {
    const status = String(req.query.status || 'pending_verification').trim();
    if (!['pending_verification', 'confirmed', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'status must be pending_verification, confirmed, or rejected.',
      });
    }
    const data = await getDatabase()
      .collection('payments')
      .find(
        { branchId: req.financeContext.branchId, status },
        { projection: { requestHash: 0, idempotencyKey: 0 } },
      )
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.post('/finance/payments/:paymentId/verify', async (req, res, next) => {
  const actor = req.financeContext;
  const paymentId = req.params.paymentId;
  if (!ObjectId.isValid(paymentId)) {
    return res
      .status(404)
      .json({ success: false, error: 'Payment was not found.' });
  }

  const db = getDatabase();
  const payments = db.collection('payments');
  const session = getClient().startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const payment = await payments.findOne(
        {
          _id: new ObjectId(paymentId),
          branchId: actor.branchId,
          status: 'pending_verification',
        },
        { session },
      );
      if (!payment) {
        const existing = await payments.findOne(
          { _id: new ObjectId(paymentId), branchId: actor.branchId },
          { session, projection: { _id: 1, status: 1 } },
        );
        const error = new Error(
          existing
            ? 'Payment is no longer pending verification.'
            : 'Payment was not found in this branch.',
        );
        error.statusCode = existing ? 409 : 404;
        throw error;
      }

      const invoice = await db
        .collection('invoices')
        .findOne(
          { id: payment.invoiceId, branchId: actor.branchId },
          { session },
        );
      if (!invoice) {
        const error = new Error('Invoice was not found in this branch.');
        error.statusCode = 404;
        throw error;
      }
      const totals = await getInvoicePaymentTotals(
        payments,
        payment.invoiceId,
        actor.branchId,
        session,
      );
      const amountTotal = Number(invoice.amount);
      const paidCents = Math.round(totals.paidAmount * 100);
      const paymentCents = Math.round(Number(payment.amount) * 100);
      const totalCents = Math.round(amountTotal * 100);
      if (
        !Number.isFinite(amountTotal) ||
        paidCents + paymentCents > totalCents
      ) {
        const error = new Error(
          'Verifying this payment would exceed the invoice total.',
        );
        error.statusCode = 409;
        throw error;
      }

      const now = new Date();
      const receiptNumber = `RCT-${crypto.randomUUID()}`;
      const updated = await payments.updateOne(
        {
          _id: payment._id,
          branchId: actor.branchId,
          status: 'pending_verification',
        },
        {
          $set: {
            status: 'confirmed',
            confirmedAt: now,
            verifiedAt: now,
            verifiedByUserId: actor.userId,
            receiptNumber,
          },
        },
        { session },
      );
      if (updated.modifiedCount !== 1) {
        const error = new Error('Payment changed while it was being verified.');
        error.statusCode = 409;
        throw error;
      }

      const remainingPending =
        Math.max(Math.round(totals.pendingAmount * 100) - paymentCents, 0) /
        100;
      const paidAmount = (paidCents + paymentCents) / 100;
      const balanceDue =
        Math.max(totalCents - paidCents - paymentCents, 0) / 100;
      const invoiceUpdate = await db.collection('invoices').updateOne(
        { _id: invoice._id, branchId: actor.branchId },
        {
          $set: {
            paidAmount,
            pendingPaymentAmount: remainingPending,
            balanceDue,
            status:
              balanceDue === 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'due',
            paymentStatus:
              balanceDue === 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid',
            updatedAt: now,
          },
        },
        { session },
      );
      if (invoiceUpdate.matchedCount !== 1) {
        const error = new Error(
          'Invoice changed while the payment was being verified.',
        );
        error.statusCode = 409;
        throw error;
      }
      await db.collection('financeAuditLogs').insertOne(
        {
          id: crypto.randomUUID(),
          event: 'payment.verified',
          branchId: actor.branchId,
          actorUserId: actor.userId,
          invoiceId: payment.invoiceId,
          paymentId: payment._id,
          amount: payment.amount,
          receiptNumber,
          previousStatus: 'pending_verification',
          status: 'confirmed',
          createdAt: now,
        },
        { session },
      );
      result = {
        paymentId: payment._id,
        invoiceId: payment.invoiceId,
        amount: payment.amount,
        currency: payment.currency,
        status: 'confirmed',
        receiptNumber,
        confirmedAt: now,
        paidAmount,
        balanceDue,
      };
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    if (error.statusCode) {
      return res
        .status(error.statusCode)
        .json({ success: false, error: error.message });
    }
    return next(error);
  } finally {
    await session.endSession();
  }
});

router.post('/finance/payments', async (req, res, next) => {
  try {
    const invoiceId =
      typeof req.body?.invoiceId === 'string' ? req.body.invoiceId.trim() : '';
    const amount = Number(req.body?.amount);
    const method =
      typeof req.body?.method === 'string'
        ? req.body.method.trim().toLowerCase()
        : '';
    const reference =
      typeof req.body?.reference === 'string' ? req.body.reference.trim() : '';
    if (
      !invoiceId ||
      !Number.isFinite(amount) ||
      Math.round(amount * 100) !== amount * 100 ||
      amount <= 0 ||
      amount > 1000000000
    ) {
      return res.status(400).json({
        success: false,
        error:
          'invoiceId and a positive amount with at most two decimals are required.',
      });
    }
    if (
      !['cash', 'bank_transfer', 'card', 'cheque', 'other'].includes(method)
    ) {
      return res.status(400).json({
        success: false,
        error: 'method must be cash, bank_transfer, card, cheque, or other.',
      });
    }
    const idempotencyKey = String(req.get('Idempotency-Key') || '').trim();
    if (!/^[A-Za-z0-9._:-]{12,128}$/.test(idempotencyKey)) {
      return res.status(400).json({
        success: false,
        error:
          'A valid Idempotency-Key header is required for payment entries.',
      });
    }
    const requestHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ invoiceId, amount, method, reference }))
      .digest('hex');
    const db = getDatabase();
    const payments = db.collection('payments');
    await ensurePaymentIdempotencyIndex(payments);
    const actor = req.financeContext;
    const idempotencyFilter = {
      branchId: actor.branchId,
      createdByUserId: actor.userId,
      idempotencyKey,
    };
    const session = getClient().startSession();
    let response;
    try {
      await session.withTransaction(async () => {
        const previous = await payments.findOne(idempotencyFilter, { session });
        if (previous) {
          if (previous.requestHash !== requestHash) {
            const conflict = new Error(
              'Idempotency-Key was already used for a different payment request.',
            );
            conflict.statusCode = 409;
            throw conflict;
          }
          response = {
            statusCode: 200,
            payload: {
              success: true,
              duplicate: true,
              data: {
                paymentId: previous._id,
                invoiceId: previous.invoiceId,
                amount: previous.amount,
                currency: previous.currency,
                status: previous.status,
              },
              message: 'This payment entry was already recorded.',
            },
          };
          return;
        }

        const invoice = await db
          .collection('invoices')
          .findOne({ id: invoiceId, branchId: actor.branchId }, { session });
        if (!invoice) {
          const missing = new Error(
            'Invoice was not found in this Finance branch.',
          );
          missing.statusCode = 404;
          throw missing;
        }
        if (
          !Number.isFinite(Number(invoice.amount)) ||
          Number(invoice.amount) <= 0
        ) {
          const invalid = new Error('Invoice has an invalid total amount.');
          invalid.statusCode = 409;
          throw invalid;
        }

        const totals = await getInvoicePaymentTotals(
          payments,
          invoiceId,
          actor.branchId,
          session,
        );
        const availableCents = Math.max(
          Math.round(Number(invoice.amount) * 100) -
            Math.round(totals.paidAmount * 100) -
            Math.round(totals.pendingAmount * 100),
          0,
        );
        const available = availableCents / 100;
        if (amount > available) {
          const overpayment = new Error(
            `Payment exceeds the available invoice balance (${available.toFixed(
              2,
            )}).`,
          );
          overpayment.statusCode = 409;
          throw overpayment;
        }

        const now = new Date();
        const payment = {
          invoiceId,
          studentId: invoice.studentId,
          branchId: actor.branchId,
          amount,
          currency: invoice.currency || 'PKR',
          method,
          reference: reference || null,
          status: 'pending_verification',
          createdByUserId: actor.userId,
          idempotencyKey,
          requestHash,
          createdAt: now,
        };
        const inserted = await payments.insertOne(payment, { session });
        const invoiceUpdate = await db.collection('invoices').updateOne(
          { _id: invoice._id, branchId: actor.branchId },
          {
            $set: {
              paidAmount: totals.paidAmount,
              pendingPaymentAmount:
                (Math.round(totals.pendingAmount * 100) +
                  Math.round(amount * 100)) /
                100,
              balanceDue:
                Math.max(
                  Math.round(Number(invoice.amount) * 100) -
                    Math.round(totals.paidAmount * 100),
                  0,
                ) / 100,
              updatedAt: now,
            },
          },
          { session },
        );
        if (invoiceUpdate.matchedCount !== 1) {
          const changed = new Error(
            'Invoice changed while recording the payment.',
          );
          changed.statusCode = 409;
          throw changed;
        }
        await db.collection('financeAuditLogs').insertOne(
          {
            id: crypto.randomUUID(),
            event: 'payment.entry_created',
            branchId: actor.branchId,
            actorUserId: actor.userId,
            invoiceId,
            paymentId: inserted.insertedId,
            amount,
            status: payment.status,
            createdAt: now,
          },
          { session },
        );
        response = {
          statusCode: 201,
          payload: {
            success: true,
            data: {
              paymentId: inserted.insertedId,
              invoiceId,
              amount,
              currency: payment.currency,
              status: payment.status,
              availableBalance: Math.max(available - amount, 0),
            },
            message:
              'Payment entry recorded for verification. No receipt is issued until confirmation.',
          },
        };
      });
    } catch (error) {
      if (error.code === 11000) {
        const duplicate = await payments.findOne(idempotencyFilter);
        if (duplicate?.requestHash === requestHash) {
          response = {
            statusCode: 200,
            payload: {
              success: true,
              duplicate: true,
              data: {
                paymentId: duplicate._id,
                invoiceId: duplicate.invoiceId,
                amount: duplicate.amount,
                currency: duplicate.currency,
                status: duplicate.status,
              },
              message: 'This payment entry was already recorded.',
            },
          };
        } else if (duplicate) {
          return res.status(409).json({
            success: false,
            error:
              'Idempotency-Key was already used for a different payment request.',
          });
        } else {
          throw error;
        }
      } else if (error.statusCode) {
        return res
          .status(error.statusCode)
          .json({ success: false, error: error.message });
      } else {
        throw error;
      }
    } finally {
      await session.endSession();
    }
    return res.status(response.statusCode).json(response.payload);
  } catch (error) {
    return next(error);
  }
});

router.get('/finance/receipts', async (req, res, next) => {
  try {
    const range = dateRange(req.query);
    if (range.error)
      return res.status(400).json({ success: false, error: range.error });
    const match = {
      branchId: req.financeContext.branchId,
      status: 'confirmed',
    };
    if (range.filter) match.confirmedAt = range.filter;
    const data = await getDatabase()
      .collection('payments')
      .aggregate([
        { $match: match },
        {
          $lookup: {
            from: 'invoices',
            let: { invoiceId: '$invoiceId', branchId: '$branchId' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$id', '$$invoiceId'] },
                      { $eq: ['$branchId', '$$branchId'] },
                    ],
                  },
                },
              },
            ],
            as: 'invoice',
          },
        },
        { $unwind: { path: '$invoice', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'students',
            let: { studentId: '$studentId', branchId: '$branchId' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$id', '$$studentId'] },
                      { $eq: ['$branchId', '$$branchId'] },
                    ],
                  },
                },
              },
            ],
            as: 'studentRecord',
          },
        },
        {
          $unwind: { path: '$studentRecord', preserveNullAndEmptyArrays: true },
        },
        {
          $project: {
            receiptNumber: 1,
            invoiceId: 1,
            amount: 1,
            currency: 1,
            method: 1,
            reference: 1,
            confirmedAt: 1,
            student: '$studentRecord.name',
          },
        },
        { $sort: { confirmedAt: -1 } },
      ])
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/finance/receipts/:paymentId', async (req, res, next) => {
  try {
    const { paymentId } = req.params;
    if (!ObjectId.isValid(paymentId)) {
      return res
        .status(404)
        .json({ success: false, error: 'Receipt was not found.' });
    }
    const payment = await getDatabase()
      .collection('payments')
      .findOne({
        _id: new ObjectId(paymentId),
        branchId: req.financeContext.branchId,
        status: 'confirmed',
      });
    if (!payment || !payment.receiptNumber) {
      return res
        .status(404)
        .json({ success: false, error: 'Confirmed receipt was not found.' });
    }
    const [invoice, student] = await Promise.all([
      getDatabase()
        .collection('invoices')
        .findOne(
          { id: payment.invoiceId, branchId: req.financeContext.branchId },
          { projection: { id: 1, description: 1, amount: 1, currency: 1 } },
        ),
      getDatabase()
        .collection('students')
        .findOne(
          { id: payment.studentId, branchId: req.financeContext.branchId },
          { projection: { id: 1, name: 1, fullName: 1 } },
        ),
    ]);
    return res.json({
      success: true,
      data: {
        receiptNumber: payment.receiptNumber,
        invoiceId: payment.invoiceId,
        student: student?.fullName || student?.name || null,
        description: invoice?.description || null,
        amount: payment.amount,
        currency: payment.currency,
        method: payment.method,
        reference: payment.reference,
        confirmedAt: payment.confirmedAt,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/finance/reports/collections', async (req, res, next) => {
  try {
    const range = dateRange(req.query);
    if (range.error)
      return res.status(400).json({ success: false, error: range.error });
    const match = {
      branchId: req.financeContext.branchId,
      status: 'confirmed',
    };
    if (range.filter) match.confirmedAt = range.filter;
    const [totals, byMethod] = await Promise.all([
      getDatabase()
        .collection('payments')
        .aggregate([
          { $match: match },
          {
            $group: {
              _id: '$currency',
              total: { $sum: '$amount' },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray(),
      getDatabase()
        .collection('payments')
        .aggregate([
          { $match: match },
          {
            $group: {
              _id: '$method',
              total: { $sum: '$amount' },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray(),
    ]);
    return res.json({
      success: true,
      data: { confirmedCollections: totals, byMethod },
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
