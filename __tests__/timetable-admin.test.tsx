import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Alert, Text, TextInput } from 'react-native';
import { ApiError } from '../src/services/api/apiClient';
import TimetableAdminScreen, {
  validClockWindow,
} from '../src/screens/admin/TimetableAdminScreen';
import {
  AdminDateField,
  AdminDialog,
  AdminSelect,
} from '../src/components/hiraDashboard/AdminForm';
import { Button } from '../src/components/hiraDashboard';
import {
  timetableAdminService as service,
  type TimetableList,
  type TimetableOptions,
} from '../src/services/admin/timetableAdminService';

let mockRole = 'principal';
const mockNavigate = jest.fn();
let mockBeforeRemove:
  | ((event: { preventDefault: () => void; data: { action: never } }) => void)
  | null = null;
const mockDispatch = jest.fn();
const mockNavigation = {
  goBack: mockNavigate,
  navigate: mockNavigate,
  dispatch: mockDispatch,
  addListener: (_name: string, callback: typeof mockBeforeRemove) => {
    mockBeforeRemove = callback;
    return () => {};
  },
};
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({
    accessToken: 'token',
    user: { id: 'principal', role: mockRole },
  }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useFocusEffect: (effect: () => void) =>
    jest.requireActual('react').useEffect(effect, [effect]),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}));
