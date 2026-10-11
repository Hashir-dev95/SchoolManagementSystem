const crypto = require('node:crypto');
const express = require('express');
const { ObjectId } = require('mongodb');
const { getDatabase } = require('./database');
const { invoiceStatusFromCents } = require('./invoiceStatus');
const { cents, checkoutIdempotencyKey, checkoutRequestHash, availableInvoiceCents, canSettleParentPayment, lockInvoice, invoiceReservedCents } = require('./invoiceReservations');
const { referenceQuery, referenceValues } = require('./identityReferenceAdapter');

const router = express.Router();
const SUPPORTED_METHODS = ['card', 'easypaisa'];
let onlinePaymentIndexPromise;
let canonicalPaymentIndexPromise;
let activeInvoiceIndexPromise;
let globalActiveInvoiceIndexPromise;
let parentIdempotencyIndexPromise;
let reconciliationIndexPromise;

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

async function resolveReferencedRecord(db, collectionName, reference, session, label) {
  const query = referenceQuery(reference);
  if (!query) return null;
  const records = await db.collection(collectionName).find(query, session ? { session } : {}).limit(3).toArray();
  const unique = new Map(records.map(record => [String(record._id), record]));
  if (unique.size > 1) {
    const error = new Error(`${label} reference matches multiple records; payment access is denied.`);
    error.statusCode = 409;
    throw error;
  }
  return unique.values().next().value || null;
}

async function findVerifiedParentChild(db, parentReference, studentReference, session) {
  const parent = await resolveReferencedRecord(db, 'users', parentReference, session, 'Parent');
  const student = await resolveReferencedRecord(db, 'students', studentReference, session, 'Student');
  if (!parent || parent.role !== 'parent' || !student) return null;
  const parentRefs = referenceValues(parent);
  const studentRefs = referenceValues(student);
  const link = await db.collection('parentChildLinks').findOne({
    parentUserId: { $in: parentRefs }, studentId: { $in: studentRefs },
    revokedAt: null,
    status: { $ne: 'revoked' },
    $or: [{ status: 'verified' }, { verified: true }],
  }, session ? { session } : {});
  return link ? { parent, student, link } : null;
}

function isVerifiedParentLink(parentUserId, studentId) {
  return findVerifiedParentChild(getDatabase(), parentUserId, studentId).then(Boolean);
}

async function merchantRequest(url, apiKey, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json',
        ...(body.idempotencyKey ? { 'Idempotency-Key': body.idempotencyKey } : {}),
      },
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
  if (!transactionId || (payment.providerTransactionId && transactionId !== payment.providerTransactionId) || orderRef !== payment.orderRef ||
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

async function fetchVerifiedMerchantStatus(payment, config = gatewayConfiguration()) {
  const merchant = await merchantRequest(config.statusUrl, config.apiKey, {
    storeId: config.storeId,
    transactionId: payment.providerTransactionId,
    orderRef: payment.orderRef,
  });
  return validateMerchantStatus(payment, merchant, config);
}

async function ensurePaymentIndexes(db) {
  if (!onlinePaymentIndexPromise) {
    onlinePaymentIndexPromise = db.collection('parentOnlinePayments').createIndex(
      { provider: 1, providerTransactionId: 1 },
      { unique: true, partialFilterExpression: { providerTransactionId: { $type: 'string' } }, name: 'unique_parent_online_provider_transaction' },
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
      { unique: true, partialFilterExpression: { activeKey: 'active' }, name: 'unique_active_parent_invoice_checkout' },
    );
  }
  if (!globalActiveInvoiceIndexPromise) {
    globalActiveInvoiceIndexPromise = db.collection('parentOnlinePayments').createIndex(
      { invoiceId: 1, activeKey: 1 },
      { unique: true, partialFilterExpression: { activeKey: 'active' }, name: 'unique_active_parent_invoice_reservation' },
    );
  }
  if (!parentIdempotencyIndexPromise) {
    parentIdempotencyIndexPromise = db.collection('parentOnlinePayments').createIndex(
      { parentUserId: 1, idempotencyKey: 1 },
      { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } }, name: 'unique_parent_checkout_idempotency' },
    );
  }
  if (!reconciliationIndexPromise) {
    reconciliationIndexPromise = db.collection('parentOnlinePayments').createIndex(
      { activeKey: 1, status: 1, reconciliationNextAt: 1, workerLeaseExpiresAt: 1, createdAt: 1 },
      { name: 'parent_payment_reconciliation_claim' },
    );
  }
  await Promise.all([onlinePaymentIndexPromise, canonicalPaymentIndexPromise, activeInvoiceIndexPromise, globalActiveInvoiceIndexPromise, parentIdempotencyIndexPromise, reconciliationIndexPromise]);
}

