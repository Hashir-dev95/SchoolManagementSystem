import React from 'react';
import { TextInput } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import { Button } from '../src/components/hiraDashboard';
import { DashboardShell } from '../src/components/hiraDashboard/DashboardShell';
import PrincipalTasksScreen from '../src/screens/principal/PrincipalTasksScreen';
import PrincipalTaskDetailScreen from '../src/screens/principal/PrincipalTaskDetailScreen';
import AssignPrincipalTaskScreen from '../src/screens/principal/AssignPrincipalTaskScreen';
import { taskCalendarDate } from '../src/screens/principal/taskUi';
import { ApiError } from '../src/services/api/apiClient';
import {
  PrincipalTask,
  TaskAction,
  TaskStatus,
  principalService,
} from '../src/services/principal/principalService';

jest.mock('../src/services/principal/principalService', () => ({
  principalService: {
    getTasks: jest.fn(),
    getTask: jest.fn(),
    getTaskAssignees: jest.fn(),
    createTask: jest.fn(),
    processTask: jest.fn(),
  },
}));
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ accessToken: 'token' }),
}));
jest.mock('../src/components/hiraDashboard/DashboardShell', () => ({
  DashboardShell: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@react-navigation/native', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useFocusEffect: function useFocusEffect(effect: () => void | (() => void)) {
      useEffect(() => effect(), [effect]);
    },
  };
});

const service = jest.mocked(principalService);
const assignee = { _id: 'teacher', fullName: 'Teacher One', role: 'teacher' };
const task: PrincipalTask = {
  _id: 'task',
  title: 'Review reports',
  description: 'Read the reports',
  priority: 'high',
  status: 'pending',
  assignee,
  creator: { _id: 'principal', fullName: 'Principal One', role: 'principal' },
  dueDate: '2000-01-02T00:00:00.000Z',
  createdAt: '2026-10-12T00:00:00Z',
  updatedAt: '2026-10-12T00:00:00Z',
  history: [],
  capabilities: { allowedActions: ['start', 'complete', 'cancel'] },
};
const navigation = {
  navigate: jest.fn(),
  replace: jest.fn(),
  goBack: jest.fn(),
};
const trees: Renderer.ReactTestRenderer[] = [];
async function mount(element: React.ReactElement) {
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(element);
  });
  trees.push(tree);
  return tree;
}
const button = (tree: Renderer.ReactTestRenderer, title: string) =>
  tree.root.findAllByType(Button).find(item => item.props.title === title)!;
async function press(tree: Renderer.ReactTestRenderer, title: string) {
  const target = button(tree, title);
  expect(target).toBeDefined();
  expect(target.props.disabled).toBeFalsy();
  await act(async () => {
    await target.props.onPress();
  });
}
async function enter(
  tree: Renderer.ReactTestRenderer,
  label: string,
  value: string,
) {
  await act(async () => {
    tree.root
      .findAllByType(TextInput)
      .find(item => item.props.accessibilityLabel === label)!
      .props.onChangeText(value);
  });
}
const contents = (tree: Renderer.ReactTestRenderer) =>
  JSON.stringify(tree.toJSON());
const listScreen = () => (
  <PrincipalTasksScreen navigation={navigation as never} route={{} as never} />
);
const detailScreen = () => (
  <PrincipalTaskDetailScreen
    navigation={navigation as never}
    route={{ params: { taskId: 'task' } } as never}
  />
);
const assignScreen = () => (
  <AssignPrincipalTaskScreen
    navigation={navigation as never}
    route={{} as never}
  />
);
beforeEach(() => {
  jest.resetAllMocks();
  service.getTasks.mockResolvedValue({
    data: [task],
    message: '',
    canAssign: true,
  });
  service.getTask.mockResolvedValue({ data: task, message: '' });
  service.getTaskAssignees.mockResolvedValue({ data: [assignee], message: '' });
  service.createTask.mockResolvedValue({ data: task, message: 'Task created' });
  service.processTask.mockResolvedValue({
    data: {
      ...task,
      status: 'completed',
      completedAt: '2026-10-12T12:00:00Z',
      capabilities: { allowedActions: [] },
    },
    message: 'Action confirmed',
  });
});
afterEach(async () => {
  await act(async () => trees.splice(0).forEach(tree => tree.unmount()));
  jest.restoreAllMocks();
});

