import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import {
  Button,
  DashboardShell,
  SectionCard,
  ScreenHeading,
  StatusBadge,
} from '../src/components/hiraDashboard';
import {
  AdminSelect,
  AdminDateField,
  AdminDialog,
  AdminFeedback,
} from '../src/components/hiraDashboard/AdminForm';
import Screen, {
  assignmentInstant,
} from '../src/screens/admin/TeacherAssignmentAdminScreen';
import { TeacherAssignmentEntry } from '../src/screens/admin/TeacherAssignmentEntry';
import { TeacherProvisioningCard } from '../src/screens/superAdmin/TeacherProvisioningCard';
import {
  teacherAssignmentService as service,
  type AssignmentOptions,
  type AssignmentHistory,
} from '../src/services/admin/teacherAssignmentService';
import { ApiError } from '../src/services/api/apiClient';
let mockRole = 'super_admin';
jest.setTimeout(20000);
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ user: { role: mockRole }, accessToken: 'token' }),
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void | (() => void)) =>
    jest.requireActual('react').useEffect(effect, [effect]),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}));
jest.mock('../src/services/admin/teacherAssignmentService', () => ({
  teacherAssignmentService: {
    options: jest.fn(),
    history: jest.fn(),
    create: jest.fn(),
    revoke: jest.fn(),
  },
}));
const api = jest.mocked(service),
  trees: Renderer.ReactTestRenderer[] = [];
const teacher = {
  teacherId: 'teacher-one',
  fullName: 'Ayesha Khan',
  email: 'ayesha@example.com',
  branchId: 'branch-main',
  isActive: true,
};
const row = {
  assignmentId: 'assignment-one',
  className: 'Grade 8',
  sectionName: 'A',
  subjectName: 'Mathematics',
  validFrom: '2020-01-01T00:00:00.000Z',
  validUntil: null,
  status: 'active' as const,
  canRevoke: true,
};
const history: AssignmentHistory = {
  teacher,
  items: [],
  total: 0,
  nextOffset: null,
};
const options = (input: {
  teacherId?: string;
  branchId?: string;
  classId?: string;
}): AssignmentOptions => ({
  branchId:
    input.branchId ??
    (input.teacherId || mockRole === 'principal' ? 'branch-main' : null),
  branchFixed: mockRole === 'principal',
  branches: [
    { id: 'branch-main', name: 'Main Campus', code: 'MC' },
    { id: 'branch-other', name: 'Other Campus', code: 'OC' },
  ],
  teachers: { items: [teacher], total: 1, nextOffset: null },
  selectedTeacher: input.teacherId ? teacher : null,
  classes:
    input.branchId || input.teacherId || mockRole === 'principal'
      ? [
          { id: 'class-eight', name: 'Grade 8' },
          { id: 'class-nine', name: 'Grade 9' },
        ]
      : [],
  sections: input.classId
    ? [
        {
          id: input.classId === 'class-eight' ? 'section-a' : 'section-b',
          name: input.classId === 'class-eight' ? 'A' : 'B',
        },
      ]
    : [],
  subjects: [
    { id: 'subject-math', name: 'Mathematics' },
    { id: 'subject-science', name: 'Science' },
  ],
});
const back = jest.fn();
const text = (tree: Renderer.ReactTestRenderer) =>
  JSON.stringify(tree.toJSON(), (key, value) =>
    key === 'props' ? undefined : value,
  );
const button = (tree: Renderer.ReactTestRenderer, title: string) =>
  tree.root.findAllByType(Button).find(n => n.props.title === title)!;
const selector = (tree: Renderer.ReactTestRenderer, label: string) =>
  tree.root.findAllByType(AdminSelect).find(n => n.props.label === label)!;
async function render(teacherId: string | undefined = 'teacher-one') {
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(
      <Screen
        route={{ params: { teacherId } }}
        navigation={{ goBack: back }}
      />,
    );
  });
  trees.push(tree);
  return tree;
}
async function fill(tree: Renderer.ReactTestRenderer) {
  await act(async () => selector(tree, 'Class').props.onSelect('class-eight'));
  await act(async () => selector(tree, 'Section').props.onSelect('section-a'));
  await act(async () => {
    selector(tree, 'Subject').props.onSelect('subject-math');
    tree.root.findAllByType(AdminDateField)[0].props.onChange('2026-10-15');
  });
}
const confirm = (tree: Renderer.ReactTestRenderer) =>
  tree.root
    .findAllByType(AdminDialog)
    .find(n => n.props.title === 'Confirm Teacher Assignment')!;
beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'super_admin';
  api.options.mockImplementation(async (_token, input) => options(input));
  api.history.mockResolvedValue(history);
  api.create.mockResolvedValue({
    success: true,
    data: { assignmentId: 'assignment-one', isActive: true },
  });
  api.revoke.mockResolvedValue({
    success: true,
    data: { assignmentId: 'assignment-one', isActive: false },
  });
});
afterEach(async () => {
  await act(async () => trees.splice(0).forEach(t => t.unmount()));
  jest.restoreAllMocks();
});
test('page identity, numbered sections and preselected Teacher are clear', async () => {
  const tree = await render();
  expect(tree.root.findByType(ScreenHeading).props.title).toBe(
    'Assign Teacher',
  );
  expect(tree.root.findAllByType(SectionCard).map(n => n.props.title)).toEqual(
    expect.arrayContaining([
      '1. Teacher',
      '2. Academic Scope',
      '3. Effective Period',
      'Current Assignments',
    ]),
  );
  expect(text(tree)).toContain('Ayesha Khan');
  expect(text(tree)).toContain('ayesha@example.com');
  expect(text(tree)).toContain('Main Campus');
  expect(button(tree, 'Create Assignment').props.disabled).toBe(true);
  expect(text(tree)).not.toContain('teacher-one');
});
test('Teacher and Student cannot self-assign or fetch options', async () => {
  for (const role of ['teacher', 'student']) {
    mockRole = role;
    const tree = await render();
    expect(text(tree)).toContain('Access restricted');
  }
  expect(api.options).not.toHaveBeenCalled();
});
test('administrator entries are authorized and route callbacks work', async () => {
  const onAssign = jest.fn();
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(
      <TeacherProvisioningCard onCreate={jest.fn()} onAssign={onAssign} />,
    );
  });
  trees.push(tree);
  await act(async () => button(tree, 'Assign Teacher').props.onPress());
  expect(onAssign).toHaveBeenCalledTimes(1);
  mockRole = 'principal';
  await act(async () => {
    tree = Renderer.create(<TeacherAssignmentEntry onAssign={onAssign} />);
  });
  trees.push(tree);
  expect(text(tree)).toContain('Teacher Academic Management');
  await act(async () => button(tree, 'Assign Teacher').props.onPress());
  expect(onAssign).toHaveBeenCalledTimes(2);
});
test('Principal branch is fixed by authoritative options', async () => {
  mockRole = 'principal';
  const tree = await render();
  expect(selector(tree, 'Branch').props.disabled).toBe(true);
  expect(text(tree)).toContain('Principal - current branch only');
});
test('missing dependencies disable academic selectors', async () => {
  const tree = await render('');
  expect(selector(tree, 'Class').props.disabled).toBe(true);
  expect(selector(tree, 'Section').props.disabled).toBe(true);
  expect(selector(tree, 'Subject').props.disabled).toBe(true);
  await act(async () =>
    selector(tree, 'Teacher').props.onSelect('teacher-one'),
  );
  expect(selector(tree, 'Class').props.disabled).toBe(false);
});
test('Class refresh retains Teacher context; branch follows the selected Teacher', async () => {
  const tree = await render();
  await fill(tree);
  await act(async () => selector(tree, 'Class').props.onSelect('class-nine'));
  expect(selector(tree, 'Section').props.value).toBe('');
  expect(selector(tree, 'Subject').props.value).toBe('');
  expect(selector(tree, 'Teacher').props.value).toBe('teacher-one');
  expect(text(tree)).toContain('Ayesha Khan');
  expect(selector(tree, 'Branch').props.disabled).toBe(true);
  await act(async () =>
    selector(tree, 'Branch').props.onSelect('branch-other'),
  );
  expect(selector(tree, 'Teacher').props.value).toBe('teacher-one');
  expect(selector(tree, 'Branch').props.value).toBe('branch-main');
  await act(async () =>
    button(tree, 'Change Teacher or branch').props.onPress(),
  );
  expect(selector(tree, 'Teacher').props.value).toBe('');
  await act(async () =>
    selector(tree, 'Branch').props.onSelect('branch-other'),
  );
  expect(selector(tree, 'Branch').props.value).toBe('branch-other');
  expect(selector(tree, 'Class').props.value).toBe('');
  expect(button(tree, 'Create Assignment').props.disabled).toBe(true);
});

test('Teacher context remains visible while dependent class options are loading', async () => {
  const tree = await render();
  let resolve!: (v: AssignmentOptions) => void;
  api.options.mockReturnValueOnce(
    new Promise(r => {
      resolve = r;
    }),
  );
  await act(async () => selector(tree, 'Class').props.onSelect('class-eight'));
  expect(selector(tree, 'Class').props.loading).toBe(true);
  expect(text(tree)).toContain('Ayesha Khan');
  expect(text(tree)).toContain('ayesha@example.com');
  await act(async () =>
    resolve(options({ teacherId: 'teacher-one', classId: 'class-eight' })),
  );
  expect(selector(tree, 'Teacher').props.value).toBe('teacher-one');
});

