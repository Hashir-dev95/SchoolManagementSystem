import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import ParentNavigator from '../src/navigation/ParentNavigator';
import PrincipalNavigator from '../src/navigation/PrincipalNavigator';
import ParentWorkspace from '../src/screens/parent/ParentWorkspaceScreen';
import PrincipalWorkspace from '../src/screens/principal/PrincipalWorkspaceScreen';
import { Button } from '../src/components/hiraDashboard';
const mockNavigate = jest.fn();
let mockRole = 'parent';
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user', role: mockRole, branchId: 'branch' },
    accessToken: 'token',
    logout: jest.fn(),
  }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    jest.requireActual('react').useEffect(effect, [effect]);
  },
}));
jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: 'StackNavigator',
    Screen: 'StackScreen',
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../src/services/parent/parentService', () => ({
  parentService: {
    children: jest.fn().mockResolvedValue({ items: [] }),
    me: jest.fn().mockResolvedValue({ fullName: 'Parent' }),
  },
}));
jest.mock(
  '../src/screens/principal/PrincipalDashboardScreen',
  () => () => null,
);
jest.mock(
  '../src/screens/principal/PrincipalApprovalsScreen',
  () => () => null,
);
jest.mock('../src/screens/principal/PrincipalInboxScreen', () => () => null);
let tree: Renderer.ReactTestRenderer;
beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'parent';
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
});
test('Parent navigator registers pickup without replacing leave/chat/notifications', async () => {
  await act(async () => {
    tree = Renderer.create(<ParentNavigator />);
  });
  const routes = tree.root
    .findAll(
      node =>
        typeof node.type === 'string' && String(node.type) === 'StackScreen',
    )
    .map(node => node.props.name);
  expect(routes).toEqual(
    expect.arrayContaining([
      'ParentPickupPersons',
      'ParentEarlyExitRequests',
      'ParentLeaveApplications',
      'ParentChat',
      'ParentNotifications',
      'ParentWorkspace',
    ]),
  );
});
test('Parent workspace Pickup Persons entry opens the real authenticated route', async () => {
  await act(async () => {
    tree = Renderer.create(<ParentWorkspace />);
  });
  await act(async () =>
    tree.root
      .findAllByType(Button)
      .find(node => node.props.title === 'Pickup Persons')!
      .props.onPress(),
  );
  expect(mockNavigate).toHaveBeenCalledWith('ParentPickupPersons');
});
test('Principal navigator preserves typed leave, canonical approvals and attendance routes', async () => {
  mockRole = 'principal';
  await act(async () => {
    tree = Renderer.create(<PrincipalNavigator />);
  });
  const routes = tree.root
    .findAll(
      node =>
        typeof node.type === 'string' && String(node.type) === 'StackScreen',
    )
    .map(node => node.props.name);
  expect(routes).toEqual(
    expect.arrayContaining([
      'PickupAuthorizationReviews',
      'PickupAuthorizationReview',
      'EarlyExitReviews',
      'EarlyExitReview',
      'ParentLeaveReview',
      'ApprovalDetail',
      'Attendance',
      'SafetyOverview',
      'Tasks',
    ]),
  );
});
test('Principal workspace exposes dedicated review navigation without a fabricated count', async () => {
  mockRole = 'principal';
  await act(async () => {
    tree = Renderer.create(<PrincipalWorkspace />);
  });
  await act(async () =>
    tree.root
      .findAllByType(Button)
      .find(node => node.props.title === 'Pickup Authorization Reviews')!
      .props.onPress(),
  );
  expect(mockNavigate).toHaveBeenCalledWith('PickupAuthorizationReviews');
});

test('Parent workspace Early Exit entry uses the authenticated route', async () => {
  await act(async () => { tree = Renderer.create(<ParentWorkspace />); });
  await act(async () => tree.root.findAllByType(Button).find(node => node.props.title === 'Early Exit Requests')!.props.onPress());
  expect(mockNavigate).toHaveBeenCalledWith('ParentEarlyExitRequests');
});

test('Principal workspace Early Exit entry uses its dedicated typed queue', async () => {
  mockRole = 'principal';
  await act(async () => { tree = Renderer.create(<PrincipalWorkspace />); });
  await act(async () => tree.root.findAllByType(Button).find(node => node.props.title === 'Early Exit Reviews')!.props.onPress());
  expect(mockNavigate).toHaveBeenCalledWith('EarlyExitReviews');
});