test('task list has loading and empty states', async () => {
  let resolve!: (result: {
    data: PrincipalTask[];
    message: string;
    canAssign: boolean;
  }) => void;
  service.getTasks.mockReturnValue(
    new Promise(done => {
      resolve = done;
    }),
  );
  const tree = await mount(listScreen());
  expect(contents(tree)).toContain('Loading tasks...');
  expect(button(tree, 'Assign task')).toBeUndefined();
  await act(async () => resolve({ data: [], message: '', canAssign: true }));
  expect(contents(tree)).toContain('No tasks match');
  expect(button(tree, 'Assign task')).toBeDefined();
});

test('task list surfaces failures, retries and preserves server order and navigation context', async () => {
  service.getTasks.mockRejectedValueOnce(
    new ApiError(403, 'Permission changed'),
  );
  const tree = await mount(listScreen());
  expect(contents(tree)).toContain('Permission changed (403)');
  await press(tree, 'Retry tasks');
  expect(contents(tree)).toContain('Review reports');
  expect(contents(tree)).toContain('Teacher One');
  await press(tree, 'Open task: Review reports');
  expect(navigation.navigate).toHaveBeenCalledWith('TaskDetail', {
    taskId: 'task',
  });
  await press(tree, 'Assign task');
  expect(navigation.navigate).toHaveBeenCalledWith('AssignTask');
  await press(tree, 'Pending');
  await press(tree, 'High');
  await enter(tree, 'Search task title', 'reports');
  await press(tree, 'Search tasks');
  expect(service.getTasks).toHaveBeenLastCalledWith('token', {
    status: 'pending',
    priority: 'high',
    search: 'reports',
  });
});

test('assignment is hidden when server denies permission', async () => {
  service.getTasks.mockResolvedValue({
    data: [task],
    message: '',
    canAssign: false,
  });
  const tree = await mount(listScreen());
  expect(button(tree, 'Assign task')).toBeUndefined();
});

test('task list refresh retains filters and displays newly created server records', async () => {
  const tree = await mount(listScreen());
  await press(tree, 'Pending');
  await enter(tree, 'Search task title', 'report');
  await press(tree, 'Search tasks');
  const created = { ...task, _id: 'new-task', title: 'New report task' };
  service.getTasks.mockResolvedValue({
    data: [created, task],
    message: '',
    canAssign: true,
  });
  await act(async () => {
    await tree.root.findByType(DashboardShell).props.onRefresh();
  });
  expect(service.getTasks).toHaveBeenLastCalledWith('token', {
    status: 'pending',
    priority: undefined,
    search: 'report',
  });
  const rows = tree.root
    .findAllByType(Button)
    .filter(item => item.props.title.startsWith('Open task:'));
  expect(rows.map(item => item.props.title)).toEqual([
    'Open task: New report task',
    'Open task: Review reports',
  ]);
});

test('detail displays selected task and truthful Teacher limitation', async () => {
  const tree = await mount(detailScreen());
  for (const text of [
    'Review reports',
    'Read the reports',
    'Teacher One',
    'Principal One',
    'Teacher self-service',
    'Created:',
    'Updated:',
    'Due:',
  ]) {
    expect(contents(tree)).toContain(text);
  }
  expect(button(tree, 'Start task')).toBeDefined();
});

test.each([
  ['pending', ['start', 'complete', 'cancel']],
  ['in_progress', ['complete', 'cancel']],
  ['completed', []],
  ['cancelled', []],
] as Array<[TaskStatus, TaskAction[]]>)(
  'task action visibility follows %s and server capabilities',
  async (status, actions) => {
    service.getTask.mockResolvedValue({
      data: { ...task, status, capabilities: { allowedActions: actions } },
      message: '',
    });
    const tree = await mount(detailScreen());
    for (const [action, label] of [
      ['start', 'Start task'],
      ['complete', 'Complete task'],
      ['cancel', 'Cancel task'],
    ] as const) {
      expect(Boolean(button(tree, label))).toBe(actions.includes(action));
    }
  },
);

test('non-owner detail displays no mutation actions', async () => {
  service.getTask.mockResolvedValue({
    data: { ...task, capabilities: { allowedActions: [] } },
    message: '',
  });
  const tree = await mount(detailScreen());
  expect(button(tree, 'Complete task')).toBeUndefined();
});

