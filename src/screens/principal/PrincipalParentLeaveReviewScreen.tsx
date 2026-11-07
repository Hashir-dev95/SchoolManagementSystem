import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Button,
  DashboardShell,
  ListRow,
  ScreenHeading,
  SectionCard,
  StatusBadge,
} from '../../components/hiraDashboard';
import { useParentLeaveReviewRead } from '../../hooks/useParentLeaveReviewRead';
import { useAuth } from '../../context/AuthContext';
import {
  AdminDialog,
  formStyles,
} from '../../components/hiraDashboard/AdminForm';
import { ApiError } from '../../services/api/apiClient';
import { leaveOperationId } from '../../services/parent/leaveApplicationService';
import type { PrincipalStackParamList } from '../../navigation/PrincipalNavigator';
import {
  parentLeaveReviewService,
  type ParentLeaveDecision,
  type ParentLeaveDecisionVersion,
  type ParentLeaveReviewDetail,
} from '../../services/principal/parentLeaveReviewService';

const dateRange = (start: string, end: string) =>
  start === end ? start : `${start} to ${end}`;

export function PrincipalParentLeaveQueue({
  onOpen,
}: {
  onOpen: (approvalId: string) => void;
}) {
  const { data, error, loading, reload } = useParentLeaveReviewRead(
    parentLeaveReviewService.list,
  );
  return (
    <SectionCard title="Parent leave applications">
      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading parent leave" />
      ) : null}
      {error ? (
        <>
          <Text>{error}</Text>
          <Button
            title="Retry parent leave"
            variant="secondary"
            onPress={reload}
          />
        </>
      ) : null}
      {data?.length === 0 ? (
        <Text>No parent leave requests are waiting for review.</Text>
      ) : null}
      {data?.map(request => (
        <ListRow
          key={request.approvalId}
          icon="▤"
          title={request.studentName}
          subtitle={dateRange(request.startDate, request.endDate)}
          right={<StatusBadge status="pending" label="Pending" />}
          onPress={() => onOpen(request.approvalId)}
        />
      ))}
    </SectionCard>
  );
}

const historyLabels: Record<
  ParentLeaveReviewDetail['history'][number]['action'],
  string
> = {
  draft_created: 'Draft created',
  draft_edited: 'Draft edited',
  submitted: 'Submitted for review',
  resubmitted: 'Resubmitted for review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  rejected: 'Rejected',
};

export default function PrincipalParentLeaveReviewScreen({
  route,
}: NativeStackScreenProps<PrincipalStackParamList, 'ParentLeaveReview'>) {
  const { approvalId } = route.params;
  const { user, accessToken } = useAuth();
  const scope = JSON.stringify([
    user?.id,
    user?.role,
    user?.branchId,
    accessToken,
    approvalId,
  ]);
  return <Review key={scope} approvalId={approvalId} token={accessToken} />;
}

function Review({
  approvalId,
  token,
}: {
  approvalId: string;
  token: string | null;
}) {
  const load = useCallback(
    (accessToken: string) =>
      parentLeaveReviewService.detail(accessToken, approvalId),
    [approvalId],
  );
  const { data, error, loading, reload, conceal } = useParentLeaveReviewRead(
    load,
    approvalId,
  );
  const [changed, setChanged] = useState(false);
  return (
    <DashboardShell refreshing={loading} onRefresh={reload}>
      <ScreenHeading
        title="Parent leave review"
        subtitle="Review submitted dates, reasons and decision history."
      />
      {changed && !error ? (
        <Text>The request changed. Review the refreshed status.</Text>
      ) : null}
      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading parent leave detail" />
      ) : null}
      {error ? (
        <SectionCard title="Parent leave unavailable">
          <Text>{error}</Text>
          <Button title="Retry" variant="secondary" onPress={reload} />
        </SectionCard>
      ) : null}
      {data ? (
        <>
          <SectionCard title={data.studentName}>
            <StatusBadge
              status={
                data.status === 'approved'
                  ? 'paid'
                  : data.status === 'rejected'
                  ? 'unpaid'
                  : 'pending'
              }
              label={
                data.status === 'changes_requested'
                  ? 'Changes requested'
                  : data.status.charAt(0).toUpperCase() + data.status.slice(1)
              }
            />
            <ListRow
              icon="▤"
              title={data.leaveType}
              subtitle={dateRange(data.startDate, data.endDate)}
            />
            <Text>{data.reason}</Text>
          </SectionCard>
          <SectionCard title="Request history">
            {data.priorCycles?.map(cycle => (
              <ListRow
                key={`cycle-${cycle.cycle}`}
                icon="▤"
                title={`Submission ${cycle.cycle} · ${cycle.leaveType}`}
                subtitle={[
                  dateRange(cycle.startDate, cycle.endDate),
                  cycle.reason,
                ].join(' · ')}
              />
            ))}
            {data.history.map(event => (
              <ListRow
                key={event.revision}
                icon="•"
                title={historyLabels[event.action]}
                subtitle={[
                  new Date(event.at).toLocaleString('en-PK'),
                  event.decisionReason,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            ))}
          </SectionCard>
          {token && data.decisionVersion && data.status === 'pending' ? (
            <DecisionActions
              token={token}
              approvalId={approvalId}
              version={data.decisionVersion}
              onDenied={conceal}
              onRefresh={conflict => {
                setChanged(conflict);
                reload().catch(() => undefined);
              }}
            />
          ) : null}
        </>
      ) : null}
    </DashboardShell>
  );
}

