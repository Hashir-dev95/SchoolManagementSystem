import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import StudentWorkspaceScreen from '../src/screens/student/StudentWorkspaceScreen';
import StudentNavigator from '../src/navigation/StudentNavigator';
import { studentWorkspaceService } from '../src/services/student/workspaceService';
import { ApiError } from '../src/services/api/apiClient';
import type { User } from '../src/types/auth';
import { fees } from './helpers/fee-fixture';

let mockUser: User | null = {
  id: 'student-a',
  fullName: 'Student A',
  email: 'a@test.invalid',
  role: 'student',
};
let mockToken: string | null = 'real-token';
const mockNavigate = jest.fn(),
  mockLogout = jest.fn();
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    accessToken: mockToken,
    logout: mockLogout,
  }),
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
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../src/services/student/workspaceService', () => ({
  studentWorkspaceService: {
    profile: jest.fn(),
    enrollment: jest.fn(),
    timetable: jest.fn(),
    attendance: jest.fn(),
    homework: jest.fn(),
    quizzes: jest.fn(),
    results: jest.fn(),
    fees: jest.fn(),
  },
}));
const service = jest.mocked(studentWorkspaceService);
let tree: Renderer.ReactTestRenderer;
async function mount(element = <StudentWorkspaceScreen />) {
  await act(async () => {
    tree = Renderer.create(element);
  });
}
function text() {
  return JSON.stringify(tree.toJSON());
}
async function press(label: string) {
  const target = tree.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  )[0];
  expect(target).toBeDefined();
  await act(async () => target.props.onPress());
}
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = {
    id: 'student-a',
    fullName: 'Student A',
    email: 'a@test.invalid',
    role: 'student',
  };
  mockToken = 'real-token';
  service.profile.mockResolvedValue({
    studentId: 'self-id',
    fullName: 'Server Student',
    email: 'server@test.invalid',
    admissionNumber: 'A1',
  });
  service.enrollment.mockResolvedValue({
    enrollmentId: 'e1',
    status: 'active',
    effectiveFrom: '2026-01-01',
    branch: { id: 'b', name: 'Own Branch' },
    schoolClass: { id: 'c', name: 'Enrollment Class' },
    section: { id: 's', name: 'Section A' },
    academicPeriod: { id: 'p', name: 'Current Term' },
  });
  service.timetable.mockResolvedValue({
    date: '2026-10-31',
    items: [
      {
        periodId: 'p1',
        date: '2026-10-31',
        startTime: '08:00',
        endTime: '08:45',
        room: 'Room 1',
        subject: 'Maths',
        teacher: 'Effective Teacher',
        isSubstitute: true,
      },
    ],
  });
  service.attendance.mockResolvedValue({
    date: '2026-10-31',
    kind: 'physical',
    items: [
      {
        periodId: 'p1',
        date: '2026-10-31',
        startTime: '08:00',
        endTime: '08:45',
        room: 'Room 1',
        subject: 'Maths',
        teacher: 'Teacher',
        isSubstitute: false,
        status: null,
        state: 'unmarked',
      },
    ],
  });
  service.homework.mockResolvedValue({
    items: [
      {
        id: 'h1',
        type: 'homework',
        title: 'Own Homework',
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
  if (tree) {
    await act(async () => tree.unmount());
  }
});
test('Student navigator starts at canonical workspace and retains both live lesson routes', async () => {
  await mount(<StudentNavigator />);
  expect(
    tree.root.findAll(node => String(node.type) === 'StackNavigator')[0].props
      .initialRouteName,
  ).toBe('StudentWorkspace');
  expect(
    tree.root
      .findAll(node => String(node.type) === 'StackScreen')
      .map(node => node.props.name),
  ).toEqual(['StudentWorkspace', 'StudentLiveLessons', 'StudentLiveRoom']);
});
test('profile and placement display real self-service enrollment data', async () => {
  await mount();
  expect(text()).toContain('Server Student');
  expect(text()).toContain('Enrollment Class');
  expect(service.profile).toHaveBeenCalledWith('real-token');
  expect(text()).not.toContain('FICTIONAL');
});
test('timetable uses effective Teacher and attendance keeps unmarked separate from absence', async () => {
  await mount();
  await press('Timetable');
  expect(text()).toContain('Effective Teacher');
  await press('Attendance');
  expect(text()).toContain('Unmarked');
  expect(text()).toContain('Physical attendance only');
  expect(text()).not.toContain('absent');
});
test('homework/quiz/results use read-only cards and honest empty states', async () => {
  await mount();
  await press('Homework');
  expect(text()).toContain('Own Homework');
  expect(text()).toContain('Read-only assigned work');
  await press('Quiz');
  expect(text()).toContain('No assigned published');
  await press('Results');
  expect(text()).toContain('No published results.');
});
test('fees uses canonical self data and displays server-derived balance', async () => {
  await mount();
  const calls = Object.values(service).reduce(
    (sum, method) => sum + method.mock.calls.length,
    0,
  );
  await press('Fees');
  expect(text()).toContain('Canonical tuition');
  expect(text()).toContain('PKR 300.00');
  expect(service.fees).toHaveBeenCalledWith('real-token');
  expect(
    Object.values(service).reduce(
      (sum, method) => sum + method.mock.calls.length,
      0,
    ),
  ).toBe(calls + 1);
});
test('published quiz metadata and safe result fields render without submission controls', async () => {
  service.quizzes.mockResolvedValueOnce({
    items: [
      {
        id: 'q1',
        type: 'quiz',
        title: 'Published Quiz',
        instructions: 'Revision instructions',
        publishedRevision: 1,
        dueAt: null,
        availableFrom: '2026-10-01',
        availableUntil: '2026-11-01',
      },
    ],
    readOnly: true,
  });
  service.results.mockResolvedValueOnce({
    items: [
      {
        resultId: 'r1',
        subject: { subjectId: 's1', name: 'Mathematics' },
        assessment: {
          type: 'quiz',
          title: 'Published Score',
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
  await press('Quiz');
  expect(text()).toContain('Published Quiz');
  await press('Results');
  expect(text()).toContain('Published Score');
  expect(text()).toContain('Released feedback');
  expect(
    tree.root.findAll(node => node.props.accessibilityLabel === 'Submit'),
  ).toHaveLength(0);
});
test('loading, forbidden and retry never use fictional data', async () => {
  let reject!: (error: Error) => void;
  service.profile.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await mount();
  expect(text()).toContain('Loading your school overview');
  await act(async () => reject(new ApiError(403, 'Forbidden')));
  expect(text()).toContain('Forbidden:');
  expect(text()).not.toContain('Server Student');
  expect(text()).not.toContain('Amina');
  const retry = tree.root.findAll(
    node =>
      node.props.children === 'Tap to try again' &&
      typeof node.props.onPress === 'function',
  )[0];
  await act(async () => retry.props.onPress());
  expect(text()).toContain('Server Student');
});
test('network failure is an error and does not become an empty success', async () => {
  service.profile.mockRejectedValueOnce(new Error('Offline'));
  await mount();
  expect(text()).toContain('Could not load your school records');
  expect(text()).not.toContain('Current enrollment');
});
test('logout and live lessons use canonical actions', async () => {
  await mount();
  await press('Live lessons');
  expect(mockNavigate).toHaveBeenCalledWith('StudentLiveLessons');
  await press('Sign out');
  expect(mockLogout).toHaveBeenCalledTimes(1);
});
test('an old request cannot populate another pane or another signed-in Student', async () => {
  let release!: (data: Awaited<ReturnType<typeof service.profile>>) => void;
  service.profile.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        release = resolve;
      }),
  );
  await mount();
  await press('Results');
  await act(async () =>
    release({
      studentId: 'old',
      fullName: 'STALE PRIVATE NAME',
      email: 'old@test.invalid',
      admissionNumber: 'old',
    }),
  );
  expect(text()).not.toContain('STALE PRIVATE NAME');
  mockUser = { ...mockUser!, id: 'student-b' };
  mockToken = 'new-token';
  await act(async () => tree.update(<StudentWorkspaceScreen />));
  expect(service.profile).toHaveBeenLastCalledWith('new-token');
  expect(text()).not.toContain('STALE PRIVATE NAME');
});
