import PageIcon from './PageIcon';
import React, { useEffect, useMemo, useState } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { theme as t } from './hiraTheme';

// Fictional conversations are rendered only in the explicitly labelled local preview.
const previewConversations = [
  {
    id: 'preview-thread-teacher',
    name: 'Ms. Sana Ahmed',
    subtitle: 'Class teacher · Preview',
    unread: 2,
    updatedAt: '2026-10-02T10:15:00.000Z',
    messages: [
      { id: 'preview-msg-1', sender: 'them', body: 'Welcome to the messaging preview.', createdAt: '2026-10-02T10:10:00.000Z' },
      { id: 'preview-msg-2', sender: 'me', body: 'Thank you. This is a local sample.', createdAt: '2026-10-02T10:12:00.000Z' },
      { id: 'preview-msg-3', sender: 'them', body: 'No message is sent to the school.', createdAt: '2026-10-02T10:15:00.000Z' },
    ],
  },
  {
    id: 'preview-thread-office',
    name: 'School office',
    subtitle: 'School contact · Preview',
    unread: 0,
    updatedAt: '2026-10-01T08:30:00.000Z',
    messages: [
      { id: 'preview-msg-4', sender: 'them', body: 'This conversation is fictional preview content.', createdAt: '2026-10-01T08:30:00.000Z' },
    ],
  },
];

function shortTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fullTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function Button({ children, onPress, disabled, secondary = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondaryButton,
        disabled && styles.disabled,
        pressed && { opacity: 0.8 },
      ]}
    >
      <Text style={[styles.buttonText, secondary && styles.secondaryButtonText]}>{children}</Text>
    </Pressable>
  );
}