jest.mock('../src/services/admin/timetableAdminService', () => ({
  timetableAdminService: {
    rooms: jest.fn(),
    options: jest.fn(),
    list: jest.fn(),
    create: jest.fn(),
    approve: jest.fn(),
    classes: jest.fn(),
    sections: jest.fn(),
    subjects: jest.fn(),
    eligibleTeachers: jest.fn(),
  },
}));
const api = jest.mocked(service);
const catalog = [
  {
    id: 'c',
    name: 'Class 8',
    code: 'G8',
    isActive: true,
    revision: 1,
    legacy: false,
    academicPeriodId: 'term',
    periodStatus: 'active',
    periodName: '2026 Term',
  },
  {
    id: 'c2',
    name: 'Grade 9',
    code: 'G9',
    isActive: true,
    revision: 1,
    legacy: false,
    academicPeriodId: 'term',
    periodStatus: 'active',
  },
];
const tuple = {
  assignmentId: 'a',
  classId: 'c',
  className: 'Class 8',
  sectionId: 's',
  sectionName: 'A',
  subjectId: 'm',
  subjectName: 'Math',
  academicPeriodId: 'term',
  academicPeriodName: '2026 Term',
};
const options: TimetableOptions = {
  branchId: 'branch',
  branchFixed: true,
  branches: [{ id: 'branch', name: 'Hira' }],
  timezone: 'Asia/Karachi',
  today: '2026-10-13',
  teachers: [{ id: 't', name: 'Ayesha' }],
  nextTeacherOffset: null,
  tuples: [tuple],
};
const row = {
  teacherId: 't',
  classId: 'c',
  sectionId: 's',
  subjectId: 'm',
  dayOfWeek: 2,
  startTime: '13:05',
  endTime: '14:00',
  roomId: 'r',
  room: 'Room 1',
  teacherName: 'Ayesha',
  className: 'Class 8',
  sectionName: 'A',
  subjectName: 'Math',
};
const list: TimetableList = {
  items: [],
  nextOffset: null,
  nextVersionNumber: 1,
};
const trees: Renderer.ReactTestRenderer[] = [];
beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'principal';
  api.rooms.mockResolvedValue([
    {
      id: 'r',
      name: 'Room 1',
      code: 'R1',
      category: 'classroom',
      isActive: true,
      revision: 1,
    },
  ]);
  api.options.mockResolvedValue(options);
  api.list.mockResolvedValue(list);
  api.create.mockResolvedValue({ versionId: 'v', status: 'draft' });
  api.approve.mockResolvedValue({});
  api.classes.mockResolvedValue(catalog);
  api.sections.mockImplementation(async (_token, _branch, classId) =>
    classId === 'c'
      ? [
          {
            id: 's',
            classId: 'c',
            name: 'A',
            code: 'A',
            isActive: true,
            revision: 1,
          },
        ]
      : []
  );
  api.subjects.mockResolvedValue([
    {
      id: 'mapping',
      subject: { id: 'm', name: 'Math', isActive: true },
      isActive: true,
      revision: 1,
    },
  ]);
  api.eligibleTeachers.mockResolvedValue({
    items: [{ id: 't', name: 'Ayesha' }],
    eligibility: undefined,
  });
});
afterEach(async () => {
  for (const tree of trees.splice(0)) await act(async () => tree.unmount());
});
async function render(element = <TimetableAdminScreen />) {
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(element);
  });
  trees.push(tree);
  return tree;
}
const text = (tree: Renderer.ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .map((n) => n.props.children)
    .flat(Infinity)
    .join(' ');
const button = (tree: Renderer.ReactTestRenderer, title: string) =>
  tree.root.findAllByType(Button).find((b) => b.props.title === title)!;
async function select(
  tree: Renderer.ReactTestRenderer,
  label: string,
  value: string
) {
  await act(async () =>
    tree.root
      .findAllByType(AdminSelect)
      .find((s) => s.props.label === label)!
      .props.onSelect(value)
  );
}
async function fill(tree: Renderer.ReactTestRenderer) {
  await select(tree, 'Class', 'c');
  await select(tree, 'Section', 's');
  await select(tree, 'Subject', 'm');
  await select(tree, 'Teacher', 't');
  await select(tree, 'Day', '2');
  await select(tree, 'Room', 'r');
  for (const [label, value] of [
    ['Start Time', '13:05'],
    ['End Time', '14:00'],
  ])
    await act(async () =>
      tree.root
        .findAllByType(TextInput)
        .find((i) => i.props.accessibilityLabel === label)!
        .props.onChangeText(value)
    );
  await act(async () => button(tree, 'Add period to draft').props.onPress());
  for (const [label, value] of [
    ['Effective From', '2026-10-01'],
    ['Effective Until', '2026-11-01'],
  ])
    await act(async () =>
      tree.root
        .findAllByType(AdminDateField)
        .find((d) => d.props.label === label)!
        .props.onChange(value)
    );
}
const confirm = (tree: Renderer.ReactTestRenderer) =>
  tree.root
    .findAllByType(AdminDialog)
    .find((d) => d.props.visible && !!d.props.onConfirm)!;

test('assigned selectors, school timezone and exact day/time payload save then refresh visible draft', async () => {
  const tree = await render();
  await fill(tree);
  expect(text(tree)).toContain('Asia/Karachi');
  expect(text(tree)).toContain('2026 Term');
  expect(button(tree, 'Save timetable draft').props.disabled).toBe(false);
  api.list.mockResolvedValue({
    ...list,
    nextVersionNumber: 2,
    items: [
      {
        versionId: 'v',
        versionNumber: 1,
        status: 'draft',
        effectiveFrom: '2026-10-01',
        effectiveUntil: '2026-11-01',
        periods: [row],
      },
    ],
  });
  await act(async () => button(tree, 'Save timetable draft').props.onPress());
  await act(async () => confirm(tree).props.onConfirm());
  expect(api.create).toHaveBeenCalledWith('token', {
    branchId: 'branch',
    versionNumber: 1,
    effectiveFrom: '2026-10-01',
    effectiveUntil: '2026-11-01',
    periods: [row],
  });
  expect(api.list.mock.calls.length).toBeGreaterThan(1);
  expect(text(tree)).toContain('Draft saved');
  expect(text(tree)).toMatch(/Version\s+1/);
  expect(button(tree, 'Approve schedule 1').props.disabled).toBe(true);
  await act(async () => button(tree, 'Review schedule 1').props.onPress());
  await act(async () => button(tree, 'Approve schedule 1').props.onPress());
  api.list.mockResolvedValue({
    ...list,
    items: [
      {
        versionId: 'v',
        versionNumber: 1,
        status: 'approved',
        effectiveFrom: '2026-10-01',
        effectiveUntil: '2026-11-01',
        periods: [row],
      },
    ],
  });
  await act(async () => confirm(tree).props.onConfirm());
  expect(api.approve).toHaveBeenCalledWith('token', 'v');
  expect(text(tree)).toContain('Schedule approved');
  expect(button(tree, 'Approve schedule 1')).toBeUndefined();
});

test('duplicate confirm while pending sends one request and displays backend rejection preserving draft', async () => {
  const tree = await render();
  await fill(tree);
  let reject!: (error: Error) => void;
  api.create.mockReturnValue(
    new Promise((_, no) => {
      reject = no;
    })
  );
  await act(async () => button(tree, 'Save timetable draft').props.onPress());
  const submit = confirm(tree).props.onConfirm;
  await act(async () => {
    submit();
    submit();
  });
  expect(api.create).toHaveBeenCalledTimes(1);
  expect(button(tree, 'Save timetable draft').props.disabled).toBe(true);
  await act(async () =>
    reject(new Error('Conflicting periods in this version'))
  );
  expect(text(tree)).toContain('Conflicting periods in this version');
  expect(text(tree)).toContain('Remove draft period 1');
});

test.each([
  ['23:00', '01:00'],
  ['1:00 PM', '14:00'],
  ['12:00', '12:00'],
  ['24:00', '24:30'],
])('invalid clock window %s to %s is blocked', (start, end) => {
  expect(validClockWindow(start, end)).toBe(false);
});

test('revise copies every period of immutable version into replacement draft', async () => {
  api.list.mockResolvedValue({
    ...list,
    nextVersionNumber: 2,
    items: [
      {
        versionId: 'v',
        versionNumber: 1,
        status: 'approved',
        effectiveFrom: '2026-10-01',
        effectiveUntil: '2026-11-01',
        periods: [row, { ...row, dayOfWeek: 3 }],
      },
    ],
  });
  const tree = await render();
  await act(async () =>
    button(tree, 'Revise complete schedule 1').props.onPress()
  );
  expect(button(tree, 'Remove draft period 1')).toBeDefined();
  expect(button(tree, 'Remove draft period 2')).toBeDefined();
  expect(button(tree, 'Save timetable draft').props.disabled).toBe(false);
});

test('loading and read errors are visible and saving remains disabled', async () => {
  api.list.mockRejectedValue(new Error('Branch access changed'));
  const tree = await render();
  expect(text(tree)).toContain('Branch access changed');
  expect(button(tree, 'Save timetable draft').props.disabled).toBe(true);
});

test.each(['teacher', 'student'])(
  'role %s cannot see scheduling entry or form',
  async (role) => {
    mockRole = role;
    const tree = await render();
    expect(text(tree)).toContain('not permitted');
    expect(api.options).not.toHaveBeenCalled();
  }
);

test('Super Admin chooses branch before scheduling', async () => {
  mockRole = 'super_admin';
  api.options.mockResolvedValueOnce({
    ...options,
    branchId: null,
    branchFixed: false,
  });
  const tree = await render();
  expect(api.list).not.toHaveBeenCalled();
  await select(tree, 'Branch', 'branch');
  expect(api.list).toHaveBeenCalledWith('token', 'branch', 0);
});

const selector = (tree: Renderer.ReactTestRenderer, label: string) =>
  tree.root.findAllByType(AdminSelect).find((s) => s.props.label === label)!;

test.each(['Class 8', 'G8', 'cLaSs 8', '  g8  '])(
  'Class picker renders and searches existing catalog by %s without requiring assignments',
  async (search) => {
    api.options.mockResolvedValue({ ...options, tuples: [] });
    const tree = await render();
    expect(api.classes).toHaveBeenCalledWith('token', 'branch');
    expect(selector(tree, 'Class').props.disabled).toBe(false);
    await act(async () =>
      selector(tree, 'Class')
        .findAll(
          (p) =>
            p.props.accessibilityLabel === 'Class: Select a Class' &&
            typeof p.props.onPress === 'function'
        )[0]
        .props.onPress()
    );
    await act(async () =>
      selector(tree, 'Class')
        .findAllByType(TextInput)
        .find((p) => p.props.accessibilityLabel === 'Search Class')!
        .props.onChangeText(search)
    );
    const matches = selector(tree, 'Class').findAll(
      (p) =>
        !!p.props.accessibilityLabel && typeof p.props.onPress === 'function'
    );
    expect(
      matches.some((p) => p.props.accessibilityLabel === 'Class 8 — G8')
    ).toBe(true);
    expect(
      matches.some((p) => p.props.accessibilityLabel === 'Grade 9 — G9')
    ).toBe(false);
    await act(async () =>
      matches
        .find((p) => p.props.accessibilityLabel === 'Class 8 — G8')!
        .props.onPress()
    );
    expect(selector(tree, 'Class').props.value).toBe('c');
    expect(button(tree, 'Add period to draft').props.disabled).toBe(true);
  }
);

test('Class changes reset Section and Subject and keep assignment scope exact', async () => {
  const tree = await render();
  await fill(tree);
  expect(selector(tree, 'Section').props.value).toBe('s');
  await select(tree, 'Class', 'c2');
  expect(selector(tree, 'Class').props.value).toBe('c2');
  expect(selector(tree, 'Section').props.value).toBe('');
  expect(selector(tree, 'Subject').props.value).toBe('');
  expect(selector(tree, 'Section').props.options).toEqual([]);
  expect(selector(tree, 'Subject').props.options).toEqual([]);
  expect(selector(tree, 'Teacher').props.value).toBe('');
  expect(text(tree)).toContain('No Sections configured');
});

test.each([401, 403, 500])(
  'Class request %s is a visible safe error rather than an empty catalog',
  async (status) => {
    api.classes.mockRejectedValue(new ApiError(status, 'sensitive diagnostic'));
    const tree = await render();
    expect(text(tree)).toContain(
      status === 500
        ? 'Classes could not be loaded'
        : 'not authorized to view Classes'
    );
    expect(text(tree)).not.toContain('No Classes configured');
    expect(text(tree)).not.toContain('sensitive diagnostic');
    expect(selector(tree, 'Class').props.disabled).toBe(true);
  }
);

test('Class loading and configured-empty catalog have distinct states', async () => {
  let resolve!: (value: typeof catalog) => void;
  api.classes.mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    })
  );
  const tree = await render();
  expect(text(tree)).toContain('Loading Classes');
  expect(selector(tree, 'Class').props.loading).toBe(true);
  expect(text(tree)).not.toContain('No Classes configured');
  await act(async () => resolve([]));
  expect(text(tree)).toContain('No Classes configured for this branch');
});

