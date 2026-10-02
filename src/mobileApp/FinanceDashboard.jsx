import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { financeApi } from './financeService';
import { financePreview } from './previewData';

const colors = {
  ink: '#14243A',
  muted: '#69788C',
  blue: '#246BFD',
  pale: '#F2F6FC',
  line: '#E3EAF3',
  green: '#168A62',
  red: '#B42318',
};
const initialForm = {
  invoiceId: '',
  amount: '',
  method: 'cash',
  reference: '',
};

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  autoCapitalize = 'none',
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        style={styles.input}
        placeholderTextColor={colors.muted}
      />
    </View>
  );
}

function Action({ title, onPress, disabled, secondary }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.action,
        secondary && styles.secondaryAction,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.actionText, secondary && styles.secondaryText]}>
        {title}
      </Text>
    </Pressable>
  );
}

function Notice({ message, error }) {
  if (!message) return null;
  return (
    <Text
      accessibilityRole="alert"
      style={[styles.notice, error && styles.error]}
    >
      {message}
    </Text>
  );
}

function formatMoney(amount, currency = 'PKR') {
  return `${currency} ${Number(amount || 0).toLocaleString()}`;
}

function financeErrorMessage(error) {
  const message = error?.message || 'Finance request failed.';
  if (
    /trusted user context|finance access is required|branch context/i.test(
      message,
    )
  ) {
    return `Finance integration blocked: partner authentication must provide trusted req.user.id, role "finance", and req.user.branchId. ${message}`;
  }
  return message;
}

