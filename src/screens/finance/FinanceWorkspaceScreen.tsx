import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { ApiError } from '../../services/api/apiClient';
import {
  financeService as service,
  type FeeList,
  type FinanceSummary,
  type PaymentView,
  type ReconciliationView,
  type StructureView,
  type FeeFilters,
  type FeeStatus,
  type FeeView,
  type FinanceStudent,
  type FinanceStudents,
  type CollectionReport,
  type CollectionFilters,
  type ReservationView,
} from '../../services/finance/financeService';
import {
  DashboardShell,
  HeroBanner,
  WorkspaceTabs,
  DashboardStateCard,
  SectionCard,
  Button,
  StatCard,
  StatGrid,
} from '../../components/hiraDashboard';
import { FeeCards } from '../../components/hiraDashboard/FeeCards';
import { colors, spacing, typography } from '../../theme/hiraDashboard';

const panes = [
  'Summary',
  'Fees',
  'Collection report',
  'Payments',
  'Reconciliation',
  'Fee setup',
] as const;
type Pane = (typeof panes)[number];
const structureLabel = (item: StructureView) =>
  `${item.title} · ${item.amountMinor} paisa`;
type Data =
  | { kind: 'Summary'; summary: FinanceSummary }
  | { kind: 'Fees'; fees: FeeList }
  | { kind: 'Collection report' }
  | { kind: 'Payments'; items: PaymentView[] }
  | { kind: 'Reconciliation'; queue: ReconciliationView }
  | {
      kind: 'Fee setup';
      structures: StructureView[];
      students: { id: string; fullName: string; admissionNumber: string }[];
    };
async function load(
  token: string,
  pane: Pane,
  filters: FeeFilters,
): Promise<Data> {
  switch (pane) {
    case 'Summary':
      return { kind: pane, summary: await service.summary(token) };
    case 'Fees':
      return { kind: pane, fees: await service.fees(token, filters) };
    case 'Collection report':
      return { kind: pane };
    case 'Payments':
      return { kind: pane, ...(await service.payments(token)) };
    case 'Reconciliation':
      return { kind: pane, queue: await service.reconciliation(token) };
    case 'Fee setup': {
      const [structures, students] = await Promise.all([
        service.structures(token),
        service.students(token),
      ]);
      return {
        kind: pane,
        structures: structures.items,
        students: students.items,
      };
    }
  }
}
const message = (failure: unknown) =>
  failure instanceof ApiError && failure.status === 403
    ? 'Forbidden: Finance action or record is unavailable.'
    : failure instanceof ApiError && failure.status === 401
    ? 'Session expired. Sign in again.'
    : failure instanceof Error
    ? failure.message
    : 'Finance request failed. Please retry.';
