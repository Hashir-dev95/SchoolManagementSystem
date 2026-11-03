import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ApiError } from '../../services/api/apiClient';
import {
  chatOperationId,
  chatService,
  type ChatConversation,
  type ChatMessage,
  type ChatRecipient,
  type ChatTransport,
} from '../../services/chat/chatService';

interface PendingSend {
  localId: string;
  conversationId: string;
  operationId: string;
  body: string;
  status: 'pending' | 'failed';
}
interface WorkspaceState {
  mode: 'inbox' | 'recipients' | 'conversation';
  conversations: ChatConversation[];
  recipients: ChatRecipient[];
  nextOffset: number | null;
  recipientOffset: number | null;
  listLoading: boolean;
  listError: string | null;
  selected: ChatConversation | null;
  messages: ChatMessage[];
  nextBefore: number | null;
  loading: boolean;
  error: string | null;
  available: boolean;
  draft: string;
  outbox: PendingSend | null;
  readBusy: boolean;
  readError: string | null;
  creating: boolean;
}
const initial = (): WorkspaceState => ({
  mode: 'inbox',
  conversations: [],
  recipients: [],
  nextOffset: null,
  recipientOffset: null,
  listLoading: true,
  listError: null,
  selected: null,
  messages: [],
  nextBefore: null,
  loading: false,
  error: null,
  available: false,
  draft: '',
  outbox: null,
  readBusy: false,
  readError: null,
  creating: false,
});
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Unable to load messages. Please retry.';
const mergeMessages = (old: ChatMessage[], incoming: ChatMessage[]) => {
  const rows = new Map(old.map(row => [row.messageId, row]));
  incoming.forEach(row =>
    rows.set(row.messageId, {
      ...row,
      ownReadAt: row.ownReadAt ?? rows.get(row.messageId)?.ownReadAt ?? null,
    }),
  );
  return [...rows.values()].sort(
    (a, b) => a.sequence - b.sequence || a.messageId.localeCompare(b.messageId),
  );
};
function workspace(
  token: string,
  userId: string,
  currentIdentity: () => boolean,
  logout: () => Promise<void>,
  transport: ChatTransport,
  operationId: () => string,
  emit: (state: WorkspaceState) => void,
) {
  let state = initial(),
    active = false,
    epoch = 0,
    localSequence = 0;
  const requests = new Map<string, number>();
  const operations = new Map<string, PendingSend>();
  const reads = new Map<string, 'pending' | 'done' | 'failed'>();
  const confirmedReads = new Map<string, string>();
  const update = (patch: Partial<WorkspaceState>) => {
    state = { ...state, ...patch };
    emit(state);
  };
  const usable = () => active && currentIdentity();
  const ticket = (channel: string, conversationId?: string) => {
    const request = (requests.get(channel) ?? 0) + 1;
    requests.set(channel, request);
    return { channel, request, epoch, conversationId };
  };
  type Ticket = ReturnType<typeof ticket>;
  const valid = (t: Ticket) =>
    usable() &&
    t.epoch === epoch &&
    requests.get(t.channel) === t.request &&
    (!t.conversationId || state.selected?.conversationId === t.conversationId);
  const invalidate = () => {
    epoch += 1;
    requests.clear();
    operations.forEach((value, id) => {
      if (value.status === 'pending')
        operations.set(id, { ...value, status: 'failed' });
    });
    // An interrupted read may be retried only by another explicit user action.
    reads.forEach((value, id) => {
      if (value === 'pending') reads.set(id, 'failed');
    });
  };
  const failure = (
    t: Ticket,
    error: unknown,
    field: 'error' | 'listError' | 'readError',
  ) => {
    if (!valid(t)) return;
    if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
      const id = t.conversationId;
      invalidate();
      if (id) operations.delete(id);
      else operations.clear();
      reads.clear();
      confirmedReads.clear();
      update({
        conversations: id
          ? state.conversations.filter(row => row.conversationId !== id)
          : [],
        recipients: [],
        selected: null,
        messages: [],
        draft: '',
        outbox: null,
        nextBefore: null,
        available: false,
        loading: false,
        listLoading: false,
        creating: false,
        readBusy: false,
        readError: null,
        error:
          'This conversation is unavailable. Return to conversations to refresh access.',
        listError:
          state.mode === 'conversation'
            ? null
            : 'Messages are unavailable. Refresh access to retry.',
      });
      if (error.status === 401) logout().catch(() => undefined);
    } else update({ [field]: message(error) });
  };
  const list = async (offset = 0) => {
    if (!usable() || (state.listLoading && requests.has('list'))) return;
    const t = ticket('list');
    update({ listLoading: true, listError: null });
    try {
      const page = await transport.list(token, offset);
      if (!valid(t)) return;
      const rows = new Map(
        (offset ? state.conversations : []).map(row => [
          row.conversationId,
          row,
        ]),
      );
      page.items.forEach(row => rows.set(row.conversationId, row));
      update({
        conversations: [...rows.values()],
        nextOffset: page.nextOffset,
      });
    } catch (error) {
      failure(t, error, 'listError');
    } finally {
      if (valid(t)) update({ listLoading: false });
    }
  };
  const recipients = async (offset = 0) => {
    if (!usable() || (state.listLoading && requests.has('recipients'))) return;
    const t = ticket('recipients');
    update({ listLoading: true, listError: null });
    try {
      const page = await transport.recipients(token, offset);
      if (!valid(t)) return;
      const rows = new Map(
        (offset ? state.recipients : []).map(row => [row.userId, row]),
      );
      page.items.forEach(row => rows.set(row.userId, row));
      update({
        recipients: [...rows.values()],
        recipientOffset: page.nextOffset,
      });
    } catch (error) {
      failure(t, error, 'listError');
    } finally {
      if (valid(t)) update({ listLoading: false });
    }
  };
  const history = async (before?: number) => {
    const id = state.selected?.conversationId;
    if (
      !usable() ||
      !id ||
      !state.available ||
      operations.has(id) ||
      state.loading
    )
      return;
    const t = ticket('history', id);
    update({ loading: true, error: null });
    try {
      const page = await transport.history(token, id, before);
      if (valid(t))
        update({
          messages: mergeMessages(
            state.messages,
            page.items.map(row => ({
              ...row,
              ownReadAt:
                row.ownReadAt ?? confirmedReads.get(row.messageId) ?? null,
            })),
          ),
          nextBefore: page.nextBeforeSequence,
        });
    } catch (error) {
      failure(t, error, 'error');
    } finally {
      if (valid(t)) update({ loading: false });
    }
  };
  const open = async (row: ChatConversation) => {
    if (!usable()) return;
    invalidate();
    update({
      mode: 'conversation',
      selected: row,
      available: false,
      messages: [],
      nextBefore: null,
      draft: '',
      outbox: operations.get(row.conversationId) ?? null,
      loading: true,
      error: null,
      readBusy: false,
      readError: null,
      creating: false,
      listLoading: false,
    });
    const t = ticket('detail', row.conversationId);
    try {
      const detail = await transport.detail(token, row.conversationId);
      if (!valid(t)) return;
      update({ selected: detail, available: true, loading: false });
      // History does not expose operation IDs. Reconcile an unknown send outcome
      // through the exact original send before mixing it with refreshed history.
      if (!operations.has(row.conversationId)) await history();
    } catch (error) {
      failure(t, error, 'error');
    } finally {
      if (valid(t)) update({ loading: false });
    }
  };
  const start = async (row: ChatRecipient) => {
    if (
      !usable() ||
      state.mode !== 'recipients' ||
      state.creating ||
      !state.recipients.some(item => item.userId === row.userId)
    )
      return;
    const t = ticket('create');
    update({ creating: true, listError: null });
    try {
      const result = await transport.create(token, row.userId);
      if (valid(t)) await open(result);
    } catch (error) {
      failure(t, error, 'listError');
    } finally {
      if (valid(t)) update({ creating: false });
    }
  };
  const send = async (retry = false) => {
    const id = state.selected?.conversationId;
    if (!usable() || !id || !state.available || state.loading) return;
    let pending = operations.get(id);
    if (
      pending?.status === 'pending' ||
      (pending && !retry) ||
      (!pending && retry)
    )
      return;
    if (!pending) {
      const body = state.draft.trim();
      if (!body || body.length > 4000) return;
      try {
        pending = {
          localId: `pending-${++localSequence}`,
          conversationId: id,
          operationId: operationId(),
          body,
          status: 'pending',
        };
      } catch (error) {
        update({ error: message(error) });
        return;
      }
    } else pending = { ...pending, status: 'pending' };
    operations.set(id, pending);
    update({ outbox: pending, draft: '', error: null });
    const t = ticket('send', id);
    try {
      const confirmed = await transport.send(
        token,
        id,
        pending.body,
        pending.operationId,
      );
      if (!valid(t)) return;
      operations.delete(id);
      update({
        messages: mergeMessages(state.messages, [confirmed]),
        outbox: null,
      });
      // The same-ID acknowledgement supplies the canonical message ID even if
      // the original request committed but its response was lost.
      await history();
      if (valid(t)) await list();
    } catch (error) {
      if (!valid(t)) return;
      const failed: PendingSend = { ...pending, status: 'failed' };
      operations.set(id, failed);
      update({ outbox: failed });
      failure(t, error, 'error');
    }
  };
  const read = async () => {
    const id = state.selected?.conversationId;
    if (!usable() || !id || !state.available || state.readBusy) return;
    const rows = state.messages.filter(
      row =>
        row.senderUserId !== userId &&
        !row.ownReadAt &&
        !['pending', 'done'].includes(reads.get(row.messageId) ?? ''),
    );
    if (!rows.length) return;
    const t = ticket('read', id);
    rows.forEach(row => reads.set(row.messageId, 'pending'));
    update({ readBusy: true, readError: null });
    for (const row of rows) {
      if (!valid(t)) return;
      try {
        const confirmed = await transport.read(token, id, row.messageId);
        if (!valid(t)) return;
        if (confirmed.ownReadAt)
          confirmedReads.set(confirmed.messageId, confirmed.ownReadAt);
        reads.set(row.messageId, 'done');
        update({ messages: mergeMessages(state.messages, [confirmed]) });
      } catch (error) {
        if (!valid(t)) return;
        reads.set(row.messageId, 'failed');
        failure(t, error, 'readError');
      }
    }
    if (valid(t)) {
      update({ readBusy: false });
      await list();
    }
  };
  const back = async (contacts = false) => {
    if (!usable()) return;
    invalidate();
    update({
      mode: contacts ? 'recipients' : 'inbox',
      selected: null,
      messages: [],
      draft: '',
      outbox: null,
      available: false,
      loading: false,
      error: null,
      readError: null,
      readBusy: false,
      creating: false,
      listLoading: false,
    });
    if (contacts) await recipients();
    else await list();
  };
  return {
    focus: () => {
      active = true;
      invalidate();
      if (state.selected) open(state.selected);
      else if (state.mode === 'recipients') recipients();
      else list();
      return () => {
        active = false;
        invalidate();
        state = {
          ...state,
          messages: [],
          draft: '',
          available: false,
          loading: false,
          listLoading: false,
          outbox: null,
          readBusy: false,
          creating: false,
        };
      };
    },
    open: (row: ChatConversation) => {
      if (
        state.conversations.some(
          item => item.conversationId === row.conversationId,
        )
      )
        return open(row);
    },
    start,
    back,
    send,
    read,
    setDraft: (draft: string) => {
      if (usable() && state.available && !state.outbox) update({ draft });
    },
    refresh: () =>
      state.mode === 'conversation'
        ? state.selected
          ? open(state.selected)
          : back()
        : state.mode === 'recipients'
        ? recipients()
        : list(),
    more: () =>
      state.mode === 'recipients'
        ? state.recipientOffset !== null
          ? recipients(state.recipientOffset)
          : undefined
        : state.nextOffset !== null
        ? list(state.nextOffset)
        : undefined,
    older: () =>
      state.nextBefore !== null ? history(state.nextBefore) : undefined,
  };
}

export function useChatWorkspace(options: {
  token: string;
  userId: string;
  currentIdentity: () => boolean;
  logout: () => Promise<void>;
  transport?: ChatTransport;
  operationId?: () => string;
}) {
  const [state, setState] = useState(initial);
  const controller = useRef<ReturnType<typeof workspace> | null>(null);
  if (!controller.current)
    controller.current = workspace(
      options.token,
      options.userId,
      options.currentIdentity,
      options.logout,
      options.transport ?? chatService,
      options.operationId ?? chatOperationId,
      setState,
    );
  const api = controller.current;
  useFocusEffect(useCallback(() => api.focus(), [api]));
  return { ...state, ...api };
}