export default function FinanceDashboard({
  previewOnly = false,
  searchQuery = '',
}) {
  const [filters, setFilters] = useState({ from: '', to: '', q: '' });
  const [summary, setSummary] = useState(
    previewOnly ? financePreview.summary : null,
  );
  const [invoices, setInvoices] = useState(
    previewOnly ? financePreview.invoices : [],
  );
  const [dues, setDues] = useState(previewOnly ? financePreview.dues : []);
  const [pendingPayments, setPendingPayments] = useState(
    previewOnly ? financePreview.pendingPayments : [],
  );
  const [paymentHistory, setPaymentHistory] = useState(
    previewOnly ? financePreview.paymentHistory : [],
  );
  const [receipts, setReceipts] = useState(
    previewOnly ? financePreview.receipts : [],
  );
  const [report, setReport] = useState(
    previewOnly ? financePreview.report : null,
  );
  const [loading, setLoading] = useState(!previewOnly);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [voucher, setVoucher] = useState('');
  const [voucherResult, setVoucherResult] = useState(null);
  const [voucherLoading, setVoucherLoading] = useState(false);
  const [voucherError, setVoucherError] = useState('');
  const [payment, setPayment] = useState(initialForm);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentNotice, setPaymentNotice] = useState('');
  const [paymentError, setPaymentError] = useState('');
  const paymentKeyRef = useRef({ fingerprint: '', key: '' });
  const paymentSubmitLock = useRef(false);
  const verificationLock = useRef(false);
  const [studentQuery, setStudentQuery] = useState('');
  const [studentResults, setStudentResults] = useState([]);
  const [studentSearchLoading, setStudentSearchLoading] = useState(false);
  const [studentSearchError, setStudentSearchError] = useState('');
  const [verifyingPaymentId, setVerifyingPaymentId] = useState('');
  const financeSearch = (previewOnly ? searchQuery || filters.q : filters.q)
    .trim()
    .toLowerCase();
  const visibleInvoices = financeSearch
    ? invoices.filter(item =>
        JSON.stringify(item).toLowerCase().includes(financeSearch),
      )
    : invoices;
  const visibleDues = financeSearch
    ? dues.filter(item =>
        JSON.stringify(item).toLowerCase().includes(financeSearch),
      )
    : dues;

  const loadData = useCallback(
    async (activeFilters, refresh = false) => {
      if (previewOnly) return;
      refresh ? setRefreshing(true) : setLoading(true);
      setLoadError('');
      try {
        const [
          summaryResult,
          invoiceResult,
          receiptResult,
          reportResult,
          duesResult,
          pendingPaymentResult,
          paymentHistoryResult,
        ] = await Promise.all([
          financeApi.getSummary({
            from: activeFilters.from,
            to: activeFilters.to,
          }),
          financeApi.searchInvoices(activeFilters),
          financeApi.getReceipts({
            from: activeFilters.from,
            to: activeFilters.to,
          }),
          financeApi.getCollectionReport({
            from: activeFilters.from,
            to: activeFilters.to,
          }),
          financeApi.getDues({
            from: activeFilters.from,
            to: activeFilters.to,
          }),
          financeApi.getPendingPayments(),
          financeApi.getPaymentHistory(),
        ]);
        setSummary(summaryResult.data);
        setInvoices(invoiceResult.data);
        setDues(duesResult.data);
        setPendingPayments(pendingPaymentResult.data);
        setPaymentHistory(paymentHistoryResult.data);
        setReceipts(receiptResult.data);
        setReport(reportResult.data);
      } catch (error) {
        setLoadError(financeErrorMessage(error));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [previewOnly],
  );

  useEffect(() => {
    if (previewOnly) return;
    loadData({ from: '', to: '', q: '' });
  }, [loadData, previewOnly]);

  async function verifyVoucher() {
    if (previewOnly) return;
    if (!voucher.trim()) {
      setVoucherError('Enter a voucher code.');
      return;
    }
    setVoucherLoading(true);
    setVoucherError('');
    setVoucherResult(null);
    try {
      const result = await financeApi.verifyVoucher(voucher.trim());
      setVoucherResult(result.data);
    } catch (error) {
      setVoucherError(financeErrorMessage(error));
    } finally {
      setVoucherLoading(false);
    }
  }

  async function submitPayment() {
    if (previewOnly) return;
    if (paymentSubmitLock.current) return;
    setPaymentError('');
    setPaymentNotice('');
    const amount = Number(payment.amount);
    const method = payment.method.trim().toLowerCase();
    const allowedMethods = ['cash', 'bank_transfer', 'card', 'cheque', 'other'];
    if (!payment.invoiceId.trim()) {
      setPaymentError('Enter an invoice ID.');
      return;
    }
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      Math.round(amount * 100) !== amount * 100
    ) {
      setPaymentError(
        'Enter an amount greater than zero with at most two decimal places.',
      );
      return;
    }
    if (!allowedMethods.includes(method)) {
      setPaymentError(`Choose a payment method: ${allowedMethods.join(', ')}.`);
      return;
    }
    const selectedDue = dues.find(
      invoice => String(invoice.id) === payment.invoiceId.trim(),
    );
    if (!selectedDue) {
      setPaymentError(
        'Choose an invoice from Outstanding dues to confirm its available balance.',
      );
      return;
    }
    if (amount > Number(selectedDue.availableBalance)) {
      setPaymentError(
        `Amount exceeds the available balance of ${formatMoney(
          selectedDue.availableBalance,
          selectedDue.currency,
        )}.`,
      );
      return;
    }
    paymentSubmitLock.current = true;
    setPaymentLoading(true);
    try {
      const paymentPayload = {
        ...payment,
        invoiceId: payment.invoiceId.trim(),
        method,
        amount,
      };
      const fingerprint = JSON.stringify(paymentPayload);
      if (paymentKeyRef.current.fingerprint !== fingerprint) {
        paymentKeyRef.current = {
          fingerprint,
          key: `payment-${Date.now().toString(36)}-${Math.random()
            .toString(36)
            .slice(2)}`,
        };
      }
      const result = await financeApi.enterPayment(
        {
          ...paymentPayload,
        },
        paymentKeyRef.current.key,
      );
      setPaymentNotice(
        `${result.message} Entry status: ${result.data.status}.${
          result.duplicate
            ? ' Existing entry returned; no duplicate created.'
            : ''
        }`,
      );
      setPayment(initialForm);
      paymentKeyRef.current = { fingerprint: '', key: '' };
      await loadData(filters, true);
    } catch (error) {
      setPaymentError(financeErrorMessage(error));
    } finally {
      paymentSubmitLock.current = false;
      setPaymentLoading(false);
    }
  }

  async function searchStudents() {
    if (previewOnly) {
      const query = studentQuery.trim().toLowerCase();
      setStudentResults(
        query
          ? financePreview.invoices
              .filter(item =>
                `${item.student} ${item.studentId}`
                  .toLowerCase()
                  .includes(query),
              )
              .map(item => ({
                id: item.studentId,
                fullName: item.student,
                grade: 'Preview record',
              }))
          : [],
      );
      return;
    }
    setStudentSearchError('');
    setStudentSearchLoading(true);
    try {
      const result = await financeApi.searchStudents(studentQuery.trim());
      setStudentResults(result.data);
    } catch (error) {
      setStudentSearchError(financeErrorMessage(error));
    } finally {
      setStudentSearchLoading(false);
    }
  }

  async function verifyPayment(paymentId) {
    if (previewOnly) return;
    if (verificationLock.current) return;
    verificationLock.current = true;
    setVerifyingPaymentId(String(paymentId));
    setPaymentError('');
    setPaymentNotice('');
    try {
      const result = await financeApi.verifyPayment(paymentId);
      setPaymentNotice(
        `Payment confirmed. Receipt ${
          result.data.receiptNumber
        } issued. Balance due: ${formatMoney(
          result.data.balanceDue,
          result.data.currency,
        )}.`,
      );
      await loadData(filters, true);
    } catch (error) {
      setPaymentError(financeErrorMessage(error));
    } finally {
      verificationLock.current = false;
      setVerifyingPaymentId('');
    }
  }

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.eyebrow}>SCHOOL MANAGEMENT</Text>
      <Text style={styles.heading}>Finance</Text>
      <Text style={styles.subtitle}>
        {previewOnly
          ? 'Fictional UI preview records'
          : 'Live records from the school finance API'}
      </Text>
      {previewOnly ? (
        <Text style={styles.previewNotice}>
          DEVELOPMENT UI PREVIEW · Fictional balances · API searches,
          verification and payment entry are disabled
        </Text>
      ) : null}

      <Text style={styles.section}>Date range</Text>
      <View style={styles.filters}>
        <Field
          label="From (YYYY-MM-DD)"
          value={filters.from}
          onChangeText={value =>
            setFilters(current => ({ ...current, from: value }))
          }
          placeholder="2026-01-01"
        />
        <Field
          label="To (YYYY-MM-DD)"
          value={filters.to}
          onChangeText={value =>
            setFilters(current => ({ ...current, to: value }))
          }
          placeholder="2026-12-31"
        />
      </View>
      <Field
        label="Invoice search"
        value={filters.q}
        onChangeText={value =>
          setFilters(current => ({ ...current, q: value }))
        }
        placeholder="Invoice, voucher, or student ID"
        autoCapitalize="characters"
      />
      {!previewOnly ? (
        <Action
          title={refreshing ? 'Refreshing…' : 'Apply filters'}
          disabled={loading || refreshing}
          onPress={() => loadData(filters, true)}
        />
      ) : null}
      <Notice message={loadError} error />

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.blue} />
          <Text style={styles.muted}>Loading finance records…</Text>
        </View>
      ) : null}
      {!loading && !loadError && summary ? (
        <View style={styles.metrics}>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Collected</Text>
            <Text style={styles.metricValue}>
              {formatMoney(summary.collected, summary.currency)}
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Outstanding</Text>
            <Text style={styles.metricValue}>
              {formatMoney(summary.outstanding, summary.currency)}
            </Text>
          </View>
        </View>
      ) : null}

      <Text style={styles.section}>Student search</Text>
      <Field
        label="Student name, ID, or email"
        value={studentQuery}
        onChangeText={setStudentQuery}
        placeholder="Search this branch"
        autoCapitalize="none"
      />
      <Action
        title={studentSearchLoading ? 'Searching…' : 'Search students'}
        disabled={studentSearchLoading}
        onPress={searchStudents}
      />
      <Notice message={studentSearchError} error />
      {!studentSearchLoading &&
      !studentSearchError &&
      studentResults.length === 0 &&
      studentQuery.trim() ? (
        <Text style={styles.empty}>
          No students match this search in your authorized branch.
        </Text>
      ) : null}
      {studentResults.map(student => (
        <View key={student.id} style={styles.card}>
          <Text style={styles.cardTitle}>
            {student.fullName || student.name}
          </Text>
          <Text style={styles.cardText}>
            {student.id} · {student.grade || 'Grade unavailable'}
          </Text>
        </View>
      ))}

      <Text style={styles.section}>Outstanding dues</Text>
      {!loading && !loadError && dues.length === 0 ? (
        <Text style={styles.empty}>
          No invoices have an outstanding balance.
        </Text>
      ) : null}
      {visibleDues.map(invoice => (
        <Pressable
          key={`due-${invoice.id}`}
          accessibilityRole="button"
          onPress={() =>
            setPayment(current => ({
              ...current,
              invoiceId: String(invoice.id),
            }))
          }
          style={styles.card}
        >
          <Text style={styles.cardTitle}>
            {invoice.id} · {invoice.student || invoice.studentId}
          </Text>
          <Text style={styles.cardText}>
            Paid {formatMoney(invoice.paidAmount, invoice.currency)} · Pending{' '}
            {formatMoney(invoice.pendingAmount, invoice.currency)}
          </Text>
          <Text style={styles.cardText}>
            Due {formatMoney(invoice.balanceDue, invoice.currency)} · Available{' '}
            {formatMoney(invoice.availableBalance, invoice.currency)}
          </Text>
          <Text style={styles.cardText}>
            Due {String(invoice.dueDate || '—').slice(0, 10)} · {invoice.status}
          </Text>
          <Text style={styles.cardText}>
            Tap to use this invoice for a payment entry.
          </Text>
        </Pressable>
      ))}

      <Text style={styles.section}>Invoices</Text>
      {!loading && !loadError && invoices.length === 0 ? (
        <Text style={styles.empty}>No invoices match these filters.</Text>
      ) : null}
      {visibleInvoices.map(invoice => (
        <Pressable
          key={invoice.id}
          accessibilityRole="button"
          onPress={() =>
            setPayment(current => ({
              ...current,
              invoiceId: String(invoice.id),
            }))
          }
          style={styles.card}
        >
          <Text style={styles.cardTitle}>
            {invoice.id} · {invoice.student || invoice.studentId}
          </Text>
          <Text style={styles.cardText}>
            {invoice.description || 'Invoice'} ·{' '}
            {formatMoney(invoice.amount, invoice.currency)}
          </Text>
          <Text style={styles.cardText}>
            Due {String(invoice.dueDate || '—').slice(0, 10)} · {invoice.status}
          </Text>
          {(() => {
            const balance = dues.find(
              item => String(item.id) === String(invoice.id),
            );
            return balance ? (
              <Text style={styles.cardText}>
                Paid {formatMoney(balance.paidAmount, balance.currency)} ·
                Pending {formatMoney(balance.pendingAmount, balance.currency)} ·
                Due {formatMoney(balance.balanceDue, balance.currency)} ·
                Available{' '}
                {formatMoney(balance.availableBalance, balance.currency)}
              </Text>
            ) : (
              <Text style={styles.cardText}>
                No outstanding available balance is listed for this invoice.
              </Text>
            );
          })()}
          {invoice.voucherCode ? (
            <Text style={styles.cardText}>Voucher {invoice.voucherCode}</Text>
          ) : null}
          <Text style={styles.cardText}>
            Tap to use this invoice for a payment entry.
          </Text>
        </Pressable>
      ))}

      <Text style={styles.section}>Voucher verification</Text>
      <Field
        label="Voucher code"
        value={voucher}
        onChangeText={setVoucher}
        placeholder="Enter voucher code"
        autoCapitalize="characters"
      />
      <Action
        title={voucherLoading ? 'Checking…' : 'Verify voucher'}
        disabled={previewOnly || voucherLoading}
        onPress={verifyVoucher}
      />
      <Notice message={voucherError} error />
      {voucherResult ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Voucher verified: {voucherResult.voucherCode}
          </Text>
          <Text style={styles.cardText}>
            Invoice {voucherResult.invoiceId} ·{' '}
            {voucherResult.student || 'Student record unavailable'}
          </Text>
          <Text style={styles.cardText}>
            Invoice total{' '}
            {formatMoney(voucherResult.amount, voucherResult.currency)} ·{' '}
            {voucherResult.paymentStatus}
          </Text>
          <Text style={styles.cardText}>
            Paid {formatMoney(voucherResult.paidAmount, voucherResult.currency)}{' '}
            · Pending{' '}
            {formatMoney(voucherResult.pendingAmount, voucherResult.currency)}
          </Text>
          <Text style={styles.cardText}>
            Due {formatMoney(voucherResult.balanceDue, voucherResult.currency)}{' '}
            · Available{' '}
            {formatMoney(
              voucherResult.availableBalance,
              voucherResult.currency,
            )}
          </Text>
          <Text style={styles.cardText}>
            Voucher validity does not confirm receipt of payment.
          </Text>
        </View>
      ) : null}

      <Text style={styles.section}>Payment entry</Text>
      <Text style={styles.muted}>
        Entries are saved as pending verification. No payment is confirmed and
        no receipt is issued by this action.
      </Text>
      <Field
        label="Invoice ID"
        value={payment.invoiceId}
        onChangeText={value =>
          setPayment(current => ({ ...current, invoiceId: value }))
        }
        placeholder="Enter invoice ID"
        autoCapitalize="characters"
      />
      <Field
        label="Amount"
        value={payment.amount}
        onChangeText={value =>
          setPayment(current => ({ ...current, amount: value }))
        }
        placeholder="0.00"
        keyboardType="decimal-pad"
      />
      <Field
        label="Method (cash, bank_transfer, card, cheque, other)"
        value={payment.method}
        onChangeText={value =>
          setPayment(current => ({ ...current, method: value }))
        }
        placeholder="cash"
      />
      <Field
        label="Reference (optional)"
        value={payment.reference}
        onChangeText={value =>
          setPayment(current => ({ ...current, reference: value }))
        }
        placeholder="Transaction or cheque reference"
        autoCapitalize="characters"
      />
      <Action
        title={paymentLoading ? 'Saving entry…' : 'Record payment entry'}
        disabled={previewOnly || paymentLoading}
        onPress={submitPayment}
      />
      <Notice message={paymentError} error />
      <Notice message={paymentNotice} />

      <Text style={styles.section}>Payments awaiting verification</Text>
      {!loading && pendingPayments.length === 0 ? (
        <Text style={styles.empty}>
          No payment entries are awaiting verification.
        </Text>
      ) : null}
      {pendingPayments.map(item => (
        <View key={String(item._id)} style={styles.card}>
          <Text style={styles.cardTitle}>Invoice {item.invoiceId}</Text>
          <Text style={styles.cardText}>
            {formatMoney(item.amount, item.currency)} · {item.method} ·{' '}
            {item.status}
          </Text>
          {!previewOnly ? (
            <Action
              title={
                verifyingPaymentId === String(item._id)
                  ? 'Verifying…'
                  : 'Verify payment and issue receipt'
              }
              disabled={previewOnly || !!verifyingPaymentId}
              onPress={() => verifyPayment(String(item._id))}
            />
          ) : (
            <Text style={styles.muted}>
              Preview only · no real verification
            </Text>
          )}
        </View>
      ))}

      <Text style={styles.section}>Payment history</Text>
      {!loading && !loadError && paymentHistory.length === 0 ? (
        <Text style={styles.empty}>
          No confirmed payments in this date range.
        </Text>
      ) : null}
      {paymentHistory.map(item => (
        <View key={String(item._id)} style={styles.card}>
          <Text style={styles.cardTitle}>Invoice {item.invoiceId}</Text>
          <Text style={styles.cardText}>
            {formatMoney(item.amount, item.currency)} · {item.method} ·{' '}
            {item.status}
          </Text>
          <Text style={styles.cardText}>
            {item.receiptNumber ? `Receipt ${item.receiptNumber} · ` : ''}
            {item.reference ? `Reference ${item.reference} · ` : ''}
            {item.confirmedAt
              ? new Date(item.confirmedAt).toLocaleDateString()
              : 'Date unavailable'}
          </Text>
        </View>
      ))}

      <Text style={styles.section}>Receipts</Text>
      {!loading && !loadError && receipts.length === 0 ? (
        <Text style={styles.empty}>
          No confirmed receipts in this date range.
        </Text>
      ) : null}
      {receipts.map(receipt => (
        <View key={String(receipt._id)} style={styles.card}>
          <Text style={styles.cardTitle}>
            {receipt.receiptNumber || 'Receipt number unavailable'}
          </Text>
          <Text style={styles.cardText}>
            {receipt.student || 'Student'} · invoice {receipt.invoiceId}
          </Text>
          <Text style={styles.cardText}>
            {formatMoney(receipt.amount, receipt.currency)} ·{' '}
            {receipt.confirmedAt
              ? new Date(receipt.confirmedAt).toLocaleDateString()
              : 'Date unavailable'}
          </Text>
        </View>
      ))}

      <Text style={styles.section}>Collection report</Text>
      {!loading && !loadError && report?.confirmedCollections?.length === 0 ? (
        <Text style={styles.empty}>
          No confirmed collections in this date range.
        </Text>
      ) : null}
      {report?.confirmedCollections?.map(item => (
        <View key={item._id || 'currency'} style={styles.card}>
          <Text style={styles.cardTitle}>
            {formatMoney(item.total, item._id || 'PKR')}
          </Text>
          <Text style={styles.cardText}>
            {item.count} confirmed collections
          </Text>
        </View>
      ))}
      {report?.byMethod?.map(item => (
        <Text key={item._id || 'method'} style={styles.reportLine}>
          {item._id || 'Unspecified'}: {formatMoney(item.total)} ({item.count})
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.pale },
  content: { padding: 20, paddingBottom: 44 },
  eyebrow: {
    color: colors.blue,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginTop: 12,
  },
  heading: { color: colors.ink, fontSize: 28, fontWeight: '800', marginTop: 8 },
  subtitle: { color: colors.muted, fontSize: 13, marginTop: 5 },
  section: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: '800',
    marginTop: 26,
    marginBottom: 10,
  },
  filters: { flexDirection: 'row', gap: 10 },
  field: { flex: 1, marginBottom: 11 },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 5,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 11,
    minHeight: 44,
    paddingHorizontal: 12,
    color: colors.ink,
    fontSize: 13,
  },
  action: {
    alignItems: 'center',
    backgroundColor: colors.blue,
    borderRadius: 11,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
    marginTop: 2,
    marginBottom: 8,
  },
  actionText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
  secondaryAction: { backgroundColor: '#EAF0FA' },
  secondaryText: { color: colors.ink },
  disabled: { opacity: 0.55 },
  notice: {
    color: colors.green,
    fontSize: 12,
    lineHeight: 18,
    marginVertical: 6,
  },
  error: { color: colors.red },
  loading: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    paddingVertical: 22,
  },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  empty: {
    color: colors.muted,
    fontSize: 13,
    padding: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
  },
  metrics: { flexDirection: 'row', gap: 10, marginTop: 17 },
  metric: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    minHeight: 95,
    justifyContent: 'center',
  },
  metricLabel: { color: colors.muted, fontSize: 11 },
  metricValue: {
    color: colors.ink,
    fontWeight: '800',
    fontSize: 17,
    marginTop: 8,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 13,
    padding: 14,
    marginBottom: 9,
  },
  cardTitle: { color: colors.ink, fontWeight: '800', fontSize: 13 },
  cardText: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 5 },
  reportLine: { color: colors.muted, fontSize: 12, paddingVertical: 5 },
  previewNotice: {
    color: '#8A4D00',
    backgroundColor: '#FFF1D6',
    borderRadius: 13,
    padding: 11,
    marginTop: 13,
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 16,
  },
});
