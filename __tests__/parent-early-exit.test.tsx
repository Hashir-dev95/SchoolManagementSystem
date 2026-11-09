import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import Screen from '../src/screens/parent/ParentEarlyExitRequestsScreen';
import {
  Button,
  DashboardStateCard,
  WorkspaceTabs,
} from '../src/components/hiraDashboard';
import { ApiError } from '../src/services/api/apiClient';
import type {
  EarlyExitTransport,
  EarlyExitPage,
  EarlyExitDetail,
  EarlyExitResult,
} from '../src/services/parent/earlyExitService';
import {
  earlyExitFields,
  earlyExitDetail,
  earlyExitChild,
  earlyExitResult,
  deferredEarlyExit,
} from './helpers/early-exit-fixture';
let mockAuth: {
  user: { id: string; role: string; branchId: string } | null;
  accessToken: string | null;
  logout: jest.Mock;
};
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('@react-navigation/native', () => {
  const ReactModule = jest.requireActual('react'),
    FocusContext = ReactModule.createContext(true);
  return {
    FocusContext,
    useFocusEffect: (effect: () => void | (() => void)) => {
      const focused = ReactModule.useContext(FocusContext);
      ReactModule.useEffect(
        () => (focused ? effect() : undefined),
        [effect, focused],
      );
    },
  };
});
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
const { FocusContext } = jest.requireMock('@react-navigation/native');
const transport: jest.Mocked<EarlyExitTransport> = {
  list: jest.fn(),
  detail: jest.fn(),
  write: jest.fn(),
};
const childrenTransport = { children: jest.fn() },
  operationId = jest.fn();
let tree: Renderer.ReactTestRenderer;
const element = (focused = true) => (
  <FocusContext.Provider value={focused}>
    <Screen
      transport={transport}
      childrenTransport={childrenTransport}
      operationId={operationId}
    />
  </FocusContext.Provider>
);
const output = () => JSON.stringify(tree.toJSON());
async function mount() {
  await act(async () => {
    tree = Renderer.create(element());
  });
}
const button = (title: string) =>
  tree.root.findAllByType(Button).find(node => node.props.title === title)!;
async function press(title: string) {
  await act(async () => {
    const node = button(title);
    expect(node).toBeDefined();
    expect(node.props.disabled).not.toBe(true);
    await node.props.onPress();
  });
}
async function change(label: string, value: string) {
  await act(async () =>
    tree.root
      .findAllByType(TextInput)
      .find(node => node.props.accessibilityLabel === label)!
      .props.onChangeText(value),
  );
}
async function form() {
  await press('New Early Exit draft');
  await change('Exit date', earlyExitFields.exitDate);
  await change('Private reason', earlyExitFields.reason);
}
async function select(label: string, value: string) {
  await act(async () =>
    tree.root
      .findAllByType(WorkspaceTabs)
      .find(node => node.props.accessibilityLabel === label)!
      .props.onSelect(value),
  );
}
const page = (): EarlyExitPage => ({
  items: [earlyExitDetail()],
  nextOffset: null,
});
beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = {
    user: { id: 'parent-A', role: 'parent', branchId: 'branch' },
    accessToken: 'token-A',
    logout: jest.fn().mockResolvedValue(undefined),
  };
  childrenTransport.children
    .mockReset()
    .mockResolvedValue({ items: [earlyExitChild(), earlyExitChild('B')] });
  transport.list.mockReset().mockResolvedValue(page());
  transport.detail.mockReset().mockResolvedValue(earlyExitDetail());
  transport.write
    .mockReset()
    .mockResolvedValue(earlyExitResult(earlyExitDetail()));
  operationId
    .mockReset()
    .mockReturnValueOnce('uuid-1')
    .mockReturnValue('uuid-next');
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
});
test('loads only verified child scope, with no operational collection permission', async () => {
  await mount();
  expect(transport.list).toHaveBeenCalledWith('token-A', 'A', 0, undefined);
  expect(output()).toContain('does not authorize the child to leave school');
  expect(output()).not.toContain('PRIVATE EARLY EXIT REASON');
});
test('empty list and pagination respect server offsets', async () => {
  transport.list
    .mockResolvedValueOnce({ items: [], nextOffset: 20 })
    .mockResolvedValueOnce(page());
  await mount();
  expect(output()).toContain('No Early Exit requests');
  await press('Load more Early Exit requests');
  expect(transport.list).toHaveBeenLastCalledWith(
    'token-A',
    'A',
    20,
    undefined,
  );
});
test('history uses exact bounded state filters, without downloading all states', async () => {
  await mount();
  await select('Early Exit filters', 'Changes Requested');
  expect(transport.list).toHaveBeenLastCalledWith(
    'token-A',
    'A',
    0,
    'changes_requested',
  );
  await select('Early Exit filters', 'Rejected');
  expect(transport.list).toHaveBeenLastCalledWith(
    'token-A',
    'A',
    0,
    'rejected',
  );
});
test('validates draft fields beside inputs before sending', async () => {
  await mount();
  await press('New Early Exit draft');
  await press('Save draft');
  expect(transport.write).not.toHaveBeenCalled();
  expect(output()).toContain('private reason of 1–500 characters');
  expect(output()).toContain('valid date');
});
test('creates a draft with exact fields and a stable operation ID', async () => {
  await mount();
  await form();
  await press('Save draft');
  expect(transport.write).toHaveBeenCalledWith('token-A', 'A', {
    kind: 'create',
    body: { ...earlyExitFields, clientOperationId: 'uuid-1' },
  });
  expect(output()).toContain('School record confirmed');
});
test('draft edit uses the current application revision and keeps submitted snapshots read-only', async () => {
  transport.detail.mockResolvedValue(earlyExitDetail({ revision: 3 }));
  await mount();
  await press(`View Draft request ${earlyExitFields.exitDate}`);
  await press('Edit draft');
  await change('Private reason', 'Revised reason');
  await press('Save draft');
  expect(transport.write).toHaveBeenCalledWith('token-A', 'A', {
    kind: 'edit',
    id: 'request-A',
    body: {
      ...earlyExitFields,
      reason: 'Revised reason',
      applicationRevision: 3,
      clientOperationId: 'uuid-1',
    },
  });
});

