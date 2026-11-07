import React from 'react';
import { Text, TextInput } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import {
  Button,
  DashboardShell,
  ListRow,
} from '../src/components/hiraDashboard';
import PrincipalParentLeaveReviewScreen, {
  PrincipalParentLeaveQueue,
} from '../src/screens/principal/PrincipalParentLeaveReviewScreen';
import { ApiError } from '../src/services/api/apiClient';
import { AdminDialog } from '../src/components/hiraDashboard/AdminForm';
import {
  parentLeaveReviewService,
  type ParentLeaveReviewDetail,
} from '../src/services/principal/parentLeaveReviewService';

jest.mock('@react-navigation/native', () => {
  const ReactModule = jest.requireActual('react');
  const FocusContext = ReactModule.createContext(true);
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
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../src/services/principal/parentLeaveReviewService', () => ({
  parentLeaveReviewService: {
    list: jest.fn(),
    detail: jest.fn(),
    decide: jest.fn(),
  },
}));
jest.mock('../src/services/parent/leaveApplicationService', () => ({
  leaveOperationId: () => 'principal-op-0001',
}));

const { FocusContext } = jest.requireMock('@react-navigation/native');
const service = jest.mocked(parentLeaveReviewService);
const primary = {
  user: { id: 'principal-a', role: 'principal', branchId: 'branch-a' },
  accessToken: 'token-a',
};
let mockAuth = primary;
let tree: Renderer.ReactTestRenderer;

const review = (
  id: string,
  name: string,
): ParentLeaveReviewDetail & { status: 'pending' } => ({
  approvalId: id,
  source: 'parent_leave_application',
  studentName: name,
  startDate: '2026-11-04',
  endDate: '2026-11-06',
  status: 'pending',
  submittedAt: '2026-11-01T12:00:00Z',
  leaveType: 'Medical leave',
  reason: `Private reason for ${name}`,
  history: [{ action: 'submitted', revision: 1, at: '2026-11-01T12:00:00Z' }],
});

const a = review('a', 'Student A');
const b = review('b', 'Student B');
const pending = {
  ...a,
  decisionVersion: { applicationRevision: 1, approvalVersion: 0 },
};
const ack = {
  approvalId: 'a',
  state: 'approved' as const,
  revision: 2,
  decidedAt: a.submittedAt,
  replayed: false,
};
const onOpen = jest.fn();