test('inactive, legacy and closed-period Classes are not schedulable but are explained', async () => {
  api.classes.mockResolvedValue([
    { ...catalog[0], isActive: false },
    { ...catalog[0], id: 'legacy', legacy: true },
    { ...catalog[0], id: 'closed', periodStatus: 'closed' },
  ]);
  const tree = await render();
  expect(selector(tree, 'Class').props.options).toEqual([]);
  expect(text(tree)).toContain('No schedulable Classes');
  expect(text(tree)).not.toContain('No Classes configured');
});

test('branch change reloads Classes and resets canonical Class and dependent fields', async () => {
  mockRole = 'super_admin';
  api.options.mockResolvedValueOnce({
    ...options,
    branchFixed: false,
    branches: [...options.branches, { id: 'other', name: 'Other Branch' }],
  });
  const tree = await render();
  await fill(tree);
  api.classes.mockResolvedValue([{ ...catalog[1], id: 'foreign-c' }]);
  await select(tree, 'Branch', 'other');
  expect(selector(tree, 'Class').props.value).toBe('c');
  await act(async () => confirm(tree).props.onConfirm());
  expect(api.classes).toHaveBeenLastCalledWith('token', 'other');
  expect(api.options).toHaveBeenLastCalledWith('token', {
    branchId: 'other',
  });
  expect(selector(tree, 'Class').props.value).toBe('');
  expect(selector(tree, 'Section').props.value).toBe('');
  expect(selector(tree, 'Subject').props.value).toBe('');
  expect(
    selector(tree, 'Class').props.options.map((c: { id: string }) => c.id)
  ).toEqual(['foreign-c']);
  expect(button(tree, 'Remove draft period 1')).toBeUndefined();
});