test('pagination deduplicates repeated request IDs using current rows', async () => {
  transport.list.mockResolvedValueOnce({ items: [earlyExitDetail()], nextOffset: 20 }).mockResolvedValueOnce({ items: [earlyExitDetail(), earlyExitDetail({ requestId: 'request-B', exitDate: '2026-11-13' })], nextOffset: null });
  await mount();
  await press('Load more Early Exit requests');
  expect(tree.root.findAllByType(Button).filter(node => node.props.title === `View Draft request ${earlyExitFields.exitDate}`)).toHaveLength(1);
  expect(button('View Draft request 2026-11-13')).toBeDefined();
});

test.each([401, 403, 404])('current write %s clears private form and summaries', async status => {
  await mount(); await form();
  transport.write.mockRejectedValueOnce(new ApiError(status, 'PRIVATE DENIAL'));
  await press('Save draft');
  expect(output()).not.toContain(earlyExitFields.reason);
  expect(output()).not.toContain('Early Exit · Child A');
  expect(output()).not.toContain('PRIVATE DENIAL');
  expect(mockAuth.logout).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
});

test.each(['account', 'token', 'branch', 'role', 'logout', 'blur'])('loaded private detail is removed on %s change', async kind => {
  await mount(); await press(`View Draft request ${earlyExitFields.exitDate}`);
  expect(output()).toContain(earlyExitFields.reason);
  if (kind === 'account') mockAuth.user = { ...mockAuth.user!, id: 'parent-B' };
  if (kind === 'token') mockAuth.accessToken = 'token-B';
  if (kind === 'branch') mockAuth.user = { ...mockAuth.user!, branchId: 'branch-B' };
  if (kind === 'role') mockAuth.user = { ...mockAuth.user!, role: 'student' };
  if (kind === 'logout') { mockAuth.user = null; mockAuth.accessToken = null; }
  await act(async () => tree.update(element(kind !== 'blur')));
  expect(output()).not.toContain(earlyExitFields.reason);
});
test('submission requires confirmation and does not imply school approval', async () => {
  await mount();
  await press(`View Draft request ${earlyExitFields.exitDate}`);
  await press('Submit request');
  expect(transport.write).not.toHaveBeenCalled();
  expect(output()).toContain('does not authorize your child to leave school');
  await press('Confirm submit');
  expect(transport.write.mock.calls[0][2]).toEqual({
    kind: 'submit',
    id: 'request-A',
    body: {
      applicationRevision: 0,
      clientOperationId: 'uuid-1',
    },
  });
});
function pending() {
  return earlyExitDetail({
    state: 'pending',
    revision: 1,
    approvalId: 'approval-A',
    reviewVersion: {
      applicationRevision: 1,
      approvalVersion: 0,
    },
    capabilities: {
      canEditDraft: false,
      canSubmit: false,
      canWithdraw: true,
      canResubmit: false,
    },
  });
}
test('pending withdrawal requires confirmation and the linked approval version', async () => {
  transport.detail.mockResolvedValue(pending());
  await mount();
  await press(`View Draft request ${earlyExitFields.exitDate}`);
  expect(button('Edit draft')).toBeUndefined();
  await press('Withdraw request');
  expect(transport.write).not.toHaveBeenCalled();
  await press('Confirm withdraw');
  expect(transport.write.mock.calls[0][2]).toEqual({
    kind: 'withdraw',
    id: 'request-A',
    body: {
      applicationRevision: 1,
      approvalVersion: 0,
      clientOperationId: 'uuid-1',
    },
  });
});
test('changes-requested explanation and resubmission preserve linked identifiers and versions', async () => {
  const changed = earlyExitDetail({
    ...pending(),
    state: 'changes_requested',
    revision: 2,
    reviewVersion: {
      applicationRevision: 2,
      approvalVersion: 1,
    },
    capabilities: {
      canEditDraft: false,
      canSubmit: false,
      canWithdraw: false,
      canResubmit: true,
    },
    history: [
      {
        action: 'changes_requested',
        revision: 2,
        at: '2026-11-08T10:00:00Z',
        decisionReason: 'Please revise contact details',
      },
    ],
  });
  transport.detail.mockResolvedValue(changed);
  await mount();
  await press(`View Draft request ${earlyExitFields.exitDate}`);
  expect(output()).toContain('Please revise contact details');
  await press('Revise request');
  await change('Private reason', 'Revised private reason');
  await press('Resubmit request');
  await press('Confirm resubmit');
  expect(transport.write.mock.calls[0][2]).toEqual({
    kind: 'resubmit',
    id: 'request-A',
    body: {
      ...earlyExitFields,
      reason: 'Revised private reason',
      applicationRevision: 2,
      approvalVersion: 1,
      clientOperationId: 'uuid-1',
    },
  });
});
test('uncertain timeout keeps fields and retries byte-equivalent operation without new nonce', async () => {
  transport.write.mockRejectedValueOnce(new Error('timeout'));
  await mount();
  await form();
  await press('Save draft');
  expect(output()).toContain('Operation unconfirmed');
  expect(output()).toContain(earlyExitFields.reason);
  await press('Retry same operation');
  expect(transport.write.mock.calls[0]).toEqual(transport.write.mock.calls[1]);
  expect(operationId).toHaveBeenCalledTimes(1);
});

