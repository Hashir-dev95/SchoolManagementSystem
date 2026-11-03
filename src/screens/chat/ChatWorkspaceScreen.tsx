import React, { useRef } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '../../context/AuthContext';
import {
  Button,
  DashboardShell,
  ScreenHeading,
  SectionCard,
  StatusBadge,
} from '../../components/hiraDashboard';
import { colors, typography } from '../../theme/hiraDashboard';
import type { ChatTransport } from '../../services/chat/chatService';
import { useChatWorkspace } from './useChatWorkspace';

export default function ChatWorkspaceScreen() {
  return <ChatWorkspace />;
}

export function ChatWorkspace({
  transport,
  operationId,
}: {
  transport?: ChatTransport;
  operationId?: () => string;
}) {
  const { user, accessToken, logout } = useAuth();
  const identity = JSON.stringify([
    user?.id,
    user?.role,
    user?.branchId,
    accessToken,
  ]);
  const latest = useRef(identity);
  latest.current = identity;
  if (
    !user ||
    !accessToken ||
    !['teacher', 'student', 'parent'].includes(user.role)
  )
    return <Text>Session unavailable. Sign in again.</Text>;
  return (
    <Workspace
      key={identity}
      token={accessToken}
      userId={user.id}
      currentIdentity={() => latest.current === identity}
      logout={logout}
      transport={transport}
      operationId={operationId}
    />
  );
}

