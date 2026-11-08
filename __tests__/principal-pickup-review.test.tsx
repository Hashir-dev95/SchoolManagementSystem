import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import Screen from '../src/screens/principal/PrincipalPickupAuthorizationReviewScreen';
import { Button } from '../src/components/hiraDashboard';
import { ApiError } from '../src/services/api/apiClient';
import type {
  PickupReviewTransport,
  PickupReviewDetail,
} from '../src/services/principal/pickupAuthorizationReviewService';
import type { PickupResult } from '../src/services/parent/pickupAuthorizationService';
import {
  pickupFields,
  pickupReview,
  pickupResult,
  deferredPickup,
} from './helpers/pickup-fixture';
let mockAuth: {
  user: { id: string; role: string; branchId: string } | null;
  accessToken: string | null;
  logout: jest.Mock;
};
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('@react-navigation/native', () => {
  const ReactModule = jest.requireActual('react'),
    FocusContext = ReactModule.createContext(true);
  return {
    FocusContext,
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
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
const transport: jest.Mocked<PickupReviewTransport> = {
    list: jest.fn(),
    detail: jest.fn(),
    decide: jest.fn(),
  },
  operationId = jest.fn();
let tree: Renderer.ReactTestRenderer;
const element = (id?: string, focused = true) => (
  <FocusContext.Provider value={focused}>
    <Screen
      route={{ params: { approvalId: id } }}
      transport={transport}
      operationId={operationId}
    />
  </FocusContext.Provider>
);
const output = () => JSON.stringify(tree.toJSON());
async function mount(id?: string) {
  await act(async () => {
    tree = Renderer.create(element(id));
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
async function reason(value = 'The proposed details need school review.') {
  await act(async () =>
    tree.root.findByType(TextInput).props.onChangeText(value),
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = {
    user: { id: 'principal-A', role: 'principal', branchId: 'branch' },
    accessToken: 'token-A',
    logout: jest.fn().mockResolvedValue(undefined),
  };
  transport.list
    .mockReset()
    .mockResolvedValue({ items: [pickupReview()], nextOffset: null });
  transport.detail.mockReset().mockResolvedValue(pickupReview());
  transport.decide.mockReset().mockResolvedValue(
    pickupResult(
      pickupReview({
        state: 'rejected',
        decisionVersion: null,
        capabilities: { allowedActions: [], canApprove: false },
      }),
    ),
  );
  operationId
    .mockReset()
    .mockReturnValueOnce('review-uuid')
    .mockReturnValue('review-next');
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
});
test('dedicated typed queue shows safe context and navigates using the canonical approval ID', async () => {
  await mount();
  expect(transport.list).toHaveBeenCalledWith('token-A', 0);
  expect(output()).toContain('Child A');
  expect(output()).toContain('Parent A');
  expect(output()).not.toContain(pickupFields.notes);
  await press(`Review ${pickupFields.fullName}`);
  expect(mockNavigate).toHaveBeenCalledWith('PickupAuthorizationReview', {
    approvalId: 'approval-A',
  });
});
test('queue pagination requests only the returned offset', async () => {
  transport.list.mockResolvedValueOnce({ items: [], nextOffset: 20 });
  await mount();
  await press('Load more pickup reviews');
  expect(transport.list).toHaveBeenLastCalledWith('token-A', 20);
});

test('typed detail back action returns through the existing native navigation stack', async () => {
  await mount('approval-A');
  await press('Back to pickup review queue');
  expect(mockGoBack).toHaveBeenCalledTimes(1);
});
test.each([401, 403, 404])(
  'current %s hides queue and private detail; 401 logs out',
  async status => {
    transport.detail.mockRejectedValueOnce(
      new ApiError(status, 'PRIVATE INTERNAL'),
    );
    await mount('approval-A');
    expect(output()).not.toContain(pickupFields.notes);
    expect(output()).not.toContain('PRIVATE INTERNAL');
    expect(output()).toContain('unavailable in your current scope');
    expect(mockAuth.logout).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
  },
);
test('category grant denial never displays queue data', async () => {
  transport.list.mockRejectedValueOnce(new ApiError(403, 'grant denied'));
  await mount();
  expect(output()).not.toContain('Parent A');
  expect(output()).not.toContain(pickupFields.fullName);
});
test('approval stays disabled regardless of available review actions', async () => {
  await mount('approval-A');
  expect(
    button('Approve unavailable — school policy required').props.disabled,
  ).toBe(true);
  expect(transport.decide).not.toHaveBeenCalled();
  expect(output()).toContain('not a gate pass');
});
test.each(['Reject proposal', 'Request changes'])(
  '%s uses exact expected versions and reason',
  async title => {
    await mount('approval-A');
    await press(title);
    await reason();
    expect(transport.decide).not.toHaveBeenCalled();
    await press('Confirm pickup decision');
    expect(transport.decide).toHaveBeenCalledWith('token-A', 'approval-A', {
      applicationRevision: 1,
      personRevision: 0,
      approvalVersion: 0,
      action: title === 'Reject proposal' ? 'reject' : 'request_changes',
      decisionReason: 'The proposed details need school review.',
      clientOperationId: 'review-uuid',
    });
  },
);
test.each(['short', 'x'.repeat(501)])(
  'invalid explanation never reaches backend',
  async explanation => {
    await mount('approval-A');
    await press('Reject proposal');
    await reason(explanation);
    await press('Confirm pickup decision');
    expect(transport.decide).not.toHaveBeenCalled();
    expect(output()).toContain('10–500 characters');
  },
);
test('backend capabilities, rather than role alone, control decision actions', async () => {
  transport.detail.mockResolvedValueOnce(
    pickupReview({
      capabilities: { allowedActions: [], canApprove: false },
      decisionVersion: null,
    }),
  );
  await mount('approval-A');
  expect(button('Reject proposal')).toBeUndefined();
  expect(button('Request changes')).toBeUndefined();
});
test('uncertain decision retries identical versions, reason and nonce', async () => {
  transport.decide.mockRejectedValueOnce(new Error('timeout'));
  await mount('approval-A');
  await press('Reject proposal');
  await reason();
  await press('Confirm pickup decision');
  expect(output()).toContain('Decision unconfirmed');
  await press('Retry same decision');
  expect(transport.decide.mock.calls[0]).toEqual(
    transport.decide.mock.calls[1],
  );
  expect(operationId).toHaveBeenCalledTimes(1);
});
test('competing decision 409 retains explanation and needs refreshed-version acknowledgement', async () => {
  await mount('approval-A');
  await press('Request changes');
  await reason();
  transport.decide.mockRejectedValueOnce(new ApiError(409, 'stale'));
  transport.detail.mockResolvedValueOnce(
    pickupReview({
      revision: 4,
      personRevision: 2,
      decisionVersion: {
        applicationRevision: 4,
        personRevision: 2,
        approvalVersion: 3,
      },
    }),
  );
  await press('Confirm pickup decision');
  expect(output()).toContain('proposed details need school review');
  expect(button('Confirm pickup decision').props.disabled).toBe(true);
  await press('Review refreshed decision versions');
  await press('Confirm pickup decision');
  expect(transport.decide.mock.calls[1][2]).toEqual(
    expect.objectContaining({
      applicationRevision: 4,
      personRevision: 2,
      approvalVersion: 3,
      clientOperationId: 'review-next',
    }),
  );
});
test('double confirmation cannot produce duplicate decisions', async () => {
  const waiting = deferredPickup<PickupResult<PickupReviewDetail>>();
  transport.decide.mockReturnValueOnce(waiting.promise);
  await mount('approval-A');
  await press('Reject proposal');
  await reason();
  await act(async () => {
    button('Confirm pickup decision').props.onPress();
    button('Confirm pickup decision').props.onPress();
  });
  expect(transport.decide).toHaveBeenCalledTimes(1);
  expect(operationId).toHaveBeenCalledTimes(1);
  await act(async () => waiting.resolve(pickupResult(pickupReview())));
});
test('current decision denial conceals previously loaded private information', async () => {
  await mount('approval-A');
  await press('Reject proposal');
  await reason();
  transport.decide.mockRejectedValueOnce(new ApiError(403, 'revoked'));
  await press('Confirm pickup decision');
  expect(output()).not.toContain(pickupFields.notes);
  expect(output()).not.toContain(pickupFields.phone);
});
test.each(['account', 'token', 'branch', 'role', 'logout', 'blur'])(
  '%s fences old detail and old denial',
  async kind => {
    const waiting = deferredPickup<PickupReviewDetail>();
    transport.detail.mockReturnValueOnce(waiting.promise);
    await mount('approval-A');
    if (kind === 'account')
      mockAuth.user = { ...mockAuth.user!, id: 'principal-B' };
    if (kind === 'token') mockAuth.accessToken = 'token-B';
    if (kind === 'branch')
      mockAuth.user = { ...mockAuth.user!, branchId: 'branch-B' };
    if (kind === 'role') mockAuth.user = { ...mockAuth.user!, role: 'parent' };
    if (kind === 'logout') {
      mockAuth.user = null;
      mockAuth.accessToken = null;
    }
    await act(async () => tree.update(element('approval-A', kind !== 'blur')));
    await act(async () => waiting.reject(new ApiError(401, 'old session')));
    expect(mockAuth.logout).not.toHaveBeenCalled();
    expect(output()).not.toContain('old session');
  },
);

test('403 while revalidating a conflicting decision retains concealment rather than replacing it with a stale-version message', async () => {
  await mount('approval-A');
  await press('Reject proposal');
  await reason();
  transport.decide.mockRejectedValueOnce(new ApiError(409, 'changed'));
  transport.detail.mockRejectedValueOnce(new ApiError(403, 'grant revoked'));
  await press('Confirm pickup decision');
  expect(output()).toContain('unavailable in your current scope');
  expect(output()).not.toContain(pickupFields.notes);
  expect(output()).not.toContain('Review refreshed decision versions');
});

test('an old decision failure after token change cannot log out the current session', async () => {
  const waiting = deferredPickup<PickupResult<PickupReviewDetail>>();
  transport.decide.mockReturnValueOnce(waiting.promise);
  await mount('approval-A');
  await press('Reject proposal');
  await reason();
  await act(async () => {
    button('Confirm pickup decision').props.onPress();
  });
  mockAuth.accessToken = 'token-B';
  await act(async () => tree.update(element('approval-A')));
  await act(async () => waiting.reject(new ApiError(401, 'obsolete decision')));
  expect(mockAuth.logout).not.toHaveBeenCalled();
  expect(output()).not.toContain('obsolete decision');
});