test('a retained Save callback cannot replace an uncertain command before UI state catches up', async () => {
  transport.write.mockRejectedValueOnce(new Error('timeout'));
  await mount(); await form();
  const retainedSave = button('Save draft').props.onPress;
  await act(async () => { await retainedSave(); });
  await act(async () => { await retainedSave(); });
  expect(transport.write).toHaveBeenCalledTimes(1);
  expect(operationId).toHaveBeenCalledTimes(1);
  await press('Retry same operation');
  expect(transport.write.mock.calls[1]).toEqual(transport.write.mock.calls[0]);
});
test('duplicate taps cannot send two operations or generate a second ID', async () => {
  const waiting = deferredEarlyExit<EarlyExitResult>();
  transport.write.mockReturnValueOnce(waiting.promise);
  await mount();
  await form();
  await act(async () => {
    button('Save draft').props.onPress();
    button('Save draft').props.onPress();
  });
  expect(transport.write).toHaveBeenCalledTimes(1);
  expect(operationId).toHaveBeenCalledTimes(1);
  await act(async () => waiting.resolve(earlyExitResult(earlyExitDetail())));
});
test.each([401, 403, 404])(
  'current %s conceals all protected pickup data',
  async status => {
    transport.detail.mockRejectedValueOnce(
      new ApiError(status, 'PRIVATE SERVER ERROR'),
    );
    await mount();
    await press(`View Draft request ${earlyExitFields.exitDate}`);
    expect(output()).not.toContain(earlyExitFields.reason);
    expect(output()).not.toContain('PRIVATE');
    expect(output()).toContain('unavailable in your current scope');
    expect(mockAuth.logout).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
  },
);
test('409 refreshes versions while retaining the working copy and requiring review', async () => {
  await mount();
  await press(`View Draft request ${earlyExitFields.exitDate}`);
  await press('Edit draft');
  await change('Private reason', 'Working copy');
  transport.write.mockRejectedValueOnce(new ApiError(409, 'conflict'));
  transport.detail.mockResolvedValueOnce(earlyExitDetail({ revision: 4 }));
  await press('Save draft');
  expect(output()).toContain('Working copy');
  expect(button('Save draft').props.disabled).toBe(true);
  await press('Use refreshed versions');
  await press('Save draft');
  expect(transport.write.mock.calls[1][2].body).toEqual(
    expect.objectContaining({
      applicationRevision: 4,
      reason: 'Working copy',
      clientOperationId: 'uuid-next',
    }),
  );
});
test('503 routing failure preserves input and never reports success', async () => {
  transport.write.mockRejectedValueOnce(new ApiError(503, 'internal config'));
  await mount();
  await form();
  await press('Save draft');
  expect(output()).toContain('School review is unavailable');
  expect(output()).toContain(earlyExitFields.reason);
  expect(output()).not.toContain('School record confirmed');
  expect(button('Refresh verified children').props.disabled).toBe(true);
  await press('Retry same operation');
  expect(transport.write.mock.calls[1]).toEqual(transport.write.mock.calls[0]);
  expect(operationId).toHaveBeenCalledTimes(1);
});
test('child switching fences late detail and late denial from the previous child', async () => {
  const waiting = deferredEarlyExit<EarlyExitDetail>();
  transport.detail.mockReturnValueOnce(waiting.promise);
  await mount();
  await act(async () => {
    button(`View Draft request ${earlyExitFields.exitDate}`).props.onPress();
  });
  await select('Verified children', 'Child B · Grade 8 A · Own Branch');
  expect(transport.list).toHaveBeenLastCalledWith('token-A', 'B', 0, undefined);
  await act(async () => waiting.reject(new ApiError(401, 'old denial')));
  expect(mockAuth.logout).not.toHaveBeenCalled();
  expect(output()).toContain('Child B');
});
test.each(['account', 'token', 'branch', 'role', 'logout', 'blur'])(
  '%s switching discards private state and ignores old request',
  async kind => {
    const waiting = deferredEarlyExit<EarlyExitDetail>();
    transport.detail.mockReturnValueOnce(waiting.promise);
    await mount();
    await act(async () => {
      button(`View Draft request ${earlyExitFields.exitDate}`).props.onPress();
    });
    if (kind === 'account')
      mockAuth.user = { ...mockAuth.user!, id: 'parent-B' };
    if (kind === 'token') mockAuth.accessToken = 'token-B';
    if (kind === 'branch')
      mockAuth.user = { ...mockAuth.user!, branchId: 'branch-B' };
    if (kind === 'role') mockAuth.user = { ...mockAuth.user!, role: 'student' };
    if (kind === 'logout') {
      mockAuth.user = null;
      mockAuth.accessToken = null;
    }
    await act(async () => tree.update(element(kind !== 'blur')));
    await act(async () =>
      waiting.resolve(earlyExitDetail({ reason: 'OLD PRIVATE DETAIL' })),
    );
    expect(output()).not.toContain('OLD PRIVATE DETAIL');
    expect(mockAuth.logout).not.toHaveBeenCalled();
  },
);
test('fresh authorization wins over an older replay receipt', async () => {
  transport.write.mockResolvedValueOnce({
    ...earlyExitResult(pending()),
    replayed: true,
    operationState: 'draft',
    operationRevision: 0,
  });
  await mount();
  await form();
  await press('Save draft');
  expect(output()).toContain('Pending');
  expect(button('Edit draft')).toBeUndefined();
});

