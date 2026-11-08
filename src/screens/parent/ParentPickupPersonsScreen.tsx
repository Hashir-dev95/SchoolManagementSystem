import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { ApiError } from '../../services/api/apiClient';
import {
  parentService,
  type VerifiedChild,
} from '../../services/parent/parentService';
import {
  pickupAuthorizationService,
  pickupOperationId,
  pickupFieldErrors,
  emptyPickupFields,
  type PickupFields,
  type PickupDetail,
  type PickupPage,
  type PickupState,
  type PickupWrite,
  type PickupTransport,
} from '../../services/parent/pickupAuthorizationService';
import {
  PickupSession,
  usePickupLifetime,
  pickupDenied,
  pickupConflict,
  pickupUncertain,
  pickupError,
} from '../../hooks/usePickupSession';
import {
  Button,
  DashboardShell,
  DashboardStateCard,
  ScreenHeading,
  SectionCard,
  WorkspaceTabs,
} from '../../components/hiraDashboard';
import {
  PickupForm,
  PickupSafety,
  PickupStatus,
  PickupHistory,
  pickupStyles as styles,
} from '../../components/pickup/PickupPresentation';

type Dependencies = {
  transport?: PickupTransport;
  childrenTransport?: Pick<typeof parentService, 'children'>;
  operationId?: () => string;
};
const childLabel = (child: VerifiedChild) =>
  `${child.fullName} · ${child.enrollment.schoolClass.name} ${child.enrollment.section.name} · ${child.enrollment.branch.name}`;