test.each([
  ['start', 'Start task'],
  ['complete', 'Complete task'],
  ['cancel', 'Cancel task'],
] as const)(
  '%s uses confirmed response and fresh detail state',
  async (action, label) => {
    const result: PrincipalTask = {
      ...task,
      status:
        action === 'start'
          ? 'in_progress'
          : action === 'complete'
          ? 'completed'
          : 'cancelled',
      completedAt: action === 'complete' ? '2026-10-12T12:00:00Z' : null,
      history: [
        { action, performer: task.creator, createdAt: '2026-10-12T12:00:00Z' },
      ],
      capabilities: {
        allowedActions: action === 'start' ? ['complete', 'cancel'] : [],
      },
    };
    service.processTask.mockResolvedValue({
      data: result,
      message: 'Action confirmed',
    });
    const tree = await mount(detailScreen());
    await press(tree, label);
    expect(service.processTask).toHaveBeenCalledWith('token', 'task', action);
    expect(contents(tree)).toContain('Action confirmed');
    expect(button(tree, 'Start task')).toBeUndefined();
    if (action === 'complete') expect(contents(tree)).toContain('Completed:');
    service.getTask.mockResolvedValue({ data: result, message: '' });
    await press(tree, 'Refresh task');
    expect(contents(tree)).toContain('Principal One');
    expect(button(tree, 'Start task')).toBeUndefined();
  },
);

test('task action duplicate calls are blocked until server confirms', async () => {
  let resolve!: (result: { data: PrincipalTask; message: string }) => void;
  service.processTask.mockReturnValue(
    new Promise(done => {
      resolve = done;
    }),
  );
  const tree = await mount(detailScreen());
  const submit = button(tree, 'Complete task').props.onPress;
  await act(async () => {
    submit();
    submit();
  });
  expect(service.processTask).toHaveBeenCalledTimes(1);
  expect(button(tree, 'Complete task').props.disabled).toBe(true);
  expect(contents(tree)).not.toContain('Action confirmed');
  await act(async () =>
    resolve({
      data: {
        ...task,
        status: 'completed',
        capabilities: { allowedActions: [] },
      },
      message: 'Action confirmed',
    }),
  );
  expect(button(tree, 'Complete task')).toBeUndefined();
});

test.each([400, 401, 403, 404, 409])(
  'task action %i is preserved and refresh restores server state',
  async status => {
    service.processTask.mockRejectedValueOnce(
      new ApiError(status, 'Backend explanation'),
    );
    const tree = await mount(detailScreen());
    service.getTask.mockResolvedValue({
      data: {
        ...task,
        status: 'cancelled',
        capabilities: { allowedActions: [] },
      },
      message: '',
    });
    await press(tree, 'Complete task');
    expect(contents(tree)).toContain(`Backend explanation (${status})`);
    expect(button(tree, 'Complete task')).toBeUndefined();
  },
);

test('assignment validates title, assignee and strict calendar fields', async () => {
  const tree = await mount(assignScreen());
  await press(tree, 'Confirm assignment');
  expect(contents(tree)).toContain('Enter a task title');
  await enter(tree, 'Task title', 'New task');
  await press(tree, 'Confirm assignment');
  expect(contents(tree)).toContain('Choose an eligible assignee');
  await press(tree, 'Teacher One (Teacher)');
  await enter(tree, 'Due year', '2026');
  await enter(tree, 'Due month', '2');
  await enter(tree, 'Due day', '30');
  await press(tree, 'Confirm assignment');
  expect(contents(tree)).toContain('Enter a valid calendar due date');
  expect(service.createTask).not.toHaveBeenCalled();
});

test('assignment sends only allowed fields with a past date and navigates on confirmed creation', async () => {
  const tree = await mount(assignScreen());
  await enter(tree, 'Task title', '  New task  ');
  await enter(tree, 'Task description', '  Details  ');
  await press(tree, 'Teacher One (Teacher)');
  await press(tree, 'High');
  await enter(tree, 'Due year', '2000');
  await enter(tree, 'Due month', '1');
  await enter(tree, 'Due day', '2');
  await press(tree, 'Confirm assignment');
  expect(service.createTask).toHaveBeenCalledWith('token', {
    title: 'New task',
    assignedTo: 'teacher',
    description: 'Details',
    priority: 'high',
    dueDate: '2000-01-02',
  });
  expect(navigation.replace).toHaveBeenCalledWith('TaskDetail', {
    taskId: 'task',
    createdMessage: 'Task created',
  });
});

