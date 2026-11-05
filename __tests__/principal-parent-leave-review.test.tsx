import React from 'react';
import { Text } from 'react-native';
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
  parentLeaveReviewService: { list: jest.fn(), detail: jest.fn() },
}));

const { FocusContext } = jest.requireMock('@react-navigation/native');
const service = jest.mocked(parentLeaveReviewService);
const primary = {
  user: { id: 'principal-a', role: 'principal', branchId: 'branch-a' },
  accessToken: 'token-a',
};
let mockAuth = primary;
let tree: Renderer.ReactTestRenderer;

const review = (id: string, name: string): ParentLeaveReviewDetail => ({
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