test('catalog-first dependency graph loads Sections and mapped Subjects before exact eligible Teachers', async () => {
  api.options.mockResolvedValue({ ...options, tuples: [] });
  const tree = await render();
  expect(selector(tree, 'Section').props.disabled).toBe(true);
  await select(tree, 'Class', 'c');
  expect(api.sections).toHaveBeenCalledWith('token', 'branch', 'c');
  expect(selector(tree, 'Section').props.options).toEqual([
    { id: 's', label: 'A — A' },
  ]);
  expect(selector(tree, 'Teacher').props.value).toBe('');
  await select(tree, 'Section', 's');
  expect(api.subjects).toHaveBeenCalledWith('token', 'branch', 'c');
  expect(selector(tree, 'Subject').props.options).toEqual([
    { id: 'm', label: 'Math' },
  ]);
  await select(tree, 'Subject', 'm');
  expect(api.eligibleTeachers).toHaveBeenCalledWith(
    'token',
    'branch',
    'c',
    's',
    'm'
  );
  expect(selector(tree, 'Teacher').props.options).toEqual([
    { id: 't', label: 'Ayesha' },
  ]);
});

test('late Section response cannot overwrite a newer Class selection', async () => {
  let first!: (rows: Awaited<ReturnType<typeof service.sections>>) => void;
  api.sections.mockImplementation((_token, _branch, id) =>
    id === 'c'
      ? new Promise((resolve) => {
          first = resolve;
        })
      : Promise.resolve([
          { id: 's2', classId: 'c2', name: 'B', isActive: true, revision: 1 },
        ])
  );
  const tree = await render();
  await select(tree, 'Class', 'c');
  await select(tree, 'Class', 'c2');
  expect(
    selector(tree, 'Section').props.options.map((r: { id: string }) => r.id)
  ).toEqual(['s2']);
  await act(async () =>
    first([
      { id: 'stale', classId: 'c', name: 'Stale', isActive: true, revision: 1 },
    ])
  );
  expect(
    selector(tree, 'Section').props.options.map((r: { id: string }) => r.id)
  ).toEqual(['s2']);
});