test('an unconfirmed write cannot be discarded by child refresh or child switching', async () => {
  transport.write.mockRejectedValueOnce(new Error('timeout'));
  await mount();
  await form();
  await press('Save draft');
  expect(button('Refresh verified children').props.disabled).toBe(true);
  await select('Verified children', 'Child B · Grade 8 A · Own Branch');
  expect(output()).toContain('Early Exit · Child A');
  expect(transport.list).not.toHaveBeenCalledWith('token-A', 'B', 0, undefined);
  await press('Retry same operation');
  expect(button('Refresh verified children').props.disabled).toBe(false);
});

test('a failed conflict refresh keeps the working copy and retries the same detail ID before enabling versions', async () => {
  await mount();
  await press(`View Draft request ${earlyExitFields.exitDate}`);
  await press('Edit draft');
  await change('Private reason', 'Retained working copy');
  transport.write.mockRejectedValueOnce(new ApiError(409, 'conflict'));
  transport.detail.mockRejectedValueOnce(new Error('read timeout'));
  await press('Save draft');
  expect(output()).toContain('Retained working copy');
  expect(button('Save draft').props.disabled).toBe(true);
  await press('Refresh changed request');
  expect(transport.detail).toHaveBeenLastCalledWith(
    'token-A',
    'A',
    'request-A',
  );
  await press('Use refreshed versions');
  expect(output()).toContain('Retained working copy');
});

