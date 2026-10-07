const crypto = require('node:crypto');
const express = require('express');
const { ObjectId } = require('mongodb');
const { getDatabase } = require('./database');

const router = express.Router();
const SUPPORTED_METHODS = ['card', 'easypaisa'];
const ACTIVE_STATUSES = ['initiated', 'pending', 'confirming'];
let onlinePaymentIndexPromise;
let canonicalPaymentIndexPromise;
let activeInvoiceIndexPromise;

function httpsUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function gatewayConfiguration(env = process.env) {
  const checkoutUrl = httpsUrl(env.EASYPAISA_CHECKOUT_URL);
  const statusUrl = httpsUrl(env.EASYPAISA_STATUS_URL);
  const storeId = String(env.EASYPAISA_STORE_ID || '').trim();
  const apiKey = String(env.EASYPAISA_API_KEY || '').trim();
  const confirmedStatus = String(env.EASYPAISA_CONFIRMED_STATUS || '').trim().toUpperCase();
  const failedStatuses = [...new Set(String(env.EASYPAISA_FAILED_STATUSES || '').split(',')
    .map(value => value.trim().toUpperCase()).filter(Boolean))];
  const methods = [...new Set(String(env.EASYPAISA_METHODS || '').split(',')
    .map(value => value.trim().toLowerCase())
    .filter(value => SUPPORTED_METHODS.includes(value)))];
  const enabled = Boolean(checkoutUrl && statusUrl && storeId && apiKey && confirmedStatus && failedStatuses.length && methods.length);
  return {
    enabled,
    provider: 'easypaisa',
    methods: enabled ? methods : [],
    message: enabled
      ? 'Secure merchant checkout is available.'
      : 'Online fee checkout is disabled because the school merchant checkout or server-side payment-status configuration is incomplete.',
    checkoutUrl,
    statusUrl,
    storeId,
    apiKey,
    confirmedStatus,
    failedStatuses,
  };
}

function publicGatewayConfiguration(env = process.env) {
  const config = gatewayConfiguration(env);
  return { enabled: config.enabled, provider: config.provider, methods: config.methods, message: config.message };
}

function isVerifiedParentLink(parentUserId, studentId) {
  return getDatabase().collection('parentChildLinks').findOne({
    parentUserId,
    studentId,
    revokedAt: null,
    status: { $ne: 'revoked' },
    $or: [{ status: 'verified' }, { verified: true }],
  });
}

