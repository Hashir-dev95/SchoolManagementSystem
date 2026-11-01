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
} from '../../services/finance/financeService';
import {
  DashboardShell,
  HeroBanner,
  WorkspaceTabs,
  DashboardStateCard,
  SectionCard,
  Button,
} from '../../components/hiraDashboard';
import { FeeCards } from '../../components/hiraDashboard/FeeCards';
import { colors, spacing, typography } from '../../theme/hiraDashboard';

const panes = [
  'Summary',
  'Fees',
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
  | { kind: 'Payments'; items: PaymentView[] }
  | { kind: 'Reconciliation'; queue: ReconciliationView }
  | {
      kind: 'Fee setup';
      structures: StructureView[];
      students: { id: string; fullName: string; admissionNumber: string }[];
    };
async function load(token: string, pane: Pane): Promise<Data> {
  switch (pane) {
    case 'Summary':
      return { kind: pane, summary: await service.summary(token) };
    case 'Fees':
      return { kind: pane, fees: await service.fees(token) };
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
  return <Workspace key={user.id} token={accessToken} />;
}
function Workspace({ token }: { token: string }) {
  const { logout } = useAuth();
  const [pane, setPane] = useState<Pane>('Summary'),
    [data, setData] = useState<Data | null>(null);
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
    setLoading(true);
    setError(null);
    setData(null);
    load(token, pane)
      .then(value => {
        if (active) {
          setData(value);
        }
      })
      .catch((failure: unknown) => {
        if (active) {
          setError(message(failure));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
      generation.current += 1;
    };
  }, [token, pane, attempt]);
  const retry = useCallback(async () => {
    setAttempt(value => value + 1);
  }, []);
  async function mutate(
    key: string,
    input: unknown,
    action: (operationId: string) => Promise<unknown>,
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
      await action(op);
      if (version === generation.current) {
        setFeedback('Server confirmed the operation.');
        setAttempt(value => value + 1);
      }
    } catch (failure) {
      if (version === generation.current) {
        setFeedback(message(failure));
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
      {feedback ? (
        <Text accessibilityRole="alert" style={styles.text}>
          {feedback}
        </Text>
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
            <Button
              title="Record bank payment"
              disabled={busy || !feeId || !reference.trim()}
              onPress={() => {
                mutate('record', [feeId, reference], op =>
                  service.record(token, feeId, {
                    method: 'bank_transfer',
                    reference,
                    operationId: op,
                  }),
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
