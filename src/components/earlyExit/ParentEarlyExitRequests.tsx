import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { VerifiedChild } from '../../services/parent/parentService';
import {
  earlyExitFieldErrors,
  emptyEarlyExitFields,
  normalizeEarlyExitFields,
  type EarlyExitDetail,
  type EarlyExitFields,
  type EarlyExitPage,
  type EarlyExitState,
  type EarlyExitWrite,
  type EarlyExitTransport,
} from '../../services/parent/earlyExitService';
import {
  useEarlyExitLifetime,
  earlyExitDenied,
  earlyExitConflict,
  earlyExitUncertain,
  earlyExitError,
} from '../../hooks/useEarlyExitSession';
import {
  Button,
  DashboardStateCard,
  SectionCard,
  WorkspaceTabs,
} from '../hiraDashboard';
import {
  EarlyExitForm,
  EarlyExitHistory,
  EarlyExitSafety,
  EarlyExitStatus,
  earlyExitLabels,
  styles,
} from './EarlyExitPresentation';

type Action = EarlyExitWrite['kind'];
const filters: Record<string, EarlyExitState | undefined> = {
  All: undefined,
  Draft: 'draft',
  Pending: 'pending',
  'Changes Requested': 'changes_requested',
  Rejected: 'rejected',
  Withdrawn: 'withdrawn',
};
export default function ParentEarlyExitRequests({
  token,
  child,
  transport,
  operationId,
  onDenied,
  onLock,
}: {
  token: string;
  child: VerifiedChild;
  transport: EarlyExitTransport;
  operationId: () => string;
  onDenied: (failure: unknown) => void;
  onLock: (value: boolean) => void;
}) {
  const live = useEarlyExitLifetime(),
    generation = useRef(0),
    sending = useRef(false),
    pending = useRef<EarlyExitWrite | null>(null),
    detailId = useRef<string | null>(null);
  const [filter, setFilter] = useState('All'),
    [page, setPage] = useState<EarlyExitPage | null>(null),
    [detail, setDetail] = useState<EarlyExitDetail | null>(null);
  const [fields, setFields] = useState<EarlyExitFields | null>(null),
    [errors, setErrors] = useState<
      Partial<Record<keyof EarlyExitFields, string>>
    >({});
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState('');
  const [uncertain, setUncertain] = useState(false),
    [conflict, setConflict] = useState(false),
    [conflictReady, setConflictReady] = useState(false),
    [confirm, setConfirm] = useState<Action | null>(null);
  useEffect(() => () => onLock(false), [onLock]);
  const fail = useCallback(
    (failure: unknown) => {
      if (earlyExitDenied(failure)) onDenied(failure);
      else setError(earlyExitError(failure));
    },
    [onDenied],
  );
  const load = useCallback(
    async (offset = 0) => {
      const request = ++generation.current;
      setLoading(true);
      setError(null);
      if (!offset) setPage(null);
      try {
        const data = await transport.list(
          token,
          child.studentId,
          offset,
          filters[filter],
        );
        if (!live.current || request !== generation.current) return;
        setPage(previous => ({
          ...data,
          items: [
            ...new Map(
              [...(offset ? previous?.items ?? [] : []), ...data.items].map(
                item => [item.requestId, item],
              ),
            ).values(),
          ],
        }));
      } catch (failure) {
        if (live.current && request === generation.current) fail(failure);
      } finally {
        if (live.current && request === generation.current) setLoading(false);
      }
    },
    [child.studentId, fail, filter, live, token, transport],
  );
  useEffect(() => {
    load();
  }, [load]);
  const open = async (id: string, preserve = false) => {
    // Edit identity survives transient detail failure; absence of detail is never Create.
    detailId.current = id;
    const request = ++generation.current;
    setDetail(null);
    setLoading(true);
    setError(null);
    setConfirm(null);
    setConflictReady(false);
    if (!preserve) {
      setFields(null);
      setErrors({});
      setNotice('');
      setConflict(false);
    }
    try {
      const data = await transport.detail(token, child.studentId, id);
      if (!live.current || request !== generation.current) return;
      setDetail(data);
      if (preserve) setConflictReady(true);
    } catch (failure) {
      if (live.current && request === generation.current) fail(failure);
    } finally {
      if (live.current && request === generation.current) setLoading(false);
    }
  };
  const edit = () => {
    if (detail) {
      setFields({ exitDate: detail.exitDate, reason: detail.reason });
      setErrors({});
      setError(null);
    }
  };
  const execute = async (operation: EarlyExitWrite) => {
    if (sending.current || !live.current) return;
    sending.current = true;
    pending.current = operation;
    onLock(true);
    ++generation.current;
    setBusy(true);
    setError(null);
    setNotice('');
    setConfirm(null);
    try {
      const data = await transport.write(token, child.studentId, operation);
      if (!live.current) return;
      pending.current = null;
      setUncertain(false);
      setConflict(false);
      setConflictReady(false);
      setFields(null);
      // Receipt may be historical; only the fresh authorized request is current.
      setDetail(data.request);
      detailId.current = data.request.requestId;
      setNotice('School record confirmed. Current request shown below.');
      await load();
    } catch (failure) {
      if (!live.current) return;
      if (earlyExitDenied(failure)) {
        pending.current = null;
        onDenied(failure);
      } else if (earlyExitConflict(failure)) {
        pending.current = null;
        setUncertain(false);
        setConflict(true);
        setConflictReady(false);
        if (operation.kind !== 'create') await open(operation.id, true);
        if (live.current) setError(earlyExitError(failure));
      } else {
        const unknown = earlyExitUncertain(failure);
        setUncertain(unknown);
        if (!unknown) pending.current = null;
        setError(earlyExitError(failure));
      }
    } finally {
      sending.current = false;
      if (live.current) {
        setBusy(false);
        onLock(pending.current !== null);
      }
    }
  };
  const begin = (kind: Action) => {
    if (
      sending.current ||
      pending.current ||
      loading ||
      uncertain ||
      conflict ||
      (detailId.current && !detail)
    )
      return;
    if (['create', 'edit', 'resubmit'].includes(kind)) {
      if (!fields) return;
      const feedback = earlyExitFieldErrors(fields);
      setErrors(feedback);
      if (Object.keys(feedback).length) return;
    }
    try {
      const clientOperationId = operationId();
      if (kind === 'create' && fields && !detailId.current)
        return execute({
          kind,
          body: { ...normalizeEarlyExitFields(fields), clientOperationId },
        });
      if (!detail) return;
      const applicationRevision = detail.revision;
      if (kind === 'edit' && fields && detail.capabilities.canEditDraft)
        return execute({
          kind,
          id: detail.requestId,
          body: {
            ...normalizeEarlyExitFields(fields),
            applicationRevision,
            clientOperationId,
          },
        });
      if (kind === 'submit' && detail.capabilities.canSubmit)
        return execute({
          kind,
          id: detail.requestId,
          body: { applicationRevision, clientOperationId },
        });
      if (
        kind === 'withdraw' &&
        detail.capabilities.canWithdraw &&
        detail.reviewVersion
      )
        return execute({
          kind,
          id: detail.requestId,
          body: { ...detail.reviewVersion, clientOperationId },
        });
      if (
        kind === 'resubmit' &&
        fields &&
        detail.capabilities.canResubmit &&
        detail.reviewVersion
      )
        return execute({
          kind,
          id: detail.requestId,
          body: {
            ...normalizeEarlyExitFields(fields),
            ...detail.reviewVersion,
            clientOperationId,
          },
        });
    } catch {
      setError('Secure operation ID unavailable. Use the native app runtime.');
    }
  };
  const blocked = busy || uncertain || loading || conflict;
  const leaveDetail = () => {
    ++generation.current;
    detailId.current = null;
    setDetail(null);
    setFields(null);
    setConfirm(null);
    setConflict(false);
    setErrors({});
    setNotice('');
  };
  return (
    <>
      <SectionCard title={`Early Exit · ${child.fullName}`}>
        <Text style={styles.body}>
          Only your own requests are shown. School review does not confirm
          physical departure.
        </Text>
        <WorkspaceTabs
          items={Object.keys(filters)}
          selected={filter}
          accessibilityLabel="Early Exit filters"
          onSelect={value => {
            if (sending.current || pending.current || loading) return;
            leaveDetail();
            setFilter(value);
          }}
        />
        <Button
          title="New Early Exit draft"
          disabled={blocked}
          onPress={() => {
            leaveDetail();
            setFields({ ...emptyEarlyExitFields });
            setError(null);
          }}
        />
        <Button
          title="Refresh Early Exit history"
          variant="secondary"
          disabled={busy || uncertain}
          onPress={() => {
            if (!sending.current && !pending.current) {
              if (detailId.current) open(detailId.current, true);
              else load();
            }
          }}
        />
      </SectionCard>
      {notice ? (
        <Text accessibilityRole="alert" style={styles.body}>
          {notice}
        </Text>
      ) : null}
      <DashboardStateCard
        loading={loading}
        error={error}
        onRetry={async () => {
          if (sending.current || pending.current) return;
          if (detailId.current) await open(detailId.current, true);
          else await load();
        }}
      />
      {uncertain ? (
        <SectionCard title="Operation unconfirmed">
          <Text style={styles.body}>
            Your working copy is retained in memory. Retry the identical
            operation. Do not create another draft to replace an unconfirmed
            save.
          </Text>
          <Button
            title="Retry same operation"
            disabled={busy}
            onPress={() => {
              if (pending.current) execute(pending.current);
            }}
          />
        </SectionCard>
      ) : null}
      {conflict ? (
        <SectionCard title="Review changed request">
          <Text style={styles.body}>
            Compare the refreshed request with your retained working copy before
            applying new versions.
          </Text>
          {conflictReady && detail ? (
            <Button
              title="Use refreshed versions"
              onPress={() => {
                setConflict(false);
                setError(null);
              }}
            />
          ) : (
            <Button
              title="Refresh changed request"
              disabled={loading}
              onPress={() => {
                if (detailId.current) open(detailId.current, true);
                else {
                  setConflict(false);
                  load();
                }
              }}
            />
          )}
        </SectionCard>
      ) : null}
      {detail ? (
        <>
          <SectionCard title={`Early Exit · ${detail.exitDate}`}>
            <EarlyExitStatus state={detail.state} />
            <Text style={styles.body}>{detail.reason}</Text>
            <EarlyExitSafety record={detail} />
            <View style={styles.actions}>
              {detail.capabilities.canEditDraft ? (
                <Button title="Edit draft" disabled={blocked} onPress={edit} />
              ) : null}
              {detail.capabilities.canSubmit && !fields ? (
                <Button
                  title="Submit request"
                  disabled={blocked}
                  onPress={() => setConfirm('submit')}
                />
              ) : null}
              {detail.capabilities.canWithdraw ? (
                <Button
                  title="Withdraw request"
                  variant="danger"
                  disabled={blocked}
                  onPress={() => setConfirm('withdraw')}
                />
              ) : null}
              {detail.capabilities.canResubmit && !fields ? (
                <Button
                  title="Revise request"
                  disabled={blocked}
                  onPress={edit}
                />
              ) : null}
            </View>
          </SectionCard>
          <EarlyExitHistory detail={detail} />
        </>
      ) : !fields ? (
        <>
          {!loading && page && !page.items.length ? (
            <Text style={styles.body}>
              No Early Exit requests in this view.
            </Text>
          ) : null}
          {page?.items.map(item => (
            <SectionCard
              key={item.requestId}
              title={`Early Exit · ${item.exitDate}`}
            >
              <EarlyExitStatus state={item.state} />
              <Text style={styles.body}>
                Updated {new Date(item.updatedAt).toLocaleString()}
              </Text>
              <Button
                title={`View ${earlyExitLabels[item.state]} request ${
                  item.exitDate
                }`}
                variant="secondary"
                disabled={blocked}
                onPress={() => open(item.requestId)}
              />
            </SectionCard>
          ))}
          {page?.nextOffset != null ? (
            <Button
              title="Load more Early Exit requests"
              disabled={blocked}
              onPress={() => load(page.nextOffset!)}
            />
          ) : null}
        </>
      ) : null}
      {fields ? (
        <>
          <EarlyExitForm
            fields={fields}
            errors={errors}
            disabled={blocked}
            onChange={setFields}
          />
          <Button
            title={
              detail?.state === 'changes_requested'
                ? 'Resubmit request'
                : 'Save draft'
            }
            disabled={
              blocked ||
              (!!detailId.current && !detail) ||
              (!!detail &&
                !detail.capabilities.canEditDraft &&
                !detail.capabilities.canResubmit)
            }
            onPress={() =>
              detail?.state === 'changes_requested'
                ? setConfirm('resubmit')
                : begin(detailId.current ? 'edit' : 'create')
            }
          />
          <Button
            title="Cancel editing"
            variant="secondary"
            disabled={busy || uncertain}
            onPress={() => {
              setFields(null);
              setConfirm(null);
              setConflict(false);
              setErrors({});
            }}
          />
        </>
      ) : null}
      {detailId.current || fields ? (
        <Button
          title="Back to Early Exit history"
          variant="secondary"
          disabled={busy || uncertain || loading}
          onPress={() => {
            leaveDetail();
            load();
          }}
        />
      ) : null}
      {confirm ? (
        <SectionCard
          title={
            confirm === 'withdraw'
              ? 'Confirm withdrawal'
              : confirm === 'resubmit'
              ? 'Confirm resubmission'
              : 'Confirm submission'
          }
        >
          <Text style={styles.body}>
            {confirm === 'withdraw'
              ? 'Withdraw this pending request? Its history will remain stored.'
              : 'Send these details for school review? This does not authorize your child to leave school.'}
          </Text>
          <Button
            title={`Confirm ${confirm}`}
            disabled={blocked}
            onPress={() => begin(confirm)}
          />
          <Button
            title="Cancel confirmation"
            variant="secondary"
            disabled={busy}
            onPress={() => setConfirm(null)}
          />
        </SectionCard>
      ) : null}
    </>
  );
}