async function merchantRequest(url, apiKey, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || typeof payload !== 'object') {
      throw new Error(`Merchant service rejected the request (${response.status}).`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function validateMerchantStatus(payment, payload, config) {
  const transactionId = String(payload.transactionId || '').trim();
  const orderRef = String(payload.orderRef || '').trim();
  const currency = String(payload.currency || '').trim().toUpperCase();
  const status = String(payload.status || '').trim().toUpperCase();
  const amountCents = Math.round(Number(payload.amount) * 100);
  if (!transactionId || transactionId !== payment.providerTransactionId || orderRef !== payment.orderRef ||
      currency !== String(payment.currency).toUpperCase() || amountCents !== Math.round(Number(payment.amount) * 100) || !status) {
    throw new Error('Merchant status response did not match the pending payment.');
  }
  return {
    confirmed: status === config.confirmedStatus,
    failed: config.failedStatuses.includes(status),
    status,
    transactionId,
  };
}

async function ensurePaymentIndexes(db) {
  if (!onlinePaymentIndexPromise) {
    onlinePaymentIndexPromise = db.collection('parentOnlinePayments').createIndex(
      { provider: 1, providerTransactionId: 1 },
      { unique: true, sparse: true, name: 'unique_parent_online_provider_transaction' },
    );
  }
  if (!canonicalPaymentIndexPromise) {
    canonicalPaymentIndexPromise = db.collection('payments').createIndex(
      { onlinePaymentId: 1 },
      { unique: true, sparse: true, name: 'unique_confirmed_online_payment' },
    );
  }
  if (!activeInvoiceIndexPromise) {
    activeInvoiceIndexPromise = db.collection('parentOnlinePayments').createIndex(
      { parentUserId: 1, studentId: 1, invoiceId: 1, activeKey: 1 },
      { unique: true, sparse: true, name: 'unique_active_parent_invoice_checkout' },
    );
  }
  await Promise.all([onlinePaymentIndexPromise, canonicalPaymentIndexPromise, activeInvoiceIndexPromise]);
}

async function confirmPayment(payment, merchantStatus) {
  const db = getDatabase();
  await ensurePaymentIndexes(db);
  const onlinePayments = db.collection('parentOnlinePayments');
  const payments = db.collection('payments');
  const claimed = await onlinePayments.findOneAndUpdate(
    { _id: payment._id, status: { $in: ['initiated', 'pending'] } },
    { $set: { status: 'confirming', verifiedAt: new Date() } },
    { returnDocument: 'after' },
  );
  const current = claimed || (await onlinePayments.findOne({ _id: payment._id }));
  if (!current) throw new Error('Pending online payment no longer exists.');
  let canonical = await payments.findOne({ onlinePaymentId: String(payment._id) });
  if (!canonical && current.status === 'confirming') {
    const confirmedAt = new Date();
    canonical = {
      onlinePaymentId: String(payment._id), invoiceId: payment.invoiceId, studentId: payment.studentId,
      branchId: payment.branchId, amount: payment.amount, currency: payment.currency, method: payment.method,
      status: 'confirmed', provider: payment.provider, providerTransactionId: payment.providerTransactionId,
      receiptNumber: `RCT-${crypto.randomUUID()}`, confirmedAt, createdAt: payment.createdAt,
      enteredByUserId: 'online-merchant-verification',
    };
    try {
      const inserted = await payments.insertOne(canonical);
      canonical._id = inserted.insertedId;
    } catch (error) {
      if (error?.code !== 11000) throw error;
      canonical = await payments.findOne({ onlinePaymentId: String(payment._id) });
    }
  }
  if (!canonical) return current;
  const invoice = await db.collection('invoices').findOne({
    id: payment.invoiceId,
    studentId: payment.studentId,
    branchId: payment.branchId,
  });
  if (invoice) {
    const [totals] = await payments.aggregate([
      { $match: { invoiceId: payment.invoiceId, studentId: payment.studentId, branchId: payment.branchId, status: 'confirmed' } },
      { $group: { _id: null, amount: { $sum: '$amount' } } },
    ]).toArray();
    const paidCents = Math.round(Number(totals?.amount || 0) * 100);
    const invoiceCents = Math.round(Number(invoice.amount || 0) * 100);
    await db.collection('invoices').updateOne(
      { _id: invoice._id, branchId: payment.branchId },
      { $set: { status: paidCents >= invoiceCents ? 'paid' : 'partially_paid', updatedAt: new Date() } },
    );
  }
  await onlinePayments.updateOne(
    { _id: payment._id },
    {
      $set: { status: 'confirmed', merchantStatus: merchantStatus.status, confirmedAt: canonical.confirmedAt,
        receiptNumber: canonical.receiptNumber, canonicalPaymentId: canonical._id },
      $unset: { activeKey: '' },
    },
  );
  return onlinePayments.findOne({ _id: payment._id });
}

function statusResponse(payment) {
  return {
    paymentId: String(payment._id), invoiceId: payment.invoiceId, status: payment.status,
    confirmedAt: payment.confirmedAt || null,
    receipt: payment.status === 'confirmed' && payment.receiptNumber
      ? { receiptNumber: payment.receiptNumber, amount: payment.amount, currency: payment.currency,
          method: payment.method, confirmedAt: payment.confirmedAt }
      : null,
  };
}

router.get('/checkout/config', (_req, res) => {
  return res.json({ success: true, data: publicGatewayConfiguration() });
});

router.post('/children/:studentId/invoices/:invoiceId/checkout', async (req, res, next) => {
  try {
    const config = gatewayConfiguration();
    if (!config.enabled) return res.status(503).json({ success: false, error: config.message });
    const studentId = String(req.params.studentId || '').trim();
    const invoiceId = String(req.params.invoiceId || '').trim();
    const method = String(req.body?.method || '').trim().toLowerCase();
    if (!studentId || !invoiceId || !config.methods.includes(method)) {
      return res.status(400).json({ success: false, error: 'A linked student, invoice, and configured payment method are required.' });
    }
    if (!(await isVerifiedParentLink(req.parentUserId, studentId))) {
      return res.status(404).json({ success: false, error: 'No verified linked child was found.' });
    }
    const db = getDatabase();
    const invoice = await db.collection('invoices').findOne({ id: invoiceId, studentId });
    if (!invoice) return res.status(404).json({ success: false, error: 'Invoice was not found for this linked child.' });
    if (!invoice.branchId) {
      return res.status(409).json({ success: false, error: 'Invoice is missing its Finance branch and cannot be paid online.' });
    }
    const active = await db.collection('parentOnlinePayments').findOne({
      parentUserId: req.parentUserId, studentId, invoiceId, status: { $in: ACTIVE_STATUSES },
    });
    if (active) return res.status(409).json({ success: false, error: 'An online payment for this invoice is already awaiting merchant confirmation.' });
    const totalCents = Math.round(Number(invoice.amount) * 100);
    if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
      return res.status(409).json({ success: false, error: 'Invoice has an invalid total amount.' });
    }
    const [totals] = await db.collection('payments').aggregate([
      { $match: { invoiceId, studentId, status: { $in: ['confirmed', 'pending_verification'] } } },
      { $group: { _id: null, reserved: { $sum: { $round: [{ $multiply: ['$amount', 100] }, 0] } } } },
    ]).toArray();
    const amountCents = Math.max(totalCents - Number(totals?.reserved || 0), 0);
    if (!amountCents) return res.status(409).json({ success: false, error: 'No balance is available for online payment on this invoice.' });
    const orderRef = `FEE-${crypto.randomUUID()}`;
    const basePayment = {
      parentUserId: req.parentUserId, studentId, invoiceId, branchId: invoice.branchId || null,
      provider: config.provider, method, orderRef, amount: amountCents / 100,
      currency: String(invoice.currency || 'PKR').toUpperCase(), status: 'initiated', createdAt: new Date(),
    };
    await ensurePaymentIndexes(db);
    let reserved;
    try {
      reserved = await db.collection('parentOnlinePayments').insertOne({
        ...basePayment,
        activeKey: 'active',
      });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({ success: false, error: 'An online payment for this invoice is already awaiting merchant confirmation.' });
      }
      throw error;
    }
    let merchant;
    try {
      merchant = await merchantRequest(config.checkoutUrl, config.apiKey, {
        storeId: config.storeId, orderRef, amount: basePayment.amount, currency: basePayment.currency,
        method, metadata: { invoiceId, studentId },
      });
    } catch (error) {
      await db.collection('parentOnlinePayments').updateOne(
        { _id: reserved.insertedId, status: 'initiated' },
        { $set: { status: 'failed', failureReason: 'merchant_checkout_failed' }, $unset: { activeKey: '' } },
      );
      throw error;
    }
    const checkoutUrl = httpsUrl(merchant.checkoutUrl);
    const providerTransactionId = String(merchant.transactionId || '').trim();
    if (!checkoutUrl || !providerTransactionId) {
      await db.collection('parentOnlinePayments').updateOne(
        { _id: reserved.insertedId, status: 'initiated' },
        { $set: { status: 'failed', failureReason: 'invalid_merchant_response' }, $unset: { activeKey: '' } },
      );
      return res.status(502).json({ success: false, error: 'Merchant checkout response was invalid.' });
    }
    await db.collection('parentOnlinePayments').updateOne(
      { _id: reserved.insertedId, status: 'initiated' },
      { $set: { providerTransactionId, checkoutUrl, status: 'pending' } },
    );
    return res.status(201).json({ success: true, data: {
      paymentId: String(reserved.insertedId), checkoutUrl, status: 'pending',
      amount: basePayment.amount, currency: basePayment.currency, method,
    } });
  } catch (error) {
    return next(error);
  }
});