test('unavailable class refresh resets the tuple and keeps the selected Teacher', async () => {
  const tree = await render();
  await fill(tree);
  api.options.mockRejectedValueOnce(
    new ApiError(404, 'The selected academic scope is unavailable'),
  );
  await act(async () => tree.root.findByType(DashboardShell).props.onRefresh());
  expect(selector(tree, 'Class').props.value).toBe('');
  expect(selector(tree, 'Section').props.value).toBe('');
  expect(selector(tree, 'Subject').props.value).toBe('');
  expect(selector(tree, 'Teacher').props.value).toBe('teacher-one');
  expect(text(tree)).toContain('Ayesha Khan');
  expect(button(tree, 'Create Assignment').props.disabled).toBe(true);
});

test('stale section resets its subject on refreshed options', async () => {
  const tree = await render();
  await fill(tree);
  api.options.mockImplementation(async (_token, input) => ({
    ...options(input),
    sections: [],
  }));
  await act(async () => tree.root.findByType(DashboardShell).props.onRefresh());
  expect(selector(tree, 'Section').props.value).toBe('');
  expect(selector(tree, 'Subject').props.value).toBe('');
  expect(selector(tree, 'Teacher').props.value).toBe('teacher-one');
});
test('date validation rejects impossible/inverted dates and explicitly uses UTC', async () => {
  expect(assignmentInstant('2026-02-30')).toBeNull();
  expect(assignmentInstant('0000-01-01')).toBeNull();
  expect(assignmentInstant('2026-10-15')).toBe('2026-10-15T00:00:00.000Z');
  const tree = await render();
  await fill(tree);
  await act(async () =>
    tree.root.findAllByType(AdminDateField)[1].props.onChange('2026-10-14'),
  );
  expect(button(tree, 'Create Assignment').props.disabled).toBe(true);
  expect(text(tree)).toContain('Valid Until must');
  expect(text(tree)).toContain('00:00 UTC');
});
test('confirmation previews names and dates; success waits for server and duplicate taps send once', async () => {
  let resolve!: (value: any) => void;
  api.create.mockReturnValue(
    new Promise(r => {
      resolve = r;
    }),
  );
  const tree = await render();
  await fill(tree);
  await act(async () => button(tree, 'Create Assignment').props.onPress());
  expect(confirm(tree).props.visible).toBe(true);
  expect(text(tree)).toContain('Ayesha Khan');
  expect(api.create).not.toHaveBeenCalled();
  await act(async () => {
    confirm(tree).props.onConfirm();
    confirm(tree).props.onConfirm();
  });
  expect(api.create).toHaveBeenCalledTimes(1);
  expect(confirm(tree).props.busy).toBe(true);
  expect(api.create).toHaveBeenCalledWith('token', {
    teacherId: 'teacher-one',
    classId: 'class-eight',
    sectionId: 'section-a',
    subjectId: 'subject-math',
    validFrom: '2026-10-15T00:00:00.000Z',
  });
  expect(text(tree)).not.toContain('Teacher assignment created successfully.');
  api.history.mockResolvedValue({ ...history, items: [row], total: 1 });
  await act(async () =>
    resolve({
      success: true,
      data: { assignmentId: 'assignment-one', isActive: true },
    }),
  );
  expect(
    tree.root
      .findAllByType(AdminFeedback)
      .some(n => n.props.kind === 'success'),
  ).toBe(true);
  expect(text(tree)).toContain('Teacher assignment created successfully.');
  expect(text(tree)).toContain('15 Oct 2026');
  expect(selector(tree, 'Subject').props.value).toBe('');
  expect(button(tree, 'Assign Another Subject')).toBeDefined();
});
test('Cancel confirmation performs no create', async () => {
  const tree = await render();
  await fill(tree);
  await act(async () => button(tree, 'Create Assignment').props.onPress());
  await act(async () => confirm(tree).props.onClose());
  expect(api.create).not.toHaveBeenCalled();
});
test.each([403, 404, 409])(
  'authoritative %s failure retains dates and selected tuple, refreshes source',
  async status => {
    api.create.mockRejectedValue(new ApiError(status, 'server denial'));
    const tree = await render();
    await fill(tree);
    await act(async () => button(tree, 'Create Assignment').props.onPress());
    const calls = api.options.mock.calls.length;
    await act(async () => confirm(tree).props.onConfirm());
    expect(api.options.mock.calls.length).toBeGreaterThan(calls);
    expect(selector(tree, 'Class').props.value).toBe('class-eight');
    expect(selector(tree, 'Subject').props.value).toBe('subject-math');
    expect(tree.root.findAllByType(AdminDateField)[0].props.value).toBe(
      '2026-10-15',
    );
    expect(tree.root.findAllByType(AdminFeedback)[0].props.kind).toBe('error');
  },
);
test('network error preserves selections and can retry without optimistic success', async () => {
  api.create.mockRejectedValueOnce(new Error('Network request failed'));
  const tree = await render();
  await fill(tree);
  await act(async () => button(tree, 'Create Assignment').props.onPress());
  await act(async () => confirm(tree).props.onConfirm());
  expect(text(tree)).toContain('Network request failed');
  expect(selector(tree, 'Subject').props.value).toBe('subject-math');
  expect(text(tree)).not.toContain('Teacher assignment created successfully.');
});
test('existing assignments show truthful statuses and confirmed revoke retains history', async () => {
  api.history.mockResolvedValue({
    ...history,
    items: [
      row,
      { ...row, assignmentId: 'upcoming', status: 'upcoming' },
      { ...row, assignmentId: 'expired', status: 'expired' },
      { ...row, assignmentId: 'revoked', status: 'revoked', canRevoke: false },
    ],
    total: 4,
  });
  const tree = await render();
  expect(tree.root.findAllByType(StatusBadge).map(n => n.props.label)).toEqual(
    expect.arrayContaining(['active', 'upcoming', 'expired', 'revoked']),
  );
  await act(async () =>
    button(tree, 'Revoke Grade 8 / A / Mathematics').props.onPress(),
  );
  const dialog = tree.root
    .findAllByType(AdminDialog)
    .find(n => n.props.title === 'Revoke this assignment?')!;
  expect(dialog.props.visible).toBe(true);
  expect(api.revoke).not.toHaveBeenCalled();
  api.history.mockResolvedValue({
    ...history,
    items: [{ ...row, status: 'revoked', canRevoke: false }],
    total: 1,
  });
  await act(async () => dialog.props.onConfirm());
  expect(api.revoke).toHaveBeenCalledWith('token', 'assignment-one');
  expect(text(tree)).toContain('Teacher assignment revoked.');
  expect(text(tree)).toContain('revoked');
});
test('stale options response cannot replace the latest Teacher context', async () => {
  let resolve!: (v: AssignmentOptions) => void;
  api.options.mockReturnValueOnce(
    new Promise(r => {
      resolve = r;
    }),
  );
  const tree = await render();
  expect(selector(tree, 'Teacher').props.loading).toBe(true);
  await act(async () => tree.root.findByType(DashboardShell).props.onRefresh());
  await act(async () =>
    resolve({
      ...options({ teacherId: 'teacher-one' }),
      selectedTeacher: { ...teacher, fullName: 'STALE PRIVATE NAME' },
    }),
  );
  expect(text(tree)).not.toContain('STALE PRIVATE NAME');
  expect(text(tree)).toContain('Ayesha Khan');
});
test('lookup error and empty states support explicit refresh', async () => {
  api.options.mockRejectedValueOnce(new ApiError(404, 'stale'));
  const tree = await render();
  expect(text(tree)).toContain('no longer available');
  await act(async () => button(tree, 'Refresh options').props.onPress());
  expect(text(tree)).toContain('Ayesha Khan');
  expect(text(tree)).toContain('No assignments for this Teacher.');
});

