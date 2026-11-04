import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { ApiError } from '../../services/api/apiClient';
import {
  parentService,
  type VerifiedChild,
} from '../../services/parent/parentService';
import {
  leaveApplicationService,
  leaveFieldErrors,
  leaveOperationId,
  type LeaveDraft,
  type LeaveFields,
  type LeavePage,
  type LeaveTransport,
} from '../../services/parent/leaveApplicationService';
import {
  Button,
  DashboardShell,
  DashboardStateCard,
  ScreenHeading,
  SectionCard,
  StatusBadge,
  WorkspaceTabs,
} from '../../components/hiraDashboard';
import { colors, radius, spacing, typography } from '../../theme/hiraDashboard';

const denied = (failure: unknown) =>
  failure instanceof ApiError && [401, 403, 404].includes(failure.status);
const empty: LeaveFields = {
  leaveType: '',
  startDate: '',
  endDate: '',
  reason: '',
};
const label = (child: VerifiedChild) =>
  `${child.fullName} · ${child.enrollment.branch.name} · ${child.enrollment.schoolClass.name} ${child.enrollment.section.name}`;
export default function ParentLeaveApplicationsScreen({
  transport = leaveApplicationService,
  childrenTransport = parentService,
  operationId = leaveOperationId,
}: {
  transport?: LeaveTransport;
  childrenTransport?: Pick<typeof parentService, 'children'>;
  operationId?: () => string;
}) {
  const { user, accessToken } = useAuth();
  if (!user || user.role !== 'parent' || !accessToken)
    return <Text>Session unavailable. Sign in as a Parent.</Text>;
  return (
    <Applications
      key={JSON.stringify([user.id, user.role, user.branchId, accessToken])}
      token={accessToken}
      transport={transport}
      childrenTransport={childrenTransport}
      operationId={operationId}
    />
  );
}
function Applications({
  token,
  transport,
  childrenTransport,
  operationId,
}: {
  token: string;
  transport: LeaveTransport;
  childrenTransport: Pick<typeof parentService, 'children'>;
  operationId: () => string;
}) {
  const { logout } = useAuth();
  const generation = useRef(0),
    focused = useRef(false),
    preferred = useRef('');
  const [children, setChildren] = useState<VerifiedChild[]>([]),
    [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null);
  const conceal = useCallback(
    (failure: unknown) => {
      generation.current += 1;
      setChildren([]);
      setSelected('');
      setLoading(false);
      setError(
        'Leave applications are unavailable in your current scope. Refresh your verified children.',
      );
      if (failure instanceof ApiError && failure.status === 401)
        logout().catch(() => {});
    },
    [logout],
  );
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setChildren([]);
    setSelected('');
    setError(null);
    setLoading(true);
    try {
      const page = await childrenTransport.children(token);
      if (!focused.current || request !== generation.current) return;
      setChildren(page.items);
      setSelected(
        page.items.find(child => child.studentId === preferred.current)
          ?.studentId ??
          page.items[0]?.studentId ??
          '',
      );
    } catch (failure) {
      if (!focused.current || request !== generation.current) return;
      if (denied(failure)) conceal(failure);
      else setError('Could not load verified children. Please retry.');
    } finally {
      if (focused.current && request === generation.current) setLoading(false);
    }
  }, [childrenTransport, token, conceal]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      refresh();
      return () => {
        focused.current = false;
        generation.current += 1;
        setChildren([]);
        setSelected('');
      };
    }, [refresh]),
  );
  const child = children.find(item => item.studentId === selected);
  return (
    <DashboardShell keyboardShouldPersistTaps="handled">
      <ScreenHeading
        title="Leave applications"
        subtitle="Private drafts for your verified children"
      />
      <Text style={styles.body}>
        Save and review a draft here. Applications are not sent for approval
        yet.
      </Text>
      <Button
        title="Refresh verified children"
        variant="secondary"
        onPress={refresh}
      />
      <DashboardStateCard loading={loading} error={error} onRetry={refresh} />
      {!loading && !error && !children.length ? (
        <Text style={styles.body}>
          No verified children available. Contact your school.
        </Text>
      ) : null}
      {child ? (
        <>
          <WorkspaceTabs
            items={children.map(label)}
            selected={label(child)}
            accessibilityLabel="Verified children"
            onSelect={value => {
              const next = children.find(item => label(item) === value);
              if (next) {
                preferred.current = next.studentId;
                setSelected(next.studentId);
              }
            }}
          />
          <DraftWorkspace
            key={JSON.stringify([
              child.studentId,
              child.enrollment.branch.id,
              child.enrollment.enrollmentId,
            ])}
            token={token}
            child={child}
            transport={transport}
            operationId={operationId}
            onDenied={conceal}
          />
        </>
      ) : null}
    </DashboardShell>
  );
}
function DraftWorkspace({
  token,
  child,
  transport,
  operationId,
  onDenied,
}: {
  token: string;
  child: VerifiedChild;
  transport: LeaveTransport;
  operationId: () => string;
  onDenied: (failure: unknown) => void;
}) {
  const generation = useRef(0),
    alive = useRef(true),
    inFlight = useRef(false);
  const pending = useRef<{
    operation: string;
    fields: LeaveFields;
    id?: string;
    revision?: number;
  } | null>(null);
  const [page, setPage] = useState<LeavePage | null>(null),
    [detail, setDetail] = useState<LeaveDraft | null>(null);
  const [form, setForm] = useState<LeaveFields | null>(null),
    [errors, setErrors] = useState<Partial<Record<keyof LeaveFields, string>>>(
      {},
    );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState('');
  const [uncertain, setUncertain] = useState(false),
    [conflict, setConflict] = useState(false);
  const current = (request: number) =>
    alive.current && request === generation.current;
  useEffect(
    () => () => {
      alive.current = false;
      generation.current += 1;
      pending.current = null;
    },
    [],
  );
  const load = useCallback(
    async (offset = 0) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      setPage(null);
      const request = ++generation.current;
      try {
        const result = await transport.list(token, child.studentId, offset);
        if (alive.current && request === generation.current) setPage(result);
      } catch (failure) {
        if (alive.current && request === generation.current) {
          if (denied(failure)) onDenied(failure);
          else setError('Could not load leave drafts. Please retry.');
        }
      } finally {
        if (alive.current && request === generation.current) {
          inFlight.current = false;
          setBusy(false);
        }
      }
    },
    [transport, token, child.studentId, onDenied],
  );
  useEffect(() => {
    load();
  }, [load]);
  const showDetail = (value: LeaveDraft) => {
    setDetail(value);
    setForm({
      leaveType: value.leaveType,
      startDate: value.startDate,
      endDate: value.endDate,
      reason: value.reason,
    });
    setErrors({});
    setConflict(false);
    setUncertain(false);
    pending.current = null;
  };
  const open = async (id: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice('');
    // Conceal an earlier draft immediately while authorizing the new detail.
    setDetail(null);
    setForm(null);
    const request = ++generation.current;
    try {
      const result = await transport.detail(token, child.studentId, id);
      if (current(request)) showDetail(result);
    } catch (failure) {
      if (current(request)) {
        if (denied(failure)) onDenied(failure);
        else setError('Could not open this draft. Refresh and try again.');
      }
    } finally {
      if (current(request)) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  };
  const save = async () => {
    if (inFlight.current || !form || conflict) return;
    const fieldErrors = leaveFieldErrors(form);
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice('');
    const request = ++generation.current;
    let saved = false;
    try {
      const attempt = pending.current ?? {
        operation: operationId(),
        fields: { ...form },
        id: detail?.applicationId,
        revision: detail?.revision,
      };
      pending.current = attempt;
      const result = attempt.id
        ? await transport.edit(
            token,
            child.studentId,
            attempt.id,
            attempt.fields,
            attempt.revision!,
            attempt.operation,
          )
        : await transport.create(
            token,
            child.studentId,
            attempt.fields,
            attempt.operation,
          );
      if (!current(request)) return;
      showDetail(result.application);
      saved = true;
      setNotice('Draft saved. It has not been submitted.');
      // Refresh counts/order from the server; a failed refresh cannot undo save.
      const refreshed = await transport.list(token, child.studentId, 0);
      if (current(request)) setPage(refreshed);
    } catch (failure) {
      if (!current(request)) return;
      if (denied(failure)) {
        setPage(null);
        setDetail(null);
        setForm(null);
        pending.current = null;
        onDenied(failure);
      } else if (failure instanceof ApiError && failure.status === 409) {
        pending.current = null;
        setUncertain(false);
        setConflict(true);
        setError('This draft changed. Reload it before editing again.');
      } else if (failure instanceof ApiError && failure.status === 400) {
        pending.current = null;
        setUncertain(false);
        setError('Check the leave fields and date range, then save again.');
      } else if (pending.current) {
        setUncertain(true);
        setError(
          'Save not confirmed. Retry save safely with the same operation.',
        );
      } else
        setError(
          saved
            ? 'Draft saved, but the list could not refresh. Close the editor and refresh drafts.'
            : 'Could not start a secure save. Please retry.',
        );
    } finally {
      if (current(request)) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  };
  return (
    <>
      <SectionCard title={`${child.fullName} · Leave drafts`}>
        <View style={styles.actions}>
          <Button
            title="New leave draft"
            disabled={busy || uncertain}
            onPress={() => {
              setDetail(null);
              setForm({ ...empty });
              setErrors({});
              setError(null);
              setNotice('');
              setConflict(false);
              pending.current = null;
            }}
          />
          <Button
            title="Refresh drafts"
            variant="secondary"
            disabled={busy || !!form}
            onPress={() => load(page?.offset ?? 0)}
          />
        </View>
        <DashboardStateCard
          loading={busy}
          error={error}
          onRetry={async () => {
            if (uncertain) await save();
            else if (conflict && detail) await open(detail.applicationId);
            else await load(page?.offset ?? 0);
          }}
        />
        {notice ? (
          <Text accessibilityLiveRegion="polite" style={styles.body}>
            {notice}
          </Text>
        ) : null}
        {error && !form ? (
          <Button
            title="Retry drafts"
            variant="secondary"
            disabled={busy}
            onPress={() => load()}
          />
        ) : null}
        {page && !page.items.length ? (
          <Text style={styles.body}>
            No leave drafts yet. Create a private draft to get started.
          </Text>
        ) : null}
        {page?.items.map(item => (
          <View key={item.applicationId} style={styles.record}>
            <StatusBadge status="pending" label="Draft" />
            <Text style={styles.title}>{item.leaveType}</Text>
            <Text style={styles.body}>
              {item.startDate} – {item.endDate} · Revision {item.revision}
            </Text>
            <Button
              title={`Open draft ${item.applicationId}`}
              variant="secondary"
              disabled={busy || uncertain}
              onPress={() => open(item.applicationId)}
            />
          </View>
        ))}
        {page ? (
          <View style={styles.actions}>
            <Text style={styles.body}>
              {page.total} draft{page.total === 1 ? '' : 's'}
            </Text>
            <Button
              title="Previous drafts"
              variant="secondary"
              disabled={busy || !!form || page.offset === 0}
              onPress={() => load(Math.max(0, page.offset - page.limit))}
            />
            <Button
              title="Next drafts"
              variant="secondary"
              disabled={
                busy || !!form || page.offset + page.limit >= page.total
              }
              onPress={() => load(page.offset + page.limit)}
            />
          </View>
        ) : null}
      </SectionCard>
      {form ? (
        <SectionCard title={detail ? 'Edit leave draft' : 'New leave draft'}>
          <StatusBadge status="pending" label="Draft" />
          <Text style={styles.body}>
            Private to your current authorized account. Medical attachments and
            submission are not available yet.
          </Text>
          {(['leaveType', 'startDate', 'endDate', 'reason'] as const).map(
            key => {
              const name = {
                leaveType: 'Leave type',
                startDate: 'Start date',
                endDate: 'End date',
                reason: 'Private reason',
              }[key];
              return (
                <View key={key} style={styles.field}>
                  <Text style={styles.title}>
                    {name}
                    {key.endsWith('Date') ? ' · YYYY-MM-DD' : ''}
                  </Text>
                  <TextInput
                    accessibilityLabel={name}
                    value={form[key]}
                    editable={!busy && !uncertain && !conflict}
                    multiline={key === 'reason'}
                    maxLength={
                      key === 'reason' ? 500 : key === 'leaveType' ? 80 : 10
                    }
                    autoCapitalize={key.endsWith('Date') ? 'none' : 'sentences'}
                    style={[styles.input, key === 'reason' && styles.reason]}
                    onChangeText={value => {
                      setForm({ ...form, [key]: value });
                      setErrors({ ...errors, [key]: undefined });
                    }}
                  />
                  {errors[key] ? (
                    <Text style={styles.error}>{errors[key]}</Text>
                  ) : null}
                </View>
              );
            },
          )}
          <View style={styles.actions}>
            <Button
              title={uncertain ? 'Retry save' : 'Save draft'}
              disabled={busy || conflict}
              onPress={save}
            />
            {detail ? (
              <Button
                title="Reload draft"
                variant="secondary"
                disabled={busy || uncertain}
                onPress={() => open(detail.applicationId)}
              />
            ) : null}
            <Button
              title="Close editor"
              variant="secondary"
              disabled={busy || uncertain}
              onPress={() => {
                setForm(null);
                setDetail(null);
                setConflict(false);
                setErrors({});
                setError(null);
              }}
            />
          </View>
          {detail ? (
            <>
              <Text style={styles.title}>Draft history</Text>
              {detail.history.map(event => (
                <Text key={event.revision} style={styles.body}>
                  {event.action === 'draft_created'
                    ? 'Draft created'
                    : 'Draft edited'}{' '}
                  · Revision {event.revision} · {event.at}
                </Text>
              ))}
            </>
          ) : null}
        </SectionCard>
      ) : null}
    </>
  );
}
const styles = StyleSheet.create({
  body: { ...typography.body, color: colors.muted, marginVertical: spacing.sm },
  title: { ...typography.bodyStrong, color: colors.ink },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginVertical: spacing.sm,
  },
  record: {
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  field: { marginVertical: spacing.sm, gap: spacing.xs },
  input: {
    ...typography.body,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.ink,
    backgroundColor: colors.white,
  },
  reason: { minHeight: 110, textAlignVertical: 'top' },
  error: { ...typography.body, color: colors.danger.text },
});
