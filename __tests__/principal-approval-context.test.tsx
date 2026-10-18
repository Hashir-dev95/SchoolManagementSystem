import React from 'react';
import { Alert, View } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import { Button } from '../src/components/hiraDashboard';
import PrincipalWorkspaceScreen from '../src/screens/principal/PrincipalWorkspaceScreen';
import PrincipalApprovalsScreen from '../src/screens/principal/PrincipalApprovalsScreen';
import ApprovalDetailScreen from '../src/screens/principal/ApprovalDetailScreen';
import PrincipalNavigator from '../src/navigation/PrincipalNavigator';
import {
  ApprovalRequest,
  principalService,
} from '../src/services/principal/principalService';

const mockNavigation = { navigate: jest.fn(), goBack: jest.fn() };
jest.mock('@react-navigation/native', () => {
  const ReactModule = jest.requireActual('react');
  const FocusContext = ReactModule.createContext(true);
  return {
    FocusContext,
    useNavigation: () => mockNavigation,
    useFocusEffect: function useFocusEffect(effect: () => void | (() => void)) {
      const focused = ReactModule.useContext(FocusContext);
      ReactModule.useEffect(
        () => (focused ? effect() : undefined),
        [focused, effect],
      );
    },
  };
});
jest.mock('@react-navigation/native-stack', () => {
  const ReactModule = jest.requireActual('react');
  return {
    createNativeStackNavigator: () => ({
      Navigator: ({ children }: { children: React.ReactNode }) =>
        ReactModule.createElement('StackNavigator', null, children),
      Screen: ({ name }: { name: string }) =>
        ReactModule.createElement('StackScreen', { name }),
    }),
  };
});
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({
    accessToken: 'token',
    user: { role: 'principal' },
    logout: jest.fn(),
  }),
}));
jest.mock('../src/services/principal/principalService', () => ({
  principalService: {
    getPendingApprovals: jest.fn(),
    getApprovalById: jest.fn(),
    getDashboard: jest.fn(),
    getNotices: jest.fn(),
    processApproval: jest.fn(),
  },
}));
// Keep the real dashboard hook so return-refresh also verifies Home behavior.
jest.mock('../src/screens/principal/PrincipalDashboardScreen', () => {
  const ReactModule = jest.requireActual('react');
  const { Button: DashboardButton } = jest.requireActual(
    '../src/components/hiraDashboard',
  );
  const { usePrincipalDashboardData } = jest.requireActual(
    '../src/hooks/usePrincipalDashboardData',
  );
  return function Dashboard({
    onOpenApprovals,
  }: {
    onOpenApprovals: () => void;
  }) {
    usePrincipalDashboardData();
    return ReactModule.createElement(DashboardButton, {
      title: 'Open approvals',
      onPress: onOpenApprovals,
    });
  };
});

const { FocusContext } = jest.requireMock('@react-navigation/native');
const service = jest.mocked(principalService);
const leave: ApprovalRequest = {
  _id: 'leave-1',
  requesterId: 'Requester',
  entityType: 'student',
  entityId: 'student-1',
  approvalType: 'leave',
  reason: 'Medical absence',
  status: 'pending',
  history: [],
  createdAt: '2026-10-12T00:00:00Z',
  updatedAt: '2026-10-12T00:00:00Z',
  capabilities: { canReview: true, canDelegate: false },
};
const refund: ApprovalRequest = {
  ...leave,
  _id: 'refund-1',
  approvalType: 'refund',
  amount: 25,
};
const trees: Renderer.ReactTestRenderer[] = [];

function Harness() {
  const [request, setRequest] = React.useState<ApprovalRequest | null>(null);
  mockNavigation.navigate.mockImplementation(
    (screen: string, params: { request: ApprovalRequest }) => {
      if (screen === 'ApprovalDetail') setRequest(params.request);
    },
  );
  mockNavigation.goBack.mockImplementation(() => setRequest(null));
  return (
    <>
      <FocusContext.Provider value={!request}>
        <View style={{ display: request ? 'none' : 'flex' }}>
          <PrincipalWorkspaceScreen />
        </View>
      </FocusContext.Provider>
      {request ? (
        <ApprovalDetailScreen
          route={{ params: { request } } as never}
          navigation={mockNavigation as never}
        />
      ) : null}
    </>
  );
}

