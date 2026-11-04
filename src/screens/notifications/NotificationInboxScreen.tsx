import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { ApiError } from '../../services/api/apiClient';
import {
  Button,
  DashboardShell,
  DashboardStateCard,
  ScreenHeading,
  SectionCard,
  StatusBadge,
  WorkspaceTabs,
} from '../../components/hiraDashboard';
import { colors, typography } from '../../theme/hiraDashboard';
import {
  inboxOperationId,
  inboxService,
  type InboxNotification,
  type InboxPage,
  type InboxStatus,
  type InboxTransport,
} from '../../services/notifications/inboxService';

const filters = ['All', 'Unread', 'Read'] as const;
const failureMessage = (error: unknown) =>
  error instanceof ApiError && error.status === 401
    ? 'Session unavailable. Sign in again.'
    : error instanceof ApiError && error.status === 403
    ? 'Forbidden: notifications are unavailable in your current scope.'
    : error instanceof ApiError && error.status === 404
    ? 'This notification or linked content is unavailable.'
    : error instanceof Error
    ? error.message
    : 'Could not load notifications. Please retry.';

export default function NotificationInboxScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<{
    navigate: (
      route: 'StudentChat' | 'ParentChat',
      params: { conversationId: string },
    ) => void;
  }>();
  const openReference = (item: InboxNotification) => {
    if (
      item.deepLink?.type !== 'chat_conversation' ||
      !/^[a-fA-F0-9]{24}$/.test(item.deepLink.targetId)
    )
      return false;
    if (user?.role === 'student')
      navigation.navigate('StudentChat', {
        conversationId: item.deepLink.targetId,
      });
    else if (user?.role === 'parent')
      navigation.navigate('ParentChat', {
        conversationId: item.deepLink.targetId,
      });
    else return false;
    return true;
  };
  return (
    <DashboardShell>
      <ScreenHeading
        title="Notifications"
        subtitle="Your school account inbox"
      />
      <NotificationInbox openReference={openReference} />
    </DashboardShell>
  );
}

export function NotificationInbox({
  transport = inboxService,
  openReference,
  operationId = inboxOperationId,
}: {
  transport?: InboxTransport;
  openReference?: (item: InboxNotification) => boolean;
  operationId?: () => string;
}) {
  const { user, accessToken } = useAuth();
  if (!user || !accessToken)
    return <Text style={styles.body}>Session unavailable. Sign in again.</Text>;
  // Remount all data, requests and operation identities on any authority change.
  return (
    <Inbox
      key={JSON.stringify([user.id, user.role, user.branchId, accessToken])}
      token={accessToken}
      transport={transport}
      openReference={openReference}
      operationId={operationId}
    />
  );
}

