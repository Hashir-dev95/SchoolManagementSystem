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
  pickupAuthorizationReviewService,
  type PickupDecision,
  type PickupReviewDetail,
  type PickupReviewSummary,
  type PickupReviewTransport,
} from '../../services/principal/pickupAuthorizationReviewService';
import {
  pickupOperationId,
  type PickupPage,
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
} from '../../components/hiraDashboard';
import {
  PickupSafety,
  PickupStatus,
  PickupHistory,
  pickupStyles as styles,
} from '../../components/pickup/PickupPresentation';

export default function PrincipalPickupAuthorizationReviewScreen({
  route,
  transport = pickupAuthorizationReviewService,
  operationId = pickupOperationId,
}: {
  route?: { params?: { approvalId?: string } };
  transport?: PickupReviewTransport;
  operationId?: () => string;
}) {
  const approvalId = route?.params?.approvalId;
  return (
    <PickupSession role="principal">
      {token => (
        <ReviewWorkspace
          key={approvalId ?? 'queue'}
          token={token}
          approvalId={approvalId}
          transport={transport}
          operationId={operationId}
        />
      )}
    </PickupSession>
  );
}
function ReviewWorkspace({
  token,
  approvalId,
  transport,
  operationId,
}: {
  token: string;
  approvalId?: string;
  transport: PickupReviewTransport;
  operationId: () => string;
}) {
  const navigation =
    useNavigation<NativeStackNavigationProp<PrincipalStackParamList>>();
  const { logout } = useAuth();
  const live = usePickupLifetime(),
    generation = useRef(0),
    sending = useRef(false),
    pending = useRef<PickupDecision | null>(null);
  const [page, setPage] = useState<PickupPage<PickupReviewSummary> | null>(
      null,
    ),
    [detail, setDetail] = useState<PickupReviewDetail | null>(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<PickupDecision['action'] | null>(null),
    [reason, setReason] = useState(''),
    [notice, setNotice] = useState('');
  const [uncertain, setUncertain] = useState(false),
    [conflict, setConflict] = useState(false);
  const conceal = useCallback(
    (failure: unknown) => {
      ++generation.current;
      setPage(null);
      setDetail(null);
      setAction(null);
      setReason('');
      pending.current = null;
      setUncertain(false);
      setLoading(false);
      setError(pickupError(failure));
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
      if (!offset) setPage(null);
      try {
        if (approvalId) {
          const data = await transport.detail(token, approvalId);
          if (live.current && request === generation.current) setDetail(data);
        } else {
          const data = await transport.list(token, offset);
          if (live.current && request === generation.current)
            setPage(previous => ({
              ...data,
              items: offset
                ? [...(previous?.items ?? []), ...data.items]
                : data.items,
            }));
        }
        return live.current && request === generation.current;
      } catch (failure) {
        if (!live.current || request !== generation.current) return;
        if (pickupDenied(failure)) conceal(failure);
        else setError(pickupError(failure));
        return false;
      } finally {
        if (live.current && request === generation.current) setLoading(false);
      }
    },
    [approvalId, conceal, live, token, transport],
  );
  useEffect(() => {
    load();
  }, [load]);
  const execute = async (body: PickupDecision) => {
    if (sending.current || !approvalId || !live.current) return;
    sending.current = true;
    pending.current = body;
    ++generation.current;
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      const result = await transport.decide(token, approvalId, body);
      if (!live.current) return;
      pending.current = null;
      setUncertain(false);
      setAction(null);
      setReason('');
      setConflict(false);
      setDetail(result.authorization);
      setNotice(
        result.replayed
          ? 'Decision operation confirmed. Current school record shown.'
          : 'School decision confirmed.',
      );
      await load();
    } catch (failure) {
      if (!live.current) return;
      if (pickupDenied(failure)) conceal(failure);
      else if (pickupConflict(failure)) {
        pending.current = null;
        setUncertain(false);
        setConflict(true);
        const refreshed = await load();
        if (live.current && refreshed) setError(pickupError(failure));
      } else {
        const unknown = pickupUncertain(failure);
        setUncertain(unknown);
        if (!unknown) pending.current = null;
        setError(pickupError(failure));
      }
    } finally {
      sending.current = false;
      if (live.current) setBusy(false);
    }
  };
  const confirm = () => {
    if (
      sending.current ||
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
          title="Pickup Authorization Reviews"
          subtitle="Dedicated own-Branch review queue · current school permissions apply"
        />
        <PickupSafety record={detail ?? undefined} />
        {notice ? (
          <Text accessibilityRole="alert" style={styles.body}>
            {notice}
          </Text>
        ) : null}
        <DashboardStateCard
          loading={loading}
          error={error}
          onRetry={async () => {
            if (!sending.current) await load();
          }}
        />
        {!loading && page && !page.items.length ? (
          <Text style={styles.body}>
            No pending pickup proposals in your permitted queue.
          </Text>
        ) : null}
        {page?.items.map(item => (
          <SectionCard key={item.authorizationId} title={item.student.fullName}>
            <Text style={styles.body}>
              {item.student.className} {item.student.sectionName} · Requested by{' '}
              {item.requester.fullName}
            </Text>
            <Text style={styles.label}>
              {item.person.fullName} · {item.person.relationship}
            </Text>
            <Text style={styles.body}>
              {item.validFromDate} – {item.validUntilDate}
            </Text>
            <PickupStatus state={item.state} />
            <PickupSafety record={item} />
            {item.approvalId ? (
              <Button
                title={`Review ${item.person.fullName}`}
                variant="secondary"
                disabled={loading}
                onPress={() =>
                  navigation.navigate('PickupAuthorizationReview', {
                    approvalId: item.approvalId,
                  })
                }
              />
            ) : (
              <Text style={styles.body}>
                Review detail unavailable: the school API has not supplied its
                linked review identifier.
              </Text>
            )}
          </SectionCard>
        ))}
        {page?.nextOffset != null ? (
          <Button
            title="Load more pickup reviews"
            disabled={loading}
            onPress={() => load(page.nextOffset!)}
          />
        ) : null}
        {detail ? (
          <>
            <SectionCard title={detail.student.fullName}>
              <Text style={styles.body}>
                {detail.student.className} {detail.student.sectionName} · Branch{' '}
                {detail.student.branchId}
              </Text>
              <Text style={styles.body}>
                Requester: {detail.requester.fullName}
              </Text>
              <Text style={styles.label}>
                {detail.person.fullName} · {detail.person.relationship}
              </Text>
              <Text style={styles.body}>{detail.person.phone}</Text>
              <Text style={styles.body}>
                {detail.validFromDate} – {detail.validUntilDate}
              </Text>
              <Text style={styles.body}>{detail.notes}</Text>
              <Text style={styles.body}>
                Request revision {detail.revision} · Person revision{' '}
                {detail.personRevision}
              </Text>
              <PickupStatus state={detail.state} />
            </SectionCard>
            <PickupHistory detail={detail} />
            <SectionCard title="School review">
              <Button
                title="Approve unavailable — school policy required"
                disabled
              />
              <Text style={styles.body}>
                Identity verification, school custody policy and operational
                pickup activation remain unavailable. Review never confirms
                physical collection.
              </Text>
              <View style={styles.actions}>
                {detail.state === 'pending' && detail.decisionVersion
                  ? detail.capabilities.allowedActions.map(value => (
                      <Button
                        key={value}
                        title={
                          value === 'reject'
                            ? 'Reject proposal'
                            : 'Request changes'
                        }
                        disabled={busy || uncertain || conflict}
                        variant="secondary"
                        onPress={() => {
                          setAction(value);
                          setError(null);
                        }}
                      />
                    ))
                  : null}
              </View>
              {conflict ? (
                <>
                  <Text style={styles.body}>
                    Your explanation is retained. Compare the refreshed request
                    before making a new decision.
                  </Text>
                  <Button
                    title="Review refreshed decision versions"
                    disabled={loading}
                    onPress={() => {
                      setConflict(false);
                      setError(null);
                    }}
                  />
                </>
              ) : null}
              {action ? (
                <>
                  <Text style={styles.label}>
                    {action === 'reject'
                      ? 'Confirm rejection'
                      : 'Confirm request for changes'}
                  </Text>
                  <Text style={styles.body}>
                    Explain this decision to the Parent (10–500 characters).
                  </Text>
                  <TextInput
                    accessibilityLabel="Decision explanation"
                    multiline
                    editable={!busy && !uncertain}
                    value={reason}
                    onChangeText={setReason}
                    style={[styles.input, styles.notes]}
                  />
                  <Button
                    title="Confirm pickup decision"
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
                    title="Cancel pickup decision"
                    variant="secondary"
                    disabled={busy || uncertain}
                    onPress={() => setAction(null)}
                  />
                </>
              ) : null}
            </SectionCard>
          </>
        ) : null}
        {uncertain ? (
          <SectionCard title="Decision unconfirmed">
            <Text style={styles.body}>
              The school may have saved your decision. Retry its identical
              operation safely.
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
              ? 'Back to pickup review queue'
              : 'Refresh pickup review queue'
          }
          variant="secondary"
          disabled={busy || uncertain}
          onPress={() => (approvalId ? navigation.goBack() : load())}
        />
      </DashboardShell>
    </KeyboardAvoidingView>
  );
}