test('late Teacher response cannot cross a changed Subject context', async () => {
  let old!: (
    rows: Awaited<ReturnType<typeof service.eligibleTeachers>>
  ) => void;
  api.subjects.mockResolvedValue(
    ['m', 'n'].map((id) => ({
      id: 'mapping-' + id,
      subject: { id, name: id, isActive: true },
      isActive: true,
      revision: 1,
    }))
  );
  api.eligibleTeachers.mockImplementation(
    (_token, _branch, _class, _section, subject) =>
      subject === 'm'
        ? new Promise((resolve) => {
            old = resolve;
          })
        : Promise.resolve({
            items: [{ id: 'new', name: 'New Teacher' }],
            eligibility: undefined,
          })
  );
  const tree = await render();
  await select(tree, 'Class', 'c');
  await select(tree, 'Section', 's');
  await select(tree, 'Subject', 'm');
  await select(tree, 'Subject', 'n');
  await act(async () =>
    old({
      items: [{ id: 'old', name: 'Old Teacher' }],
      eligibility: undefined,
    })
  );
  expect(selector(tree, 'Teacher').props.options).toEqual([
    { id: 'new', label: 'New Teacher' },
  ]);
  expect(selector(tree, 'Teacher').props.value).toBe('');
});

test.each(['sections', 'subjects', 'eligibleTeachers'] as const)(
  '%s failure is visible and cannot become a misleading empty selector',
  async (method) => {
    api[method].mockRejectedValue(new ApiError(403, 'private diagnostic'));
    const tree = await render();
    await select(tree, 'Class', 'c');
    if (method !== 'sections') await select(tree, 'Section', 's');
    if (method === 'eligibleTeachers') await select(tree, 'Subject', 'm');
    const label =
      method === 'eligibleTeachers'
        ? 'Teachers'
        : method === 'sections'
        ? 'Sections'
        : 'Subjects';
    expect(text(tree)).toContain(`not authorized to view ${label}`);
    expect(text(tree)).not.toContain('private diagnostic');
    expect(text(tree)).not.toContain(`No ${label} configured`);
    expect(button(tree, 'Add period to draft').props.disabled).toBe(true);
  }
);