test('current denial while refreshing a loaded list clears cached summaries', async () => {
  await mount();
  transport.list.mockRejectedValueOnce(new ApiError(403, 'revoked'));
  await select('Early Exit filters', 'Pending');
  expect(output()).not.toContain('Early Exit · Child A');
  expect(output()).not.toContain(earlyExitFields.exitDate);
  expect(output()).toContain('unavailable in your current scope');
});

test('out-of-order child list response cannot replace the newly selected child', async () => {
  const waiting = deferredEarlyExit<EarlyExitPage>();
  transport.list.mockReturnValueOnce(waiting.promise);
  await mount();
  transport.list.mockResolvedValueOnce({ items: [], nextOffset: null });
  await select('Verified children', 'Child B · Grade 8 A · Own Branch');
  await act(async () => waiting.resolve(page()));
  expect(output()).not.toContain(earlyExitFields.exitDate);
  expect(output()).toContain('Early Exit · Child B');
});

test('old mutation failure after account switch cannot clear or log out the newer account', async () => {
  const waiting = deferredEarlyExit<EarlyExitResult>();
  transport.write.mockReturnValueOnce(waiting.promise);
  await mount();
  await form();
  await act(async () => {
    button('Save draft').props.onPress();
  });
  mockAuth.user = { ...mockAuth.user!, id: 'parent-B' };
  await act(async () => tree.update(element()));
  await act(async () => waiting.reject(new ApiError(401, 'old mutation')));
  expect(mockAuth.logout).not.toHaveBeenCalled();
  expect(output()).not.toContain(earlyExitFields.reason);
});

test('routing-disabled draft exposes no enabled submit action', async () => {
  transport.detail.mockResolvedValueOnce(
    earlyExitDetail({
      reviewRoutingState: 'unconfigured',
      capabilities: {
        canEditDraft: true,
        canSubmit: false,
        canWithdraw: false,
        canResubmit: false,
      },
    }),
  );
  await mount();
  await press(`View Draft request ${earlyExitFields.exitDate}`);
  expect(button('Submit request')).toBeUndefined();
  expect(output()).toContain('Review routing: unconfigured');
});

test('failed ordinary detail refresh cannot turn a retained draft edit into a new create', async () => {
  await mount();
  await press(`View Draft request ${earlyExitFields.exitDate}`);
  await press('Edit draft');
  await change('Private reason', 'Retained edit');
  transport.write.mockRejectedValueOnce(new ApiError(400, 'Check fields'));
  await press('Save draft');
  transport.detail.mockRejectedValueOnce(new Error('Refresh timed out'));
  await act(async () => {
    await tree.root
      .findAllByType(DashboardStateCard)
      .find(node => node.props.error)!
      .props.onRetry();
  });
  expect(output()).toContain('Retained edit');
  expect(button('Save draft').props.disabled).toBe(true);
  await act(async () => {
    await button('Save draft').props.onPress();
  });
  expect(transport.write).toHaveBeenCalledTimes(1);
  transport.detail.mockResolvedValueOnce(earlyExitDetail({ revision: 3 }));
  await act(async () => {
    await tree.root
      .findAllByType(DashboardStateCard)
      .find(node => node.props.error)!
      .props.onRetry();
  });
  await press('Save draft');
  expect(transport.write.mock.calls[1][2]).toEqual({
    kind: 'edit',
    id: 'request-A',
    body: {
      ...earlyExitFields,
      reason: 'Retained edit',
      applicationRevision: 3,
      clientOperationId: 'uuid-next',
    },
  });
});
