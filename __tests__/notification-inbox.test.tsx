import React from 'react';
import { Text } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import NotificationInboxScreen, {
  NotificationInbox,
} from '../src/screens/notifications/NotificationInboxScreen';
import {
  Button,
  StatusBadge,
  WorkspaceTabs,
} from '../src/components/hiraDashboard';
import { ApiError } from '../src/services/api/apiClient';
import {
  inboxService,
  type InboxNotification,
  type InboxPage,
} from '../src/services/notifications/inboxService';
import type { User } from '../src/types/auth';

let mockUser: User | null;
let mockToken: string | null;
const mockNavigate = jest.fn();
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, accessToken: mockToken }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(effect, [effect]);
  },
}));
jest.mock('../src/services/notifications/inboxService', () => ({
  inboxOperationId: () => 'inbox_read_operation_12345',
  inboxService: { list: jest.fn(), get: jest.fn(), markRead: jest.fn() },
}));
const service = jest.mocked(inboxService);
const item: InboxNotification = {
  notificationId: 'own1',
  category: 'system',
  title: 'School update',
  body: 'Your school account update.',
  priority: 'normal',
  createdAt: '2026-11-01T10:00:00.000Z',
  availableAt: '2026-11-01T10:00:00.000Z',
  readAt: null,
  source: { type: 'system', revision: 1 },
  deepLink: null,
};
const page = (extra: Partial<InboxPage> = {}): InboxPage => ({
  items: [item],
  status: 'all',
  offset: 0,
  limit: 25,
  total: 1,
  unread: 1,
  nextOffset: null,
  ...extra,
});
let trees: Renderer.ReactTestRenderer[] = [];
const contents = (tree: Renderer.ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .map(node => React.Children.toArray(node.props.children).join(''))
    .join(' ');
const mount = async (component = <NotificationInboxScreen />) => {
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(component);
  });
  trees.push(tree);
  return tree;
};
const press = async (tree: Renderer.ReactTestRenderer, title: string) =>
  act(async () => {
    const button = tree.root
      .findAllByType(Button)
      .find(node => node.props.title === title)!;
    expect(button).toBeDefined();
    expect(button.props.disabled).not.toBe(true);
    await button.props.onPress();
  });
const filter = async (tree: Renderer.ReactTestRenderer, value: string) =>
  act(async () => {
    tree.root.findByType(WorkspaceTabs).props.onSelect(value);
  });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = {
    id: 'student1',
    role: 'student',
    fullName: 'Student',
    email: 'own@test.invalid',
    branchId: 'branch1',
  };
  mockToken = 'token1';
  service.list.mockReset().mockResolvedValue(page());
  service.get.mockReset().mockResolvedValue(item);
  service.markRead
    .mockReset()
    .mockResolvedValue({ ...item, readAt: '2026-11-01T11:00:00.000Z' });
});
afterEach(async () =>
  act(async () => {
    trees.splice(0).forEach(tree => tree.unmount());
  }),
);