function detail(approvalId: string) {
  return (
    <PrincipalParentLeaveReviewScreen
      route={{
        key: 'detail',
        name: 'ParentLeaveReview',
        params: { approvalId },
      }}
      navigation={{} as never}
    />
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const text = (value: string) =>
  tree.root.findAllByType(Text).some(node => node.props.children === value);
const retry = (title: string) =>
  tree.root
    .findAllByType(Button)
    .find(node => node.props.title === title)!
    .props.onPress();

beforeEach(() => {
  jest.resetAllMocks();
  mockAuth = primary;
});
afterEach(() => act(() => tree?.unmount()));

test('queue opens only the approval ID, clears on blur, and reloads on return', async () => {
  const later = deferred<(typeof a)[]>();
  service.list.mockResolvedValueOnce([a]).mockReturnValueOnce(later.promise);
  const queue = (focused: boolean) => (
    <FocusContext.Provider value={focused}>
      <PrincipalParentLeaveQueue onOpen={onOpen} />
    </FocusContext.Provider>
  );
  await act(async () => {
    tree = Renderer.create(queue(true));
  });
  expect(text('Student A')).toBe(true);
  expect(text(a.reason)).toBe(false);
  act(() => tree.root.findByType(ListRow).props.onPress());
  expect(onOpen).toHaveBeenCalledWith('a');
  await act(async () => tree.update(queue(false)));
  expect(text('Student A')).toBe(false);
  await act(async () => tree.update(queue(true)));
  expect(text('Student A')).toBe(false);
  await act(async () => later.reject(new ApiError(404, a.reason)));
  expect(text('Student A')).toBe(false);
  expect(text(a.reason)).toBe(false);
  service.list.mockResolvedValueOnce([]);
  await act(async () => retry('Retry parent leave'));
  expect(text('No parent leave requests are waiting for review.')).toBe(true);
});

test.each([401, 403, 404, 409, 503])(
  'current detail error %i conceals cached details and supports retry',
  async status => {
    service.detail
      .mockResolvedValueOnce(a)
      .mockRejectedValueOnce(new ApiError(status, 'Raw private error'))
      .mockResolvedValueOnce(a);
    await act(async () => {
      tree = Renderer.create(detail('a'));
    });
    expect(text(a.reason)).toBe(true);
    expect(text('Submitted for review')).toBe(true);
    expect(
      tree.root.findAllByType(Button).map(node => node.props.title),
    ).toEqual([]);
    const shell = tree.root.findByType(DashboardShell);
    await act(async () => shell.props.onRefresh());
    expect(text(a.reason)).toBe(false);
    expect(text('Raw private error')).toBe(false);
    await act(async () => retry('Retry'));
    expect(text(a.reason)).toBe(true);
  },
);

test.each(['account and token', 'Branch', 'route', 'role'] as const)(
  'ignores late detail success after a %s change',
  async scope => {
    const old = deferred<typeof a>();
    service.detail.mockReturnValueOnce(old.promise).mockResolvedValueOnce(b);
    await act(async () => {
      tree = Renderer.create(detail('a'));
    });
    if (scope === 'account and token')
      mockAuth = {
        user: { ...primary.user, id: 'principal-b' },
        accessToken: 'token-b',
      };
    if (scope === 'Branch')
      mockAuth = {
        ...primary,
        user: { ...primary.user, branchId: 'branch-b' },
      };
    if (scope === 'role')
      mockAuth = { ...primary, user: { ...primary.user, role: 'teacher' } };
    await act(async () => tree.update(detail(scope === 'route' ? 'b' : 'a')));
    await act(async () => old.resolve(a));
    expect(text(a.reason)).toBe(false);
    expect(text(b.reason)).toBe(scope !== 'role');
  },
);

test('a stale denial cannot clear the newer request', async () => {
  const old = deferred<typeof a>();
  service.detail.mockReturnValueOnce(old.promise).mockResolvedValueOnce(b);
  await act(async () => {
    tree = Renderer.create(detail('a'));
  });
  await act(async () => tree.update(detail('b')));
  await act(async () => old.reject(new ApiError(403, 'Old scope denied')));
  expect(text(b.reason)).toBe(true);
  expect(text('Parent leave unavailable')).toBe(false);
});

const confirmDecision = () =>
  tree.root.findByType(AdminDialog).props.onConfirm();

test('approval confirmation waits for acknowledgment and refreshes the current authorized detail', async () => {
  const decision = deferred<typeof ack>();
  service.detail
    .mockResolvedValueOnce(pending)
    .mockResolvedValueOnce({ ...a, status: 'approved' });
  service.decide.mockReturnValueOnce(decision.promise);
  await act(async () => {
    tree = Renderer.create(detail('a'));
  });
  act(() => retry('Approve leave'));
  expect(tree.root.findByType(AdminDialog).props.visible).toBe(true);
  expect(service.decide).not.toHaveBeenCalled();
  act(() => {
    confirmDecision();
  });
  expect(service.decide).toHaveBeenCalledWith('token-a', 'a', {
    ...pending.decisionVersion,
    action: 'approve',
    clientOperationId: 'principal-op-0001',
  });
  expect(text('Approved')).toBe(false);
  await act(async () => decision.resolve(ack));
  expect(text('Approved')).toBe(true);
  expect(service.detail).toHaveBeenCalledTimes(2);
});

test('rejection validates the reason and an uncertain retry reuses the identical operation', async () => {
  const reason = 'Documentation does not cover the requested dates.';
  service.detail
    .mockResolvedValueOnce(pending)
    .mockResolvedValueOnce({ ...a, status: 'rejected' });
  service.decide
    .mockRejectedValueOnce(new Error('Connection lost'))
    .mockResolvedValueOnce({ ...ack, state: 'rejected' });
  await act(async () => {
    tree = Renderer.create(detail('a'));
  });
  act(() => retry('Reject leave'));
  await act(async () => confirmDecision());
  expect(service.decide).not.toHaveBeenCalled();
  act(() => tree.root.findByType(TextInput).props.onChangeText(reason));
  await act(async () => confirmDecision());
  expect(tree.root.findByType(AdminDialog).props.confirmTitle).toBe(
    'Retry decision',
  );
  expect(text('Rejected')).toBe(false);
  await act(async () => confirmDecision());
  expect(service.decide.mock.calls[0]).toEqual(service.decide.mock.calls[1]);
  expect(service.decide.mock.calls[0][2].decisionReason).toBe(reason);
  expect(text('Rejected')).toBe(true);
});

test.each([401, 403, 404])(
  'decision denial %i conceals current protected detail',
  async status => {
    service.detail.mockResolvedValueOnce(pending);
    service.decide.mockRejectedValueOnce(
      new ApiError(status, 'Protected failure'),
    );
    await act(async () => {
      tree = Renderer.create(detail('a'));
    });
    act(() => retry('Approve leave'));
    await act(async () => confirmDecision());
    expect(text(a.reason)).toBe(false);
    expect(text('Protected failure')).toBe(false);
    expect(text('Parent leave unavailable')).toBe(true);
  },
);

test('decision conflict refreshes the current request without resubmitting', async () => {
  service.detail
    .mockResolvedValueOnce(pending)
    .mockResolvedValueOnce({ ...a, status: 'rejected' });
  service.decide.mockRejectedValueOnce(new ApiError(409, 'Conflict'));
  await act(async () => {
    tree = Renderer.create(detail('a'));
  });
  act(() => retry('Approve leave'));
  await act(async () => confirmDecision());
  expect(text('The request changed. Review the refreshed status.')).toBe(true);
  expect(text('Rejected')).toBe(true);
  expect(service.decide).toHaveBeenCalledTimes(1);
  expect(service.detail).toHaveBeenLastCalledWith('token-a', 'a');
});

test.each(['success', 'denial'])(
  'late decision %s cannot alter the new account and approval',
  async result => {
    const old = deferred<typeof ack>();
    service.detail.mockResolvedValueOnce(pending).mockResolvedValueOnce(b);
    service.decide.mockReturnValueOnce(old.promise);
    await act(async () => {
      tree = Renderer.create(detail('a'));
    });
    act(() => retry('Approve leave'));
    act(() => {
      confirmDecision();
    });
    mockAuth = {
      user: { ...primary.user, id: 'principal-b', branchId: 'branch-b' },
      accessToken: 'token-b',
    };
    await act(async () => tree.update(detail('b')));
    await act(async () => {
      if (result === 'success') old.resolve(ack);
      else old.reject(new ApiError(403, 'Old denial'));
    });
    expect(text(b.reason)).toBe(true);
    expect(text('Approved')).toBe(false);
    expect(service.detail).toHaveBeenCalledTimes(2);
  },
);

test('G3c Principal confirms an actionable return and refreshes only after acknowledgement', async () => {
  const reason = 'Please explain the revised dates before resubmitting.';
  const returned: ParentLeaveReviewDetail = {
    ...pending,
    status: 'changes_requested',
    decisionVersion: null,
    history: [
      ...pending.history,
      {
        action: 'changes_requested',
        revision: 2,
        at: ack.decidedAt,
        decisionReason: reason,
      },
    ],
  };
  service.detail.mockResolvedValueOnce(pending).mockResolvedValueOnce(returned);
  service.decide
    .mockRejectedValueOnce(new Error('connection lost'))
    .mockResolvedValueOnce({ ...ack, state: 'changes_requested' });
  await act(async () => {
    tree = Renderer.create(detail('a'));
  });
  act(() => retry('Request changes'));
  await act(async () => confirmDecision());
  expect(service.decide).not.toHaveBeenCalled();
  act(() => tree.root.findByType(TextInput).props.onChangeText(reason));
  await act(async () => confirmDecision());
  expect(text('Changes requested')).toBe(false);
  await act(async () => confirmDecision());
  expect(service.decide.mock.calls[0]).toEqual(service.decide.mock.calls[1]);
  expect(service.decide.mock.calls[0][2]).toEqual({
    ...pending.decisionVersion,
    action: 'request_changes',
    decisionReason: reason,
    clientOperationId: 'principal-op-0001',
  });
  expect(text('Changes requested')).toBe(true);
  expect(service.detail).toHaveBeenCalledTimes(2);
});