async function mount(element: React.ReactElement = <Harness />) {
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(element);
  });
  trees.push(tree);
  return tree;
}
function button(tree: Renderer.ReactTestRenderer, title: string) {
  return tree.root
    .findAllByType(Button)
    .find(item => item.props.title === title)!;
}
async function press(tree: Renderer.ReactTestRenderer, title: string) {
  const target = button(tree, title);
  expect(target).toBeDefined();
  await act(async () => {
    await target.props.onPress();
  });
}
async function tab(tree: Renderer.ReactTestRenderer, title: string) {
  const tabs = tree.root.findAll(
    item => item.props.accessibilityRole === 'tab',
    { deep: false },
  );
  const target = tabs[['Home', 'Approvals', 'Inbox'].indexOf(title)];
  expect(target).toBeDefined();
  await act(async () => {
    target.props.onPress();
  });
}
const search = (tree: Renderer.ReactTestRenderer) =>
  tree.root.findByProps({ accessibilityLabel: 'Search approval requests' });
// Native mocked props can contain React elements with circular owner references;
// assertions inspect rendered children/types rather than serializing those props.
const contents = (tree: Renderer.ReactTestRenderer) =>
  JSON.stringify(tree.toJSON(), (key, value) =>
    key === 'props' ? undefined : value,
  );

beforeEach(() => {
  jest.resetAllMocks();
  service.getPendingApprovals.mockResolvedValue({
    data: { requests: [leave, refund], total: 2 },
    message: '',
  });
  service.getApprovalById.mockResolvedValue({ data: leave, message: '' });
  service.getDashboard.mockResolvedValue({ data: {} as never, message: '' });
  service.getNotices.mockResolvedValue({ data: [], message: '' });
});
afterEach(async () => {
  await act(async () => {
    trees.splice(0).forEach(tree => tree.unmount());
  });
  jest.restoreAllMocks();
});

test('workspace detail/back refresh preserves search, type, selection and the mounted list', async () => {
  const tree = await mount();
  await press(tree, 'Open approvals');
  await act(async () => {
    search(tree).props.onChangeText('Medical');
  });
  await press(tree, 'leave');
  expect(service.getPendingApprovals).toHaveBeenCalledTimes(1);
  await press(tree, 'Review');
  expect(mockNavigation.navigate).toHaveBeenCalledWith('ApprovalDetail', {
    request: leave,
  });
  expect(tree.root.findAllByType(ApprovalDetailScreen)).toHaveLength(1);
  service.getPendingApprovals.mockResolvedValue({
    data: { requests: [leave, refund], total: 2 },
    message: '',
  });
  await press(tree, 'Back to approvals');
  expect(service.getPendingApprovals).toHaveBeenCalledTimes(2);
  expect(search(tree).props.value).toBe('Medical');
  expect(button(tree, 'leave').props.variant).toBe('primary');
  expect(contents(tree)).toContain('leave-1');
  expect(tree.root.findAllByType(PrincipalApprovalsScreen)).toHaveLength(1);
  expect(tree.root.findAllByType(ApprovalDetailScreen)).toHaveLength(0);
});

test('a finalized selection disappears on return without clearing its ID, search or now-empty category', async () => {
  const tree = await mount();
  await press(tree, 'Open approvals');
  await act(async () => {
    search(tree).props.onChangeText('Medical');
  });
  await press(tree, 'leave');
  await press(tree, 'Review');
  const confirmation = jest
    .spyOn(Alert, 'alert')
    .mockImplementation(() => undefined);
  service.processApproval.mockResolvedValue({
    data: { ...leave, status: 'approved' },
    message: 'Decision recorded',
  });
  service.getPendingApprovals.mockResolvedValueOnce({
    data: { requests: [leave, refund], total: 2 },
    message: '',
  });
  service.getPendingApprovals.mockResolvedValue({
    data: { requests: [refund], total: 1 },
    message: '',
  });
  await press(tree, 'Approve');
  expect(service.processApproval).toHaveBeenCalledWith(
    'token',
    'leave-1',
    'approved',
    undefined,
  );
  expect(confirmation.mock.calls[0][1]).toContain(
    'business action is handled separately',
  );
  await act(async () => {
    confirmation.mock.calls[0][2]![0].onPress!();
  });
  expect(search(tree).props.value).toBe('Medical');
  expect(button(tree, 'leave').props.variant).toBe('primary');
  expect(
    tree.root
      .findAllByType(Button)
      .filter(item => item.props.title === 'Review'),
  ).toHaveLength(0);
  expect(contents(tree)).toContain('leave-1');
  expect(contents(tree)).toContain('No longer in the pending inbox.');
  expect(contents(tree)).toContain('No requests match this search or filter.');
});