function DecisionActions({
  token,
  approvalId,
  version,
  onDenied,
  onRefresh,
}: {
  token: string;
  approvalId: string;
  version: ParentLeaveDecisionVersion;
  onDenied: () => void;
  onRefresh: (conflict: boolean) => void;
}) {
  const [action, setAction] = useState<ParentLeaveDecision['action'] | null>(
    null,
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const operation = useRef<ParentLeaveDecision | null>(null);
  const sending = useRef(false);
  const live = useRef(false);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const confirm = async () => {
    if (!action || sending.current) return;
    const decisionReason = reason.trim().normalize('NFC');
    if (
      !operation.current &&
      action !== 'approve' &&
      decisionReason.length < 10
    ) {
      setError(
        action === 'reject'
          ? 'Enter a rejection reason of at least 10 characters.'
          : 'Explain what the Parent should change (at least 10 characters).',
      );
      return;
    }
    try {
      operation.current ??= {
        ...version,
        action,
        clientOperationId: leaveOperationId(),
        ...(action !== 'approve' ? { decisionReason } : {}),
      };
    } catch {
      setError('A secure operation ID is unavailable. Try again.');
      return;
    }
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      await parentLeaveReviewService.decide(
        token,
        approvalId,
        operation.current,
      );
      if (live.current) onRefresh(false);
    } catch (failure) {
      if (!live.current) return;
      if (
        failure instanceof ApiError &&
        [401, 403, 404].includes(failure.status)
      )
        onDenied();
      else if (failure instanceof ApiError && failure.status === 409)
        onRefresh(true);
      else
        setError(
          'Decision could not be confirmed. Retry to check the same operation.',
        );
    } finally {
      sending.current = false;
      if (live.current) setBusy(false);
    }
  };

  const close = () => {
    if (operation.current) onRefresh(false);
    setAction(null);
    setReason('');
    setError('');
  };
  const reject = action === 'reject';
  const requestChanges = action === 'request_changes';
  return (
    <SectionCard title="Decision">
      <View>
        <Button title="Approve leave" onPress={() => setAction('approve')} />
        <Button
          title="Reject leave"
          variant="secondary"
          onPress={() => setAction('reject')}
        />
        <Button
          title="Request changes"
          variant="secondary"
          onPress={() => setAction('request_changes')}
        />
      </View>
      <AdminDialog
        visible={!!action}
        title={
          requestChanges
            ? 'Request changes to parent leave'
            : reject
            ? 'Reject parent leave'
            : 'Approve parent leave'
        }
        onClose={close}
        onConfirm={confirm}
        confirmTitle={
          operation.current && error
            ? 'Retry decision'
            : requestChanges
            ? 'Confirm request for changes'
            : reject
            ? 'Confirm rejection'
            : 'Confirm approval'
        }
        busy={busy}
        busyLabel="Saving leave decision"
        danger={reject}
      >
        <Text style={formStyles.copy}>
          {requestChanges
            ? 'Explain the changes needed before the Parent resubmits.'
            : reject
            ? 'The Parent can read your rejection reason.'
            : 'Approval records leave coverage. Existing attendance marks stay as recorded.'}
        </Text>
        {reject || requestChanges ? (
          <TextInput
            accessibilityLabel={
              requestChanges ? 'Requested changes' : 'Rejection reason'
            }
            value={reason}
            onChangeText={setReason}
            editable={!operation.current && !busy}
            multiline
            maxLength={500}
            style={formStyles.input}
          />
        ) : null}
        {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      </AdminDialog>
    </SectionCard>
  );
}