async function confirmPayment(payment, merchantStatus) {
  const db = getDatabase();
  await ensurePaymentIndexes(db);
  const onlinePayments = db.collection('parentOnlinePayments');
  const payments = db.collection('payments');
  const { getClient } = require('./database');
  const session = getClient().startSession();
  let current;
  try {
    await session.withTransaction(async () => {
      current = await onlinePayments.findOne({ _id: payment._id }, { session });
      if (!current) throw new Error('Pending online payment no longer exists.');
      const existingCanonical = await payments.findOne({ onlinePaymentId: String(current._id) }, { session });
      if (existingCanonical) {
        if (current.status !== 'confirmed') {
          await onlinePayments.updateOne({ _id: current._id }, { $set: {
            status: 'reconciliation_required', reconciliationReason: 'existing_canonical_payment_requires_reconciliation',
          } }, { session });
          current.status = 'reconciliation_required';
        }
        return;
      }
      if (!['initiated', 'pending', 'confirming', 'reconciliation_required'].includes(current.status)) return;

      const linked = await findVerifiedParentChild(db, current.parentUserId, current.studentId, session);
      const invoice = await db.collection('invoices').findOne({ id: current.invoiceId }, { session });
      const invoiceBranch = invoice ? await resolveReferencedRecord(db, 'branches', invoice.branchId, session, 'Invoice branch') : null;
      const studentBranch = linked ? await resolveReferencedRecord(db, 'branches', linked.student.branchId, session, 'Student branch') : null;
      const parentBranch = linked ? await resolveReferencedRecord(db, 'branches', linked.parent.branchId, session, 'Parent branch') : null;
      const amountCents = cents(current.amount);
      const totalCents = cents(invoice?.amount);
      const expectedCurrency = String(invoice?.currency || 'PKR').toUpperCase();
      if (!invoice || !Number.isSafeInteger(totalCents) || totalCents <= 0 ||
          !Number.isSafeInteger(amountCents) || amountCents <= 0 ||
          !linked || !invoiceBranch || !studentBranch || !parentBranch ||
          !referenceValues(linked.student).some(value => String(value) === String(invoice.studentId)) ||
          String(invoiceBranch._id) !== String(studentBranch._id) || String(invoiceBranch._id) !== String(parentBranch._id) ||
          !referenceValues(invoiceBranch).some(value => String(value) === String(current.branchId)) ||
          expectedCurrency !== String(current.currency || '').toUpperCase() ||
          String(merchantStatus.transactionId || '') !== String(current.providerTransactionId || '') ||
          String(merchantStatus.orderRef || current.orderRef) !== String(current.orderRef)) {
        await onlinePayments.updateOne({ _id: current._id }, { $set: {
          status: 'reconciliation_required', reconciliationReason: !invoice ? 'invoice_missing_or_mismatched' : 'settlement_identity_mismatch',
          merchantStatus: merchantStatus.status, lastCheckedAt: new Date(),
        } }, { session });
        current.status = 'reconciliation_required';
        return;
      }
      await lockInvoice(db.collection('invoices'), invoice, session);
      const reservations = await invoiceReservedCents(db, invoice, session, current._id);
      if (!canSettleParentPayment(invoice, current, reservations)) {
        await onlinePayments.updateOne({ _id: current._id }, { $set: {
          status: 'reconciliation_required', reconciliationReason: 'invoice_balance_reserved_or_paid',
          merchantStatus: merchantStatus.status, lastCheckedAt: new Date(),
        } }, { session });
        current.status = 'reconciliation_required';
        return;
      }

      const confirmedAt = new Date();
      const canonical = {
        onlinePaymentId: String(current._id), invoiceId: current.invoiceId, studentId: current.studentId,
        branchId: current.branchId, amount: current.amount, currency: current.currency, method: current.method,
        status: 'confirmed', provider: current.provider, providerTransactionId: current.providerTransactionId,
        receiptNumber: `RCT-${crypto.randomUUID()}`, confirmedAt, createdAt: current.createdAt,
        enteredByUserId: 'online-merchant-verification',
      };
      const inserted = await payments.insertOne(canonical, { session });
      const paidCents = reservations.paidCents + amountCents;
      const invoiceUpdate = await db.collection('invoices').updateOne({ _id: invoice._id, branchId: invoice.branchId }, { $set: {
        paidAmount: paidCents / 100,
        pendingPaymentAmount: reservations.pendingCents / 100,
        balanceDue: Math.max(totalCents - paidCents, 0) / 100,
        status: invoiceStatusFromCents(totalCents, paidCents), updatedAt: confirmedAt,
      } }, { session });
      if (invoiceUpdate.matchedCount !== 1) {
        const error = new Error('Invoice changed while applying the confirmed payment.');
        error.statusCode = 409;
        throw error;
      }
      await onlinePayments.updateOne({ _id: current._id }, { $set: {
        status: 'confirmed', merchantStatus: merchantStatus.status, confirmedAt,
        receiptNumber: canonical.receiptNumber, canonicalPaymentId: inserted.insertedId,
      }, $unset: {
        activeKey: '', reconciliationReason: '', reconciliationNextAt: '',
        reconciliationExhaustedAt: '', workerLeaseId: '', workerLeaseExpiresAt: '',
      } }, { session });
      current = { ...current, status: 'confirmed', confirmedAt, receiptNumber: canonical.receiptNumber };
    });
    return current;
  } finally {
    await session.endSession();
  }
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
    const db = getDatabase();
    await ensurePaymentIndexes(db);
    const suppliedKey = String(req.get('Idempotency-Key') || '').trim();
    if (suppliedKey && !/^[A-Za-z0-9._:-]{12,128}$/.test(suppliedKey)) {
      return res.status(400).json({ success: false, error: 'Idempotency-Key must be 12-128 safe characters.' });
    }
    const idempotencyKey = checkoutIdempotencyKey(req.parentUserId, studentId, invoiceId, method, suppliedKey);
    const requestHash = checkoutRequestHash(studentId, invoiceId, method);
    const onlinePayments = db.collection('parentOnlinePayments');
    const idemFilter = { parentUserId: req.parentUserId, idempotencyKey };
    const previous = await onlinePayments.findOne(idemFilter);
    if (previous) {
      if (previous.requestHash !== requestHash) return res.status(409).json({ success: false, error: 'Idempotency-Key was already used for a different checkout request.' });
      if (previous.status === 'pending' && previous.checkoutUrl) {
        return res.json({ success: true, duplicate: true, data: {
          paymentId: String(previous._id), checkoutUrl: previous.checkoutUrl, status: 'pending',
          amount: previous.amount, currency: previous.currency, method: previous.method,
        } });
      }
      if (['initiated', 'reconciliation_required', 'confirming'].includes(previous.status)) {
        return res.status(202).json({ success: true, duplicate: true, data: {
          paymentId: String(previous._id), status: previous.status, amount: previous.amount,
          currency: previous.currency, method: previous.method,
        }, message: 'This checkout is still reserved and will not be recreated while its merchant result is uncertain.' });
      }
      return res.status(409).json({ success: false, error: 'This idempotent checkout is terminal; use a new Idempotency-Key to start another attempt.' });
    }

    const { getClient } = require('./database');
    const session = getClient().startSession();
    let basePayment;
    let reservedId;
    try {
      await session.withTransaction(async () => {
        const linked = await findVerifiedParentChild(db, req.parentUserId, studentId, session);
        if (!linked) { const error = new Error('No verified linked child was found.'); error.statusCode = 404; throw error; }
        let invoice = await db.collection('invoices').findOne({ id: invoiceId }, { session });
        if (!invoice) { const error = new Error('Invoice was not found for this linked child.'); error.statusCode = 404; throw error; }
        const invoiceBranch = await resolveReferencedRecord(db, 'branches', invoice.branchId, session, 'Invoice branch');
        const studentBranch = await resolveReferencedRecord(db, 'branches', linked.student.branchId, session, 'Student branch');
        const parentBranch = await resolveReferencedRecord(db, 'branches', linked.parent.branchId, session, 'Parent branch');
        const invoiceMatchesChild = referenceValues(linked.student).some(value => String(value) === String(invoice.studentId));
        const invoiceMatchesBranch = referenceValues(invoiceBranch).some(value => String(value) === String(invoice.branchId));
        if (!invoiceMatchesChild || !invoiceMatchesBranch || String(invoiceBranch._id) !== String(studentBranch._id) || String(invoiceBranch._id) !== String(parentBranch._id)) {
          const error = new Error('Invoice, student, and verified Parent branch references do not match.'); error.statusCode = 409; throw error;
        }
        invoice = await lockInvoice(db.collection('invoices'), invoice, session);
        const totalCents = cents(invoice.amount);
        if (!Number.isSafeInteger(totalCents) || totalCents <= 0) { const error = new Error('Invoice has an invalid total amount.'); error.statusCode = 409; throw error; }
        const totals = await invoiceReservedCents(db, invoice, session);
        const amountCents = availableInvoiceCents(invoice, totals);
        if (!amountCents) { const error = new Error('No balance is available for online payment on this invoice.'); error.statusCode = 409; throw error; }
        const orderRef = `FEE-${crypto.createHash('sha256').update(`${req.parentUserId}:${idempotencyKey}`).digest('hex').slice(0, 32).toUpperCase()}`;
        basePayment = {
          parentUserId: req.parentUserId, studentId, invoiceId, branchId: invoice.branchId,
          provider: config.provider, method, orderRef, idempotencyKey, requestHash,
          amount: amountCents / 100, currency: String(invoice.currency || 'PKR').toUpperCase(),
          status: 'initiated', createdAt: new Date(), expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        };
        const inserted = await onlinePayments.insertOne({ ...basePayment, activeKey: 'active' }, { session });
        reservedId = inserted.insertedId;
      });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: error.message });
      if (error?.code === 11000) {
        const duplicate = await onlinePayments.findOne(idemFilter);
        if (duplicate?.requestHash === requestHash) return res.status(202).json({
          success: true, duplicate: true, data: {
            paymentId: String(duplicate._id), ...(duplicate.checkoutUrl ? { checkoutUrl: duplicate.checkoutUrl } : {}),
            status: duplicate.status, amount: duplicate.amount, currency: duplicate.currency, method: duplicate.method,
          },
        });
        return res.status(409).json({ success: false, error: 'An online payment reservation or checkout retry already exists for this invoice.' });
      }
      throw error;
    } finally {
      await session.endSession();
    }
    let merchant;
    try {
      merchant = await merchantRequest(config.checkoutUrl, config.apiKey, {
        storeId: config.storeId, orderRef: basePayment.orderRef, amount: basePayment.amount, currency: basePayment.currency,
        method, metadata: { invoiceId, studentId }, idempotencyKey,
      });
    } catch (error) {
      await onlinePayments.updateOne({ _id: reservedId, status: 'initiated' }, { $set: {
        status: 'reconciliation_required', reconciliationReason: 'merchant_checkout_outcome_unknown',
        lastCheckedAt: new Date(),
      } });
      return res.status(202).json({ success: true, data: { paymentId: String(reservedId), status: 'reconciliation_required' },
        message: 'Merchant checkout outcome is uncertain; the invoice balance remains reserved pending status reconciliation.' });
    }
    const checkoutUrl = httpsUrl(merchant.checkoutUrl);
    const providerTransactionId = String(merchant.transactionId || '').trim();
    if (!checkoutUrl || !providerTransactionId) {
      await onlinePayments.updateOne({ _id: reservedId, status: 'initiated' }, { $set: {
        status: 'reconciliation_required', reconciliationReason: 'invalid_merchant_response', lastCheckedAt: new Date(),
      } });
      return res.status(202).json({ success: true, data: { paymentId: String(reservedId), status: 'reconciliation_required' },
        message: 'Merchant response was incomplete; the invoice balance remains reserved pending reconciliation.' });
    }
    await onlinePayments.updateOne(
      { _id: reservedId, status: 'initiated' },
      { $set: { providerTransactionId, checkoutUrl, status: 'pending' } },
    );
    return res.status(201).json({ success: true, data: {
      paymentId: String(reservedId), checkoutUrl, status: 'pending',
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
    } else if (['pending', 'initiated', 'reconciliation_required'].includes(payment.status)) {
      const config = gatewayConfiguration();
      if (!config.enabled) return res.status(503).json({ success: false, error: config.message });
      if (payment.expiresAt && payment.expiresAt <= new Date() && payment.status !== 'reconciliation_required') {
        // Expiry only changes the workflow state; an uncertain external payment keeps its invoice hold.
        await db.collection('parentOnlinePayments').updateOne({ _id: payment._id, status: payment.status }, { $set: {
          status: 'reconciliation_required', reconciliationReason: 'checkout_expired_awaiting_authoritative_status',
        } });
        payment.status = 'reconciliation_required';
      }
      const verified = await fetchVerifiedMerchantStatus(payment, config);
      if (verified.confirmed) {
        if (!payment.providerTransactionId) {
          await db.collection('parentOnlinePayments').updateOne({ _id: payment._id, status: payment.status }, { $set: { providerTransactionId: verified.transactionId } });
          payment.providerTransactionId = verified.transactionId;
        }
        payment = await confirmPayment(payment, verified);
      }
      else if (verified.failed) {
        await db.collection('parentOnlinePayments').updateOne(
          { _id: payment._id, status: { $in: ['pending', 'initiated', 'reconciliation_required'] } },
          { $set: { status: 'failed', merchantStatus: verified.status, lastCheckedAt: new Date(), terminalFailureVerifiedAt: new Date() },
            $unset: { activeKey: '', workerLeaseId: '', workerLeaseExpiresAt: '' } },
        );
        payment = await db.collection('parentOnlinePayments').findOne({ _id: payment._id });
      } else {
        await db.collection('parentOnlinePayments').updateOne(
          { _id: payment._id, status: { $in: ['pending', 'initiated', 'reconciliation_required'] } },
          { $set: { merchantStatus: verified.status, lastCheckedAt: new Date() } },
        );
        payment = await db.collection('parentOnlinePayments').findOne({ _id: payment._id });
      }
    }
    return res.json({ success: true, data: statusResponse(payment) });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
module.exports.__test = { gatewayConfiguration, httpsUrl, publicGatewayConfiguration, statusResponse, validateMerchantStatus, fetchVerifiedMerchantStatus, ensurePaymentIndexes, confirmPayment };
module.exports.__reconciliation = { gatewayConfiguration, fetchVerifiedMerchantStatus, ensurePaymentIndexes, confirmPayment };
