const express = require('express');
const { ObjectId } = require('mongodb');
const { getDatabase } = require('./database');

const router = express.Router();
const GATEWAY = Object.freeze({
  id: 'easypaisa',
  name: 'Easypaisa merchant checkout',
  methods: ['card', 'easypaisa'],
});

function unavailableSetup() {
  return {
    enabled: false,
    provider: GATEWAY.id,
    methods: GATEWAY.methods,
    message:
      'Online fee checkout is disabled until the Easypaisa merchant integration is configured and its payment-status verification is tested.',
    requirements: [
      'Easypaisa online merchant approval and store credentials for Card and Easypaisa channels.',
      'The merchant-issued hosted-checkout and transaction-status integration guide/endpoints for this account.',
      'A verified callback signature or authenticated server-side status-check contract.',
      'Public HTTPS return and webhook URLs registered with the merchant gateway.',
    ],
  };
}

function isVerifiedParentLink(parentUserId, studentId) {
  return getDatabase().collection('parentChildLinks').findOne({
    parentUserId,
    studentId,
    revokedAt: null,
    $or: [{ status: 'verified' }, { verified: true }],
  });
}

router.get('/checkout/config', (_req, res) => {
  return res.json({ success: true, data: unavailableSetup() });
});

router.post(
  '/children/:studentId/invoices/:invoiceId/checkout',
  async (req, res, next) => {
    try {
      const studentId = String(req.params.studentId || '').trim();
      const invoiceId = String(req.params.invoiceId || '').trim();
      const method = String(req.body?.method || '').trim().toLowerCase();
      if (!studentId || !invoiceId || !GATEWAY.methods.includes(method)) {
        return res.status(400).json({
          success: false,
          error: 'A linked student, invoice, and supported payment method are required.',
        });
      }

      const link = await isVerifiedParentLink(req.parentUserId, studentId);
      if (!link) {
        return res.status(404).json({
          success: false,
          error: 'No verified linked child was found.',
        });
      }

      const invoice = await getDatabase().collection('invoices').findOne({
        id: invoiceId,
        studentId,
      });
      if (!invoice) {
        return res.status(404).json({
          success: false,
          error: 'Invoice was not found for this linked child.',
        });
      }
      const total = Number(invoice.amount);
      if (!Number.isFinite(total) || total <= 0) {
        return res.status(409).json({
          success: false,
          error: 'Invoice has an invalid total amount.',
        });
      }

      const payments = getDatabase().collection('payments');
      const [totals] = await payments.aggregate([
        { $match: { invoiceId, studentId, status: { $in: ['confirmed', 'pending_verification'] } } },
        {
          $group: {
            _id: null,
            confirmedCents: {
              $sum: {
                $cond: [
                  { $eq: ['$status', 'confirmed'] },
                  { $round: [{ $multiply: ['$amount', 100] }, 0] },
                  0,
                ],
              },
            },
            pendingCents: {
              $sum: {
                $cond: [
                  { $eq: ['$status', 'pending_verification'] },
                  { $round: [{ $multiply: ['$amount', 100] }, 0] },
                  0,
                ],
              },
            },
          },
        },
      ]).toArray();
      const totalCents = Math.round(total * 100);
      const confirmedCents = Number(totals?.confirmedCents || 0);
      const pendingCents = Number(totals?.pendingCents || 0);
      const balanceCents = Math.max(totalCents - confirmedCents, 0);
      const availableCents = Math.max(balanceCents - pendingCents, 0);
      if (!availableCents) {
        return res.status(409).json({
          success: false,
          error: 'No balance is available for online payment on this invoice.',
          data: {
            currency: invoice.currency || 'PKR',
            confirmedPaidAmount: confirmedCents / 100,
            pendingAmount: pendingCents / 100,
            balanceDue: balanceCents / 100,
            availableBalance: 0,
          },
        });
      }

      // Fail closed until the merchant account and an authenticated status verifier are configured.
      return res.status(503).json({
        success: false,
        error: unavailableSetup().message,
        data: {
          provider: GATEWAY.id,
          method,
          currency: invoice.currency || 'PKR',
          amount: availableCents / 100,
          checkoutEnabled: false,
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.get('/transactions/:paymentId/status', async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.paymentId)) {
      return res.status(400).json({ success: false, error: 'Invalid payment ID.' });
    }
    const payment = await getDatabase().collection('parentOnlinePayments').findOne({
      _id: new ObjectId(req.params.paymentId),
      parentUserId: req.parentUserId,
    });
    if (!payment || !(await isVerifiedParentLink(req.parentUserId, payment.studentId))) {
      return res.status(404).json({
        success: false,
        error: 'Payment status was not found for a currently linked child.',
      });
    }
    return res.json({
      success: true,
      data: {
        paymentId: String(payment._id),
        invoiceId: payment.invoiceId,
        status: payment.status,
        confirmedAt: payment.confirmedAt || null,
        receipt: payment.status === 'confirmed' && payment.receiptNumber
          ? { receiptNumber: payment.receiptNumber, amount: payment.amount, currency: payment.currency, confirmedAt: payment.confirmedAt }
          : null,
      },
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
