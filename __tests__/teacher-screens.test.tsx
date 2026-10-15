import React from 'react';
import { FlatList, TextInput, Text } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import TeacherWorkspaceScreen from '../src/screens/teacher/TeacherWorkspaceScreen';
import TeacherRosterScreen from '../src/screens/teacher/TeacherRosterScreen';
import {
  teacherService,
  TeacherAssignment,
} from '../src/services/teacher/teacherService';
import { TeacherButton } from '../src/screens/teacher/teacherUi';
import { ApiError } from '../src/services/api/apiClient';

jest.mock('../src/services/teacher/homeService', () => ({
  homeService: {
    getHome: jest.fn().mockResolvedValue({
      teacher: { id: 'teacher', fullName: 'Teacher One' },
      schoolDate: '2026-10-14',
      timezone: 'Asia/Karachi',
      hero: {
        state: 'no_periods',
        greeting: 'Good morning',
        periodCount: 0,
        currentOrNextPeriod: null,
      },
      primaryAction: null,
    }),
  },
}));
jest.mock('../src/services/teacher/teacherService', () => ({
  teacherService: { getAssignedClasses: jest.fn(), getRoster: jest.fn() },
}));
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({
    accessToken: 'token',
    user: {
      id: 'teacher',
      role: 'teacher',
      fullName: 'Teacher One',
      email: 'teacher@test.invalid',
    },
    logout: jest.fn(),
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}));
jest.mock('../src/services/teacher/communicationService', () => ({
  communicationService: {
    inbox: jest
      .fn()
      .mockResolvedValue({ total: 0, items: [], nextOffset: null }),
    tasks: jest
      .fn()
      .mockResolvedValue({ total: 0, items: [], nextOffset: null }),
  },
}));
const mockFocus: { focus: () => void; blur: () => void }[] = [];
jest.mock('@react-navigation/native', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useFocusEffect: function useFocusEffect(effect: () => void | (() => void)) {
      useEffect(() => {
        let cleanup = effect();
        const entry = {
          focus: () => {
            cleanup = effect();
          },
          blur: () => {
            if (cleanup) cleanup();
          },
        };
        mockFocus.push(entry);
        return () => {
          entry.blur();
          mockFocus.splice(mockFocus.indexOf(entry), 1);
        };
      }, [effect]);
    },
  };
});
const service = jest.mocked(teacherService);
const tuple: TeacherAssignment = {
  assignmentId: 'a',
  classId: 'class8',
  className: 'Class 8',
  sectionId: 'sectionA',
  sectionName: 'A',
  subjectId: 'math',
  subjectName: 'Math',
};
const physics = {
  ...tuple,
  assignmentId: 'b',
  subjectId: 'physics',
  subjectName: 'Physics',
};
const sectionB = {
  ...tuple,
  assignmentId: 'c',
  sectionId: 'sectionB',
  sectionName: 'B',
};
const student = {
  studentId: 'student',
  fullName: 'Learner One',
  admissionNumber: '001',
};
const navigation = { navigate: jest.fn(), goBack: jest.fn() };
const trees: Renderer.ReactTestRenderer[] = [];
async function mount(element: React.ReactElement) {
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(element);
  });
  trees.push(tree);
  return tree;
}
const workspace = () => (
  <TeacherWorkspaceScreen
    navigation={navigation as never}
    route={{} as never}
  />
);
const roster = (
  ids = {
    classId: tuple.classId,
    sectionId: tuple.sectionId,
    subjectId: tuple.subjectId,
  },
) => (
  <TeacherRosterScreen
    navigation={navigation as never}
    route={{ params: ids } as never}
  />
);
const contents = (tree: Renderer.ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .map(node =>
      React.Children.toArray(node.props.children)
        .filter(child => typeof child === 'string' || typeof child === 'number')
        .join(''),
    )
    .join(' ');
async function tab(tree: Renderer.ReactTestRenderer, label: string) {
  await act(async () => {
    tree.root
      .findAll(node => typeof node.props.onPress === 'function')
      .find(
        node =>
          node.props.accessibilityRole === 'tab' &&
          node.props.accessibilityLabel === label,
      )!
      .props.onPress();
  });
}
async function retry(tree: Renderer.ReactTestRenderer) {
  await act(async () => {
    tree.root
      .findAllByType(TeacherButton)
      .find(node => node.props.title === 'Retry')!
      .props.onPress();
  });
}
async function refresh(tree: Renderer.ReactTestRenderer) {
  await act(async () => {
    tree.root.findByType(FlatList).props.onRefresh();
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (value: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  jest.clearAllMocks();
  service.getAssignedClasses
    .mockReset()
    .mockResolvedValue([tuple, physics, sectionB]);
  service.getRoster
    .mockReset()
    .mockResolvedValue({ assignment: tuple, students: [student] });
});
afterEach(async () => {
  await act(async () => {
    trees.splice(0).forEach(tree => tree.unmount());
  });
});

test('Teacher login projects Home and preserves five primary destinations', async () => {
  const tree = await mount(workspace());
  expect(service.getAssignedClasses).toHaveBeenCalledWith('token');
  expect(contents(tree)).toContain('Teacher One');
  expect(contents(tree)).toContain('all caught up');
  expect(
    tree.root
      .findAll(node => typeof node.props.onPress === 'function')
      .filter(node => node.props.accessibilityRole === 'tab')
      .map(node => node.props.accessibilityLabel),
  ).toEqual(['Home', 'Classes', 'Tasks', 'Inbox', 'Me']);
  await tab(tree, 'Tasks');
  expect(contents(tree)).toContain('No current assigned work.');
  await tab(tree, 'Inbox');
  expect(contents(tree)).toContain(
    'Private questions and replies are not available yet.',
  );
  await tab(tree, 'Me');
  expect(contents(tree)).toContain('teacher@test.invalid');
  expect(contents(tree)).toContain('Log out');
  for (const fake of [
    'Today periods',
    'attendance pending',
    'submissions',
    'catch-up',
    'assigned approvals',
  ])
    expect(contents(tree)).not.toContain(fake);
});

test('Classes initial loading never claims a zero assignment summary', async () => {
  service.getAssignedClasses.mockReturnValue(
    deferred<TeacherAssignment[]>().promise,
  );
  const tree = await mount(workspace());
  await tab(tree, 'Classes');
  expect(contents(tree)).toContain('Loading assigned classes');
  expect(contents(tree)).not.toContain('current assignment');
});

test('Classes keeps subject and section tuples distinct and navigates using identifiers only', async () => {
  const tree = await mount(workspace());
  await tab(tree, 'Classes');
  const rows = tree.root
    .findAll(node => typeof node.props.onPress === 'function')
    .filter(node => node.props.accessibilityLabel?.startsWith('Class 8'));
  expect(rows.map(node => node.props.accessibilityLabel)).toEqual([
    'Class 8 / A / Math',
    'Class 8 / A / Physics',
    'Class 8 / B / Math',
  ]);
  await act(async () => {
    rows[1].props.onPress();
  });
  expect(navigation.navigate).toHaveBeenCalledWith('TeacherAcademic', {
    classId: 'class8',
    sectionId: 'sectionA',
    subjectId: 'physics',
  });
  expect(rows[1].props.accessibilityState.selected).toBe(true);
});

test('selected tuple survives tab changes and a roster return focus refresh', async () => {
  const tree = await mount(workspace());
  await tab(tree, 'Classes');
  const row = () =>
    tree.root
      .findAll(node => typeof node.props.onPress === 'function')
      .find(node => node.props.accessibilityLabel === 'Class 8 / A / Physics')!;
  await act(async () => {
    row().props.onPress();
    mockFocus[mockFocus.length - 1].blur();
  });
  await act(async () => {
    mockFocus[mockFocus.length - 1].focus();
  });
  expect(row().props.accessibilityState.selected).toBe(true);
  await tab(tree, 'Home');
  await tab(tree, 'Classes');
  expect(row().props.accessibilityState.selected).toBe(true);
  expect(service.getAssignedClasses).toHaveBeenCalledTimes(2);
});

test('Classes empty/error/retry/pull refresh show server truth', async () => {
  service.getAssignedClasses.mockResolvedValueOnce([]);
  const tree = await mount(workspace());
  await tab(tree, 'Classes');
  expect(contents(tree)).toContain('No current class assignments');
  service.getAssignedClasses.mockRejectedValueOnce(
    new Error('Connection failed'),
  );
  await refresh(tree);
  expect(contents(tree)).toContain('Connection failed');
  expect(contents(tree)).not.toContain('No current class assignments');
  await retry(tree);
  expect(contents(tree)).toContain('Physics');
  expect(service.getAssignedClasses).toHaveBeenCalledTimes(3);
});

test('latest Classes response wins even when older request resolves last', async () => {
  const first = deferred<TeacherAssignment[]>(),
    second = deferred<TeacherAssignment[]>();
  service.getAssignedClasses
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const tree = await mount(workspace());
  await tab(tree, 'Classes');
  await refresh(tree);
  await act(async () => {
    second.resolve([physics]);
  });
  await act(async () => {
    first.resolve([tuple]);
  });
  expect(contents(tree)).toContain('Physics');
  expect(contents(tree)).not.toContain('Math');
});

test('blur invalidates outstanding Classes responses and failures', async () => {
  const pending = deferred<TeacherAssignment[]>();
  service.getAssignedClasses.mockReturnValueOnce(pending.promise);
  const tree = await mount(workspace());
  await act(async () => {
    mockFocus[mockFocus.length - 1].blur();
  });
  await act(async () => {
    pending.reject(new Error('obsolete failure'));
  });
  expect(contents(tree)).not.toContain('obsolete failure');
  await act(async () => {
    mockFocus[mockFocus.length - 1].focus();
  });
  expect(contents(tree)).toContain('all caught up');
});

test('Roster independently loads exact tuple, renders context and minimal learner identity', async () => {
  const tree = await mount(roster());
  expect(service.getRoster).toHaveBeenCalledWith('token', {
    classId: 'class8',
    sectionId: 'sectionA',
    subjectId: 'math',
  });
  expect(contents(tree)).toContain('Class 8 / A / Math');
  expect(contents(tree)).toContain('Learner One');
  expect(contents(tree)).toContain('001');
  for (const privateField of [
    'guardian',
    'address',
    'dateOfBirth',
    'finance',
    'counseling',
    'permissions',
  ])
    expect(contents(tree)).not.toContain(privateField);
});

test('Roster never renders arbitrary private payload fields', async () => {
  service.getRoster.mockResolvedValue({
    assignment: tuple,
    students: [
      {
        ...student,
        guardianPhone: 'private phone',
        address: 'private address',
        finance: 'private finance',
      } as typeof student,
    ],
  });
  const tree = await mount(roster());
  expect(contents(tree)).not.toContain('private');
});

test('Roster loading, empty, error, retry and refresh are truthful', async () => {
  const pending =
    deferred<Awaited<ReturnType<typeof teacherService.getRoster>>>();
  service.getRoster.mockReturnValueOnce(pending.promise);
  const tree = await mount(roster());
  expect(contents(tree)).toContain('Loading roster');
  await act(async () => {
    pending.resolve({ assignment: tuple, students: [] });
  });
  expect(contents(tree)).toContain('No active students');
  service.getRoster.mockRejectedValueOnce(new Error('Offline'));
  await refresh(tree);
  expect(contents(tree)).toContain('Offline');
  await retry(tree);
  expect(contents(tree)).toContain('Learner One');
});

test('concealed 404 removes stale roster and shows unavailable scope without claiming an empty class', async () => {
  const tree = await mount(roster());
  service.getRoster.mockRejectedValueOnce(
    new ApiError(404, 'Assigned class not found'),
  );
  await refresh(tree);
  expect(contents(tree)).toContain('unavailable or you no longer have access');
  expect(contents(tree)).not.toContain('Learner One');
  expect(contents(tree)).not.toContain('No active students');
});

test('Roster search survives focus refresh and latest response wins', async () => {
  const tree = await mount(roster());
  await act(async () => {
    tree.root.findByType(TextInput).props.onChangeText('001');
  });
  await act(async () => {
    mockFocus[mockFocus.length - 1].blur();
    mockFocus[mockFocus.length - 1].focus();
  });
  expect(tree.root.findByType(TextInput).props.value).toBe('001');
  const first =
      deferred<Awaited<ReturnType<typeof teacherService.getRoster>>>(),
    second = deferred<Awaited<ReturnType<typeof teacherService.getRoster>>>();
  service.getRoster
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  await refresh(tree);
  await refresh(tree);
  await act(async () => {
    second.resolve({ assignment: physics, students: [student] });
  });
  await act(async () => {
    first.resolve({ assignment: tuple, students: [] });
  });
  expect(contents(tree)).toContain('Physics');
  expect(contents(tree)).toContain('Learner One');
});

test('changing roster identifiers invalidates the previous scope response', async () => {
  const old = deferred<Awaited<ReturnType<typeof teacherService.getRoster>>>();
  service.getRoster.mockReturnValueOnce(old.promise);
  const tree = await mount(roster());
  service.getRoster.mockResolvedValueOnce({
    assignment: physics,
    students: [],
  });
  await act(async () => {
    tree.update(
      roster({
        classId: 'class8',
        sectionId: 'sectionA',
        subjectId: 'physics',
      }),
    );
  });
  await act(async () => {
    old.resolve({ assignment: tuple, students: [student] });
  });
  expect(contents(tree)).toContain('Physics');
  expect(contents(tree)).not.toContain('Learner One');
});

test('roster search does not conflate filtered results with enrollment emptiness', async () => {
  const tree = await mount(roster());
  await act(async () => {
    tree.root.findByType(TextInput).props.onChangeText('no match');
  });
  expect(contents(tree)).toContain('No matching students');
  expect(contents(tree)).not.toContain('No active students');
});