test('new Teacher navigation intent cancels stale success and does not leave submission stuck', async () => {
  let resolve!: (v: any) => void;
  api.create.mockReturnValue(
    new Promise(r => {
      resolve = r;
    }),
  );
  api.options.mockImplementation(async (_token, input) => ({
    ...options(input),
    selectedTeacher: input.teacherId
      ? {
          ...teacher,
          teacherId: input.teacherId,
          fullName:
            input.teacherId === 'teacher-two' ? 'Nida Noor' : 'Ayesha Khan',
        }
      : null,
  }));
  const tree = await render();
  await fill(tree);
  await act(async () => button(tree, 'Create Assignment').props.onPress());
  await act(async () => confirm(tree).props.onConfirm());
  await act(async () =>
    tree.update(
      <Screen
        route={{ params: { teacherId: 'teacher-two' } }}
        navigation={{ goBack: back }}
      />,
    ),
  );
  await act(async () =>
    resolve({
      success: true,
      data: { assignmentId: 'assignment-one', isActive: true },
    }),
  );
  expect(text(tree)).toContain('Nida Noor');
  expect(text(tree)).not.toContain('Teacher assignment created successfully.');
  expect(button(tree, 'Create Assignment')).toBeDefined();
  expect(tree.root.findAllByType(AdminDateField)[0].props.value).toBe('');
});
