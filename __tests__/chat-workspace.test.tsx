import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import { ChatWorkspace } from '../src/screens/chat/ChatWorkspaceScreen';
import { Button } from '../src/components/hiraDashboard';
import { ApiError } from '../src/services/api/apiClient';
import type {
  ChatConversation,
  ChatHistory,
  ChatMessage,
  ChatPage,
  ChatRecipient,
  ChatTransport,
} from '../src/services/chat/chatService';
import type { User } from '../src/types/auth';
import { useChatWorkspace } from '../src/screens/chat/useChatWorkspace';

let mockUser: User | null, mockToken: string | null;
const mockLogout = jest.fn();
let mockBlur: () => void, mockFocus: () => void;
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    accessToken: mockToken,
    logout: mockLogout,
  }),
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(() => {
      let cleanup = effect();
      mockBlur = () => cleanup();
      mockFocus = () => {
        cleanup = effect();
      };
      return () => cleanup();
    }, [effect]);
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
const recipient = (id: string): ChatRecipient => ({
  userId: `teacher-${id}`,
  displayName: `Teacher ${id}`,
  role: 'teacher',
  relationshipType: 'assigned_teacher',
});
const conversation = (id: string): ChatConversation => ({
  conversationId: id,
  otherParticipant: recipient(id),
  unread: 1,
  createdAt: '2026-11-01T10:00:00Z',
  updatedAt: '2026-11-01T10:00:00Z',
});
const a = conversation('A'),
  b = conversation('B');
const row = (
  id: string,
  sequence = 1,
  extra: Partial<ChatMessage> = {},
): ChatMessage => ({
  messageId: id,
  conversationId: 'A',
  senderUserId: 'teacher-A',
  body: `Private ${id}`,
  sequence,
  createdAt: '2026-11-01T10:00:00Z',
  ownReadAt: null,
  ...extra,
});
const page = <T,>(
  items: T[],
  nextOffset: number | null = null,
  offset = 0,
): ChatPage<T> => ({
  items,
  total: items.length,
  offset,
  limit: 25,
  nextOffset,
});
const history = (
  items: ChatMessage[],
  nextBeforeSequence: number | null = null,
): ChatHistory => ({ items, limit: 50, nextBeforeSequence });
let transport: jest.Mocked<ChatTransport>, operationId: jest.Mock;
let tree: Renderer.ReactTestRenderer | undefined;
const view = () => (
  <ChatWorkspace transport={transport} operationId={operationId} />
);
async function mount(element = view()) {
  await act(async () => {
    tree = Renderer.create(element);
  });
  return tree!;
}
const text = () =>
  JSON.stringify(tree!.toJSON()) +
  '\n' +
  tree!.root
    .findAllByType(Text)
    .map(node => React.Children.toArray(node.props.children).join(''))
    .join(' ');
const button = (title: string) =>
  tree!.root.findAllByType(Button).find(node => node.props.title === title)!;