function Inbox({
  token,
  transport,
  openReference,
  operationId,
}: {
  token: string;
  transport: InboxTransport;
  openReference?: (item: InboxNotification) => boolean;
  operationId: () => string;
}) {
  const generation = useRef(0),
    inFlight = useRef(false);
  const operations = useRef(new Map<string, string>());
  const [status, setStatus] = useState<InboxStatus>('all');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<InboxPage | null>(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    inFlight.current = false;
    setBusy(false);
    setLoading(true);
    setData(null);
    setError(null);
    setUnavailable(false);
    try {
      const page = await transport.list(token, { status, offset, limit: 25 });
      if (request === generation.current) setData(page);
    } catch (failure) {
      if (request === generation.current) setError(failureMessage(failure));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [token, transport, status, offset]);
  useFocusEffect(
    useCallback(() => {
      refresh();
      return () => {
        generation.current += 1;
        inFlight.current = false;
      };
    }, [refresh]),
  );

  const changePage = (next: number) => {
    generation.current += 1;
    setData(null);
    setError(null);
    setOffset(next);
  };
  const markRead = async (item: InboxNotification) => {
    if (inFlight.current || item.readAt) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const request = ++generation.current;
    const operation =
      operations.current.get(item.notificationId) ?? operationId();
    operations.current.set(item.notificationId, operation);
    try {
      await transport.markRead(token, item.notificationId, operation);
      if (request !== generation.current) return;
      // Read-filter membership and count are confirmed by the server, not one page.
      if (offset) changePage(0);
      else await refresh();
    } catch (failure) {
      if (request === generation.current) {
        if (
          failure instanceof ApiError &&
          [401, 403, 404].includes(failure.status)
        )
          setData(null);
        setError(failureMessage(failure));
      }
    } finally {
      if (request === generation.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  };
  const open = async (item: InboxNotification) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setUnavailable(false);
    const request = ++generation.current;
    try {
      const current = await transport.get(token, item.notificationId);
      if (request !== generation.current) return;
      // Only a caller's explicit typed allowlist may navigate. No raw object cache.
      if (!current.deepLink || !openReference?.(current)) setUnavailable(true);
    } catch (failure) {
      if (request === generation.current) {
        if (failure instanceof ApiError && [401, 403].includes(failure.status))
          setData(null);
        setError(failureMessage(failure));
      }
    } finally {
      if (request === generation.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  };
  return (
    <SectionCard
      title={`Notifications${data ? ` · ${data.unread} unread` : ''}`}
    >
      <WorkspaceTabs
        items={filters}
        selected={filters.find(value => value.toLowerCase() === status)!}
        accessibilityLabel="Notification read filter"
        onSelect={value => {
          const next = value.toLowerCase() as InboxStatus;
          if (next !== status) {
            generation.current += 1;
            setData(null);
            setError(null);
            setStatus(next);
            setOffset(0);
          }
        }}
      />
      <DashboardStateCard loading={loading} error={error} onRetry={refresh} />
      {unavailable ? (
        <Text accessibilityRole="alert" style={styles.body}>
          Linked content is unavailable in this inbox.
        </Text>
      ) : null}
      {data?.items.length === 0 ? (
        <Text style={styles.body}>
          {status === 'all'
            ? 'No internal notifications yet.'
            : 'No notifications match this filter.'}
        </Text>
      ) : null}
      {data?.items.map(item => (
        <SectionCard key={item.notificationId} title={item.title}>
          <StatusBadge
            status={item.readAt ? 'paid' : 'pending'}
            label={item.readAt ? 'Read' : 'Unread'}
          />
          <Text style={styles.body}>{item.body}</Text>
          <Text style={styles.muted}>
            {item.category.replaceAll('_', ' ')} ·{' '}
            {new Date(item.availableAt).toLocaleString()}
          </Text>
          {!item.readAt ? (
            <Button
              title={`Mark ${item.title} read`}
              disabled={busy}
              onPress={() => markRead(item)}
            />
          ) : null}
          {item.deepLink ? (
            <Button
              title={`Open ${item.title}`}
              variant="secondary"
              disabled={busy}
              onPress={() => open(item)}
            />
          ) : null}
        </SectionCard>
      ))}
      {data ? (
        <Text style={styles.muted}>
          {data.total
            ? `${offset + 1}–${offset + data.items.length} of ${data.total}`
            : '0 notifications'}
        </Text>
      ) : null}
      {offset > 0 ? (
        <Button
          title="Previous notifications"
          disabled={busy || loading}
          variant="secondary"
          onPress={() => changePage(Math.max(0, offset - 25))}
        />
      ) : null}
      {data?.nextOffset != null ? (
        <Button
          title="Next notifications"
          disabled={busy || loading}
          variant="secondary"
          onPress={() => changePage(data.nextOffset!)}
        />
      ) : null}
      <Button
        title="Retry notification sync"
        variant="secondary"
        onPress={refresh}
      />
    </SectionCard>
  );
}
const styles = StyleSheet.create({
  body: { ...typography.body, color: colors.ink },
  muted: { ...typography.body, color: colors.muted },
});
