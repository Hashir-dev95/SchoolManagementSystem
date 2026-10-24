import React from 'react';
import Renderer, { act } from 'react-test-renderer';
const { readFileSync } = require('fs') as {
  readFileSync: (path: string, encoding: string) => string;
};
import Workspace from '../src/screens/principal/PrincipalWorkspaceScreen';
import PrincipalNavigator from '../src/navigation/PrincipalNavigator';
import SuperAdminNavigator from '../src/navigation/SuperAdminNavigator';
import TeacherNavigator from '../src/navigation/TeacherNavigator';
import Dashboard from '../src/screens/superAdmin/SuperAdminDashboardScreen';
let mockRole = 'principal';
const mockNavigate = jest.fn();
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({
    user: { role: mockRole, fullName: 'Admin' },
    accessToken: 'admin-token',
    logout: jest.fn(),
  }),
}));
jest.mock('../src/services/admin/adminService', () => ({
  adminService: {
    getDashboard: jest.fn().mockResolvedValue({
      data: { branches: { total: 0, active: 0, inactive: 0, list: [] } },
    }),
    getSystemHealth: jest.fn().mockResolvedValue({ data: null }),
    getBackupStatus: jest.fn().mockResolvedValue({ data: null }),
    getUsageStatus: jest.fn().mockResolvedValue({ data: null }),
    getPendingPrivilegedRequests: jest
      .fn()
      .mockResolvedValue({ data: { requests: [] } }),
    getAutomations: jest.fn().mockResolvedValue({ data: { automations: [] } }),
    getSessions: jest.fn().mockResolvedValue({ data: { sessions: [] } }),
  },
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));
jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: 'StackNavigator',
    Screen: 'StackScreen',
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}));
jest.mock(
  '../src/screens/principal/PrincipalDashboardScreen',
  () => () => 'Principal Home'
);
jest.mock(
  '../src/screens/principal/PrincipalApprovalsScreen',
  () => () => 'Approvals'
);
jest.mock('../src/screens/principal/PrincipalInboxScreen', () => () => 'Inbox');
const trees: Renderer.ReactTestRenderer[] = [];
async function render(element: React.ReactElement) {
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(element);
  });
  trees.push(tree);
  return tree;
}
afterEach(async () => {
  for (const tree of trees.splice(0)) await act(async () => tree.unmount());
  jest.clearAllMocks();
  mockRole = 'principal';
});
test('Principal drawer opens Timetable under existing academic administration', async () => {
  const tree = await render(<Workspace />);
  const action = (label: string) =>
    tree.root.findAll(
      (n) =>
        n.props.accessibilityLabel === label &&
        typeof n.props.onPress === 'function'
    )[0];
  await act(async () => action('Open navigation drawer').props.onPress());
  await act(async () => action('Manage Timetable').props.onPress());
  expect(mockNavigate).toHaveBeenCalledWith('TimetableAdmin');
});
test('only admin role stacks register the Timetable destination and keep native back navigation', async () => {
  for (const [Component, present] of [
    [PrincipalNavigator, true],
    [SuperAdminNavigator, true],
    [TeacherNavigator, false],
  ] as const) {
    const tree = await render(<Component />);
    const route = tree.root.findAll(
      (n) =>
        String(n.type) === 'StackScreen' && n.props.name === 'TimetableAdmin'
    );
    expect(route.length > 0).toBe(present);
    if (present) expect(route[0].props.options.headerShown).not.toBe(false);
  }
});
test('Super Admin Administration exposes Academic Management timetable action', async () => {
  mockRole = 'super_admin';
  const tree = await render(<Dashboard />);
  const tab = tree.root.findAll(
    (n) =>
      n.props.accessibilityLabel === 'Administration' &&
      typeof n.props.onPress === 'function'
  )[0];
  await act(async () => tab.props.onPress());
  await act(async () =>
    tree.root
      .findAll(
        (n) =>
          n.props.accessibilityLabel === 'Manage Timetable' &&
          typeof n.props.onPress === 'function'
      )[0]
      .props.onPress()
  );
  expect(mockNavigate).toHaveBeenCalledWith('TimetableAdmin');
});
test('Principal Home has no standalone Timetable shortcut', () => {
  expect(
    readFileSync('src/screens/principal/PrincipalDashboardScreen.tsx', 'utf8')
  ).not.toMatch(/TimetableEntry|onOpenTimetable/);
});

test('Rooms is registered only in admin stacks with native Back header', async () => {
  for (const [Component, present] of [
    [PrincipalNavigator, true],
    [SuperAdminNavigator, true],
    [TeacherNavigator, false],
  ] as const) {
    const tree = await render(<Component />);
    const routes = tree.root.findAll(
      (n) => String(n.type) === 'StackScreen' && n.props.name === 'Rooms'
    );
    expect(routes.length > 0).toBe(present);
    if (present) expect(routes[0].props.options.headerShown).toBe(true);
  }
});
test('Principal Rooms destination uses Academic Administration drawer', async () => {
  const tree = await render(<Workspace />);
  const action = (label: string) =>
    tree.root.findAll(
      (n) =>
        n.props.accessibilityLabel === label &&
        typeof n.props.onPress === 'function'
    )[0];
  await act(async () => action('Open navigation drawer').props.onPress());
  await act(async () => action('Rooms').props.onPress());
  expect(mockNavigate).toHaveBeenCalledWith('Rooms');
});
test('Super Admin Rooms destination lives in Administration Academic Management', async () => {
  mockRole = 'super_admin';
  const tree = await render(<Dashboard />);
  const action = (label: string) =>
    tree.root.findAll(
      (n) =>
        n.props.accessibilityLabel === label &&
        typeof n.props.onPress === 'function'
    )[0];
  await act(async () => action('Administration').props.onPress());
  await act(async () => action('Rooms').props.onPress());
  expect(mockNavigate).toHaveBeenCalledWith('Rooms');
});