test('empty Teacher eligibility differs from absent academic catalogs', async () => {
  api.eligibleTeachers.mockResolvedValue({
    items: [],
    eligibility: {
      asOf: '2026-10-13T06:00:00Z',
      reasons: ['no_exact_assignment'],
    },
  });
  const tree = await render();
  await select(tree, 'Class', 'c');
  await select(tree, 'Section', 's');
  await select(tree, 'Subject', 'm');
  expect(text(tree)).toContain(
    'No teacher is assigned to this Class, Section and Subject.'
  );
  expect(text(tree)).not.toContain('No Teachers configured');
});

test('draft conflict blocks save and editing a period resolves it without changing a published version', async () => {
  const tree = await render();
  await fill(tree);
  await act(async () => button(tree, 'Add period to draft').props.onPress());
  expect(text(tree)).toContain('Schedule conflict');
  expect(button(tree, 'Save timetable draft').props.disabled).toBe(true);
  await act(async () => button(tree, 'Edit draft period 2').props.onPress());
  for (const [label, value] of [
    ['Start Time', '15:00'],
    ['End Time', '15:40'],
  ])
    await act(async () =>
      tree.root
        .findAllByType(TextInput)
        .find((n) => n.props.accessibilityLabel === label)!
        .props.onChangeText(value)
    );
  await act(async () => button(tree, 'Update draft period').props.onPress());
  expect(text(tree)).not.toContain('Schedule conflict');
  expect(button(tree, 'Save timetable draft').props.disabled).toBe(false);
  expect(api.create).not.toHaveBeenCalled();
  expect(api.approve).not.toHaveBeenCalled();
});

test('Back returns to the management destination when no unsaved draft exists', async () => {
  const tree = await render();
  await act(async () => button(tree, 'Back').props.onPress());
  expect(mockNavigate).toHaveBeenCalled();
});

test('native Back protects unsaved draft until the user confirms discard', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    const tree = await render();
    await fill(tree);
    const preventDefault = jest.fn();
    const action = { type: 'GO_BACK' } as never;
    await act(async () =>
      mockBeforeRemove!({ preventDefault, data: { action } })
    );
    expect(preventDefault).toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
    await act(async () =>
      alert.mock.calls[0][2]!.find((b) => b.text === 'Discard draft')!
        .onPress!()
    );
    expect(mockDispatch).toHaveBeenCalledWith(action);
  } finally {
    alert.mockRestore();
  }
});