test('failed return refresh retains context and offers retry without claiming the selected request left the inbox', async () => {
  const tree = await mount();
  await press(tree, 'Open approvals');
  await act(async () => {
    search(tree).props.onChangeText('Medical');
  });
  await press(tree, 'leave');
  await press(tree, 'Review');
  service.getPendingApprovals.mockRejectedValueOnce(
    new Error('Refresh unavailable'),
  );
  await press(tree, 'Back to approvals');
  expect(search(tree).props.value).toBe('Medical');
  expect(button(tree, 'leave').props.variant).toBe('primary');
  expect(contents(tree)).toContain('Refresh unavailable');
  expect(contents(tree)).not.toContain('No longer in the pending inbox.');
  await press(tree, 'Retry');
  expect(contents(tree)).toContain('leave-1');
  expect(search(tree).props.value).toBe('Medical');
});

test('late blurred-list responses cannot overwrite the newer return refresh', async () => {
  const tree = await mount();
  await press(tree, 'Open approvals');
  let finish!: (
    value: Awaited<ReturnType<typeof principalService.getPendingApprovals>>,
  ) => void;
  service.getPendingApprovals.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  await act(async () => {
    const shell = tree.root
      .findByType(PrincipalApprovalsScreen)
      .findByProps({ safeArea: false });
    shell.props.onRefresh();
  });
  await press(tree, 'Review');
  service.getPendingApprovals.mockResolvedValue({
    data: { requests: [refund], total: 1 },
    message: '',
  });
  await press(tree, 'Back to approvals');
  await act(async () => {
    finish({ data: { requests: [leave, refund], total: 2 }, message: '' });
  });
  expect(contents(tree)).toContain('No longer in the pending inbox.');
  expect(
    tree.root
      .findAllByType(Button)
      .filter(item => item.props.title === 'Review'),
  ).toHaveLength(1);
});

test('removing workspace remounts keeps Home and Inbox refreshing on focus', async () => {
  const tree = await mount();
  expect(service.getDashboard).toHaveBeenCalledTimes(1);
  await tab(tree, 'Inbox');
  expect(service.getNotices).toHaveBeenCalledTimes(1);
  await tab(tree, 'Home');
  expect(service.getDashboard).toHaveBeenCalledTimes(2);
  await tab(tree, 'Approvals');
  await press(tree, 'Review');
  await press(tree, 'Back to approvals');
  expect(service.getPendingApprovals).toHaveBeenCalledTimes(2);
});

test('Principal navigator retains one stack with unique existing screens and no nested navigation container', async () => {
  const tree = await mount(<PrincipalNavigator />);
  const json = tree.toJSON() as Renderer.ReactTestRendererJSON;
  expect(json.type).toBe('StackNavigator');
  const names = (json.children as Renderer.ReactTestRendererJSON[]).map(
    screen => screen.props.name,
  );
  expect(names).toEqual([
    'AcademicSetup',
    'PrincipalWorkspace',
    'AttendanceReview',
    'ApprovalDetail',
    'NoticeDetail',
    'Tasks',
    'TaskDetail',
    'AssignTask',
    'SafetyOverview',
    'SafetyDetail',
    'AssignTeacher',
    'ResultModeration',
  ]);
  expect(new Set(names).size).toBe(names.length);
  expect(contents(tree)).not.toContain('NavigationContainer');
});

test('typed corrections use Principal attendance review from the existing approvals workspace', async () => {
  service.getPendingApprovals.mockResolvedValue({
    data: {
      requests: [
        {
          ...leave,
          _id: 'correction-1',
          entityType: 'attendance_correction',
          approvalType: 'attendance_correction',
        },
      ],
      total: 1,
    },
    message: '',
  });
  const tree = await mount();
  await press(tree, 'Open approvals');
  await press(tree, 'Review');
  expect(mockNavigation.navigate).toHaveBeenCalledWith('AttendanceReview', {
    approvalId: 'correction-1',
  });
});

test('typed academic results use the marks moderation workflow', async () => {
  const resultRequest = {
    ...leave,
    _id: 'result-1',
    entityType: 'academic_result',
    approvalType: 'result',
  };
  service.getPendingApprovals.mockResolvedValue({
    data: {requests: [resultRequest], total: 1},
    message: '',
  });
  const tree = await mount();
  await press(tree, 'Open approvals');
  await press(tree, 'Review');
  expect(mockNavigation.navigate).toHaveBeenCalledWith('ResultModeration', {
    approvalId: 'result-1',
  });
});
