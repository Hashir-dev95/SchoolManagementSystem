import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import { Button, DashboardShell } from '../src/components/hiraDashboard';
import CreateTeacherScreen from '../src/screens/superAdmin/CreateTeacherScreen';
import SuperAdminDashboardScreen from '../src/screens/superAdmin/SuperAdminDashboardScreen';
import { TeacherProvisioningCard } from '../src/screens/superAdmin/TeacherProvisioningCard';
import SuperAdminNavigator from '../src/navigation/SuperAdminNavigator';
import { adminService } from '../src/services/admin/adminService';
import { apiClient } from '../src/services/api/apiClient';
let mockRole = 'super_admin';
const mockNavigate = jest.fn();
jest.setTimeout(20000);
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ user: { role: mockRole }, accessToken: 'admin-token' }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (effect: () => void | (() => void)) =>
    jest.requireActual('react').useEffect(effect, [effect]),
}));
jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: 'Navigator',
    Screen: 'Screen',
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}));
jest.mock('../src/services/api/apiClient', () => ({
  apiClient: { request: jest.fn() },
}));
const trees: Renderer.ReactTestRenderer[] = [];
let branchSpy: jest.SpyInstance, createSpy: jest.SpyInstance;
const confirmed = {
  success: true,
  message: 'Created',
  data: { id: 'teacher', role: 'teacher', branchId: 'branch' },
};
async function render(element = <CreateTeacherScreen />) {
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(element);
  });
  trees.push(tree);
  return tree;
}
const text = (tree: Renderer.ReactTestRenderer) =>
  JSON.stringify(tree.toJSON(), (key, value) =>
    key === 'props' ? undefined : value,
  );
const button = (tree: Renderer.ReactTestRenderer, title: string) =>
  tree.root.findAllByType(Button).find(n => n.props.title === title)!;
