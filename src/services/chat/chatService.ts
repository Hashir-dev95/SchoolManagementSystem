import { apiClient } from '../api/apiClient';

export interface ChatRecipient {
  userId: string;
  displayName: string;
  role: 'teacher' | 'student' | 'parent';
  relationshipType: string;
}
export interface ChatConversation {
  conversationId: string;
  otherParticipant: ChatRecipient;
  createdAt: string;
  updatedAt: string;
  unread: number;
}
export interface ChatMessage {
  messageId: string;
  conversationId: string;
  senderUserId: string;
  body: string;
  sequence: number;
  createdAt: string;
  ownReadAt: string | null;
}
export interface ChatPage<T> {
  items: T[];
  offset: number;
  limit: number;
  total: number;
  nextOffset: number | null;
}
export interface ChatHistory {
  items: ChatMessage[];
  limit: number;
  nextBeforeSequence: number | null;
}
export interface ChatTransport {
  recipients(token: string, offset: number): Promise<ChatPage<ChatRecipient>>;
  list(token: string, offset: number): Promise<ChatPage<ChatConversation>>;
  create(token: string, recipientUserId: string): Promise<ChatConversation>;
  detail(token: string, id: string): Promise<ChatConversation>;
  history(token: string, id: string, before?: number): Promise<ChatHistory>;
  send(
    token: string,
    id: string,
    body: string,
    operation: string,
  ): Promise<ChatMessage>;
  read(token: string, id: string, messageId: string): Promise<ChatMessage>;
}

// index.js installs the native polyfill before the application graph is loaded.
// Fail closed in the package's legacy remote-debug fallback mode.
export function chatOperationId(): string {
  const runtime = globalThis as typeof globalThis & {
    RN$Bridgeless?: boolean;
    nativeCallSyncHook?: unknown;
    crypto?: { getRandomValues: (bytes: Uint8Array) => Uint8Array };
  };
  if (
    __DEV__ &&
    runtime.RN$Bridgeless !== true &&
    typeof runtime.nativeCallSyncHook === 'undefined'
  )
    throw new Error('Secure message IDs require the native runtime.');
  if (typeof runtime.crypto?.getRandomValues !== 'function')
    throw new Error('Secure message IDs are unavailable.');
  const bytes = new Uint8Array(16);
  runtime.crypto.getRandomValues(bytes);
  return `chat_${Array.from(bytes, byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('')}`;
}

const request = async <T>(token: string, path: string, body?: unknown) =>
  (
    await apiClient.request<{ success: boolean; data: T }>(`/chat${path}`, {
      token,
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined ? {} : { body }),
    })
  ).data;
const conversation = (id: string) => `/conversations/${encodeURIComponent(id)}`;
export const chatService: ChatTransport = {
  recipients: (token, offset) =>
    request(token, `/me/recipients?offset=${offset}&limit=25`),
  list: (token, offset) =>
    request(token, `/conversations?offset=${offset}&limit=25`),
  create: (token, recipientUserId) =>
    request(token, '/conversations', { recipientUserId }),
  detail: (token, id) => request(token, conversation(id)),
  history: (token, id, before) =>
    request(
      token,
      `${conversation(id)}/messages?limit=50${
        before === undefined ? '' : `&beforeSequence=${before}`
      }`,
    ),
  send: (token, id, body, clientOperationId) =>
    request(token, `${conversation(id)}/messages`, { body, clientOperationId }),
  read: (token, id, messageId) =>
    request(
      token,
      `${conversation(id)}/messages/${encodeURIComponent(messageId)}/read`,
      {},
    ),
};