router.get('/transactions/:paymentId/status', async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.paymentId)) return res.status(400).json({ success: false, error: 'Invalid payment ID.' });
    const db = getDatabase();
    let payment = await db.collection('parentOnlinePayments').findOne({
      _id: new ObjectId(req.params.paymentId), parentUserId: req.parentUserId,
    });
    if (!payment || !(await isVerifiedParentLink(req.parentUserId, payment.studentId))) {
      return res.status(404).json({ success: false, error: 'Payment status was not found for a currently linked child.' });
    }
    if (payment.status === 'confirming') {
      const canonical = await db.collection('payments').findOne({ onlinePaymentId: String(payment._id) });
      if (canonical) payment = await confirmPayment(payment, { status: payment.merchantStatus || 'CONFIRMED' });
    } else if (payment.status === 'pending') {
      const config = gatewayConfiguration();
      if (!config.enabled) return res.status(503).json({ success: false, error: config.message });
      const merchant = await merchantRequest(config.statusUrl, config.apiKey, {
        storeId: config.storeId, transactionId: payment.providerTransactionId, orderRef: payment.orderRef,
      });
      const verified = validateMerchantStatus(payment, merchant, config);
      if (verified.confirmed) payment = await confirmPayment(payment, verified);
      else if (verified.failed) {
        await db.collection('parentOnlinePayments').updateOne(
          { _id: payment._id, status: 'pending' },
          { $set: { status: 'failed', merchantStatus: verified.status, lastCheckedAt: new Date() }, $unset: { activeKey: '' } },
        );
        payment = { ...payment, status: 'failed', merchantStatus: verified.status };
      } else {
        await db.collection('parentOnlinePayments').updateOne(
          { _id: payment._id, status: 'pending' },
          { $set: { merchantStatus: verified.status, lastCheckedAt: new Date() } },
        );
        payment = { ...payment, merchantStatus: verified.status };
      }
    }
    return res.json({ success: true, data: statusResponse(payment) });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
module.exports.__test = { gatewayConfiguration, httpsUrl, publicGatewayConfiguration, statusResponse, validateMerchantStatus };