test('assignment prevents duplicate POST and omits optional fields', async () => {
  let resolve!: (result: { data: PrincipalTask; message: string }) => void;
  service.createTask.mockReturnValue(
    new Promise(done => {
      resolve = done;
    }),
  );
  const tree = await mount(assignScreen());
  await enter(tree, 'Task title', 'New task');
  await press(tree, 'Teacher One (Teacher)');
  const submit = button(tree, 'Confirm assignment').props.onPress;
  await act(async () => {
    submit();
    submit();
  });
  expect(service.createTask).toHaveBeenCalledTimes(1);
  expect(service.createTask).toHaveBeenCalledWith('token', {
    title: 'New task',
    assignedTo: 'teacher',
    priority: 'normal',
  });
  expect(navigation.replace).not.toHaveBeenCalled();
  await act(async () => resolve({ data: task, message: 'Task created' }));
  expect(navigation.replace).toHaveBeenCalledTimes(1);
});

test('uncertain creation network failure prevents blind duplicate retry', async () => {
  service.createTask.mockRejectedValue(new Error('Network unavailable'));
  const tree = await mount(assignScreen());
  await enter(tree, 'Task title', 'New task');
  await press(tree, 'Teacher One (Teacher)');
  await press(tree, 'Confirm assignment');
  expect(contents(tree)).toContain('task may have been created');
  expect(button(tree, 'Confirm assignment').props.disabled).toBe(true);
  expect(navigation.replace).not.toHaveBeenCalled();
  await press(tree, 'Check Tasks');
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
});

test('empty eligible assignees cannot submit', async () => {
  service.getTaskAssignees.mockResolvedValue({ data: [], message: '' });
  const tree = await mount(assignScreen());
  expect(contents(tree)).toContain('No eligible assignees');
  expect(button(tree, 'Confirm assignment').props.disabled).toBe(true);
});

test('assignee loading error offers retry without claiming the eligible list is empty', async () => {
  service.getTaskAssignees.mockRejectedValueOnce(
    new ApiError(403, 'Permission changed'),
  );
  const tree = await mount(assignScreen());
  expect(contents(tree)).toContain('Permission changed (403)');
  expect(contents(tree)).not.toContain('No eligible assignees');
  await press(tree, 'Refresh assignees');
  expect(button(tree, 'Teacher One (Teacher)')).toBeDefined();
});

test.each([400, 401, 403, 404, 409])(
  'assignment POST %i is shown without claiming successful creation',
  async status => {
    service.createTask.mockRejectedValueOnce(
      new ApiError(status, 'Creation denied'),
    );
    const tree = await mount(assignScreen());
    await enter(tree, 'Task title', 'New task');
    await press(tree, 'Teacher One (Teacher)');
    await press(tree, 'Confirm assignment');
    expect(contents(tree)).toContain(`Creation denied (${status})`);
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(button(tree, 'Confirm assignment').props.disabled).toBe(false);
    if (status === 403) {
      service.getTaskAssignees.mockResolvedValue({ data: [], message: '' });
      await press(tree, 'Refresh assignees');
      expect(button(tree, 'Confirm assignment').props.disabled).toBe(true);
      expect(
        tree.root
          .findAllByType(TextInput)
          .find(item => item.props.accessibilityLabel === 'Task title')!.props
          .value,
      ).toBe('New task');
    }
  },
);

test('structured dates allow optional, past, today, future and leap day, but reject invalid fields', () => {
  expect(taskCalendarDate('', '', '')).toBeUndefined();
  expect(taskCalendarDate('2000', '1', '2')).toBe('2000-01-02');
  const now = new Date();
  expect(
    taskCalendarDate(
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1),
      String(now.getUTCDate()),
    ),
  ).toBe(now.toISOString().slice(0, 10));
  expect(taskCalendarDate('2099', '1', '2')).toBe('2099-01-02');
  expect(taskCalendarDate('2024', '2', '29')).toBe('2024-02-29');
  for (const values of [
    ['2026', '2', '29'],
    ['2026', '13', '1'],
    ['2026', '1', '0'],
    ['0000', '1', '1'],
    ['2026', '', '1'],
    ['abcd', '1', '1'],
  ]) {
    expect(() =>
      taskCalendarDate(...(values as [string, string, string])),
    ).toThrow();
  }
});