test('catalog revalidation exposes a stale Section selection and blocks adding a period', async () => {
  const tree = await render();
  await fill(tree);
  api.sections.mockResolvedValue([
    { id: 's', classId: 'c', name: 'A', isActive: false, revision: 1 },
  ]);
  await act(async () => button(tree, 'Refresh timetable').props.onPress());
  expect(text(tree)).toContain('Academic context changed');
  expect(button(tree, 'Add period to draft').props.disabled).toBe(true);
});

for (const [reason, message] of [
  ['inactive_assignment', 'inactive or revoked'],
  ['future_assignment', 'start date is in the future'],
  ['expired_assignment', 'effective window has ended'],
  ['teacher_unavailable', 'Teacher account is unavailable for this Branch'],
] as const)
  test('empty Teacher selector explains ' + reason, async () => {
    api.eligibleTeachers.mockResolvedValue({
      items: [],
      eligibility: { asOf: '2026-10-13T06:00:00Z', reasons: [reason] },
    });
    const tree = await render();
    await select(tree, 'Class', 'c');
    await select(tree, 'Section', 's');
    await select(tree, 'Subject', 'm');
    expect(text(tree)).toContain(message);
    expect(text(tree)).not.toContain('No teacher is assigned');
    expect(button(tree, 'Add period to draft').props.disabled).toBe(true);
  });
test('Teacher requests wait for all parents; loading and retry are distinct from no assignment', async () => {
  const tree = await render();
  expect(api.eligibleTeachers).not.toHaveBeenCalled();
  await select(tree, 'Class', 'c');
  await select(tree, 'Section', 's');
  expect(api.eligibleTeachers).not.toHaveBeenCalled();
  let reject!: (error: Error) => void;
  api.eligibleTeachers.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      })
  );
  await select(tree, 'Subject', 'm');
  expect(selector(tree, 'Teacher').props.loading).toBe(true);
  expect(text(tree)).not.toContain('No teacher is assigned');
  await act(async () => reject(new Error('network')));
  expect(text(tree)).toContain('Unable to load Teachers');
  expect(text(tree)).not.toContain('No teacher is assigned');
  await act(async () =>
    button(tree, 'Retry eligible Teachers').props.onPress()
  );
  expect(selector(tree, 'Teacher').props.options).toEqual([
    { id: 't', label: 'Ayesha' },
  ]);
  await select(tree, 'Teacher', 't');
  expect(selector(tree, 'Teacher').props.value).toBe('t');
});

test.each(['principal', 'super_admin'])(
  '%s can open existing assignment management from a diagnosed empty selector',
  async (role) => {
    mockRole = role;
    api.eligibleTeachers.mockResolvedValue({
      items: [],
      eligibility: {
        asOf: '2026-10-22T00:00:00Z',
        reasons: ['expired_assignment'],
      },
    });
    const tree = await render();
    await select(tree, 'Class', 'c');
    await select(tree, 'Section', 's');
    await select(tree, 'Subject', 'm');
    await act(async () =>
      button(tree, 'Manage Teacher Assignments').props.onPress()
    );
    expect(mockNavigate).toHaveBeenCalledWith('AssignTeacher');
    expect(api.create).not.toHaveBeenCalled();
  }
);