test('own account renders safe list, canonical count and unread/read indicators without selectors/creation', async () => {
  service.list.mockResolvedValue(
    page({
      items: [
        item,
        {
          ...item,
          notificationId: 'own2',
          title: 'Read update',
          readAt: '2026-11-01T11:00:00.000Z',
        },
      ],
      total: 41,
      unread: 40,
    }),
  );
  const tree = await mount();
  expect(contents(tree)).toContain('40 unread');
  expect(contents(tree)).toContain(item.body);
  expect(
    tree.root.findAllByType(StatusBadge).map(node => node.props.label),
  ).toEqual(['Unread', 'Read']);
  expect(service.list).toHaveBeenCalledWith('token1', {
    status: 'all',
    offset: 0,
    limit: 25,
  });
  expect(
    tree.root
      .findAllByType(Button)
      .map(node => node.props.title)
      .join(' '),
  ).not.toMatch(/create|recipient|child|user id/i);
});
test('empty own inbox has truthful zero state', async () => {
  service.list.mockResolvedValue(page({ items: [], total: 0, unread: 0 }));
  const tree = await mount();
  expect(contents(tree)).toContain('No internal notifications yet.');
  expect(contents(tree)).toContain('0 unread');
});
test('loading hides old data until server response', async () => {
  const pending = deferred<InboxPage>();
  service.list.mockReturnValue(pending.promise);
  const tree = await mount();
  expect(contents(tree)).toContain('Loading');
  expect(contents(tree)).not.toContain(item.body);
  await act(async () => pending.resolve(page()));
  expect(contents(tree)).toContain(item.body);
});
test('page controls replace bounded pages and retain authoritative full-scope unread count', async () => {
  service.list
    .mockResolvedValueOnce(page({ nextOffset: 25, total: 26, unread: 26 }))
    .mockResolvedValueOnce(
      page({
        items: [{ ...item, title: 'Next page' }],
        offset: 25,
        total: 26,
        unread: 26,
      }),
    );
  const tree = await mount();
  await press(tree, 'Next notifications');
  expect(service.list).toHaveBeenLastCalledWith('token1', {
    status: 'all',
    offset: 25,
    limit: 25,
  });
  expect(contents(tree)).toContain('Next page');
  expect(contents(tree)).toContain('26 unread');
  await press(tree, 'Previous notifications');
  expect(service.list).toHaveBeenLastCalledWith('token1', {
    status: 'all',
    offset: 0,
    limit: 25,
  });
});
test('read/unread filters reset pagination and use server count', async () => {
  const tree = await mount();
  await filter(tree, 'Unread');
  expect(service.list).toHaveBeenLastCalledWith('token1', {
    status: 'unread',
    offset: 0,
    limit: 25,
  });
  await filter(tree, 'Read');
  expect(service.list).toHaveBeenLastCalledWith('token1', {
    status: 'read',
    offset: 0,
    limit: 25,
  });
  expect(contents(tree)).toContain('1 unread');
});
test('mark-read waits for confirmation then refreshes membership/count and correct item', async () => {
  const pending = deferred<InboxNotification>();
  service.markRead.mockReturnValue(pending.promise);
  const tree = await mount();
  await act(async () => {
    tree.root
      .findAllByType(Button)
      .find(node => node.props.title === 'Mark School update read')!
      .props.onPress();
  });
  expect(contents(tree)).toContain('1 unread');
  service.list.mockResolvedValue(
    page({
      items: [{ ...item, readAt: '2026-11-01T11:00:00.000Z' }],
      unread: 0,
    }),
  );
  await act(async () =>
    pending.resolve({ ...item, readAt: '2026-11-01T11:00:00.000Z' }),
  );
  expect(service.markRead).toHaveBeenCalledWith(
    'token1',
    'own1',
    'inbox_read_operation_12345',
  );
  expect(contents(tree)).toContain('0 unread');
  expect(
    tree.root
      .findAllByType(Button)
      .some(node => node.props.title === 'Mark School update read'),
  ).toBe(false);
});
test('repeat taps issue one read, and a retry reuses the same operation identity', async () => {
  const pending = deferred<InboxNotification>();
  service.markRead
    .mockReturnValueOnce(pending.promise)
    .mockRejectedValueOnce(new Error('Offline'));
  const tree = await mount();
  await act(async () => {
    const mark = tree.root
      .findAllByType(Button)
      .find(node => node.props.title === 'Mark School update read')!;
    mark.props.onPress();
    mark.props.onPress();
  });
  expect(service.markRead).toHaveBeenCalledTimes(1);
  await act(async () => pending.reject(new Error('Offline')));
  await press(tree, 'Mark School update read');
  expect(service.markRead.mock.calls.map(call => call[2])).toEqual([
    'inbox_read_operation_12345',
    'inbox_read_operation_12345',
  ]);
  expect(contents(tree)).toContain('Offline');
});
for (const [status, text] of [
  [401, 'Session unavailable'],
  [403, 'Forbidden'],
] as const) {
  test(`${status} hides list and presents safe session/scope state`, async () => {
    service.list.mockRejectedValue(
      new ApiError(status, 'private server message'),
    );
    const tree = await mount();
    expect(contents(tree)).toContain(text);
    expect(contents(tree)).not.toContain(item.body);
    expect(contents(tree)).not.toContain('private server message');
  });
}
test('network failure offers retry and successful server recovery', async () => {
  service.list.mockRejectedValueOnce(new Error('Offline'));
  const tree = await mount();
  expect(contents(tree)).toContain('Offline');
  await press(tree, 'Retry notification sync');
  expect(contents(tree)).toContain(item.body);
});
test('late page request cannot overwrite newer filter response', async () => {
  const pending = deferred<InboxPage>();
  service.list
    .mockResolvedValueOnce(page({ nextOffset: 25, total: 26 }))
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(
      page({ items: [{ ...item, title: 'Current unread' }], status: 'unread' }),
    );
  const tree = await mount();
  await act(async () => {
    tree.root
      .findAllByType(Button)
      .find(node => node.props.title === 'Next notifications')!
      .props.onPress();
  });
  await filter(tree, 'Unread');
  await act(async () =>
    pending.resolve(
      page({ items: [{ ...item, title: 'Stale page' }], offset: 25 }),
    ),
  );
  expect(contents(tree)).toContain('Current unread');
  expect(contents(tree)).not.toContain('Stale page');
});
test('late filter response and error cannot overwrite newer selection', async () => {
  const pending = deferred<InboxPage>();
  service.list
    .mockResolvedValueOnce(page())
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(
      page({
        items: [{ ...item, title: 'Current read', readAt: item.createdAt }],
        status: 'read',
      }),
    );
  const tree = await mount();
  await filter(tree, 'Unread');
  await filter(tree, 'Read');
  await act(async () => pending.reject(new Error('Stale filter error')));
  expect(contents(tree)).toContain('Current read');
  expect(contents(tree)).not.toContain('Stale filter error');
});
for (const authority of ['account', 'token', 'role', 'branch'] as const) {
  test(`${authority} switch clears old data and rejects old request`, async () => {
    const pending = deferred<InboxPage>();
    service.list
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(
        page({ items: [{ ...item, title: 'New authority' }] }),
      );
    const tree = await mount();
    if (authority === 'account') mockUser = { ...mockUser!, id: 'student2' };
    if (authority === 'token') mockToken = 'token2';
    if (authority === 'role') mockUser = { ...mockUser!, role: 'parent' };
    if (authority === 'branch')
      mockUser = { ...mockUser!, branchId: 'branch2' };
    await act(async () => tree.update(<NotificationInboxScreen />));
    await act(async () =>
      pending.resolve(page({ items: [{ ...item, title: 'Old authority' }] })),
    );
    expect(contents(tree)).toContain('New authority');
    expect(contents(tree)).not.toContain('Old authority');
  });
}
test('session switch clears already-loaded data immediately and unmount rejects late requests', async () => {
  const tree = await mount();
  expect(contents(tree)).toContain(item.body);
  const pending = deferred<InboxPage>();
  service.list.mockReturnValue(pending.promise);
  mockToken = 'new-token';
  await act(async () => tree.update(<NotificationInboxScreen />));
  expect(contents(tree)).not.toContain(item.body);
  await act(async () => tree.unmount());
  await act(async () => pending.resolve(page()));
});
test('missing session exposes no account data and performs no inbox request', async () => {
  mockUser = null;
  mockToken = null;
  const tree = await mount();
  expect(contents(tree)).toContain('Sign in again');
  expect(service.list).not.toHaveBeenCalled();
});
test('reference is re-fetched, unavailable/unsupported content exposes no cached domain object', async () => {
  const linked: InboxNotification = {
    ...item,
    deepLink: { type: 'attendance_period', targetId: 'occurrence' },
  };
  service.list.mockResolvedValue(page({ items: [linked] }));
  service.get.mockResolvedValue(linked);
  const tree = await mount();
  await press(tree, 'Open School update');
  expect(service.get).toHaveBeenCalledWith('token1', 'own1');
  expect(contents(tree)).toContain('Linked content is unavailable');
  service.get.mockRejectedValue(new ApiError(404, 'foreign source'));
  await press(tree, 'Open School update');
  expect(contents(tree)).toContain(
    'This notification or linked content is unavailable.',
  );
  expect(contents(tree)).not.toContain('foreign source');
});
test('old detail response cannot navigate after token switch', async () => {
  const pending = deferred<InboxNotification>();
  const navigate = jest.fn(() => true);
  service.list.mockResolvedValue(
    page({
      items: [
        { ...item, deepLink: { type: 'inbox_notice', targetId: 'notice1' } },
      ],
    }),
  );
  service.get.mockReturnValue(pending.promise);
  const tree = await mount(<NotificationInbox openReference={navigate} />);
  await act(async () => {
    tree.root
      .findAllByType(Button)
      .find(node => node.props.title === 'Open School update')!
      .props.onPress();
  });
  mockToken = 'token2';
  await act(async () =>
    tree.update(<NotificationInbox openReference={navigate} />),
  );
  await act(async () =>
    pending.resolve({
      ...item,
      deepLink: { type: 'inbox_notice', targetId: 'notice1' },
    }),
  );
  expect(navigate).not.toHaveBeenCalled();
});
test('late mark-read result cannot refresh or alter a new account inbox', async () => {
  const pending = deferred<InboxNotification>();
  service.markRead.mockReturnValue(pending.promise);
  const tree = await mount();
  await act(async () => {
    tree.root
      .findAllByType(Button)
      .find(node => node.props.title === 'Mark School update read')!
      .props.onPress();
  });
  mockUser = { ...mockUser!, id: 'parent2', role: 'parent' };
  mockToken = 'parent-token';
  service.list.mockResolvedValue(
    page({ items: [{ ...item, title: 'Parent own inbox' }], unread: 3 }),
  );
  await act(async () => tree.update(<NotificationInboxScreen />));
  await act(async () => pending.resolve({ ...item, readAt: item.createdAt }));
  expect(service.list).toHaveBeenCalledTimes(2);
  expect(contents(tree)).toContain('Parent own inbox');
  expect(contents(tree)).toContain('3 unread');
});

