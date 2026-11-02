import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import ParentWorkspaceScreen from '../src/screens/parent/ParentWorkspaceScreen';
import ParentNavigator from '../src/navigation/ParentNavigator';
import AppNavigator from '../src/navigation/AppNavigator';
import { parentService } from '../src/services/parent/parentService';
import type { VerifiedChild } from '../src/services/parent/parentService';
import { ApiError } from '../src/services/api/apiClient';
import type { User } from '../src/types/auth';
import { fees } from './helpers/fee-fixture';

let mockUser: User = {
  id: 'parent-a',
  fullName: 'Parent A',
  email: 'parent@test.invalid',
  role: 'parent',
};
const mockLogout = jest.fn();
const mockNavigate = jest.fn();
jest.mock('../src/context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    user: mockUser,
    accessToken: 'parent-token',
    logout: mockLogout,
  }),
}));
jest.mock('@react-navigation/native', () => ({
  NavigationContainer: 'NavigationContainer',
  useNavigation: () => ({ navigate: mockNavigate }),
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
    me: jest.fn(),
    children: jest.fn(),
    child: jest.fn(),
    enrollment: jest.fn(),
    timetable: jest.fn(),
    attendance: jest.fn(),
    homework: jest.fn(),
    quizzes: jest.fn(),
    results: jest.fn(),
    fees: jest.fn(),
  },
}));
const service = jest.mocked(parentService);
const child = (id: string): VerifiedChild => ({
  studentId: id,
  fullName: `Child ${id}`,
  email: `${id}@test.invalid`,
  admissionNumber: id,
  relationship: 'guardian',
  enrollment: {
    enrollmentId: id,
    status: 'active',
    effectiveFrom: '2026-01-01',
    branch: { id: 'branch', name: 'Own Branch' },
    schoolClass: { id: 'class', name: 'Grade 8' },
    section: { id: 'section', name: 'A' },
    academicPeriod: { id: 'term', name: 'Current Term' },
  },
});
const label = (id: string) => `Child ${id} · Own Branch · Grade 8 A · ${id}`;
let tree: Renderer.ReactTestRenderer;
async function mount(element = <ParentWorkspaceScreen />) {
  await act(async () => {
    tree = Renderer.create(element);
  });
}
const text = () => JSON.stringify(tree.toJSON());
async function press(labelValue: string) {
  const button = tree.root.findAll(
    node =>
      node.props.accessibilityLabel === labelValue &&
      typeof node.props.onPress === 'function',
  )[0];
  expect(button).toBeDefined();
  await act(async () => button.props.onPress());
}
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = {
    id: 'parent-a',
    fullName: 'Parent A',
    email: 'parent@test.invalid',
    role: 'parent',
  };
  service.me.mockResolvedValue({ fullName: 'Authenticated Parent' });
  service.children.mockResolvedValue({ items: [child('A'), child('B')] });
  service.child.mockImplementation(async (_token, id) => ({
    ...child(id),
    fullName: `Private profile ${id}`,
  }));
  service.enrollment.mockResolvedValue(child('A').enrollment);
  service.timetable.mockResolvedValue({
    date: '2026-10-31',
    items: [
      {
        periodId: 'p',
        date: '2026-10-31',
        startTime: '09:00',
        endTime: '09:45',
        subject: 'Mathematics',
        teacher: 'Effective Teacher',
        room: 'Room 2',
        isSubstitute: true,
      },
    ],
  });
  service.attendance.mockResolvedValue({
    date: '2026-10-31',
    kind: 'physical',
    items: [
      {
        periodId: 'p',
        date: '2026-10-31',
        startTime: '09:00',
        endTime: '09:45',
        subject: 'Mathematics',
        teacher: 'Teacher',
        room: 'Room 2',
        isSubstitute: false,
        status: null,
        state: 'unmarked',
      },
    ],
  });
  service.homework.mockResolvedValue({
    items: [
      {
        id: 'h',
        type: 'homework',
        title: 'Authorized homework',
        instructions: 'Practice',
        publishedRevision: 1,
        dueAt: '2026-11-01',
        availableFrom: null,
        availableUntil: null,
      },
    ],
    readOnly: true,
  });
  service.quizzes.mockResolvedValue({ items: [], readOnly: true });
  service.results.mockResolvedValue({ items: [], total: 0 });
  service.fees.mockResolvedValue(fees);
  mockLogout.mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => tree.unmount());
});
test('canonical Parent routing uses one existing root NavigationContainer', async () => {
  await mount(<AppNavigator />);
  expect(tree.root.findAllByType(ParentNavigator)).toHaveLength(1);
  expect(
    tree.root.findAll(node => String(node.type) === 'NavigationContainer'),
  ).toHaveLength(1);
  expect(
    tree.root
      .findAll(node => String(node.type) === 'StackScreen')
      .map(node => node.props.name),
  ).toEqual(['ParentNotifications', 'ParentWorkspace']);
});
test('Parent notifications opens account inbox independently of verified child selection', async () => {
  service.children.mockResolvedValue({ items: [] });
  await mount();
  await press('Notifications');
  expect(mockNavigate).toHaveBeenCalledWith('ParentNotifications');
  expect(service.child).not.toHaveBeenCalled();
});
test('verified selector retains Branch/Class/Section and child details come from canonical API', async () => {
  await mount();
  expect(text()).toContain(label('A'));
  expect(text()).toContain('Private profile A');
  expect(service.child).toHaveBeenCalledWith('parent-token', 'A');
  expect(text()).not.toContain('FICTIONAL');
});
test('switching child remounts private state and requests only the selected child', async () => {
  await mount();
  await press(label('B'));
  expect(service.child).toHaveBeenLastCalledWith('parent-token', 'B');
  expect(text()).toContain('Private profile B');
  expect(text()).not.toContain('Private profile A');
});
test('enrollment, timetable and physical attendance use canonical panes', async () => {
  await mount();
  await press('Enrollment');
  expect(text()).toContain('Current Term');
  await press('Timetable');
  expect(text()).toContain('Effective Teacher');
  await press('Attendance');
  expect(text()).toContain('Unmarked');
  expect(text()).toContain('Physical attendance only');
  expect(text()).not.toContain('absent');
});
test('academic panes are read-only and empty results are honest', async () => {
  await mount();
  await press('Homework');
  expect(text()).toContain('Authorized homework');
  await press('Quiz');
  expect(text()).toContain('No authorized published work');
  await press('Results');
  expect(text()).toContain('No published results');
});
test('safe published result rendering excludes any write controls', async () => {
  service.results.mockResolvedValueOnce({
    items: [
      {
        resultId: 'r',
        subject: { subjectId: 's', name: 'Maths' },
        assessment: {
          type: 'quiz',
          title: 'Published assessment',
          publishedRevision: 1,
        },
        awardedMarks: 8,
        maxMarks: 10,
        percentage: 80,
        publishedAt: '2026-10-31',
        releasedFeedback: {
          feedback: 'Released feedback',
          releasedAt: '2026-10-31',
        },
      },
    ],
    total: 1,
  });
  await mount();
  await press('Results');
  expect(text()).toContain('Published assessment');
  expect(text()).toContain('Released feedback');
  expect(
    tree.root.findAll(node => node.props.accessibilityLabel === 'Submit'),
  ).toHaveLength(0);
});
test('fees requests real verified-child data and renders canonical balances', async () => {
  await mount();
  const before = Object.values(service).reduce(
    (sum, method) => sum + method.mock.calls.length,
    0,
  );
  await press('Fees');
  expect(text()).toContain('Canonical tuition');
  expect(text()).toContain('PKR 300.00');
  expect(service.fees).toHaveBeenCalledWith('parent-token', 'A');
  expect(
    Object.values(service).reduce(
      (sum, method) => sum + method.mock.calls.length,
      0,
    ),
  ).toBe(before + 1);
});
test('empty verified-child list renders no child data or fallback children', async () => {
  service.children.mockResolvedValueOnce({ items: [] });
  await mount();
  expect(text()).toContain('No verified children');
  expect(service.child).not.toHaveBeenCalled();
});
test.each([
  [403, 'Forbidden:'],
  [401, 'Session expired'],
])(
  'child read denial %s clears data and reports its real state',
  async (status, expected) => {
    service.child.mockRejectedValueOnce(new ApiError(Number(status), 'Denied'));
    await mount();
    expect(text()).toContain(expected);
    expect(text()).not.toContain('Private profile A');
  },
);
test('network failure supports retry without sample fallback', async () => {
  service.children.mockRejectedValueOnce(new Error('Offline'));
  await mount();
  expect(text()).toContain('Could not load school records');
  const retry = tree.root.findAll(
    node =>
      node.props.children === 'Tap to try again' &&
      typeof node.props.onPress === 'function',
  )[0];
  await act(async () => retry.props.onPress());
  expect(text()).toContain('Private profile A');
});
test('late responses cannot display another child or another Parent session data', async () => {
  let release!: (value: VerifiedChild) => void;
  service.child.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        release = resolve;
      }),
  );
  await mount();
  expect(text()).toContain('Loading your school overview');
  await press(label('B'));
  await act(async () =>
    release({ ...child('A'), fullName: 'STALE PRIVATE CHILD' }),
  );
  expect(text()).not.toContain('STALE PRIVATE CHILD');
  service.children.mockResolvedValueOnce({ items: [] });
  mockUser = { ...mockUser, id: 'parent-b' };
  await act(async () => tree.update(<ParentWorkspaceScreen />));
  expect(text()).toContain('No verified children');
  expect(text()).not.toContain('Private profile B');
});
test('sign out delegates to canonical logout', async () => {
  await mount();
  await press('Sign out');
  expect(mockLogout).toHaveBeenCalledTimes(1);
});
