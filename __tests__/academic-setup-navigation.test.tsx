import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import PrincipalNavigator from '../src/navigation/PrincipalNavigator';
import SuperAdminNavigator from '../src/navigation/SuperAdminNavigator';
import TeacherNavigator from '../src/navigation/TeacherNavigator';
import Workspace from '../src/screens/principal/PrincipalWorkspaceScreen';
import Settings from '../src/screens/superAdmin/SuperAdminSettingsScreen';
import {Button} from '../src/components/hiraDashboard';
const mockNavigate = jest.fn();
const {readFileSync} = require('fs') as {readFileSync: (path: string, encoding: string) => string};
jest.mock('../src/context/AuthContext', () => ({useAuth: () => ({user: {role: 'principal', fullName: 'Principal'}, logout: jest.fn()})}));
jest.mock('@react-navigation/native', () => ({useNavigation: () => ({navigate: mockNavigate})}));
jest.mock('@react-navigation/native-stack', () => ({createNativeStackNavigator: () => ({Navigator: 'StackNavigator', Screen: 'StackScreen'})}));
jest.mock('react-native-safe-area-context', () => ({SafeAreaView: 'SafeAreaView'}));
jest.mock('../src/screens/principal/PrincipalDashboardScreen', () => () => 'Principal Home');
jest.mock('../src/screens/principal/PrincipalApprovalsScreen', () => () => 'Approvals');
jest.mock('../src/screens/principal/PrincipalInboxScreen', () => () => 'Inbox');
const trees: Renderer.ReactTestRenderer[] = [];
async function render(element: React.ReactElement) {let tree!: Renderer.ReactTestRenderer; await act(async () => {tree = Renderer.create(element);}); trees.push(tree); return tree;}
afterEach(async () => {await act(async () => trees.splice(0).forEach(t => t.unmount())); jest.clearAllMocks();});
test('Principal and Super Admin register Academic Setup; Teacher does not', async () => {
  for (const [Component, present] of [[PrincipalNavigator, true], [SuperAdminNavigator, true], [TeacherNavigator, false]] as const) {
    const tree = await render(<Component />);
    const routes = tree.root.findAll(n => String(n.type) === 'StackScreen').map(n => n.props.name);
    expect(routes.includes('AcademicSetup')).toBe(present);
  }
});
test('Principal drawer opens the dedicated Academic Setup destination', async () => {
  const tree = await render(<Workspace />);
  const action = (label: string) => tree.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
  await act(async () => action('Open navigation drawer').props.onPress());
  await act(async () => action('Academic Setup').props.onPress());
  expect(mockNavigate).toHaveBeenCalledWith('AcademicSetup');
});
test('Super Admin Settings provides period governance entry', async () => {
  const tree = await render(<Settings />);
  await act(async () => tree.root.findAllByType(Button).find(n => n.props.title === 'Academic Setup')!.props.onPress());
  expect(mockNavigate).toHaveBeenCalledWith('AcademicSetup');
});
test('Principal and Super Admin Home contain no setup CRUD entries', () => {
  for (const file of ['src/screens/principal/PrincipalDashboardScreen.tsx', 'src/screens/superAdmin/SuperAdminDashboardScreen.tsx']) {
    const source = readFileSync(file, 'utf8');
    expect(source).not.toMatch(/Create (?:Class|Section|Subject|Academic Period)|navigate\(['"]AcademicSetup/);
  }
});
