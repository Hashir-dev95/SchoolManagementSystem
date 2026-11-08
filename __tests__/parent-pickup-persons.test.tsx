import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import Screen from '../src/screens/parent/ParentPickupPersonsScreen';
import { Button, WorkspaceTabs } from '../src/components/hiraDashboard';
import { ApiError } from '../src/services/api/apiClient';
import type {
  PickupTransport,
  PickupPage,
  PickupDetail,
  PickupResult,
} from '../src/services/parent/pickupAuthorizationService';
import {
  pickupFields,
  pickupDetail,
  pickupChild,
  pickupResult,
  deferredPickup,
} from './helpers/pickup-fixture';
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
const transport: jest.Mocked<PickupTransport> = {
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
  await press('New pickup proposal');
  for (const [label, value] of [
    ['Full name', pickupFields.fullName],
    ['Relationship', pickupFields.relationship],
    ['Phone', pickupFields.phone],
    ['Valid from', pickupFields.validFromDate],
    ['Valid until', pickupFields.validUntilDate],
    ['Notes (optional)', pickupFields.notes],
  ])
    await change(label, value);
}
async function select(label: string, value: string) {
  await act(async () =>
    tree.root
      .findAllByType(WorkspaceTabs)
      .find(node => node.props.accessibilityLabel === label)!
      .props.onSelect(value),
  );
}
const page = (): PickupPage => ({ items: [pickupDetail()], nextOffset: null });
beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = {
    user: { id: 'parent-A', role: 'parent', branchId: 'branch' },
    accessToken: 'token-A',
    logout: jest.fn().mockResolvedValue(undefined),
  };
  childrenTransport.children
    .mockReset()
    .mockResolvedValue({ items: [pickupChild(), pickupChild('B')] });
  transport.list.mockReset().mockResolvedValue(page());
  transport.detail.mockReset().mockResolvedValue(pickupDetail());
  transport.write.mockReset().mockResolvedValue(pickupResult(pickupDetail()));
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
  expect(output()).toContain('Pickup permission inactive');
  expect(output()).not.toContain('PRIVATE PROPOSAL');
});
test('empty list and pagination respect server offsets', async () => {
  transport.list
    .mockResolvedValueOnce({ items: [], nextOffset: 20 })
    .mockResolvedValueOnce(page());
  await mount();
  expect(output()).toContain('No pickup proposals');
  await press('Load more pickup proposals');
  expect(transport.list).toHaveBeenLastCalledWith(
    'token-A',
    'A',
    20,
    undefined,
  );
});
test('Reviewed uses exact bounded state filters, without downloading all states', async () => {
  await mount();
  await select('Pickup filters', 'Reviewed');
  expect(transport.list).toHaveBeenLastCalledWith(
    'token-A',
    'A',
    0,
    'changes_requested',
  );
  await select('Reviewed states', 'Rejected');
  expect(transport.list).toHaveBeenLastCalledWith(
    'token-A',
    'A',
    0,
    'rejected',
  );
});
test('validates draft fields beside inputs before sending', async () => {
  await mount();
  await press('New pickup proposal');
  await press('Save draft');
  expect(transport.write).not.toHaveBeenCalled();
  expect(output()).toContain('Use 2–100 characters.');
  expect(output()).toContain('valid date');
});
test('creates a draft with exact fields and a stable operation ID', async () => {
  await mount();
  await form();
  await press('Save draft');
  expect(transport.write).toHaveBeenCalledWith('token-A', 'A', {
    kind: 'create',
    body: { ...pickupFields, clientOperationId: 'uuid-1' },
  });
  expect(output()).toContain('School record confirmed');
});
test('draft edit uses both revisions and keeps submitted snapshots read-only', async () => {
  transport.detail.mockResolvedValue(
    pickupDetail({ revision: 3, personRevision: 2 }),
  );
  await mount();
  await press(`View ${pickupFields.fullName}`);
  await press('Edit draft');
  await change('Full name', 'Revised Collector');
  await press('Save draft');
  expect(transport.write).toHaveBeenCalledWith('token-A', 'A', {
    kind: 'edit',
    id: 'proposal-A',
    body: {
      ...pickupFields,
      fullName: 'Revised Collector',
      applicationRevision: 3,
      personRevision: 2,
      clientOperationId: 'uuid-1',
    },
  });
});
test('submission requires confirmation and does not imply school approval', async () => {
  await mount();
  await press(`View ${pickupFields.fullName}`);
  await press('Submit proposal');
  expect(transport.write).not.toHaveBeenCalled();
  expect(output()).toContain('Submission is not school approval');
  await press('Confirm submit');
  expect(transport.write.mock.calls[0][2]).toEqual({
    kind: 'submit',
    id: 'proposal-A',
    body: {
      applicationRevision: 0,
      personRevision: 0,
      clientOperationId: 'uuid-1',
    },
  });
});
function pending() {
  return pickupDetail({
    state: 'pending',
    revision: 1,
    approvalId: 'approval-A',
    reviewVersion: {
      applicationRevision: 1,
      personRevision: 0,
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
  await press(`View ${pickupFields.fullName}`);
  expect(button('Edit draft')).toBeUndefined();
  await press('Withdraw proposal');
  expect(transport.write).not.toHaveBeenCalled();
  await press('Confirm withdraw');
  expect(transport.write.mock.calls[0][2]).toEqual({
    kind: 'withdraw',
    id: 'proposal-A',
    body: {
      applicationRevision: 1,
      personRevision: 0,
      approvalVersion: 0,
      clientOperationId: 'uuid-1',
    },
  });
});
test('changes-requested explanation and resubmission preserve linked identifiers and versions', async () => {
  const changed = pickupDetail({
    ...pending(),
    state: 'changes_requested',
    revision: 2,
    reviewVersion: {
      applicationRevision: 2,
      personRevision: 0,
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
        reason: 'Please revise contact details',
      },
    ],
  });
  transport.detail.mockResolvedValue(changed);
  await mount();
  await press(`View ${pickupFields.fullName}`);
  expect(output()).toContain('Please revise contact details');
  await press('Revise proposal');
  await change('Phone', '+92 300 7654321');
  await press('Resubmit proposal');
  await press('Confirm resubmit');
  expect(transport.write.mock.calls[0][2]).toEqual({
    kind: 'resubmit',
    id: 'proposal-A',
    body: {
      ...pickupFields,
      phone: '+92 300 7654321',
      applicationRevision: 2,
      personRevision: 0,
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
  expect(output()).toContain(pickupFields.notes);
  await press('Retry same operation');
  expect(transport.write.mock.calls[0]).toEqual(transport.write.mock.calls[1]);
  expect(operationId).toHaveBeenCalledTimes(1);
});
test('duplicate taps cannot send two operations or generate a second ID', async () => {
  const waiting = deferredPickup<PickupResult>();
  transport.write.mockReturnValueOnce(waiting.promise);
  await mount();
  await form();
  await act(async () => {
    button('Save draft').props.onPress();
    button('Save draft').props.onPress();
  });
  expect(transport.write).toHaveBeenCalledTimes(1);
  expect(operationId).toHaveBeenCalledTimes(1);
  await act(async () => waiting.resolve(pickupResult(pickupDetail())));
});
test.each([401, 403, 404])(
  'current %s conceals all protected pickup data',
  async status => {
    transport.detail.mockRejectedValueOnce(
      new ApiError(status, 'PRIVATE SERVER ERROR'),
    );
    await mount();
    await press(`View ${pickupFields.fullName}`);
    expect(output()).not.toContain(pickupFields.fullName);
    expect(output()).not.toContain('PRIVATE');
    expect(output()).toContain('unavailable in your current scope');
    expect(mockAuth.logout).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
  },
);
test('409 refreshes versions while retaining the working copy and requiring review', async () => {
  await mount();
  await press(`View ${pickupFields.fullName}`);
  await press('Edit draft');
  await change('Full name', 'Working copy');
  transport.write.mockRejectedValueOnce(new ApiError(409, 'conflict'));
  transport.detail.mockResolvedValueOnce(
    pickupDetail({ revision: 4, personRevision: 3 }),
  );
  await press('Save draft');
  expect(output()).toContain('Working copy');
  expect(button('Save draft').props.disabled).toBe(true);
  await press('Use refreshed versions');
  await press('Save draft');
  expect(transport.write.mock.calls[1][2].body).toEqual(
    expect.objectContaining({
      applicationRevision: 4,
      personRevision: 3,
      fullName: 'Working copy',
      clientOperationId: 'uuid-next',
    }),
  );
});
test('503 routing failure preserves input and never reports success', async () => {
  transport.write.mockRejectedValueOnce(new ApiError(503, 'internal config'));
  await mount();
  await form();
  await press('Save draft');
  expect(output()).toContain('not available for this branch yet');
  expect(output()).toContain(pickupFields.notes);
  expect(output()).not.toContain('School record confirmed');
});
test('child switching fences late detail and late denial from the previous child', async () => {
  const waiting = deferredPickup<PickupDetail>();
  transport.detail.mockReturnValueOnce(waiting.promise);
  await mount();
  await act(async () => {
    button(`View ${pickupFields.fullName}`).props.onPress();
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
    const waiting = deferredPickup<PickupDetail>();
    transport.detail.mockReturnValueOnce(waiting.promise);
    await mount();
    await act(async () => {
      button(`View ${pickupFields.fullName}`).props.onPress();
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
      waiting.resolve(pickupDetail({ notes: 'OLD PRIVATE DETAIL' })),
    );
    expect(output()).not.toContain('OLD PRIVATE DETAIL');
    expect(mockAuth.logout).not.toHaveBeenCalled();
  },
);
test('fresh authorization wins over an older replay receipt', async () => {
  transport.write.mockResolvedValueOnce({
    ...pickupResult(pending()),
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
  expect(output()).toContain('Pickup proposals · Child A');
  expect(transport.list).not.toHaveBeenCalledWith('token-A', 'B', 0, undefined);
  await press('Retry same operation');
  expect(button('Refresh verified children').props.disabled).toBe(false);
});

test('a failed conflict refresh keeps the working copy and retries the same detail ID before enabling versions', async () => {
  await mount();
  await press(`View ${pickupFields.fullName}`);
  await press('Edit draft');
  await change('Full name', 'Retained working copy');
  transport.write.mockRejectedValueOnce(new ApiError(409, 'conflict'));
  transport.detail.mockRejectedValueOnce(new Error('read timeout'));
  await press('Save draft');
  expect(output()).toContain('Retained working copy');
  expect(button('Save draft').props.disabled).toBe(true);
  await press('Refresh changed request');
  expect(transport.detail).toHaveBeenLastCalledWith(
    'token-A',
    'A',
    'proposal-A',
  );
  await press('Use refreshed versions');
  expect(output()).toContain('Retained working copy');
});

test('current denial while refreshing a loaded list clears cached summaries', async () => {
  await mount();
  transport.list.mockRejectedValueOnce(new ApiError(403, 'revoked'));
  await select('Pickup filters', 'Pending');
  expect(output()).not.toContain(pickupFields.fullName);
  expect(output()).toContain('unavailable in your current scope');
});

test('out-of-order child list response cannot replace the newly selected child', async () => {
  const waiting = deferredPickup<PickupPage>();
  transport.list.mockReturnValueOnce(waiting.promise);
  await mount();
  transport.list.mockResolvedValueOnce({ items: [], nextOffset: null });
  await select('Verified children', 'Child B · Grade 8 A · Own Branch');
  await act(async () => waiting.resolve(page()));
  expect(output()).not.toContain(pickupFields.fullName);
  expect(output()).toContain('Pickup proposals · Child B');
});

test('old mutation failure after account switch cannot clear or log out the newer account', async () => {
  const waiting = deferredPickup<PickupResult>();
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
  expect(output()).not.toContain(pickupFields.notes);
});

test('routing-disabled draft exposes no enabled submit action', async () => {
  transport.detail.mockResolvedValueOnce(
    pickupDetail({
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
  await press(`View ${pickupFields.fullName}`);
  expect(button('Submit proposal')).toBeUndefined();
  expect(output()).toContain('not available for this branch yet');
});
