import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import AppNavigator from '../src/navigation/AppNavigator';
import TeacherNavigator from '../src/navigation/TeacherNavigator';
import { USER_ROLES, UserRole } from '../src/constants/roles';

let mockRole: UserRole | null = null;
jest.mock('../src/context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ user: mockRole ? { role: mockRole } : null }),
}));
jest.mock('@react-navigation/native', () => ({
  NavigationContainer: 'NavigationContainer',
}));
jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: 'StackNavigator',
    Screen: 'StackScreen',
  }),
}));
jest.mock('../src/navigation/AuthNavigator', () => () => 'Auth');
jest.mock('../src/navigation/PrincipalNavigator', () => () => 'Principal');
jest.mock('../src/navigation/SuperAdminNavigator', () => () => 'SuperAdmin');
jest.mock(
  '../src/screens/teacher/TeacherWorkspaceScreen',
  () => () => 'TeacherWorkspace',
);
jest.mock('../src/screens/teacher/TeacherRosterScreen', () => () => 'Roster');

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
  await act(async () => {
    trees.splice(0).forEach(tree => tree.unmount());
  });
});
test.each([
  [null, 'Auth'],
  [USER_ROLES.PRINCIPAL, 'Principal'],
  [USER_ROLES.SUPER_ADMIN, 'SuperAdmin'],
])(
  'role %s preserves its existing destination and a single root container',
  async (role, expected) => {
    mockRole = role;
    const tree = await render(<AppNavigator />);
    expect(JSON.stringify(tree.toJSON())).toContain(expected);
    expect(
      tree.root.findAll(node => String(node.type) === 'NavigationContainer'),
    ).toHaveLength(1);
  },
);
test('authenticated Teacher enters the Teacher stack with no duplicate route owners', async () => {
  mockRole = USER_ROLES.TEACHER;
  const tree = await render(<AppNavigator />);
  expect(tree.root.findAllByType(TeacherNavigator)).toHaveLength(1);
  expect(
    tree.root.findAll(node => String(node.type) === 'NavigationContainer'),
  ).toHaveLength(1);
  expect(
    tree.root
      .findAll(node => String(node.type) === 'StackScreen')
      .map(node => node.props.name),
  ).toEqual([
    'TeacherWorkspace',
    'TeacherRoster',
    'TeacherTimetable',
    'TeacherPeriod',
    'TeacherAttendanceQueue',
    'TeacherAttendance',
  ]);
});
