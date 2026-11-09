import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { PrincipalStackParamList } from '../../navigation/PrincipalNavigator';
import { useAuth } from '../../context/AuthContext';
import { ApiError } from '../../services/api/apiClient';
import {
  earlyExitOperationId,
  type EarlyExitPage,
} from '../../services/parent/earlyExitService';
import {
  earlyExitReviewService,
  type EarlyExitDecision,
  type EarlyExitReviewDetail,
  type EarlyExitReviewSummary,
  type EarlyExitReviewTransport,
} from '../../services/principal/earlyExitReviewService';
import {
  EarlyExitSession,
  useEarlyExitLifetime,
  earlyExitDenied,
  earlyExitConflict,
  earlyExitUncertain,
  earlyExitError,
} from '../../hooks/useEarlyExitSession';
import {
  Button,
  DashboardShell,
  DashboardStateCard,
  ScreenHeading,
  SectionCard,
} from '../../components/hiraDashboard';
import {
  EarlyExitHistory,
  EarlyExitSafety,
  EarlyExitStatus,
  styles,
} from '../../components/earlyExit/EarlyExitPresentation';

export default function PrincipalEarlyExitReviewScreen({
  route,
  transport = earlyExitReviewService,
  operationId = earlyExitOperationId,
}: {
  route?: { params?: { approvalId?: string } };
  transport?: EarlyExitReviewTransport;
  operationId?: () => string;
}) {
  const approvalId = route?.params?.approvalId;
  return (
    <EarlyExitSession role="principal">
      {(token, branch) => (
        <ReviewWorkspace
          key={approvalId ?? 'queue'}
          token={token}
          branch={branch}
          approvalId={approvalId}
          transport={transport}
          operationId={operationId}
        />
      )}
    </EarlyExitSession>
  );
}
function ReviewWorkspace({
  token,
  branch,
  approvalId,
  transport,
  operationId,
}: {
  token: string;
  branch: string;
  approvalId?: string;
  transport: EarlyExitReviewTransport;
  operationId: () => string;
}) {
  const navigation =
      useNavigation<NativeStackNavigationProp<PrincipalStackParamList>>(),
    { logout } = useAuth();
  const live = useEarlyExitLifetime(),
    generation = useRef(0),
    sending = useRef(false),
    pending = useRef<EarlyExitDecision | null>(null);
  const [page, setPage] =
      useState<EarlyExitPage<EarlyExitReviewSummary> | null>(null),
    [detail, setDetail] = useState<EarlyExitReviewDetail | null>(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState('');
  const [action, setAction] = useState<EarlyExitDecision['action'] | null>(
      null,
    ),
    [reason, setReason] = useState('');
  const [uncertain, setUncertain] = useState(false),
    [conflict, setConflict] = useState(false),
    [versionsReady, setVersionsReady] = useState(false);
  const conceal = useCallback(
    (failure: unknown) => {
      ++generation.current;
      setPage(null);
      setDetail(null);
      setAction(null);
      setReason('');
      setNotice('');
      pending.current = null;
      setUncertain(false);
      setConflict(false);
      setVersionsReady(false);
      setLoading(false);
      setError(earlyExitError(failure));
      if (failure instanceof ApiError && failure.status === 401)
        logout().catch(() => undefined);
    },
    [logout],
  );
  const load = useCallback(
    async (offset = 0) => {
      const request = ++generation.current;
      setLoading(true);
      setError(null);
      setDetail(null);
      setVersionsReady(false);
      if (!offset) setPage(null);
      try {
        if (approvalId) {
          const data = await transport.detail(token, branch, approvalId);
          if (live.current && request === generation.current) {
            setDetail(data);
            setVersionsReady(true);
          }
        } else {
          const data = await transport.list(token, branch, offset);
          if (live.current && request === generation.current)
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
        }
        return live.current && request === generation.current;
      } catch (failure) {
        if (!live.current || request !== generation.current) return false;
        if (earlyExitDenied(failure)) conceal(failure);
        else setError(earlyExitError(failure));
        return false;
      } finally {
        if (live.current && request === generation.current) setLoading(false);
      }
    },
    [approvalId, branch, conceal, live, token, transport],
  );
  useEffect(() => {
    load();
  }, [load]);
  const execute = async (body: EarlyExitDecision) => {
    if (sending.current || !approvalId || !live.current) return;
    sending.current = true;
    pending.current = body;
    ++generation.current;
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      const data = await transport.decide(token, branch, approvalId, body);
      if (!live.current) return;
      pending.current = null;
      setUncertain(false);
      setAction(null);
      setReason('');
      setConflict(false);
      setDetail(data.request);
      setNotice('School decision confirmed. Current request shown.');
      // Refresh current server capabilities; never use historical receipt state.
      await load();
    } catch (failure) {
      if (!live.current) return;
      if (earlyExitDenied(failure)) conceal(failure);
      else if (earlyExitConflict(failure)) {
        pending.current = null;
        setUncertain(false);
        setConflict(true);
        const refreshed = await load();
        if (live.current && refreshed) setError(earlyExitError(failure));
      } else {
        const unknown = earlyExitUncertain(failure);
        setUncertain(unknown);
        if (!unknown) pending.current = null;
        setError(earlyExitError(failure));
      }
    } finally {
      sending.current = false;
      if (live.current) setBusy(false);
    }
  };
  const confirm = () => {
    if (
      sending.current ||
      pending.current ||
      loading ||
      !detail ||
      !action ||
      !detail.decisionVersion ||
      conflict ||
      uncertain ||
      busy ||
      !detail.capabilities.allowedActions.includes(action)
    )
      return;
    const explanation = reason.normalize('NFC').trim();
    if (explanation.length < 10 || explanation.length > 500) {
      setError('Enter an explanation of 10–500 characters.');
      return;
    }
    try {
      execute({
        ...detail.decisionVersion,
        action,
        decisionReason: explanation,
        clientOperationId: operationId(),
      });
    } catch {
      setError('Secure operation ID unavailable. Use the native app runtime.');
    }
  };
  return (
    <KeyboardAvoidingView
      style={styles.shell}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <DashboardShell keyboardShouldPersistTaps="handled">
        <ScreenHeading
          title="Early Exit Reviews"
          subtitle="Dedicated own-Branch school review · current permissions apply"
        />
        <EarlyExitSafety principal record={detail ?? undefined} />
        {notice ? (
          <Text accessibilityRole="alert" style={styles.body}>
            {notice}
          </Text>
        ) : null}
        <DashboardStateCard
          loading={loading}
          error={error}
          onRetry={async () => {
            if (!sending.current && !pending.current) await load();
          }}
        />
        {!loading && page && !page.items.length ? (
          <Text style={styles.body}>
            No pending Early Exit requests in your permitted queue.
          </Text>
        ) : null}
        {page?.items.map(item => (
          <SectionCard key={item.requestId} title={item.student.fullName}>
            <Text style={styles.body}>
              {item.student.className} {item.student.sectionName} · Requested by{' '}
              {item.requester.fullName}
            </Text>
            <Text style={styles.body}>Exit date: {item.exitDate}</Text>
            <EarlyExitStatus state={item.state} />
            <Button
              title={`Review Early Exit ${item.exitDate}`}
              variant="secondary"
              disabled={loading}
              onPress={() =>
                navigation.navigate('EarlyExitReview', {
                  approvalId: item.approvalId,
                })
              }
            />
          </SectionCard>
        ))}
        {page?.nextOffset != null ? (
          <Button
            title="Load more Early Exit reviews"
            disabled={loading}
            onPress={() => load(page.nextOffset!)}
          />
        ) : null}
        {detail ? (
          <>
            <SectionCard title={detail.student.fullName}>
              <Text style={styles.body}>
                {detail.student.className} {detail.student.sectionName} ·
                Requester: {detail.requester.fullName}
              </Text>
              <EarlyExitStatus state={detail.state} />
              <Text style={styles.label}>Exit date: {detail.exitDate}</Text>
              <Text style={styles.body}>{detail.reason}</Text>
              <Text style={styles.body}>
                Request revision {detail.revision}
              </Text>
            </SectionCard>
            <EarlyExitHistory detail={detail} />
            <SectionCard title="School review">
              <Button
                title="Approve unavailable — school policy required"
                disabled
              />
              <View style={styles.actions}>
                {detail.state === 'pending' && detail.decisionVersion
                  ? detail.capabilities.allowedActions
                      .filter(
                        value =>
                          value === 'reject' || value === 'request_changes',
                      )
                      .map(value => (
                        <Button
                          key={value}
                          title={
                            value === 'reject'
                              ? 'Reject request'
                              : 'Request changes'
                          }
                          variant="secondary"
                          disabled={busy || uncertain || conflict || loading}
                          onPress={() => {
                            setAction(value);
                            setError(null);
                          }}
                        />
                      ))
                  : null}
              </View>
              {action ? (
                <>
                  <Text style={styles.label}>
                    {action === 'reject'
                      ? 'Confirm rejection'
                      : 'Confirm request for changes'}
                  </Text>
                  <Text style={styles.body}>
                    Explain the decision to the Parent (10–500 characters).
                  </Text>
                  <TextInput
                    accessibilityLabel="Decision explanation"
                    multiline
                    editable={!busy && !uncertain}
                    value={reason}
                    onChangeText={setReason}
                    style={[styles.input, styles.notes]}
                  />
                  <Text style={styles.body}>
                    {reason.normalize('NFC').trim().length}/500 characters
                  </Text>
                  <Button
                    title="Confirm Early Exit decision"
                    disabled={
                      busy ||
                      uncertain ||
                      conflict ||
                      loading ||
                      !detail.decisionVersion ||
                      !detail.capabilities.allowedActions.includes(action)
                    }
                    onPress={confirm}
                  />
                  <Button
                    title="Cancel decision"
                    variant="secondary"
                    disabled={busy || uncertain}
                    onPress={() => setAction(null)}
                  />
                </>
              ) : null}
            </SectionCard>
          </>
        ) : null}
        {conflict ? (
          <SectionCard title="Review changed decision">
            <Text style={styles.body}>
              Your explanation is retained. Compare current detail and history
              before using new versions.
            </Text>
            <Button
              title="Use refreshed decision versions"
              disabled={loading || !versionsReady || !detail}
              onPress={() => {
                if (versionsReady && detail) {
                  setConflict(false);
                  setError(null);
                }
              }}
            />
          </SectionCard>
        ) : null}
        {uncertain ? (
          <SectionCard title="Decision unconfirmed">
            <Text style={styles.body}>
              The school may have saved this decision. Retry its identical
              operation.
            </Text>
            <Button
              title="Retry same decision"
              disabled={busy}
              onPress={() => {
                if (pending.current) execute(pending.current);
              }}
            />
          </SectionCard>
        ) : null}
        <Button
          title={
            approvalId
              ? 'Back to Early Exit review queue'
              : 'Refresh Early Exit review queue'
          }
          variant="secondary"
          disabled={busy || uncertain || loading}
          onPress={() => (approvalId ? navigation.goBack() : load())}
        />
      </DashboardShell>
    </KeyboardAvoidingView>
  );
}