async function fill(tree: Renderer.ReactTestRenderer) {
  await act(async () => {
    const fields = tree.root.findAllByType(TextInput);
    fields[0].props.onChangeText('New Teacher');
    fields[1].props.onChangeText('Teacher@Example.com');
    fields[2].props.onChangeText('StrongPassword123!');
    button(tree, 'Branch A (AA)').props.onPress();
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'super_admin';
  branchSpy = jest.spyOn(adminService, 'getTeacherBranches').mockResolvedValue({
    success: true,
    data: [{ id: 'branch', name: 'Branch A', code: 'AA' }],
  });
  createSpy = jest
    .spyOn(adminService, 'createTeacher')
    .mockResolvedValue(confirmed as any);
});
afterEach(async () => {
  await act(async () => {
    trees.splice(0).forEach(t => t.unmount());
  });
  jest.restoreAllMocks();
});
test('authorized Administration entry opens the Teacher route in the real dashboard', async () => {
  jest.spyOn(adminService, 'getDashboard').mockResolvedValue({
    data: { branches: { total: 0, active: 0, inactive: 0, list: [] } },
  } as any);
  for (const method of [
    'getSystemHealth',
    'getBackupStatus',
    'getUsageStatus',
  ] as const)
    jest.spyOn(adminService, method).mockResolvedValue({ data: null } as any);
  jest
    .spyOn(adminService, 'getPendingPrivilegedRequests')
    .mockResolvedValue({ data: { requests: [] } } as any);
  jest
    .spyOn(adminService, 'getAutomations')
    .mockResolvedValue({ data: { automations: [] } } as any);
  jest
    .spyOn(adminService, 'getSessions')
    .mockResolvedValue({ data: { sessions: [] } } as any);
  const tree = await render(<SuperAdminDashboardScreen />);
  expect(text(tree)).toContain('Administration');
  const administration = tree.root.findAll(
    n =>
      n.props.accessibilityLabel === 'Administration' &&
      typeof n.props.onPress === 'function',
  )[0];
  await act(async () => administration.props.onPress());
  expect(tree.root.findAllByType(TeacherProvisioningCard)).toHaveLength(1);
  await act(async () => button(tree, 'Create Teacher').props.onPress());
  expect(mockNavigate).toHaveBeenCalledWith('CreateTeacher');
});
test('new route is registered and Principal/settings routes remain', async () => {
  const tree = await render(<SuperAdminNavigator />);
  expect(
    tree.root.findAll(n => String(n.type) === 'Navigator')[0].props
      .initialRouteName,
  ).toBe('SuperAdminDashboard');
  const routes = tree.root
    .findAll(n => String(n.type) === 'Screen')
    .map(n => n.props.name);
  expect(routes).toEqual(
    expect.arrayContaining([
      'CreateTeacher',
      'CreatePrincipal',
      'SuperAdminSettings',
      'SuperAdminDashboard',
      'SuperAdminBranchDetails',
    ]),
  );
});
test.each(['teacher', 'student', 'principal'])(
  '%s sees no provisioning entry or form',
  async role => {
    mockRole = role;
    expect(
      text(await render(<TeacherProvisioningCard onCreate={mockNavigate} />)),
    ).toBe('null');
    expect(text(await render())).toContain('Access restricted');
    expect(branchSpy).not.toHaveBeenCalled();
  },
);
test('loading branches disables creation and branch selection comes from the server', async () => {
  let resolve!: (value: any) => void;
  branchSpy.mockReturnValue(
    new Promise(r => {
      resolve = r;
    }),
  );
  const tree = await render();
  expect(button(tree, 'Create Teacher account').props.disabled).toBe(true);
  expect(
    tree.root.findAll(n => n.props.accessibilityLabel === 'Loading branches')
      .length,
  ).toBeGreaterThan(0);
  await act(async () =>
    resolve({
      success: true,
      data: [{ id: 'branch', name: 'Branch A', code: 'AA' }],
    }),
  );
  await fill(tree);
  expect(button(tree, 'Branch A (AA) — Selected')).toBeDefined();
});
test('validation prevents a request; password is secure and role has no input', async () => {
  const tree = await render();
  await act(async () => button(tree, 'Create Teacher account').props.onPress());
  expect(createSpy).not.toHaveBeenCalled();
  expect(text(tree)).toContain('Enter a name');
  const fields = tree.root.findAllByType(TextInput);
  expect(fields).toHaveLength(3);
  expect(fields[2].props.secureTextEntry).toBe(true);
  expect(text(tree)).toContain('Role: Teacher (fixed)');
});
test('success waits for confirmation; double-click sends once and explains separate assignments', async () => {
  let resolve!: (value: any) => void;
  createSpy.mockReturnValue(
    new Promise(r => {
      resolve = r;
    }),
  );
  const tree = await render();
  await fill(tree);
  await act(async () => {
    const press = button(tree, 'Create Teacher account').props.onPress;
    press();
    press();
  });
  expect(createSpy).toHaveBeenCalledTimes(1);
  expect(text(tree)).not.toContain('Teacher account created successfully.');
  expect(createSpy).toHaveBeenCalledWith('admin-token', {
    fullName: 'New Teacher',
    email: 'teacher@example.com',
    password: 'StrongPassword123!',
    branchId: 'branch',
  });
  await act(async () => resolve(confirmed));
  expect(text(tree)).toContain('Teacher account created successfully.');
  expect(text(tree)).toContain(
    'still requires class/section/subject assignment',
  );
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
});
test.each([
  'A user with this email already exists',
  'Permission denied',
  'Active branch is unavailable',
  'Network request failed',
])('failure %s retains credentials and branch', async message => {
  createSpy.mockRejectedValue(new Error(message));
  const tree = await render();
  await fill(tree);
  await act(async () => button(tree, 'Create Teacher account').props.onPress());
  expect(text(tree)).toContain(message);
  expect(tree.root.findAllByType(TextInput)[0].props.value).toBe('New Teacher');
  expect(tree.root.findAllByType(TextInput)[2].props.value).toBe(
    'StrongPassword123!',
  );
  expect(button(tree, 'Branch A (AA) — Selected')).toBeDefined();
  expect(text(tree)).not.toContain('Teacher account created successfully.');
});
test('branch error supports retry without clearing entered values', async () => {
  branchSpy.mockRejectedValueOnce(new Error('Branch request failed'));
  const tree = await render();
  expect(text(tree)).toContain('Branch request failed');
  await act(async () => button(tree, 'Retry branches').props.onPress());
  expect(button(tree, 'Branch A (AA)')).toBeDefined();
});
test('unconfirmed server response cannot produce success', async () => {
  createSpy.mockResolvedValue({
    success: false,
    data: { role: 'teacher' },
  } as any);
  const tree = await render();
  await fill(tree);
  await act(async () => button(tree, 'Create Teacher account').props.onPress());
  expect(text(tree)).toContain('Account creation was not confirmed');
  expect(tree.root.findAllByType(TextInput)).toHaveLength(3);
});
test('service sends only the supported DTO and authenticated Teacher endpoint', async () => {
  createSpy.mockRestore();
  branchSpy.mockRestore();
  jest.mocked(apiClient.request).mockResolvedValue(confirmed);
  await adminService.createTeacher('token', {
    fullName: 'Teacher',
    email: 't@example.com',
    password: 'StrongPassword123!',
    branchId: 'branch',
    role: 'super_admin',
  } as any);
  expect(apiClient.request).toHaveBeenCalledWith('/admin/teachers', {
    method: 'POST',
    token: 'token',
    body: {
      fullName: 'Teacher',
      email: 't@example.com',
      password: 'StrongPassword123!',
      branchId: 'branch',
    },
  });
  await adminService.getTeacherBranches('token');
  expect(apiClient.request).toHaveBeenCalledWith('/admin/teachers/branches', {
    token: 'token',
  });
});
test('late branch response cannot replace newer authoritative choices', async () => {
  let resolve!: (value: any) => void;
  branchSpy.mockReturnValueOnce(
    new Promise(r => {
      resolve = r;
    }),
  );
  const tree = await render();
  await act(async () => tree.root.findByType(DashboardShell).props.onRefresh());
  expect(button(tree, 'Branch A (AA)')).toBeDefined();
  await act(async () =>
    resolve({
      success: true,
      data: [{ id: 'stale', name: 'Stale Branch', code: 'OLD' }],
    }),
  );
  expect(text(tree)).not.toContain('Stale Branch');
  expect(button(tree, 'Branch A (AA)')).toBeDefined();
});
test('no active branches prevents submission', async () => {
  branchSpy.mockResolvedValue({ success: true, data: [] });
  const tree = await render();
  expect(text(tree)).toContain('No active branches');
  expect(button(tree, 'Create Teacher account').props.disabled).toBe(true);
});