test('Rooms load by Branch independently of academic selection and retain canonical selected ID', async () => {
  const tree = await render();
  expect(api.rooms).toHaveBeenCalledWith('token', 'branch');
  expect(api.eligibleTeachers).not.toHaveBeenCalled();
  expect(selector(tree, 'Room').props.options).toEqual([
    { id: 'r', label: 'Room 1', detail: 'R1 · classroom' },
  ]);
  await fill(tree);
  await act(async () => button(tree, 'Save timetable draft').props.onPress());
  await act(async () => confirm(tree).props.onConfirm());
  expect(api.create).toHaveBeenCalledWith(
    'token',
    expect.objectContaining({
      periods: [expect.objectContaining({ roomId: 'r' })],
    })
  );
});
test.each(['none', 'inactive', 'failure', 'unauthorized'] as const)(
  'Room selector distinguishes %s',
  async (state) => {
    if (state === 'none') api.rooms.mockResolvedValue([]);
    if (state === 'inactive')
      api.rooms.mockResolvedValue([
        {
          id: 'r',
          name: 'Room 1',
          code: 'R1',
          category: 'classroom',
          isActive: false,
          revision: 1,
        },
      ]);
    if (state === 'failure') api.rooms.mockRejectedValue(new Error('network'));
    if (state === 'unauthorized')
      api.rooms.mockRejectedValue(new ApiError(403, 'private'));
    const tree = await render();
    const message =
      state === 'none'
        ? 'No rooms configured'
        : state === 'inactive'
        ? 'No active rooms'
        : state === 'failure'
        ? 'Unable to load Rooms'
        : 'not authorized to view Rooms';
    expect(text(tree)).toContain(message);
    expect(selector(tree, 'Room').props.options).toEqual([]);
    if (state === 'failure' || state === 'unauthorized')
      expect(text(tree)).not.toContain('No rooms configured');
    expect(button(tree, 'Add period to draft').props.disabled).toBe(true);
  }
);
test('legacy copied Room text blocks new draft until a canonical Room is selected', async () => {
  api.list.mockResolvedValue({
    ...list,
    items: [
      {
        versionId: 'v',
        versionNumber: 1,
        status: 'approved',
        effectiveFrom: '2026-10-01',
        effectiveUntil: '2026-11-01',
        periods: [{ ...row, roomId: undefined, room: 'Old hall' }],
      },
    ],
  });
  const tree = await render();
  const revise = tree.root
    .findAllByType(Button)
    .find((n) => String(n.props.title).includes('Revise complete schedule'))!;
  await act(async () => revise.props.onPress());
  expect(text(tree)).toContain('Legacy Room text');
  expect(button(tree, 'Save timetable draft').props.disabled).toBe(true);
});

test('Room picker searches name/code and stores canonical Room ID', async () => {
  api.rooms.mockResolvedValue([
    {
      id: 'r',
      name: 'Room 1',
      code: 'R1',
      category: 'classroom',
      isActive: true,
      revision: 1,
    },
    {
      id: 'lab',
      name: 'Science Lab',
      code: 'LAB1',
      category: 'science_lab',
      isActive: true,
      revision: 1,
    },
  ]);
  const tree = await render();
  const control = selector(tree, 'Room');
  await act(async () =>
    control
      .findAll(
        (n) =>
          n.props.accessibilityLabel === 'Room: Select a physical Room' &&
          typeof n.props.onPress === 'function'
      )[0]
      .props.onPress()
  );
  await act(async () =>
    control
      .findAllByType(TextInput)
      .find((n) => n.props.accessibilityLabel === 'Search Room')!
      .props.onChangeText('LAB1')
  );
  const match = control.findAll(
    (n) =>
      n.props.accessibilityLabel === 'Science Lab, LAB1 · science lab' &&
      typeof n.props.onPress === 'function'
  )[0];
  expect(match).toBeDefined();
  expect(
    control.findAll(
      (n) =>
        n.props.accessibilityLabel === 'Room 1, R1 · classroom' &&
        typeof n.props.onPress === 'function'
    )
  ).toHaveLength(0);
  await act(async () => match.props.onPress());
  expect(selector(tree, 'Room').props.value).toBe('lab');
});
test('Room loading and local retry preserve eligibility boundaries', async () => {
  let fail!: (error: Error) => void;
  api.rooms.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      })
  );
  const tree = await render();
  expect(selector(tree, 'Room').props.loading).toBe(true);
  expect(text(tree)).not.toContain('No rooms configured');
  await act(async () => fail(new Error('network')));
  expect(text(tree)).toContain('Unable to load Rooms');
  await act(async () => button(tree, 'Retry Rooms').props.onPress());
  expect(selector(tree, 'Room').props.options).toHaveLength(1);
});