async function press(title: string) {
  const target = button(title);
  expect(target).toBeDefined();
  expect(target.props.disabled).not.toBe(true);
  await act(async () => {
    target.props.onPress();
  });
}
async function draft(value: string) {
  await act(async () =>
    tree!.root.findByType(TextInput).props.onChangeText(value),
  );
}
async function updateIdentity() {
  await act(async () => {
    tree!.update(view());
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  mockUser = {
    id: 'self',
    fullName: 'Current User',
    email: 'current@test.invalid',
    role: 'student',
    branchId: 'own',
  };
  mockToken = 'token-one';
  mockLogout.mockReset();
  mockLogout.mockResolvedValue(undefined);
  let sequence = 0;
  operationId = jest.fn(
    () => `chat_${(++sequence).toString(16).padStart(32, '0')}`,
  );
  transport = {
    list: jest.fn().mockResolvedValue(page([a, b])),
    recipients: jest.fn().mockResolvedValue(page([recipient('A')])),
    create: jest.fn().mockResolvedValue(a),
    detail: jest
      .fn()
      .mockImplementation(async (_token, id) => conversation(id)),
    history: jest
      .fn()
      .mockImplementation(async (_token, id) =>
        history([row(`history-${id}`, 1, { conversationId: id })]),
      ),
    send: jest
      .fn()
      .mockImplementation(async (_token, id, body) =>
        row('sent', 3, { conversationId: id, body, senderUserId: 'self' }),
      ),
    read: jest.fn().mockImplementation(async (_token, id, messageId) =>
      row(messageId, 1, {
        conversationId: id,
        ownReadAt: '2026-11-03T10:00:00Z',
      }),
    ),
  };
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
});

test.each(['teacher', 'student', 'parent'] as const)(
  '%s uses the same canonical flow and only backend-returned selection',
  async role => {
    mockUser!.role = role;
    await mount();
    await press('Open Teacher A');
    expect(transport.list).toHaveBeenCalledWith('token-one', 0);
    expect(transport.detail).toHaveBeenCalledWith('token-one', 'A');
    expect(transport.history).toHaveBeenCalledWith('token-one', 'A', undefined);
    expect(text()).toContain('Private history-A');
    expect(text()).not.toContain('Private history-B');
  },
);
test('inbox loading, empty, failure and explicit retry are honest', async () => {
  const pending = deferred<ChatPage<ChatConversation>>();
  transport.list.mockReturnValueOnce(pending.promise);
  await mount();
  expect(text()).toContain('Loading conversations');
  await act(async () => pending.reject(new Error('offline')));
  expect(text()).toContain('offline');
  expect(text()).not.toContain('No conversations yet');
  transport.list.mockResolvedValueOnce(page([]));
  await press('Retry inbox');
  expect(text()).toContain('No conversations yet');
});
test('conversation detail must finish before history or composer and can be retried', async () => {
  const pending = deferred<ChatConversation>();
  transport.detail.mockReturnValueOnce(pending.promise);
  await mount();
  await press('Open Teacher A');
  expect(text()).toContain('Loading conversation');
  expect(transport.history).not.toHaveBeenCalled();
  expect(button('Send message').props.disabled).toBe(true);
  await act(async () => pending.reject(new Error('detail offline')));
  expect(text()).toContain('detail offline');
  await press('Refresh conversation');
  expect(text()).toContain('Private history-A');
});
test('history failure has explicit refresh and never renders an empty success', async () => {
  transport.history.mockRejectedValueOnce(new Error('history offline'));
  await mount();
  await press('Open Teacher A');
  expect(text()).toContain('history offline');
  await press('Refresh conversation');
  expect(text()).toContain('Private history-A');
});
test('inbox pagination is explicit and deduplicates overlapping server IDs', async () => {
  transport.list
    .mockResolvedValueOnce(page([a], 25))
    .mockResolvedValueOnce(page([a, b], null, 25));
  await mount();
  expect(transport.list).toHaveBeenCalledTimes(1);
  await press('More conversations');
  expect(transport.list).toHaveBeenLastCalledWith('token-one', 25);
  expect(
    tree!.root
      .findAllByType(Button)
      .filter(node => node.props.title === 'Open Teacher A'),
  ).toHaveLength(1);
  expect(button('Open Teacher B')).toBeDefined();
});
test('recipient chooser pages only canonical contacts and creates then revalidates detail', async () => {
  transport.recipients
    .mockResolvedValueOnce(page([recipient('A')], 25))
    .mockResolvedValueOnce(page([recipient('A'), recipient('B')], null, 25));
  await mount();
  await press('New conversation');
  await press('More contacts');
  expect(transport.recipients.mock.calls).toEqual([
    ['token-one', 0],
    ['token-one', 25],
  ]);
  await press('Message Teacher A');
  expect(transport.create).toHaveBeenCalledWith('token-one', 'teacher-A');
  expect(transport.detail).toHaveBeenCalledWith('token-one', 'A');
  expect(text()).toContain('Private history-A');
  expect(text()).not.toContain('Select Branch');
  expect(text()).not.toContain('Select relationship');
});
test('recipient loading/error/empty retry does not invent contacts', async () => {
  transport.recipients
    .mockRejectedValueOnce(new Error('contacts offline'))
    .mockResolvedValueOnce(page([]));
  await mount();
  await press('New conversation');
  expect(text()).toContain('contacts offline');
  await press('Retry inbox');
  expect(text()).toContain('No available contacts.');
  expect(transport.create).not.toHaveBeenCalled();
});
test('history merges overlapping pages by canonical message ID in sequence order', async () => {
  transport.history
    .mockResolvedValueOnce(history([row('three', 3), row('two', 2)], 2))
    .mockResolvedValueOnce(history([row('two', 2), row('one', 1)]));
  await mount();
  await press('Open Teacher A');
  await press('Load older messages');
  expect(transport.history).toHaveBeenLastCalledWith('token-one', 'A', 2);
  const ids = tree!.root
    .findAll(
      node =>
        typeof node.props.testID === 'string' &&
        node.props.testID.startsWith('message-') &&
        typeof node.type === 'string',
    )
    .map(node => node.props.testID);
  expect(ids).toEqual(['message-one', 'message-two', 'message-three']);
});
test('pending local send becomes one confirmed canonical bubble', async () => {
  const pending = deferred<ChatMessage>();
  transport.send.mockReturnValueOnce(pending.promise);
  await mount();
  await press('Open Teacher A');
  await draft('  New message  ');
  await press('Send message');
  expect(text()).toContain('Sending');
  expect(text()).toContain('pending-1');
  expect(button('Send message').props.disabled).toBe(true);
  await act(async () =>
    pending.resolve(
      row('confirmed', 2, { body: 'New message', senderUserId: 'self' }),
    ),
  );
  expect(text()).not.toContain('pending-1');
  expect(text()).toContain('message-confirmed');
  expect(transport.send).toHaveBeenCalledWith(
    'token-one',
    'A',
    'New message',
    'chat_00000000000000000000000000000001',
  );
});
test('failed send retries immutable body and operation ID, replay/history yields one bubble', async () => {
  const confirmed = row('committed', 2, {
    body: 'Same body',
    senderUserId: 'self',
  });
  transport.send
    .mockRejectedValueOnce(new Error('ack lost'))
    .mockResolvedValueOnce(confirmed);
  transport.history
    .mockResolvedValueOnce(history([]))
    .mockResolvedValueOnce(history([confirmed, confirmed]));
  await mount();
  await press('Open Teacher A');
  await draft('Same body');
  await press('Send message');
  expect(text()).toContain('Delivery unconfirmed');
  await draft('Changed draft');
  expect(tree!.root.findByType(TextInput).props.value).toBe('');
  const callsBefore = transport.history.mock.calls.length;
  await press('Refresh conversation');
  expect(transport.history).toHaveBeenCalledTimes(callsBefore);
  await press('Retry message');
  expect(transport.send.mock.calls[1]).toEqual(transport.send.mock.calls[0]);
  expect(operationId).toHaveBeenCalledTimes(1);
  expect(
    tree!.root.findAll(
      node =>
        typeof node.type === 'string' &&
        node.props.testID === 'message-committed',
    ),
  ).toHaveLength(1);
});
test('new logical sends with identical or changed text get new IDs', async () => {
  await mount();
  await press('Open Teacher A');
  for (const body of ['same', 'same', 'changed']) {
    await draft(body);
    await press('Send message');
  }
  expect(transport.send.mock.calls.map(call => call[2])).toEqual([
    'same',
    'same',
    'changed',
  ]);
  expect(new Set(transport.send.mock.calls.map(call => call[3])).size).toBe(3);
  expect(operationId).toHaveBeenCalledTimes(3);
});
test('unavailable CSPRNG leaves the draft intact and never attempts a send', async () => {
  operationId.mockImplementationOnce(() => {
    throw new Error('Secure message IDs are unavailable.');
  });
  await mount();
  await press('Open Teacher A');
  await draft('retain this draft');
  await press('Send message');
  expect(transport.send).not.toHaveBeenCalled();
  expect(tree!.root.findByType(TextInput).props.value).toBe(
    'retain this draft',
  );
  expect(text()).toContain('Secure message IDs are unavailable.');
  expect(text()).not.toContain('pending-');
});
test('one unresolved send blocks new sends and double-tap retry', async () => {
  const pending = deferred<ChatMessage>();
  transport.send
    .mockRejectedValueOnce(new Error('offline'))
    .mockReturnValueOnce(pending.promise);
  await mount();
  await press('Open Teacher A');
  await draft('one');
  await press('Send message');
  const retry = button('Retry message');
  await act(async () => {
    retry.props.onPress();
    retry.props.onPress();
  });
  expect(transport.send).toHaveBeenCalledTimes(2);
  expect(button('Send message').props.disabled).toBe(true);
});
test.each(['detail', 'history', 'send', 'read'] as const)(
  'late A %s response cannot overwrite B',
  async method => {
    const pending = deferred<never>();
    if (method === 'detail')
      transport.detail.mockReturnValueOnce(pending.promise);
    if (method === 'history')
      transport.history.mockReturnValueOnce(pending.promise);
    await mount();
    await press('Open Teacher A');
    if (method === 'send') {
      transport.send.mockReturnValueOnce(pending.promise);
      await draft('private pending A');
      await press('Send message');
    }
    if (method === 'read') {
      transport.read.mockReturnValueOnce(pending.promise);
      await press('Mark displayed messages read');
    }
    await press('Back to conversations');
    await press('Open Teacher B');
    await act(async () => pending.reject(new ApiError(401, 'stale A failure')));
    expect(text()).toContain('Private history-B');
    expect(text()).not.toContain('stale A failure');
    expect(text()).not.toContain('private pending A');
    expect(mockLogout).not.toHaveBeenCalled();
  },
);
test('late A successful history cannot render B data or alter its loading state', async () => {
  const pending = deferred<ChatHistory>();
  transport.history.mockReturnValueOnce(pending.promise);
  await mount();
  await press('Open Teacher A');
  await press('Back to conversations');
  await press('Open Teacher B');
  await act(async () => pending.resolve(history([row('secret-A')])));
  expect(text()).not.toContain('secret-A');
  expect(text()).toContain('Private history-B');
});
test.each(['detail', 'send', 'read'] as const)(
  'late A successful %s cannot mutate B',
  async method => {
    const pending = deferred<ChatConversation & ChatMessage>();
    if (method === 'detail')
      transport.detail.mockReturnValueOnce(pending.promise);
    await mount();
    await press('Open Teacher A');
    if (method === 'send') {
      transport.send.mockReturnValueOnce(pending.promise);
      await draft('secret send A');
      await press('Send message');
    }
    if (method === 'read') {
      transport.read.mockReturnValueOnce(pending.promise);
      await press('Mark displayed messages read');
    }
    await press('Back to conversations');
    await press('Open Teacher B');
    const calls = transport.list.mock.calls.length;
    await act(async () => pending.resolve({ ...a, ...row('late-secret-A') }));
    expect(text()).toContain('Private history-B');
    expect(text()).not.toContain('late-secret-A');
    expect(text()).not.toContain('secret send A');
    expect(transport.list).toHaveBeenCalledTimes(calls);
  },
);
test.each(['list', 'recipients', 'create'] as const)(
  'stale %s cannot replace another selected conversation',
  async method => {
    const pending = deferred<
      ChatPage<ChatRecipient> & ChatPage<ChatConversation> & ChatConversation
    >();
    await mount();
    if (method === 'list') {
      transport.list.mockReturnValueOnce(pending.promise);
      await press('Refresh inbox');
    } else {
      await press('New conversation');
      if (method === 'recipients') {
        transport.recipients.mockReturnValueOnce(pending.promise);
        await press('Refresh inbox');
      } else {
        transport.create.mockReturnValueOnce(pending.promise);
        await press('Message Teacher A');
      }
    }
    // The navigation-back action stays available during these list/create requests.
    if (method === 'list') {
      await press('New conversation');
    }
    await press('Back to conversations');
    await press('Open Teacher B');
    await act(async () => pending.reject(new ApiError(403, 'obsolete scope')));
    expect(text()).toContain('Private history-B');
    expect(text()).not.toContain('obsolete scope');
  },
);
test.each(['account', 'token', 'role', 'branch', 'logout'] as const)(
  '%s change conceals old identity and fences late success',
  async change => {
    const pending = deferred<ChatHistory>();
    transport.history.mockReturnValueOnce(pending.promise);
    await mount();
    await press('Open Teacher A');
    if (change === 'account') mockUser = { ...mockUser!, id: 'another-user' };
    if (change === 'token') mockToken = 'token-two';
    if (change === 'role') mockUser = { ...mockUser!, role: 'parent' };
    if (change === 'branch')
      mockUser = { ...mockUser!, branchId: 'other-branch' };
    if (change === 'logout') {
      mockUser = null;
      mockToken = null;
    }
    await updateIdentity();
    await act(async () => pending.resolve(history([row('old-user-secret')])));
    expect(text()).not.toContain('old-user-secret');
    expect(text()).not.toContain('Private history-A');
    if (change === 'logout') expect(text()).toContain('Session unavailable');
  },
);
test('current-session 401 calls canonical logout and clears protected state', async () => {
  await mount();
  await press('Open Teacher A');
  await draft('secret');
  transport.send.mockRejectedValueOnce(new ApiError(401, 'expired'));
  await press('Send message');
  expect(mockLogout).toHaveBeenCalledTimes(1);
  expect(text()).not.toContain('Private history-A');
  expect(text()).not.toContain('pending-');
  expect(button('Send message').props.disabled).toBe(true);
});
test('old-token 401 cannot log out the new session', async () => {
  const pending = deferred<ChatPage<ChatConversation>>();
  transport.list.mockReturnValueOnce(pending.promise);
  await mount();
  mockToken = 'new-token';
  await updateIdentity();
  await act(async () => pending.reject(new ApiError(401, 'old token')));
  expect(mockLogout).not.toHaveBeenCalled();
  expect(button('Open Teacher A')).toBeDefined();
});
test.each([403, 404])(
  'send %s conceals history, draft and outbox and prevents further sends',
  async status => {
    await mount();
    await press('Open Teacher A');
    await draft('private text');
    transport.send.mockRejectedValueOnce(new ApiError(status, 'revoked'));
    await press('Send message');
    expect(text()).not.toContain('Private history-A');
    expect(text()).not.toContain('private text');
    expect(text()).not.toContain('pending-');
    expect(button('Send message').props.disabled).toBe(true);
    expect(mockLogout).not.toHaveBeenCalled();
    await press('Back to conversations');
    await press('Open Teacher A');
    expect(transport.detail).toHaveBeenCalledTimes(2);
    expect(text()).toContain('Private history-A');
  },
);
test.each(['detail', 'history', 'read'] as const)(
  '%s authorization loss conceals all protected thread state',
  async method => {
    await mount();
    await press('Open Teacher A');
    await draft('cached draft');
    if (method === 'read') {
      transport.read.mockRejectedValueOnce(new ApiError(404, 'gone'));
      await press('Mark displayed messages read');
    } else {
      transport[method].mockRejectedValueOnce(new ApiError(403, 'revoked'));
      await press('Refresh conversation');
    }
    expect(text()).not.toContain('Private history-A');
    expect(text()).not.toContain('cached draft');
    expect(button('Send message').props.disabled).toBe(true);
  },
);
test.each([403, 404])(
  'older-history %s conceals already rendered data and disables the composer',
  async status => {
    transport.history.mockResolvedValueOnce(
      history([row('cached-history', 2)], 2),
    );
    await mount();
    await press('Open Teacher A');
    await draft('cached secret');
    expect(text()).toContain('Private cached-history');
    transport.history.mockRejectedValueOnce(
      new ApiError(status, 'relationship removed'),
    );
    await press('Load older messages');
    expect(text()).not.toContain('Private cached-history');
    expect(text()).not.toContain('cached secret');
    expect(button('Send message').props.disabled).toBe(true);
  },
);
test('only incoming unread messages get explicit recipient-owned reads, with no render/focus loop', async () => {
  transport.history.mockResolvedValue(
    history([
      row('incoming'),
      row('outgoing', 2, { senderUserId: 'self' }),
      row('already-read', 3, { ownReadAt: '2026-11-01T10:00:00Z' }),
    ]),
  );
  await mount();
  await press('Open Teacher A');
  expect(transport.read).not.toHaveBeenCalled();
  await press('Mark displayed messages read');
  expect(transport.read.mock.calls).toEqual([['token-one', 'A', 'incoming']]);
  expect(text()).toContain('Read by you');
  expect(text()).not.toContain('Seen');
  expect(transport.list).toHaveBeenCalledTimes(2);
  await act(async () => {
    tree!.update(view());
  });
  await act(async () => {
    mockBlur();
    mockFocus();
  });
  expect(text()).toContain('Read by you');
  expect(button('Mark displayed messages read').props.disabled).toBe(true);
  expect(transport.read).toHaveBeenCalledTimes(1);
});
test('read in-flight ledger blocks duplicate taps and failed reads retry only explicitly', async () => {
  const pending = deferred<ChatMessage>();
  transport.read.mockReturnValueOnce(pending.promise);
  await mount();
  await press('Open Teacher A');
  const mark = button('Mark displayed messages read');
  await act(async () => {
    mark.props.onPress();
    mark.props.onPress();
  });
  expect(transport.read).toHaveBeenCalledTimes(1);
  await act(async () => pending.reject(new Error('read offline')));
  expect(text()).toContain('read offline');
  expect(transport.read).toHaveBeenCalledTimes(1);
  await press('Retry read update');
  expect(transport.read).toHaveBeenCalledTimes(2);
});
test('blur invalidates in-flight send; refocus revalidates then retries original identity before history', async () => {
  const pending = deferred<ChatMessage>();
  transport.send.mockReturnValueOnce(pending.promise);
  await mount();
  await press('Open Teacher A');
  await draft('unconfirmed');
  await press('Send message');
  await act(async () => mockBlur());
  await act(async () =>
    pending.resolve(row('late-ack', 2, { body: 'unconfirmed' })),
  );
  await act(async () => mockFocus());
  expect(text()).not.toContain('message-late-ack');
  expect(text()).toContain('Delivery unconfirmed');
  expect(transport.history).toHaveBeenCalledTimes(1);
  expect(transport.detail).toHaveBeenCalledTimes(2);
  await press('Retry message');
  expect(transport.send.mock.calls[1]).toEqual(transport.send.mock.calls[0]);
});
test('request generation ignores an earlier detail failure after a newer refresh', async () => {
  const pending = deferred<ChatConversation>();
  transport.detail.mockReturnValueOnce(pending.promise);
  await mount();
  await press('Open Teacher A');
  // Invoke the real controller refresh via an existing button after its loading
  // state: a new focus is also a new request/authority validation generation.
  await act(async () => {
    mockBlur();
    mockFocus();
  });
  await act(async () => pending.reject(new ApiError(401, 'obsolete detail')));
  expect(text()).toContain('Private history-A');
  expect(mockLogout).not.toHaveBeenCalled();
});
test('controller refuses fabricated conversations/recipients even when called outside UI', async () => {
  let api!: ReturnType<typeof useChatWorkspace>;
  function Probe() {
    api = useChatWorkspace({
      token: 'token-one',
      userId: 'self',
      currentIdentity: () => true,
      logout: mockLogout,
      transport,
      operationId,
    });
    return null;
  }
  await mount(<Probe />);
  await act(async () => {
    await api.open(conversation('foreign'));
    await api.start(recipient('foreign'));
  });
  expect(transport.detail).not.toHaveBeenCalled();
  expect(transport.create).not.toHaveBeenCalled();
  await act(async () => {
    await api.back(true);
    await api.start(recipient('foreign'));
  });
  expect(transport.create).not.toHaveBeenCalled();
});

test('notification target outside the inbox page revalidates detail before history, without fabricated conversation data', async () => {
  const pending = deferred<ChatConversation>();
  transport.detail.mockReturnValueOnce(pending.promise);
  await mount(
    <ChatWorkspace
      conversationId="outside-page"
      transport={transport}
      operationId={operationId}
    />,
  );
  expect(transport.detail).toHaveBeenCalledWith('token-one', 'outside-page');
  expect(transport.list).not.toHaveBeenCalled();
  expect(transport.history).not.toHaveBeenCalled();
  expect(button('Send message').props.disabled).toBe(true);
  await act(async () => pending.resolve(conversation('outside-page')));
  expect(transport.history).toHaveBeenCalledWith(
    'token-one',
    'outside-page',
    undefined,
  );
  expect(text()).toContain('Private history-outside-page');
});
test('notification target detail network failure retries the exact target without relying on inbox membership', async () => {
  transport.detail.mockRejectedValueOnce(new Error('target offline'));
  await mount(
    <ChatWorkspace
      conversationId="outside-page"
      transport={transport}
      operationId={operationId}
    />,
  );
  expect(text()).toContain('target offline');
  expect(transport.history).not.toHaveBeenCalled();
  await press('Refresh conversation');
  expect(transport.detail.mock.calls).toEqual([
    ['token-one', 'outside-page'],
    ['token-one', 'outside-page'],
  ]);
  expect(text()).toContain('Private history-outside-page');
});
test.each([403, 404])(
  'revoked notification target %s never exposes prior protected chat or enables send',
  async status => {
    await mount();
    await press('Open Teacher A');
    await draft('private cached draft');
    transport.detail.mockRejectedValueOnce(
      new ApiError(status, 'revoked after send'),
    );
    await act(async () =>
      tree!.update(
        <ChatWorkspace
          conversationId="revoked"
          transport={transport}
          operationId={operationId}
        />,
      ),
    );
    expect(text()).not.toContain('Private history-A');
    expect(text()).not.toContain('private cached draft');
    expect(button('Send message').props.disabled).toBe(true);
    expect(transport.history).toHaveBeenCalledTimes(1);
  },
);
test('target parameter change fences late detail and hides old outbox until fresh authority succeeds', async () => {
  const pending = deferred<ChatConversation>();
  transport.detail.mockReturnValueOnce(pending.promise);
  await mount(
    <ChatWorkspace
      conversationId="A"
      transport={transport}
      operationId={operationId}
    />,
  );
  await act(async () =>
    tree!.update(
      <ChatWorkspace
        conversationId="B"
        transport={transport}
        operationId={operationId}
      />,
    ),
  );
  await act(async () => pending.resolve(a));
  expect(text()).toContain('Private history-B');
  expect(text()).not.toContain('Private history-A');
  expect(transport.history.mock.calls.map(call => call[1])).toEqual(['B']);
});
test.each(['account', 'token', 'role', 'Branch'] as const)(
  'notification target response after %s switch cannot expose old data',
  async change => {
    const pending = deferred<ChatHistory>();
    transport.history.mockReturnValueOnce(pending.promise);
    const targetView = () => (
      <ChatWorkspace
        conversationId="A"
        transport={transport}
        operationId={operationId}
      />
    );
    await mount(targetView());
    if (change === 'account') mockUser = { ...mockUser!, id: 'other-account' };
    if (change === 'token') mockToken = 'new-token';
    if (change === 'role') mockUser = { ...mockUser!, role: 'parent' };
    if (change === 'Branch')
      mockUser = { ...mockUser!, branchId: 'other-Branch' };
    transport.history.mockResolvedValueOnce(history([]));
    await act(async () => tree!.update(targetView()));
    await act(async () => pending.resolve(history([row('old-target-secret')])));
    expect(text()).not.toContain('old-target-secret');
    expect(mockLogout).not.toHaveBeenCalled();
  },
);