export default function ParentPickupPersonsScreen({
  transport = pickupAuthorizationService,
  childrenTransport = parentService,
  operationId = pickupOperationId,
}: Dependencies) {
  return (
    <PickupSession role="parent">
      {token => (
        <VerifiedWorkspace
          token={token}
          transport={transport}
          childrenTransport={childrenTransport}
          operationId={operationId}
        />
      )}
    </PickupSession>
  );
}
function VerifiedWorkspace({
  token,
  transport,
  childrenTransport,
  operationId,
}: Required<Dependencies> & { token: string }) {
  const { logout } = useAuth();
  const live = usePickupLifetime(),
    generation = useRef(0),
    preferred = useRef('');
  const [children, setChildren] = useState<VerifiedChild[]>([]),
    [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const [operationLocked, setOperationLocked] = useState(false);
  const onLock = useCallback((value: boolean) => {
    locked.current = value;
    setOperationLocked(value);
  }, []);
  const conceal = useCallback(
    (failure: unknown) => {
      if (!live.current) return;
      ++generation.current;
      setChildren([]);
      setSelected('');
      setLoading(false);
      setError(pickupError(failure));
      onLock(false);
      if (failure instanceof ApiError && failure.status === 401)
        logout().catch(() => undefined);
    },
    [live, logout, onLock],
  );
  const refresh = useCallback(async () => {
    if (locked.current) return;
    const request = ++generation.current;
    setChildren([]);
    setSelected('');
    setError(null);
    setLoading(true);
    try {
      const result = await childrenTransport.children(token);
      if (!live.current || request !== generation.current) return;
      setChildren(result.items);
      setSelected(
        result.items.find(child => child.studentId === preferred.current)
          ?.studentId ??
          result.items[0]?.studentId ??
          '',
      );
    } catch (failure) {
      if (!live.current || request !== generation.current) return;
      if (pickupDenied(failure)) conceal(failure);
      else
        setError(
          'Verified children could not be loaded. Retry when connected.',
        );
    } finally {
      if (live.current && request === generation.current) setLoading(false);
    }
  }, [childrenTransport, conceal, live, token]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  const child = children.find(item => item.studentId === selected);
  return (
    <KeyboardAvoidingView
      style={styles.shell}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <DashboardShell keyboardShouldPersistTaps="handled">
        <ScreenHeading
          title="Pickup Persons"
          subtitle="Private proposals for your school-verified children"
        />
        <PickupSafety />
        <Button
          title="Refresh verified children"
          variant="secondary"
          disabled={operationLocked}
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
              items={children.map(childLabel)}
              selected={childLabel(child)}
              accessibilityLabel="Verified children"
              onSelect={value => {
                if (locked.current) return;
                const next = children.find(item => childLabel(item) === value);
                if (next) {
                  preferred.current = next.studentId;
                  setSelected(next.studentId);
                }
              }}
            />
            <ChildPickups
              key={JSON.stringify([
                child.studentId,
                child.enrollment.enrollmentId,
                child.enrollment.branch.id,
              ])}
              token={token}
              child={child}
              transport={transport}
              operationId={operationId}
              onDenied={conceal}
              onLock={onLock}
            />
          </>
        ) : null}
      </DashboardShell>
    </KeyboardAvoidingView>
  );
}
type Action = PickupWrite['kind'];
const reviewedStates: Record<string, PickupState> = {
  'Changes Requested': 'changes_requested',
  Rejected: 'rejected',
  Withdrawn: 'withdrawn',
  'Approved history': 'approved',
};
function ChildPickups({
  token,
  child,
  transport,
  operationId,
  onDenied,
  onLock,
}: {
  token: string;
  child: VerifiedChild;
  transport: PickupTransport;
  operationId: () => string;
  onDenied: (failure: unknown) => void;
  onLock: (value: boolean) => void;
}) {
  const live = usePickupLifetime(),
    generation = useRef(0),
    sending = useRef(false),
    operation = useRef<PickupWrite | null>(null),
    detailId = useRef<string | null>(null);
  useEffect(() => () => onLock(false), [onLock]);
  const [filter, setFilter] = useState('All'),
    [reviewed, setReviewed] = useState('Changes Requested');
  const state =
    filter === 'Draft'
      ? 'draft'
      : filter === 'Pending'
      ? 'pending'
      : filter === 'Reviewed'
      ? reviewedStates[reviewed]
      : undefined;
  const [page, setPage] = useState<PickupPage | null>(null),
    [detail, setDetail] = useState<PickupDetail | null>(null);
  const [fields, setFields] = useState<PickupFields | null>(null),
    [errors, setErrors] = useState<Partial<Record<keyof PickupFields, string>>>(
      {},
    );
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState(''),
    [uncertain, setUncertain] = useState(false),
    [conflict, setConflict] = useState(false),
    [conflictReady, setConflictReady] = useState(false);
  const [confirm, setConfirm] = useState<Action | null>(null);
  const fail = useCallback(
    (failure: unknown) => {
      if (pickupDenied(failure)) onDenied(failure);
      else setError(pickupError(failure));
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
        const result = await transport.list(
          token,
          child.studentId,
          offset,
          state,
        );
        if (!live.current || request !== generation.current) return;
        setPage(previous => ({
          ...result,
          items: offset
            ? [...(previous?.items ?? []), ...result.items]
            : result.items,
        }));
      } catch (failure) {
        if (live.current && request === generation.current) fail(failure);
      } finally {
        if (live.current && request === generation.current) setLoading(false);
      }
    },
    [child.studentId, fail, live, state, token, transport],
  );
  useEffect(() => {
    load();
  }, [load]);
  const open = async (id: string, preserve = false) => {
    detailId.current = id;
    const request = ++generation.current;
    setDetail(null);
    setLoading(true);
    setError(null);
    setConfirm(null);
    if (!preserve) {
      setFields(null);
      setNotice('');
      setConflict(false);
      setConflictReady(false);
    }
    try {
      const result = await transport.detail(token, child.studentId, id);
      if (!live.current || request !== generation.current) return;
      setDetail(result);
      if (!preserve) setFields(null);
      else setConflictReady(true);
    } catch (failure) {
      if (live.current && request === generation.current) fail(failure);
    } finally {
      if (live.current && request === generation.current) setLoading(false);
    }
  };
  const edit = () => {
    if (!detail) return;
    setFields({
      fullName: detail.person.fullName,
      relationship: detail.person.relationship,
      phone: detail.person.phone,
      validFromDate: detail.validFromDate,
      validUntilDate: detail.validUntilDate,
      notes: detail.notes,
    });
    setErrors({});
    setError(null);
  };
  const execute = async (pending: PickupWrite) => {
    if (sending.current || !live.current) return;
    sending.current = true;
    onLock(true);
    operation.current = pending;
    ++generation.current;
    setBusy(true);
    setError(null);
    setNotice('');
    setConfirm(null);
    try {
      const result = await transport.write(token, child.studentId, pending);
      if (!live.current) return;
      operation.current = null;
      setUncertain(false);
      setConflict(false);
      setConflictReady(false);
      setFields(null);
      // Receipt describes the original operation; fresh authorization is current.
      setDetail(result.authorization);
      detailId.current = result.authorization.authorizationId;
      setNotice(
        result.replayed
          ? 'Saved operation confirmed. Current request shown below.'
          : 'School record confirmed. Current request shown below.',
      );
      await load();
    } catch (failure) {
      if (!live.current) return;
      if (pickupDenied(failure)) {
        operation.current = null;
        onDenied(failure);
      } else if (pickupConflict(failure)) {
        operation.current = null;
        setUncertain(false);
        setConflict(true);
        setConflictReady(false);
        if (pending.kind !== 'create') await open(pending.id, true);
        setError(pickupError(failure));
      } else {
        const unknown = pickupUncertain(failure);
        setUncertain(unknown);
        if (!unknown) operation.current = null;
        setError(pickupError(failure));
      }
    } finally {
      sending.current = false;
      if (live.current) {
        setBusy(false);
        onLock(operation.current !== null);
      }
    }
  };
  const begin = (kind: Action) => {
    if (sending.current || uncertain || conflict) return;
    if (
      (kind === 'create' || kind === 'edit' || kind === 'resubmit') &&
      fields
    ) {
      const feedback = pickupFieldErrors(fields);
      setErrors(feedback);
      if (Object.keys(feedback).length) return;
    }
    try {
      const nonce = operationId();
      if (kind === 'create' && fields)
        return execute({ kind, body: { ...fields, clientOperationId: nonce } });
      if (!detail) return;
      const version = {
        applicationRevision: detail.revision,
        personRevision: detail.personRevision,
      };
      if (kind === 'edit' && fields && detail.capabilities.canEditDraft)
        return execute({
          kind,
          id: detail.authorizationId,
          body: { ...fields, ...version, clientOperationId: nonce },
        });
      if (kind === 'submit' && detail.capabilities.canSubmit)
        return execute({
          kind,
          id: detail.authorizationId,
          body: { ...version, clientOperationId: nonce },
        });
      if (
        kind === 'withdraw' &&
        detail.capabilities.canWithdraw &&
        detail.reviewVersion
      )
        return execute({
          kind,
          id: detail.authorizationId,
          body: { ...detail.reviewVersion, clientOperationId: nonce },
        });
      if (
        kind === 'resubmit' &&
        fields &&
        detail.capabilities.canResubmit &&
        detail.reviewVersion
      )
        return execute({
          kind,
          id: detail.authorizationId,
          body: {
            ...fields,
            ...detail.reviewVersion,
            clientOperationId: nonce,
          },
        });
    } catch {
      setError('Secure operation ID unavailable. Use the native app runtime.');
    }
  };
  const disabled = busy || uncertain || conflict || loading;
  return (
    <>
      <SectionCard title={`Pickup proposals · ${child.fullName}`}>
        <Text style={styles.body}>
          Only your own proposals are shown. Review decisions do not grant
          physical collection permission.
        </Text>
        <WorkspaceTabs
          items={['All', 'Draft', 'Pending', 'Reviewed']}
          selected={filter}
          accessibilityLabel="Pickup filters"
          onSelect={value => {
            if (!busy && !uncertain) {
              detailId.current = null;
              setDetail(null);
              setFields(null);
              setConflict(false);
              setFilter(value);
            }
          }}
        />
        {filter === 'Reviewed' ? (
          <WorkspaceTabs
            items={Object.keys(reviewedStates)}
            selected={reviewed}
            accessibilityLabel="Reviewed states"
            onSelect={value => {
              if (!busy && !uncertain) {
                detailId.current = null;
                setDetail(null);
                setFields(null);
                setConflict(false);
                setReviewed(value);
              }
            }}
          />
        ) : null}
        <Button
          title="New pickup proposal"
          disabled={disabled}
          onPress={() => {
            detailId.current = null;
            setDetail(null);
            setFields({ ...emptyPickupFields });
            setErrors({});
            setNotice('');
            setError(null);
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
          if (sending.current) return;
          if (detailId.current) await open(detailId.current, true);
          else await load();
        }}
      />
      {uncertain ? (
        <SectionCard title="Operation unconfirmed">
          <Text style={styles.body}>
            Your entered information is kept in memory. Retry the identical
            operation; do not create another proposal to replace an unconfirmed
            save.
          </Text>
          <Button
            title="Retry same operation"
            disabled={busy}
            onPress={() => {
              if (operation.current) execute(operation.current);
            }}
          />
        </SectionCard>
      ) : null}
      {conflict ? (
        <SectionCard title="Review changed request">
          <Text style={styles.body}>
            Your working copy is retained. Compare the refreshed request and
            history before applying it to the current version.
          </Text>
          {conflictReady ? (
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
              onPress={() => {
                if (detailId.current) open(detailId.current, true);
                else load();
              }}
            />
          )}
        </SectionCard>
      ) : null}
      {detail ? (
        <>
          <SectionCard title={detail.person.fullName}>
            <PickupStatus state={detail.state} />
            <Text style={styles.body}>
              {detail.person.relationship} · {detail.person.phone}
            </Text>
            <Text style={styles.body}>
              {detail.validFromDate} – {detail.validUntilDate}
            </Text>
            <Text style={styles.body}>{detail.notes}</Text>
            <Text style={styles.body}>
              Last update:{' '}
              {new Date(
                detail.history[detail.history.length - 1]?.at,
              ).toLocaleString()}
            </Text>
            <PickupSafety record={detail} />
            <View style={styles.actions}>
              {detail.capabilities.canEditDraft ? (
                <Button title="Edit draft" disabled={disabled} onPress={edit} />
              ) : null}
              {detail.capabilities.canSubmit && !fields ? (
                <Button
                  title="Submit proposal"
                  disabled={disabled}
                  onPress={() => setConfirm('submit')}
                />
              ) : null}
              {detail.capabilities.canWithdraw ? (
                <Button
                  title="Withdraw proposal"
                  variant="danger"
                  disabled={disabled}
                  onPress={() => setConfirm('withdraw')}
                />
              ) : null}
              {detail.capabilities.canResubmit && !fields ? (
                <Button
                  title="Revise proposal"
                  disabled={disabled}
                  onPress={edit}
                />
              ) : null}
              <Button
                title="Back to pickup history"
                variant="secondary"
                disabled={busy || uncertain}
                onPress={() => {
                  detailId.current = null;
                  setDetail(null);
                  setFields(null);
                  setConfirm(null);
                  setConflict(false);
                  load();
                }}
              />
            </View>
          </SectionCard>
          <PickupHistory detail={detail} />
        </>
      ) : !fields ? (
        <>
          {!loading && page && !page.items.length ? (
            <Text style={styles.body}>No pickup proposals in this view.</Text>
          ) : null}
          {page?.items.map(item => (
            <SectionCard
              key={item.authorizationId}
              title={item.person.fullName}
            >
              <PickupStatus state={item.state} />
              <Text style={styles.body}>
                {item.person.relationship} · {item.validFromDate} –{' '}
                {item.validUntilDate}
              </Text>
              <PickupSafety record={item} />
              <Button
                title={`View ${item.person.fullName}`}
                variant="secondary"
                disabled={busy || uncertain || loading}
                onPress={() => open(item.authorizationId)}
              />
            </SectionCard>
          ))}
          {page?.nextOffset != null ? (
            <Button
              title="Load more pickup proposals"
              disabled={loading || busy || uncertain}
              onPress={() => load(page.nextOffset!)}
            />
          ) : null}
        </>
      ) : null}
      {fields ? (
        <>
          <PickupForm
            fields={fields}
            errors={errors}
            disabled={disabled}
            onChange={setFields}
          />
          <Button
            title={
              detail?.state === 'changes_requested'
                ? 'Resubmit proposal'
                : 'Save draft'
            }
            disabled={
              disabled ||
              (!!detail &&
                !detail.capabilities.canEditDraft &&
                !detail.capabilities.canResubmit)
            }
            onPress={() =>
              detail?.state === 'changes_requested'
                ? setConfirm('resubmit')
                : begin(detail ? 'edit' : 'create')
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
              setError(null);
            }}
          />
        </>
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
              ? 'Withdraw this pending proposal? The school retains its history.'
              : 'Send these proposed details for school review? Submission is not school approval or pickup permission.'}
          </Text>
          <Button
            title={`Confirm ${confirm}`}
            disabled={disabled}
            onPress={() => begin(confirm)}
          />
          <Button
            title="Cancel confirmation"
            variant="secondary"
            onPress={() => setConfirm(null)}
          />
        </SectionCard>
      ) : null}
    </>
  );
}