function Workspace(props: Parameters<typeof useChatWorkspace>[0]) {
  const chat = useChatWorkspace(props);
  const conversation = chat.mode === 'conversation';
  const contacts = chat.mode === 'recipients';
  const canRead =
    chat.available &&
    chat.messages.some(
      row => row.senderUserId !== props.userId && !row.ownReadAt,
    );
  const loading = conversation ? chat.loading : chat.listLoading;
  const error = conversation ? chat.error : chat.listError;
  return (
    <DashboardShell keyboardShouldPersistTaps="handled">
      <ScreenHeading title="Messages" subtitle="Your school conversations" />
      {conversation ? (
        <>
          <Button
            title="Back to conversations"
            variant="secondary"
            onPress={() => {
              chat.back();
            }}
          />
          <SectionCard
            title={
              chat.selected?.otherParticipant.displayName ??
              'Conversation unavailable'
            }
          >
            {loading ? (
              <View>
                <ActivityIndicator />
                <Text style={styles.body}>Loading conversation…</Text>
              </View>
            ) : null}
            {error ? (
              <Text accessibilityRole="alert" style={styles.body}>
                {error}
              </Text>
            ) : null}
            <Button
              title="Refresh conversation"
              variant="secondary"
              disabled={loading || chat.outbox?.status === 'pending'}
              onPress={() => {
                chat.refresh();
              }}
            />
            {chat.available ? (
              <>
                {!loading && !error && !chat.messages.length && !chat.outbox ? (
                  <Text style={styles.body}>No messages yet.</Text>
                ) : null}
                {chat.nextBefore !== null ? (
                  <Button
                    title="Load older messages"
                    variant="secondary"
                    disabled={loading || !!chat.outbox}
                    onPress={() => {
                      chat.older();
                    }}
                  />
                ) : null}
                {chat.messages.map(row => (
                  <View
                    key={row.messageId}
                    testID={`message-${row.messageId}`}
                    style={styles.message}
                  >
                    <Text style={styles.body}>{row.body}</Text>
                    <Text style={styles.muted}>
                      {row.senderUserId === props.userId
                        ? 'You · Sent'
                        : chat.selected?.otherParticipant.displayName}{' '}
                      · {new Date(row.createdAt).toLocaleString()}
                    </Text>
                    {row.senderUserId !== props.userId && row.ownReadAt ? (
                      <Text style={styles.muted}>Read by you</Text>
                    ) : null}
                  </View>
                ))}
                {chat.outbox ? (
                  <View
                    key={chat.outbox.localId}
                    testID={chat.outbox.localId}
                    style={styles.message}
                    accessibilityLiveRegion="polite"
                  >
                    <Text style={styles.body}>{chat.outbox.body}</Text>
                    <Text style={styles.muted}>
                      {chat.outbox.status === 'pending'
                        ? 'Sending…'
                        : 'Delivery unconfirmed. Retry to confirm before refreshing history.'}
                    </Text>
                    {chat.outbox.status === 'failed' ? (
                      <Button
                        title="Retry message"
                        onPress={() => {
                          chat.send(true);
                        }}
                      />
                    ) : null}
                  </View>
                ) : null}
                {chat.readError ? (
                  <Text accessibilityRole="alert" style={styles.body}>
                    {chat.readError}
                  </Text>
                ) : null}
                <Button
                  title={
                    chat.readError
                      ? 'Retry read update'
                      : 'Mark displayed messages read'
                  }
                  variant="secondary"
                  disabled={!canRead || chat.readBusy || loading}
                  onPress={() => {
                    chat.read();
                  }}
                />
              </>
            ) : null}
            <TextInput
              accessibilityLabel="Message"
              placeholder="Write a message…"
              multiline
              maxLength={4000}
              style={styles.input}
              value={chat.draft}
              onChangeText={chat.setDraft}
              editable={chat.available && !loading && !chat.outbox}
            />
            <Button
              title="Send message"
              disabled={
                !chat.available ||
                loading ||
                !!chat.outbox ||
                !chat.draft.trim()
              }
              onPress={() => {
                chat.send();
              }}
            />
          </SectionCard>
        </>
      ) : (
        <>
          <Button
            title={contacts ? 'Back to conversations' : 'New conversation'}
            variant="secondary"
            onPress={() => {
              chat.back(!contacts);
            }}
          />
          <SectionCard
            title={contacts ? 'Available contacts' : 'Conversations'}
          >
            {loading ? (
              <View>
                <ActivityIndicator />
                <Text style={styles.body}>
                  Loading {contacts ? 'contacts' : 'conversations'}…
                </Text>
              </View>
            ) : null}
            {error ? (
              <Text accessibilityRole="alert" style={styles.body}>
                {error}
              </Text>
            ) : null}
            <Button
              title={error ? 'Retry inbox' : 'Refresh inbox'}
              variant="secondary"
              disabled={loading || chat.creating}
              onPress={() => {
                chat.refresh();
              }}
            />
            {!loading &&
            !error &&
            !(contacts ? chat.recipients.length : chat.conversations.length) ? (
              <Text style={styles.body}>
                {contacts ? 'No available contacts.' : 'No conversations yet.'}
              </Text>
            ) : null}
            {contacts
              ? chat.recipients.map(row => (
                  <View key={row.userId} style={styles.row}>
                    <Text style={styles.body}>{row.displayName}</Text>
                    <Text style={styles.muted}>{row.role}</Text>
                    <Button
                      title={`Message ${row.displayName}`}
                      disabled={chat.creating || loading}
                      onPress={() => {
                        chat.start(row);
                      }}
                    />
                  </View>
                ))
              : chat.conversations.map(row => (
                  <View key={row.conversationId} style={styles.row}>
                    <Text style={styles.body}>
                      {row.otherParticipant.displayName}
                    </Text>
                    <StatusBadge
                      label={row.unread ? `${row.unread} unread` : 'Read'}
                      status={row.unread ? 'pending' : 'paid'}
                    />
                    <Button
                      title={`Open ${row.otherParticipant.displayName}`}
                      disabled={loading}
                      onPress={() => {
                        chat.open(row);
                      }}
                    />
                  </View>
                ))}
            {(contacts ? chat.recipientOffset : chat.nextOffset) !== null ? (
              <Button
                title={contacts ? 'More contacts' : 'More conversations'}
                variant="secondary"
                disabled={loading || chat.creating}
                onPress={() => {
                  chat.more();
                }}
              />
            ) : null}
          </SectionCard>
        </>
      )}
    </DashboardShell>
  );
}
const styles = StyleSheet.create({
  body: { ...typography.body, color: colors.ink, marginVertical: 8 },
  muted: { ...typography.small, color: colors.muted, marginVertical: 4 },
  row: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 12,
    gap: 6,
  },
  message: {
    backgroundColor: colors.cardWarm,
    borderRadius: 12,
    padding: 12,
    marginVertical: 8,
  },
  input: {
    ...typography.body,
    color: colors.ink,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginVertical: 12,
    minHeight: 70,
  },
});