export default function FinanceWorkspaceScreen() {
  const { user, accessToken } = useAuth();
  if (!user || !accessToken) {
    return null;
  }
  return <Workspace key={`${user.id}:${accessToken}`} token={accessToken} />;
}
function Workspace({ token }: { token: string }) {
  const { logout } = useAuth();
  const [pane, setPane] = useState<Pane>('Summary'),
    [data, setData] = useState<Data | null>(null);
  const [filters, setFilters] = useState<FeeFilters>({});
  const [reservation, setReservation] = useState<ReservationView | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false),
    [feedback, setFeedback] = useState('');
  const [title, setTitle] = useState(''),
    [minorUnits, setMinorUnits] = useState(''),
    [dueDate, setDueDate] = useState('');
  const [studentId, setStudentId] = useState(''),
    [structureId, setStructureId] = useState(''),
    [feeId, setFeeId] = useState('');
  const [reference, setReference] = useState(''),
    [reviewNote, setReviewNote] = useState('');
  const locked = useRef(false),
    operations = useRef<Record<string, string>>({}),
    generation = useRef(0);
  useEffect(() => {
    let active = true;
    generation.current += 1;
    const request = generation.current;
    setLoading(true);
    setError(null);
    setData(null);
    load(token, pane, filters)
      .then(value => {
        if (active && request === generation.current) {
          setData(value);
        }
      })
      .catch((failure: unknown) => {
        if (active && request === generation.current) {
          setError(message(failure));
        }
      })
      .finally(() => {
        if (active && request === generation.current) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
      generation.current += 1;
    };
  }, [token, pane, attempt, filters]);
  const retry = useCallback(async () => {
    setAttempt(value => value + 1);
  }, []);
  async function mutate<T>(
    key: string,
    input: unknown,
    action: (operationId: string) => Promise<T>,
    confirmed?: (result: T) => void,
  ) {
    if (locked.current) {
      return;
    }
    locked.current = true;
    setBusy(true);
    setFeedback('');
    const requestKey = key + JSON.stringify(input),
      op =
        operations.current[requestKey] ??
        `finance_${Date.now().toString(36)}_${Math.random()
          .toString(36)
          .slice(2, 14)}`;
    operations.current[requestKey] = op;
    const version = generation.current;
    try {
      const result = await action(op);
      if (version === generation.current) {
        confirmed?.(result);
        setFeedback('Server confirmed the operation.');
        setAttempt(value => value + 1);
      }
    } catch (failure) {
      if (version === generation.current) {
        setFeedback(
          message(failure) +
            (key === 'record' &&
            (!(failure instanceof ApiError) || failure.status >= 500)
              ? ' Reservation outcome is unknown. Retry with the same obligation and reference; the same operation ID will be reused.'
              : ''),
        );
      }
    } finally {
      locked.current = false;
      if (version === generation.current) {
        setBusy(false);
      }
    }
  }
  return (
    <DashboardShell>
      <HeroBanner
        roleLabel="FINANCE WORKSPACE"
        dateLabel="Branch scope"
        title="Fees and payment review"
        subtitle="Only settled transactions count as paid. Recording a payment reserves funds pending independent verification."
      />
      <Button
        title="Sign out"
        variant="secondary"
        onPress={() => {
          logout().catch(() => setError('Sign out could not be confirmed.'));
        }}
      />
      <WorkspaceTabs
        items={panes}
        selected={pane}
        accessibilityLabel="Finance workspace sections"
        onSelect={value => {
          if (!busy) {
            setPane(value as Pane);
            setFeedback('');
          }
        }}
      />
      <DashboardStateCard loading={loading} error={error} onRetry={retry} />
      {pane === 'Collection report' ? (
        <CollectionReportPane key={token} token={token} />
      ) : null}
      {pane === 'Fees' ? (
        <FinanceLookup
          token={token}
          disabled={busy}
          filters={filters}
          onFilters={next => {
            generation.current += 1;
            setData(null);
            setLoading(true);
            setError(null);
            setFeeId('');
            setFilters(next);
          }}
        />
      ) : null}
      {feedback ? (
        <Text accessibilityRole="alert" style={styles.text}>
          {feedback}
        </Text>
      ) : null}
      {pane === 'Fees' &&
      reservation?.feeId === feeId &&
      reservation.reference === reference ? (
        <SectionCard title="Server reservation result">
          <Text style={styles.text}>
            {reservation.amountLabel} · {reservation.currency} ·{' '}
            {reservation.status}
          </Text>
          <Text style={styles.text}>
            Created {reservation.createdAt} · Expires {reservation.expiresAt}
          </Text>
          <Text style={styles.note}>
            {reservation.expired
              ? 'Expired reservation remains held for explicit review.'
              : 'Reservation does not confirm payment or create a receipt.'}
          </Text>
        </SectionCard>
      ) : null}
      {!loading && !error && data?.kind === 'Summary' ? (
        <SectionCard title="Canonical branch totals">
          <Text style={styles.text}>Charges: {data.summary.amountLabel}</Text>
          <Text style={styles.text}>Settled: {data.summary.paidLabel}</Text>
          <Text style={styles.text}>
            Outstanding: {data.summary.balanceLabel}
          </Text>
          <Text style={styles.text}>
            {data.summary.totalInvoices} obligations
          </Text>
          {data.summary.legacyUnmigratedCount ? (
            <Text style={styles.text}>
              {data.summary.legacyUnmigratedCount} legacy records need migration
              and are excluded.
            </Text>
          ) : null}
          <Text style={styles.note}>
            Online payments: provider validation pending. Refunds, discounts,
            payroll and expenses are outside this workflow.
          </Text>
        </SectionCard>
      ) : null}
      {!loading && !error && data?.kind === 'Fees' ? (
        <>
          <FeeCards data={data.fees} />
          {data.fees.nextOffset != null ? (
            <Button
              title="Next obligations"
              variant="secondary"
              disabled={busy}
              onPress={() => {
                generation.current += 1;
                setData(null);
                setLoading(true);
                setFeeId('');
                setFilters({ ...filters, offset: data.fees.nextOffset! });
              }}
            />
          ) : null}
          <SectionCard title="Record bank payment for verification">
            <Text style={styles.note}>
              The server reserves the selected obligation’s full available
              balance. A different authorized Finance user must verify the bank
              record before settlement. This is not a paid receipt.
            </Text>
            <WorkspaceTabs
              items={data.fees.items.map(fee => fee.challanReference)}
              selected={
                data.fees.items.find(fee => fee.id === feeId)
                  ?.challanReference ?? ''
              }
              accessibilityLabel="Select payment obligation"
              onSelect={label => {
                if (!busy) {
                  setFeeId(
                    data.fees.items.find(fee => fee.challanReference === label)
                      ?.id ?? '',
                  );
                }
              }}
            />
            <TextInput
              accessibilityLabel="Bank payment reference"
              value={reference}
              onChangeText={setReference}
              editable={!busy}
              style={styles.input}
            />
            {data.fees.items.find(fee => fee.id === feeId)?.status ===
            'paid' ? (
              <Text style={styles.note}>
                Already paid: no outstanding balance is payable.
              </Text>
            ) : null}
            {data.fees.items.find(fee => fee.id === feeId)?.status ===
            'payment_pending' ? (
              <Text style={styles.note}>
                Funds are reserved pending review. A retry of the same request
                retrieves its existing reservation.
              </Text>
            ) : null}
            <Button
              title="Record bank payment"
              disabled={busy || !feeId || !reference.trim()}
              onPress={() => {
                setReservation(null);
                mutate(
                  'record',
                  [feeId, reference],
                  op =>
                    service.record(token, feeId, {
                      method: 'bank_transfer',
                      reference,
                      operationId: op,
                    }),
                  setReservation,
                );
              }}
            />
          </SectionCard>
        </>
      ) : null}
      {!loading && !error && data?.kind === 'Payments' ? (
        <>
          {!data.items.length ? (
            <Text style={styles.text}>No payment records.</Text>
          ) : null}
          <TextInput
            accessibilityLabel="Independent verification note"
            value={reviewNote}
            onChangeText={setReviewNote}
            editable={!busy}
            style={styles.input}
          />
          {data.items.map(payment => (
            <SectionCard key={payment.id} title={payment.reference}>
              <Text style={styles.text}>
                {payment.amountLabel} · {payment.method} · {payment.status}
                {payment.expired
                  ? ' · Reservation expired: review required'
                  : ''}
              </Text>
              {payment.canVerify ? (
                <View style={styles.actions}>
                  <Button
                    title={`Verify ${payment.reference}`}
                    disabled={busy || reviewNote.trim().length < 3}
                    onPress={() => {
                      mutate(
                        'verify',
                        [payment.id, payment.revision, reviewNote],
                        op =>
                          service.verify(token, payment.id, {
                            revision: payment.revision,
                            reviewNote,
                            operationId: op,
                          }),
                      );
                    }}
                  />
                  <Button
                    title={`Reject ${payment.reference}`}
                    variant="danger"
                    disabled={busy || reviewNote.trim().length < 3}
                    onPress={() => {
                      mutate(
                        'reject',
                        [payment.id, payment.revision, reviewNote],
                        op =>
                          service.verify(
                            token,
                            payment.id,
                            {
                              revision: payment.revision,
                              reviewNote,
                              operationId: op,
                            },
                            true,
                          ),
                      );
                    }}
                  />
                </View>
              ) : null}
            </SectionCard>
          ))}
        </>
      ) : null}
      {!loading && !error && data?.kind === 'Reconciliation' ? (
        <>
          <Text style={styles.note}>
            Read-only review queue. Unresolved reservations remain held; this
            screen never auto-settles or refunds.
          </Text>
          {!data.queue.items.length && !data.queue.observations.length ? (
            <Text style={styles.text}>No reconciliation items.</Text>
          ) : null}
          {data.queue.items.map(item => (
            <SectionCard key={item.id} title={item.reference}>
              <Text style={styles.text}>
                {item.status} · {item.reason}
              </Text>
            </SectionCard>
          ))}
          {data.queue.observations.map(item => (
            <SectionCard key={item.eventId} title={item.orderRef}>
              <Text style={styles.text}>{item.outcome}</Text>
            </SectionCard>
          ))}
        </>
      ) : null}
      {!loading && !error && data?.kind === 'Fee setup' ? (
        <>
          <SectionCard title="Create fixed fee structure">
            <TextInput
              accessibilityLabel="Fee title"
              value={title}
              onChangeText={setTitle}
              editable={!busy}
              style={styles.input}
            />
            <Text style={styles.note}>
              Amount in paisa (100 paisa = PKR 1). No discounts or currency
              conversion.
            </Text>
            <TextInput
              accessibilityLabel="Fee amount in paisa"
              value={minorUnits}
              onChangeText={setMinorUnits}
              editable={!busy}
              keyboardType="number-pad"
              style={styles.input}
            />
            <Button
              title="Create fee structure"
              disabled={busy || !title.trim() || !minorUnits}
              onPress={() => {
                mutate('structure', [title, minorUnits], op =>
                  service.createStructure(token, {
                    title,
                    amountMinor: Number(minorUnits),
                    operationId: op,
                  }),
                );
              }}
            />
          </SectionCard>
          <SectionCard title="Assign current enrollment fee">
            <WorkspaceTabs
              items={data.students.map(
                student => `${student.fullName} · ${student.admissionNumber}`,
              )}
              selected={
                data.students.find(student => student.id === studentId)
                  ? `${
                      data.students.find(student => student.id === studentId)!
                        .fullName
                    } · ${
                      data.students.find(student => student.id === studentId)!
                        .admissionNumber
                    }`
                  : ''
              }
              accessibilityLabel="Select fee Student"
              onSelect={label => {
                if (!busy) {
                  setStudentId(
                    data.students.find(
                      student =>
                        `${student.fullName} · ${student.admissionNumber}` ===
                        label,
                    )?.id ?? '',
                  );
                }
              }}
            />
            <WorkspaceTabs
              items={data.structures.map(structureLabel)}
              selected={
                data.structures.find(item => item._id === structureId)
                  ? structureLabel(
                      data.structures.find(item => item._id === structureId)!,
                    )
                  : ''
              }
              accessibilityLabel="Select fee structure"
              onSelect={label => {
                if (!busy) {
                  setStructureId(
                    data.structures.find(item => structureLabel(item) === label)
                      ?._id ?? '',
                  );
                }
              }}
            />
            <TextInput
              accessibilityLabel="Fee due date YYYY-MM-DD"
              value={dueDate}
              onChangeText={setDueDate}
              editable={!busy}
              placeholder="YYYY-MM-DD"
              style={styles.input}
            />
            <Button
              title="Assign fee"
              disabled={busy || !studentId || !structureId || !dueDate}
              onPress={() => {
                mutate('assign', [studentId, structureId, dueDate], op =>
                  service.assign(token, {
                    studentId,
                    structureId,
                    dueDate,
                    operationId: op,
                  }),
                );
              }}
            />
          </SectionCard>
        </>
      ) : null}
    </DashboardShell>
  );
}
const statusChoices: { label: string; value?: FeeStatus }[] = [
  { label: 'All statuses' },
  { label: 'Due', value: 'due' },
  { label: 'Overdue', value: 'overdue' },
  { label: 'Partial', value: 'partial' },
  { label: 'Payment pending', value: 'payment_pending' },
  { label: 'Paid', value: 'paid' },
];
function CollectionReportPane({ token }: { token: string }) {
  const [filters, setFilters] = useState<CollectionFilters>({}),
    [data, setData] = useState<CollectionReport | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const counter = generation;
    const request = ++counter.current;
    setData(null);
    setError(null);
    setLoading(true);
    service
      .collectionReport(token, filters)
      .then(report => {
        if (request === counter.current) setData(report);
      })
      .catch((failure: unknown) => {
        if (request === counter.current) setError(message(failure));
      })
      .finally(() => {
        if (request === counter.current) setLoading(false);
      });
    return () => {
      counter.current++;
    };
  }, [token, filters, attempt]);
  const change = (next: CollectionFilters) => {
    generation.current++;
    setData(null);
    setError(null);
    setLoading(true);
    setFilters(next);
  };
  return (
    <>
      <SectionCard title="Collection and receivables report">
        <Text style={styles.note}>
          Dates select obligation due dates, inclusive (YYYY-MM-DD). Settled
          totals include all settled payments for those obligations, regardless
          of payment date. Pending reservations are not collections. Summary
          totals cover all matching records, across every page. Legacy
          unmigrated fees are excluded.
        </Text>
        <TextInput
          accessibilityLabel="Report due date from"
          placeholder="Due from YYYY-MM-DD"
          value={filters.dateFrom ?? ''}
          maxLength={10}
          style={styles.input}
          onChangeText={value =>
            change({
              ...filters,
              dateFrom: value || undefined,
              offset: undefined,
            })
          }
        />
        <TextInput
          accessibilityLabel="Report due date to"
          placeholder="Due to YYYY-MM-DD"
          value={filters.dateTo ?? ''}
          maxLength={10}
          style={styles.input}
          onChangeText={value =>
            change({
              ...filters,
              dateTo: value || undefined,
              offset: undefined,
            })
          }
        />
      </SectionCard>
      <FinanceLookup
        token={token}
        disabled={false}
        filters={filters}
        onFilters={change}
        report
      />
      <DashboardStateCard
        loading={loading}
        error={error}
        onRetry={async () => {
          setAttempt(value => value + 1);
        }}
      />
      {!loading && !error && data ? (
        <>
          <StatGrid>
            <StatCard
              icon="#"
              label="Report obligations"
              value={data.summary.obligationCount}
            />
            <StatCard
              icon="+"
              label="Report charges"
              value={data.summary.amountLabel}
            />
            <StatCard
              icon="✓"
              label="Report settled"
              value={data.summary.paidLabel}
            />
            <StatCard
              icon="…"
              label="Report outstanding"
              value={data.summary.balanceLabel}
            />
          </StatGrid>
          <SectionCard title="Canonical obligation statuses">
            <Text style={styles.text}>
              Fully paid: {data.summary.statusCounts.paid}
            </Text>
            <Text style={styles.text}>
              Partial: {data.summary.statusCounts.partial}
            </Text>
            <Text style={styles.text}>
              Due: {data.summary.statusCounts.due}
            </Text>
            <Text style={styles.text}>
              Overdue: {data.summary.statusCounts.overdue}
            </Text>
            <Text style={styles.text}>
              Payment pending: {data.summary.statusCounts.payment_pending}
            </Text>
            <Text style={styles.text}>
              No settled payment: {data.summary.unpaidCount}
            </Text>
            <Text style={styles.note}>
              Statuses match the dues list. No settled payment includes
              obligations with pending reservations.
            </Text>
          </SectionCard>
          {data.summary.obligationCount === 0 ? (
            <Text style={styles.text}>
              No obligations match this report scope. Clear report filters to
              view all permitted obligations.
            </Text>
          ) : (
            <>
              {data.summary.paidMinor === 0 ? (
                <Text style={styles.text}>
                  No settled collections for these obligations.
                </Text>
              ) : null}
              {data.items.length ? (
                <FeeCards data={{ items: data.items }} />
              ) : (
                <Text style={styles.text}>
                  No obligation rows on this page. Clear report filters to
                  return to the first page.
                </Text>
              )}
            </>
          )}
          {data.nextOffset != null ? (
            <Button
              title="Next report page"
              variant="secondary"
              onPress={() => change({ ...filters, offset: data.nextOffset! })}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}
/** Read-only lookup controls. No payment action is called from this component. */
function FinanceLookup({
  token,
  disabled,
  filters,
  onFilters,
  report = false,
}: {
  token: string;
  disabled: boolean;
  filters: FeeFilters;
  onFilters: (filters: FeeFilters) => void;
  report?: boolean;
}) {
  const [search, setSearch] = useState(''),
    [offset, setOffset] = useState(0),
    [attempt, setAttempt] = useState(0);
  const [students, setStudents] = useState<{
    token: string;
    search: string;
    offset: number;
    data: FinanceStudents;
  } | null>(null);
  const [searching, setSearching] = useState(false),
    [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FinanceStudent | null>(null);
  const [reference, setReference] = useState(''),
    [looking, setLooking] = useState(false);
  const [found, setFound] = useState<{
    token: string;
    reference: string;
    fee: FeeView;
  } | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const searchGeneration = useRef(0),
    lookupGeneration = useRef(0);
  useEffect(() => {
    const counter = searchGeneration;
    const request = ++counter.current;
    setStudents(null);
    setSearchError(null);
    setSearching(!!search.trim());
    if (search.trim())
      service
        .students(token, search, offset)
        .then(data => {
          if (request === searchGeneration.current)
            setStudents({ token, search, offset, data });
        })
        .catch((failure: unknown) => {
          if (request === searchGeneration.current)
            setSearchError(message(failure));
        })
        .finally(() => {
          if (request === searchGeneration.current) setSearching(false);
        });
    return () => {
      counter.current++;
    };
  }, [token, search, offset, attempt]);
  useEffect(() => {
    const counter = lookupGeneration;
    setFound(null);
    setLookupError(null);
    setLooking(false);
    return () => {
      counter.current++;
    };
  }, [token]);
  const results =
    students?.token === token &&
    students.search === search &&
    students.offset === offset
      ? students.data
      : null;
  async function lookup() {
    const request = ++lookupGeneration.current;
    setLooking(true);
    setFound(null);
    setLookupError(null);
    try {
      const fee = await service.challan(token, reference);
      if (request === lookupGeneration.current)
        setFound({ token, reference, fee });
    } catch (failure) {
      if (request === lookupGeneration.current)
        setLookupError(
          failure instanceof ApiError && failure.status === 404
            ? 'No issued challan found in your permitted records.'
            : message(failure),
        );
    } finally {
      if (request === lookupGeneration.current) setLooking(false);
    }
  }
  return (
    <>
      <SectionCard
        title={
          report
            ? 'Find Students and report obligations'
            : 'Find Students and dues'
        }
      >
        <Text style={styles.note}>
          Search enrolled Students by name, admission number or Student ID.
          Placement comes from current enrollment.
        </Text>
        <TextInput
          accessibilityLabel="Search Finance Students"
          value={search}
          editable={!disabled}
          maxLength={80}
          style={styles.input}
          onChangeText={value => {
            searchGeneration.current++;
            setStudents(null);
            setSearchError(null);
            setSearch(value);
            setOffset(0);
          }}
        />
        {searching ? (
          <Text style={styles.text}>Searching Students...</Text>
        ) : null}
        {searchError ? (
          <Text accessibilityRole="alert" style={styles.text}>
            {searchError}
          </Text>
        ) : null}
        {searchError ? (
          <Button
            title="Retry Student search"
            variant="secondary"
            disabled={disabled}
            onPress={() => setAttempt(value => value + 1)}
          />
        ) : null}
        {results && !results.items.length ? (
          <Text style={styles.text}>
            No permitted enrolled Students on this page.
          </Text>
        ) : null}
        {results?.items.map(student => (
          <View key={student.id}>
            <Text style={styles.note}>
              {student.enrollment.className} · {student.enrollment.sectionName}{' '}
              · {student.enrollment.academicPeriod}
            </Text>
            <Button
              title={`Filter fees for ${student.fullName} (${student.admissionNumber})`}
              variant="secondary"
              disabled={disabled}
              onPress={() => {
                setSelected(student);
                onFilters({
                  ...filters,
                  studentId: student.id,
                  offset: undefined,
                });
              }}
            />
          </View>
        ))}
        {results?.nextOffset != null ? (
          <Button
            title="Next Student results"
            variant="secondary"
            disabled={disabled}
            onPress={() => {
              searchGeneration.current++;
              setStudents(null);
              setOffset(results.nextOffset!);
            }}
          />
        ) : null}
        {selected && filters.studentId === selected.id ? (
          <Text style={styles.text}>
            Dues for {selected.fullName} · {selected.admissionNumber}
          </Text>
        ) : null}
        <TextInput
          accessibilityLabel="Search obligations"
          placeholder="Fee title, academic period or challan reference"
          value={filters.search ?? ''}
          maxLength={80}
          editable={!disabled}
          style={styles.input}
          onChangeText={value =>
            onFilters({ ...filters, search: value, offset: undefined })
          }
        />
        <WorkspaceTabs
          accessibilityLabel="Canonical fee status"
          items={statusChoices.map(value => value.label)}
          selected={
            statusChoices.find(value => value.value === filters.status)!.label
          }
          onSelect={label => {
            if (!disabled)
              onFilters({
                ...filters,
                status: statusChoices.find(value => value.label === label)
                  ?.value,
                offset: undefined,
              });
          }}
        />
        <Button
          title={report ? 'Clear report filters' : 'Clear dues filters'}
          variant="secondary"
          disabled={disabled}
          onPress={() => {
            searchGeneration.current++;
            setSearch('');
            setOffset(0);
            setStudents(null);
            setSelected(null);
            onFilters({});
          }}
        />
      </SectionCard>
      {!report ? (
        <SectionCard title="Find issued challan">
          <Text style={styles.note}>
            Finding an issued reference confirms only the obligation. It does
            not confirm a payment.
          </Text>
          <TextInput
            accessibilityLabel="Issued challan reference"
            value={reference}
            editable={!disabled}
            maxLength={80}
            autoCapitalize="none"
            style={styles.input}
            onChangeText={value => {
              lookupGeneration.current++;
              setLooking(false);
              setFound(null);
              setLookupError(null);
              setReference(value);
            }}
          />
          <Button
            title="Find challan"
            disabled={disabled || looking || !reference.trim()}
            onPress={lookup}
          />
          {looking ? (
            <Text style={styles.text}>Looking up challan...</Text>
          ) : null}
          {lookupError ? (
            <Text accessibilityRole="alert" style={styles.text}>
              {lookupError}
            </Text>
          ) : null}
          {lookupError ? (
            <Button
              title="Retry challan lookup"
              variant="secondary"
              disabled={disabled || looking}
              onPress={lookup}
            />
          ) : null}
          {found?.token === token && found.reference === reference ? (
            <>
              <Text style={styles.text}>Issued challan found.</Text>
              <FeeCards data={{ items: [found.fee] }} />
            </>
          ) : null}
        </SectionCard>
      ) : null}
    </>
  );
}
const styles = StyleSheet.create({
  text: { ...typography.body, color: colors.ink },
  note: {
    ...typography.small,
    color: colors.muted,
    marginVertical: spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    color: colors.ink,
    padding: spacing.md,
    marginVertical: spacing.sm,
  },
  actions: { gap: spacing.sm },
});
