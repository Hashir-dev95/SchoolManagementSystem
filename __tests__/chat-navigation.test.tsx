import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import AppNavigator from '../src/navigation/AppNavigator';
import TeacherWorkspaceScreen from '../src/screens/teacher/TeacherWorkspaceScreen';
import StudentWorkspaceScreen from '../src/screens/student/StudentWorkspaceScreen';
import ParentWorkspaceScreen from '../src/screens/parent/ParentWorkspaceScreen';
import ChatWorkspaceScreen from '../src/screens/chat/ChatWorkspaceScreen';
import type { UserRole } from '../src/constants/roles';
import { chatService } from '../src/services/chat/chatService';
import { ApiError } from '../src/services/api/apiClient';

let mockRole: UserRole = 'teacher';
const mockNavigate = jest.fn(),
  mockLogout = jest.fn();
jest.mock('../src/context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    user: { id: 'self', role: mockRole, fullName: 'Self' },
    accessToken: 'session',
    logout: mockLogout,
  }),
}));
jest.mock('@react-navigation/native', () => ({
  NavigationContainer: 'NavigationContainer',
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(effect, [effect]);
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
jest.mock('../src/screens/teacher/useTeacherResource', () => ({
  useTeacherResource: () => ({
    data: [],
    loading: false,
    error: null,
    refresh: jest.fn(),
  }),
}));
jest.mock('../src/screens/teacher/TeacherHomeScreen', () => () => null);
jest.mock('../src/screens/teacher/TeacherClassesScreen', () => () => null);
jest.mock('../src/screens/teacher/TeacherInboxScreen', () => () => null);
jest.mock('../src/services/student/workspaceService', () => ({
  studentWorkspaceService: {
    profile: jest.fn().mockRejectedValue(new Error('profile unavailable')),
    enrollment: jest.fn().mockResolvedValue(null),
  },
}));
jest.mock('../src/services/parent/parentService', () => ({
  parentService: {
    me: jest.fn().mockResolvedValue({ fullName: 'Parent' }),
    children: jest.fn().mockResolvedValue({ items: [] }),
  },
}));
jest.mock('../src/services/chat/chatService', () => ({
  chatOperationId: () => 'chat_00000000000000000000000000000001',
  chatService: { detail: jest.fn(), history: jest.fn(), list: jest.fn() },
}));
let tree: Renderer.ReactTestRenderer | undefined;
async function mount(element: React.ReactElement) {
  await act(async () => {
    tree = Renderer.create(element);
  });
}
async function press(label: string) {
  const node = tree!.root.findAll(
    item =>
      item.props.accessibilityLabel === label &&
      typeof item.props.onPress === 'function',
  )[0];
  expect(node).toBeDefined();
  await act(async () => node.props.onPress());
}
beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'teacher';
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
});

test.each([
  ['teacher', 'TeacherChat'],
  ['student', 'StudentChat'],
  ['parent', 'ParentChat'],
] as const)(
  '%s has exactly one shared Messages screen in the existing root navigator',
  async (role, route) => {
    mockRole = role;
    await mount(<AppNavigator />);
    const screens = tree!.root.findAll(
      node => String(node.type) === 'StackScreen',
    );
    expect(
      screens
        .filter(node => node.props.component === ChatWorkspaceScreen)
        .map(node => node.props.name),
    ).toEqual([route]);
    expect(
      tree!.root.findAll(node => String(node.type) === 'NavigationContainer'),
    ).toHaveLength(1);
    const owner = screens.find(node => node.props.name === route)!;
    expect(owner.props.initialParams).toBeUndefined();
  },
);
test('Teacher Me opens Messages without replacing the separate notice Inbox', async () => {
  await mount(
    <TeacherWorkspaceScreen
      navigation={{ navigate: mockNavigate } as never}
      route={{ key: 'workspace', name: 'TeacherWorkspace' }}
    />,
  );
  await press('Me');
  await press('Messages');
  expect(mockNavigate).toHaveBeenCalledWith('TeacherChat');
  expect(
    tree!.root.findAll(node => node.props.accessibilityLabel === 'Inbox')
      .length,
  ).toBeGreaterThan(0);
});
test('Student workspace opens account Messages without authority parameters', async () => {
  mockRole = 'student';
  await mount(<StudentWorkspaceScreen />);
  await press('Messages');
  expect(mockNavigate).toHaveBeenCalledWith('StudentChat');
});
test('Parent with no selected or verified child still opens account Messages', async () => {
  mockRole = 'parent';
  await mount(<ParentWorkspaceScreen />);
  await press('Messages');
  expect(mockNavigate).toHaveBeenCalledWith('ParentChat');
});
test.each(['teacher', 'student', 'parent'] as const)(
  '%s existing chat screen consumes a notification route target through F4 detail, not route authority',
  async role => {
    mockRole = role;
    const targetId = 'abcdef0123456789abcdef01';
    jest
      .mocked(chatService.detail)
      .mockRejectedValueOnce(new ApiError(403, 'revoked relationship'));
    await mount(
      <ChatWorkspaceScreen route={{ params: { conversationId: targetId } }} />,
    );
    expect(chatService.detail).toHaveBeenCalledWith('session', targetId);
    expect(chatService.history).not.toHaveBeenCalled();
    expect(JSON.stringify(tree!.toJSON())).toContain(
      'This conversation is unavailable',
    );
  },
);
