import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import Screen from '../src/screens/principal/PrincipalEarlyExitReviewScreen';
import { Button, DashboardStateCard } from '../src/components/hiraDashboard';
import { ApiError } from '../src/services/api/apiClient';
import type {
  EarlyExitReviewTransport,
  EarlyExitReviewDetail,
} from '../src/services/principal/earlyExitReviewService';
import type { EarlyExitResult } from '../src/services/parent/earlyExitService';
import {
  earlyExitFields,
  earlyExitReview,
  earlyExitResult,
  deferredEarlyExit,
} from './helpers/early-exit-fixture';
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
const transport: jest.Mocked<EarlyExitReviewTransport> = {
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
    .mockResolvedValue({ items: [earlyExitReview()], nextOffset: null });
  transport.detail.mockReset().mockResolvedValue(earlyExitReview());
  transport.decide.mockReset().mockResolvedValue(
    earlyExitResult(
      earlyExitReview({
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
  expect(transport.list).toHaveBeenCalledWith('token-A', 'branch', 0);
  expect(output()).toContain('Child A');
  expect(output()).toContain('Parent A');
  expect(output()).not.toContain(earlyExitFields.reason);
  await press(`Review Early Exit ${earlyExitFields.exitDate}`);
  expect(mockNavigate).toHaveBeenCalledWith('EarlyExitReview', {
    approvalId: 'approval-A',
  });
});
test('queue pagination requests only the returned offset', async () => {
  transport.list.mockResolvedValueOnce({ items: [], nextOffset: 20 });
  await mount();
  await press('Load more Early Exit reviews');
  expect(transport.list).toHaveBeenLastCalledWith('token-A', 'branch', 20);
});

test('typed detail back action returns through the existing native navigation stack', async () => {
  await mount('approval-A');
  await press('Back to Early Exit review queue');
  expect(mockGoBack).toHaveBeenCalledTimes(1);
});
test.each([401, 403, 404])(
  'current %s hides queue and private detail; 401 logs out',
  async status => {
    transport.detail.mockRejectedValueOnce(
      new ApiError(status, 'PRIVATE INTERNAL'),
    );
    await mount('approval-A');
    expect(output()).not.toContain(earlyExitFields.reason);
    expect(output()).not.toContain('PRIVATE INTERNAL');
    expect(output()).toContain('unavailable in your current scope');
    expect(mockAuth.logout).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
  },
);
test('category grant denial never displays queue data', async () => {
  transport.list.mockRejectedValueOnce(new ApiError(403, 'grant denied'));
  await mount();
  expect(output()).not.toContain('Parent A');
  expect(output()).not.toContain('Parent A');
  expect(output()).not.toContain('Child A');
});
test('approval stays disabled regardless of available review actions', async () => {
  await mount('approval-A');
  expect(
    button('Approve unavailable — school policy required').props.disabled,
  ).toBe(true);
  expect(transport.decide).not.toHaveBeenCalled();
  expect(output()).toContain('No gate pass');
});
test.each(['Reject request', 'Request changes'])(
  '%s uses exact expected versions and reason',
  async title => {
    await mount('approval-A');
    await press(title);
    await reason();
    expect(transport.decide).not.toHaveBeenCalled();
    await press('Confirm Early Exit decision');
    expect(transport.decide).toHaveBeenCalledWith(
      'token-A',
      'branch',
      'approval-A',
      {
        applicationRevision: 1,
        approvalVersion: 0,
        action: title === 'Reject request' ? 'reject' : 'request_changes',
        decisionReason: 'The proposed details need school review.',
        clientOperationId: 'review-uuid',
      },
    );
  },
);
test.each(['short', 'x'.repeat(501)])(
  'invalid explanation never reaches backend',
  async explanation => {
    await mount('approval-A');
    await press('Reject request');
    await reason(explanation);
    await press('Confirm Early Exit decision');
    expect(transport.decide).not.toHaveBeenCalled();
    expect(output()).toContain('10–500 characters');
  },
);
test('backend capabilities, rather than role alone, control decision actions', async () => {
  transport.detail.mockResolvedValueOnce(
    earlyExitReview({
      capabilities: { allowedActions: [], canApprove: false },
      decisionVersion: null,
    }),
  );
  await mount('approval-A');
  expect(button('Reject request')).toBeUndefined();
  expect(button('Request changes')).toBeUndefined();
});
test('uncertain decision retries identical versions, reason and nonce', async () => {
  transport.decide.mockRejectedValueOnce(new Error('timeout'));
  await mount('approval-A');
  await press('Reject request');
  await reason();
  await press('Confirm Early Exit decision');
  expect(output()).toContain('Decision unconfirmed');
  await press('Retry same decision');
  expect(transport.decide.mock.calls[0]).toEqual(
    transport.decide.mock.calls[1],
  );
  expect(operationId).toHaveBeenCalledTimes(1);
});

test('a retained confirmation cannot replace the pending decision after timeout', async () => {
  transport.decide.mockRejectedValueOnce(new Error('timeout'));
  await mount('approval-A'); await press('Reject request'); await reason();
  const retainedConfirm = button('Confirm Early Exit decision').props.onPress;
  await act(async () => { await retainedConfirm(); });
  await act(async () => { await retainedConfirm(); });
  expect(transport.decide).toHaveBeenCalledTimes(1);
  expect(operationId).toHaveBeenCalledTimes(1);
  await press('Retry same decision');
  expect(transport.decide.mock.calls[1]).toEqual(transport.decide.mock.calls[0]);
});
test('competing decision 409 retains explanation and needs refreshed-version acknowledgement', async () => {
  await mount('approval-A');
  await press('Request changes');
  await reason();
  transport.decide.mockRejectedValueOnce(new ApiError(409, 'stale'));
  transport.detail.mockResolvedValueOnce(
    earlyExitReview({
      revision: 4,
      decisionVersion: {
        applicationRevision: 4,
        approvalVersion: 3,
      },
    }),
  );
  await press('Confirm Early Exit decision');
  expect(output()).toContain('proposed details need school review');
  expect(button('Confirm Early Exit decision').props.disabled).toBe(true);
  await press('Use refreshed decision versions');
  await press('Confirm Early Exit decision');
  expect(transport.decide.mock.calls[1][3]).toEqual(
    expect.objectContaining({
      applicationRevision: 4,
      approvalVersion: 3,
      clientOperationId: 'review-next',
    }),
  );
});
test('double confirmation cannot produce duplicate decisions', async () => {
  const waiting = deferredEarlyExit<EarlyExitResult<EarlyExitReviewDetail>>();
  transport.decide.mockReturnValueOnce(waiting.promise);
  await mount('approval-A');
  await press('Reject request');
  await reason();
  await act(async () => {
    button('Confirm Early Exit decision').props.onPress();
    button('Confirm Early Exit decision').props.onPress();
  });
  expect(transport.decide).toHaveBeenCalledTimes(1);
  expect(operationId).toHaveBeenCalledTimes(1);
  await act(async () => waiting.resolve(earlyExitResult(earlyExitReview())));
});
test('current decision denial conceals previously loaded private information', async () => {
  await mount('approval-A');
  await press('Reject request');
  await reason();
  transport.decide.mockRejectedValueOnce(new ApiError(403, 'revoked'));
  await press('Confirm Early Exit decision');
  expect(output()).not.toContain(earlyExitFields.reason);
  expect(output()).not.toContain('Child A');
});

test('queue refresh 403 clears cached Student and Parent summaries', async () => {
  await mount();
  expect(output()).toContain('Parent A');
  transport.list.mockRejectedValueOnce(new ApiError(403, 'PRIVATE DENIAL'));
  await press('Refresh Early Exit review queue');
  expect(output()).not.toContain('Parent A');
  expect(output()).not.toContain('Child A');
  expect(output()).not.toContain('PRIVATE DENIAL');
});

test('503 keeps the identical decision nonce, normalized explanation and versions', async () => {
  await mount('approval-A'); await press('Reject request'); await reason('  A current school explanation.  ');
  transport.decide.mockRejectedValueOnce(new ApiError(503, 'Unconfigured routing'));
  await press('Confirm Early Exit decision');
  expect(output()).not.toContain('School decision confirmed');
  await press('Retry same decision');
  expect(transport.decide.mock.calls[1]).toEqual(transport.decide.mock.calls[0]);
  expect(transport.decide.mock.calls[1][3].decisionReason).toBe('A current school explanation.');
  expect(operationId).toHaveBeenCalledTimes(1);
});

test('failed conflict detail refresh cannot enable a new decision with stale versions', async () => {
  await mount('approval-A'); await press('Reject request'); await reason();
  transport.decide.mockRejectedValueOnce(new ApiError(409, 'changed'));
  transport.detail.mockRejectedValueOnce(new Error('read timeout'));
  await press('Confirm Early Exit decision');
  expect(button('Use refreshed decision versions').props.disabled).toBe(true);
  await act(async () => button('Use refreshed decision versions').props.onPress());
  expect(transport.decide).toHaveBeenCalledTimes(1);
  // Revalidating the identical typed detail recovers current versions and retained text.
  await act(async () => tree.root.findAllByType(DashboardStateCard).find(node => node.props.error)!.props.onRetry());
  expect(output()).toContain('proposed details need school review');
  await press('Use refreshed decision versions');
  await press('Confirm Early Exit decision');
  expect(transport.decide).toHaveBeenCalledTimes(2);
});

test('Principal queue pagination never duplicates a canonical request', async () => {
  transport.list.mockResolvedValueOnce({ items: [earlyExitReview()], nextOffset: 20 }).mockResolvedValueOnce({ items: [earlyExitReview()], nextOffset: null });
  await mount(); await press('Load more Early Exit reviews');
  expect(tree.root.findAllByType(Button).filter(node => node.props.title === `Review Early Exit ${earlyExitFields.exitDate}`)).toHaveLength(1);
});
test.each(['account', 'token', 'branch', 'role', 'logout', 'blur'])(
  '%s fences old detail and old denial',
  async kind => {
    const waiting = deferredEarlyExit<EarlyExitReviewDetail>();
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
  await press('Reject request');
  await reason();
  transport.decide.mockRejectedValueOnce(new ApiError(409, 'changed'));
  transport.detail.mockRejectedValueOnce(new ApiError(403, 'grant revoked'));
  await press('Confirm Early Exit decision');
  expect(output()).toContain('unavailable in your current scope');
  expect(output()).not.toContain(earlyExitFields.reason);
  expect(output()).not.toContain('Use refreshed decision versions');
});

test('an old decision failure after token change cannot log out the current session', async () => {
  const waiting = deferredEarlyExit<EarlyExitResult<EarlyExitReviewDetail>>();
  transport.decide.mockReturnValueOnce(waiting.promise);
  await mount('approval-A');
  await press('Reject request');
  await reason();
  await act(async () => {
    button('Confirm Early Exit decision').props.onPress();
  });
  mockAuth.accessToken = 'token-B';
  await act(async () => tree.update(element('approval-A')));
  await act(async () => waiting.reject(new ApiError(401, 'obsolete decision')));
  expect(mockAuth.logout).not.toHaveBeenCalled();
  expect(output()).not.toContain('obsolete decision');
});