test.each([
  ['student', 'StudentChat'],
  ['parent', 'ParentChat'],
] as const)(
  '%s opens only a fresh owned chat reference through its existing role route',
  async (role, route) => {
    mockUser = { ...mockUser!, role };
    const targetId = 'abcdef0123456789abcdef01';
    service.list.mockResolvedValue(
      page({
        items: [{ ...item, deepLink: { type: 'chat_conversation', targetId } }],
      }),
    );
    service.get.mockResolvedValue({
      ...item,
      deepLink: { type: 'chat_conversation', targetId },
    });
    const tree = await mount();
    await press(tree, 'Open School update');
    expect(service.get).toHaveBeenCalledWith('token1', 'own1');
    expect(mockNavigate).toHaveBeenCalledWith(route, {
      conversationId: targetId,
    });
    expect(service.markRead).not.toHaveBeenCalled();
  },
);
test('malformed chat targets and other roles do not dispatch arbitrary navigation', async () => {
  service.list.mockResolvedValue(
    page({
      items: [
        {
          ...item,
          deepLink: {
            type: 'chat_conversation',
            targetId: 'abcdef0123456789abcdef01',
          },
        },
      ],
    }),
  );
  service.get.mockResolvedValue({
    ...item,
    deepLink: { type: 'chat_conversation', targetId: 'https://foreign' },
  });
  const tree = await mount();
  await press(tree, 'Open School update');
  expect(mockNavigate).not.toHaveBeenCalled();
  mockUser = { ...mockUser!, role: 'finance' };
  await act(async () => tree.update(<NotificationInboxScreen />));
  service.get.mockResolvedValue({
    ...item,
    deepLink: {
      type: 'chat_conversation',
      targetId: 'abcdef0123456789abcdef01',
    },
  });
  await press(tree, 'Open School update');
  expect(mockNavigate).not.toHaveBeenCalled();
});
test.each(['account', 'token', 'role', 'Branch'] as const)(
  'pending owned chat detail cannot navigate after %s changes',
  async change => {
    service.list.mockResolvedValue(
      page({
        items: [
          {
            ...item,
            deepLink: {
              type: 'chat_conversation',
              targetId: 'abcdef0123456789abcdef01',
            },
          },
        ],
      }),
    );
    const pending = deferred<InboxNotification>();
    service.get.mockReturnValueOnce(pending.promise);
    const tree = await mount();
    await act(async () => {
      tree.root
        .findAllByType(Button)
        .find(node => node.props.title === 'Open School update')!
        .props.onPress();
    });
    if (change === 'account') mockUser = { ...mockUser!, id: 'other-user' };
    if (change === 'token') mockToken = 'new-token';
    if (change === 'role') mockUser = { ...mockUser!, role: 'parent' };
    if (change === 'Branch')
      mockUser = { ...mockUser!, branchId: 'other-branch' };
    await act(async () => tree.update(<NotificationInboxScreen />));
    await act(async () =>
      pending.resolve({
        ...item,
        deepLink: {
          type: 'chat_conversation',
          targetId: 'abcdef0123456789abcdef01',
        },
      }),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  },
);