export default function MessagesInbox({ role, previewOnly = false, onNavigate }) {
  const [conversations, setConversations] = useState(
    previewOnly ? previewConversations : [],
  );
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState('');
  const [previewNotice, setPreviewNotice] = useState('');
  const selected = conversations.find((item) => item.id === selectedId);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return conversations.filter((item) =>
      !query || `${item.name} ${item.subtitle} ${item.messages.map((message) => message.body).join(' ')}`.toLowerCase().includes(query),
    );
  }, [conversations, search]);

  useEffect(() => {
    if (!selectedId) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setSelectedId('');
      setDraft('');
      return true;
    });
    return () => subscription.remove();
  }, [selectedId]);

  function openConversation(item) {
    setSelectedId(item.id);
    setDraft('');
    setPreviewNotice('');
    if (previewOnly && item.unread) {
      setConversations((current) => current.map((conversation) =>
        conversation.id === item.id ? { ...conversation, unread: 0 } : conversation,
      ));
    }
  }

  function sendPreviewMessage() {
    const body = draft.trim();
    if (!body || !selected || !previewOnly) return;
    const createdAt = new Date().toISOString();
    setConversations((current) => current.map((conversation) =>
      conversation.id === selected.id
        ? {
            ...conversation,
            updatedAt: createdAt,
            messages: [...conversation.messages, {
              id: `preview-local-${createdAt}`,
              sender: 'me',
              body,
              createdAt,
            }],
          }
        : conversation,
    ));
    setDraft('');
    setPreviewNotice('Saved in this local preview only. Nothing was sent.');
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={styles.eyebrow}>{role.toUpperCase()} · MESSAGES</Text>
        <Text style={styles.title}>{selected ? selected.name : 'Your conversations'}</Text>
        <Text style={styles.subtitle}>
          {selected ? selected.subtitle : 'School conversations in one place'}
        </Text>

        {previewOnly ? (
          <View style={styles.previewBanner}>
            <PageIcon name="sparkle" size={18} />
            <Text style={styles.previewText}>Developer Preview · fictional local messages; nothing is sent.</Text>
          </View>
        ) : null}

        {selected ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to conversations"
              onPress={() => { setSelectedId(''); setDraft(''); }}
              style={styles.back}
            >
              <PageIcon name="chevron" size={18} style={styles.backIcon} />
              <Text style={styles.backText}>All conversations</Text>
            </Pressable>
            <View style={styles.threadHeading}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{selected.name.slice(0, 1)}</Text></View>
              <View style={styles.flex}>
                <Text style={styles.threadName}>{selected.name}</Text>
                <Text style={styles.muted}>{selected.subtitle}</Text>
              </View>
            </View>
            <View style={styles.messageList}>
              {selected.messages.map((message) => {
                const mine = message.sender === 'me';
                return (
                  <View key={message.id} style={[styles.messageRow, mine && styles.mineRow]}>
                    <View style={[styles.bubble, mine ? styles.mineBubble : styles.theirBubble]}>
                      <Text style={[styles.messageText, mine && styles.mineText]}>{message.body}</Text>
                      <Text style={[styles.timestamp, mine && styles.mineTimestamp]}>{fullTime(message.createdAt)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
            {previewNotice ? <Text accessibilityRole="alert" style={styles.previewNotice}>{previewNotice}</Text> : null}
          </>
        ) : (
          <>
            <View style={styles.searchBox}>
              <PageIcon name="search" size={19} />
              <TextInput
                accessibilityLabel="Search conversations"
                placeholder="Search conversations"
                placeholderTextColor={t.muted}
                value={search}
                onChangeText={setSearch}
                style={styles.searchInput}
                returnKeyType="search"
              />
              {search ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearch('')}>
                  <PageIcon name="close" size={18} color={t.muted} />
                </Pressable>
              ) : null}
            </View>
            {previewOnly ? filtered.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`${item.name}${item.unread ? `, ${item.unread} unread` : ''}`}
                onPress={() => openConversation(item)}
                style={styles.conversation}
              >
                <View style={styles.avatar}><Text style={styles.avatarText}>{item.name.slice(0, 1)}</Text></View>
                <View style={styles.conversationCopy}>
                  <View style={styles.conversationTop}>
                    <Text numberOfLines={1} style={styles.threadName}>{item.name}</Text>
                    <Text style={styles.time}>{shortTime(item.updatedAt)}</Text>
                  </View>
                  <View style={styles.conversationBottom}>
                    <Text numberOfLines={1} style={styles.previewMessage}>{item.messages[item.messages.length - 1]?.body}</Text>
                    {item.unread ? <View style={styles.unreadBadge}><Text style={styles.unreadText}>{item.unread}</Text></View> : null}
                  </View>
                </View>
              </Pressable>
            )) : (
              <View style={styles.unavailable}>
                <View style={styles.unavailableIcon}><PageIcon name="message" size={32} /></View>
                <Text style={styles.sectionTitle}>Messaging isn’t available yet</Text>
                <Text style={styles.muted}>
                  No messaging API is connected for this account. No live messages are shown, and sending is disabled.
                </Text>
              </View>
            )}
            {previewOnly && filtered.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.sectionTitle}>No conversations found</Text>
                <Text style={styles.muted}>Try another name or search term.</Text>
              </View>
            ) : null}
          </>
        )}

        <View style={styles.composer}>
          <TextInput
            accessibilityLabel="Write a message"
            placeholder={previewOnly ? 'Write a preview message…' : 'Messaging unavailable'}
            placeholderTextColor={t.muted}
            value={draft}
            onChangeText={setDraft}
            editable={previewOnly && !!selected}
            multiline
            style={[styles.composerInput, !(previewOnly && selected) && styles.composerDisabled]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={previewOnly ? 'Send local preview message' : 'Sending unavailable'}
            accessibilityState={{ disabled: !previewOnly || !selected || !draft.trim() }}
            disabled={!previewOnly || !selected || !draft.trim()}
            onPress={sendPreviewMessage}
            style={({ pressed }) => [styles.send, (!previewOnly || !selected || !draft.trim()) && styles.disabled, pressed && { opacity: 0.8 }]}
          >
            <PageIcon name="message" size={19} color="#FFFFFF" />
          </Pressable>
        </View>
        <Button secondary onPress={() => onNavigate('Home')}>Back to Overview</Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { padding: 18, paddingBottom: 30 },
  eyebrow: { color: t.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1.4 },
  title: { color: t.ink, fontSize: 27, lineHeight: 34, fontWeight: '900', marginTop: 10 },
  subtitle: { color: t.muted, fontSize: 13, lineHeight: 20, marginTop: 7, marginBottom: 16 },
  previewBanner: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, marginBottom: 14, borderRadius: 15, backgroundColor: '#FFF0CF' },
  previewText: { flex: 1, color: '#755518', fontSize: 11, lineHeight: 16, fontWeight: '600' },
  searchBox: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 14, backgroundColor: t.paper, borderWidth: 1, borderColor: t.border, borderRadius: 16, marginBottom: 10 },
  searchInput: { flex: 1, minHeight: 44, color: t.ink, fontSize: 14 },
  conversation: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 82, padding: 13, marginBottom: 8, backgroundColor: t.paper, borderRadius: 19, borderWidth: 1, borderColor: t.border },
  conversationCopy: { flex: 1 },
  conversationTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  conversationBottom: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 7 },
  avatar: { width: 45, height: 45, borderRadius: 16, backgroundColor: t.lavender, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: t.primary, fontSize: 17, fontWeight: '800' },
  threadName: { flex: 1, color: t.ink, fontSize: 14, fontWeight: '800' },
  time: { color: t.muted, fontSize: 10 },
  previewMessage: { flex: 1, color: t.muted, fontSize: 12 },
  unreadBadge: { minWidth: 21, height: 21, borderRadius: 11, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: t.primary },
  unreadText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  unavailable: { alignItems: 'center', padding: 22, marginTop: 8, backgroundColor: t.paper, borderWidth: 1, borderColor: t.border, borderRadius: 23, ...t.shadow },
  unavailableIcon: { width: 62, height: 62, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: t.lavender, marginBottom: 12 },
  sectionTitle: { color: t.ink, fontSize: 16, fontWeight: '800', textAlign: 'center', marginBottom: 7 },
  muted: { color: t.muted, fontSize: 12, lineHeight: 19, textAlign: 'center' },
  empty: { alignItems: 'center', padding: 24 },
  back: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 10, marginBottom: 8 },
  backIcon: { transform: [{ rotate: '180deg' }] },
  backText: { color: t.primary, fontSize: 13, fontWeight: '700' },
  threadHeading: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, marginBottom: 16, backgroundColor: t.paper, borderRadius: 18, borderWidth: 1, borderColor: t.border },
  messageList: { gap: 10, paddingBottom: 12 },
  messageRow: { flexDirection: 'row', justifyContent: 'flex-start' },
  mineRow: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '85%', paddingVertical: 10, paddingHorizontal: 13, borderRadius: 18 },
  theirBubble: { backgroundColor: t.paper, borderWidth: 1, borderColor: t.border, borderTopLeftRadius: 5 },
  mineBubble: { backgroundColor: t.primary, borderTopRightRadius: 5 },
  messageText: { color: t.ink, fontSize: 14, lineHeight: 20 },
  mineText: { color: '#FFFFFF' },
  timestamp: { color: t.muted, fontSize: 9, marginTop: 5 },
  mineTimestamp: { color: '#E1E3FF', textAlign: 'right' },
  previewNotice: { color: '#755518', fontSize: 11, marginBottom: 8, textAlign: 'center' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 9, padding: 8, marginTop: 10, marginBottom: 14, backgroundColor: t.paper, borderWidth: 1, borderColor: t.border, borderRadius: 19 },
  composerInput: { flex: 1, minHeight: 42, maxHeight: 110, paddingHorizontal: 10, paddingTop: 10, color: t.ink, fontSize: 13 },
  composerDisabled: { opacity: 0.6 },
  send: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: t.primary },
  disabled: { opacity: 0.42 },
  button: { alignSelf: 'flex-start', minHeight: 42, paddingHorizontal: 17, paddingVertical: 11, borderRadius: 16, backgroundColor: t.primary, ...t.shadow },
  secondaryButton: { backgroundColor: t.lavender, elevation: 0, shadowOpacity: 0 },
  buttonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  secondaryButtonText: { color: t.primary },
});
