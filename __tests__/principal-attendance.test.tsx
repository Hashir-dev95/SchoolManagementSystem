import React from 'react';
import { Text, TextInput } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import {
  Button,
  DashboardShell,
  StatCard,
} from '../src/components/hiraDashboard';
import { DashboardStateCard } from '../src/components/hiraDashboard/DashboardShell';
import { AdminDialog } from '../src/components/hiraDashboard/AdminForm';
import PrincipalAttendanceScreen from '../src/screens/principal/PrincipalAttendanceScreen';
import PrincipalAttendanceSessionScreen from '../src/screens/principal/PrincipalAttendanceSessionScreen';
import PrincipalAttendancePatternsScreen from '../src/screens/principal/PrincipalAttendancePatternsScreen';
import PrincipalDashboardScreen from '../src/screens/principal/PrincipalDashboardScreen';
import PrincipalWorkspaceScreen from '../src/screens/principal/PrincipalWorkspaceScreen';
import {
  attendanceOversightService,
  type AttendanceOccurrence,
  type AttendanceOccurrenceDetail,
  type AttendanceOverview,
} from '../src/services/principal/attendanceOversightService';
import { principalService } from '../src/services/principal/principalService';
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@react-navigation/native', () => {
  const R = jest.requireActual('react');
  return {
    useFocusEffect: (effect: () => void) => R.useEffect(effect, [effect]),
    useNavigation: () => mockNavigation,
  };
});
let mockToken = 'token',
  mockUser = { id: 'principal', role: 'principal', branchId: 'branch-1' };
const mockNavigation = { navigate: jest.fn() };
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({
    accessToken: mockToken,
    user: mockUser,
    logout: jest.fn(),
  }),
}));
jest.mock('../src/services/principal/attendanceOversightService', () => ({
  attendanceOversightService: {
    overview: jest.fn(),
    detail: jest.fn(),
    filters: jest.fn(),
    patterns: jest.fn(),
  },
}));
jest.mock('../src/services/principal/principalService', () => ({
  principalService: { getDashboard: jest.fn() },
}));
const service = jest.mocked(attendanceOversightService),
  dashboard = jest.mocked(principalService);
const row: AttendanceOccurrence = {
  periodId: 'period-1',
  date: '2026-10-25',
  versionId: 'version-1',
  classId: 'class-1',
  sectionId: 'section-1',
  subjectId: 'subject-1',
  teacherId: 'teacher-1',
  className: 'Grade 8 with a long Class name',
  sectionName: 'A',
  subjectName: 'Science with a long Subject name',
  teacherName: 'Teacher with a long full name',
  room: 'Room A',
  startTime: '08:00',
  endTime: '09:00',
  isSubstitute: false,
  state: 'unmarked',
  needsAttention: false,
  issues: [],
  configurationIssue: false,
  operational: true,
  sessionId: null,
  revision: 0,
  submittedAt: null,
};
const empty: AttendanceOverview = {
  date: row.date,
  today: row.date,
  timezone: 'Asia/Karachi',
  mode: 'scheduled',
  summary: {
    expected: 0,
    submitted: 0,
    unmarked: 0,
    inProgress: 0,
    needsAttention: 0,
  },
  items: [],
  total: 0,
  nextOffset: null,
};
const page: AttendanceOverview = {
  ...empty,
  summary: { ...empty.summary, expected: 1, unmarked: 1 },
  items: [row],
  total: 1,
};
const session: AttendanceOccurrenceDetail = {
  occurrence: row,
  timezone: 'Asia/Karachi',
  counts: {
    total: 1,
    present: 0,
    absent: 0,
    late: 0,
    leave: 0,
    unmarked: 1,
    approvedLeave: 1,
    leaveMismatch: 1,
  },
  students: [
    {
      studentId: 'student-1',
      fullName: 'Learner One',
      admissionNumber: 'A-1',
      status: null,
      effectiveRevision: 0,
      approvedLeave: true,
    },
  ],
  nextOffset: null,
  amendments: [
    {
      requestId: 'request-1',
      approvalId: 'approval-1',
      studentId: 'student-1',
      kind: 'correction',
      state: 'pending',
      createdAt: '2026-10-25T08:00:00Z',
      canOpenReview: true,
    },
  ],
  historyTotal: 1,
  nextHistoryOffset: null,
  operationHistory: [],
};
let trees: Renderer.ReactTestRenderer[] = [];
const mount = async (element: React.ReactElement) => {
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(element);
  });
  trees.push(tree);
  return tree;
};
const content = (tree: Renderer.ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .flatMap(n => React.Children.toArray(n.props.children))
    .join(' ');
const titles = (tree: Renderer.ReactTestRenderer) =>
  tree.root.findAllByType(Button).map(n => n.props.title);
const press = async (tree: Renderer.ReactTestRenderer, title: string) =>
  act(async () =>
    tree.root
      .findAllByType(Button)
      .find(n => n.props.title === title)!
      .props.onPress(),
  );
const input = async (
  tree: Renderer.ReactTestRenderer,
  label: string,
  value: string,
) =>
  act(async () =>
    tree.root
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === label)!
      .props.onChangeText(value),
  );
const refresh = async (tree: Renderer.ReactTestRenderer) =>
  act(async () => tree.root.findByType(DashboardShell).props.onRefresh());
const overviewElement = () => (
  <PrincipalAttendanceScreen {...({ navigation: mockNavigation } as any)} />
);
const detailElement = (periodId = 'period-1') => (
  <PrincipalAttendanceSessionScreen
    {...({
      navigation: mockNavigation,
      route: { params: { periodId, date: row.date, mode: 'scheduled' } },
    } as any)}
  />
);
beforeEach(() => {
  jest.clearAllMocks();
  mockToken = 'token';
  mockUser = { id: 'principal', role: 'principal', branchId: 'branch-1' };
  service.overview.mockResolvedValue(page);
  service.detail.mockResolvedValue(session);
  service.filters.mockResolvedValue({ items: [], total: 0, nextOffset: null });
  service.patterns.mockResolvedValue({
    from: '2026-10-19',
    until: row.date,
    timezone: 'Asia/Karachi',
    items: [],
    total: 0,
    nextOffset: null,
  });
  dashboard.getDashboard.mockResolvedValue({
    data: {
      branch: { name: 'Own Branch' },
      students: { total: 1, active: 1 },
      attendance: {
        date: row.date,
        timezone: 'Asia/Karachi',
        expected: 4,
        submitted: 2,
        unmarked: 1,
        inProgress: 1,
        needsAttention: 1,
      },
      tasks: [],
      safetyAlerts: { total: 0, critical: 0, open: 0 },
      feeSummary: { outstandingAmount: 0, overdueInvoices: 0, paidAmount: 0 },
      notices: [],
      pendingApprovals: { total: 0 },
    },
  } as any);
});
afterEach(async () =>
  act(async () => {
    trees.forEach(t => t.unmount());
    trees = [];
  }),
);
test('loading never claims a zero or empty attendance day', async () => {
  service.overview.mockReturnValue(new Promise(() => {}));
  const tree = await mount(overviewElement());
  expect(content(tree)).toContain('Loading attendance');
  expect(content(tree)).not.toContain('No scheduled sessions');
  expect(tree.root.findAllByType(StatCard)).toHaveLength(0);
});
test('populated overview shows authoritative summary, wrapped context and drilldown', async () => {
  const tree = await mount(overviewElement());
  for (const text of [
    'Expected',
    'Submitted',
    'Unmarked',
    'Needs Attention',
    'Asia/Karachi',
    row.teacherName,
    row.className,
    row.subjectName,
    'Unmarked is not absent',
  ])
    expect(content(tree)).toContain(text);
  await press(tree, 'View Session');
  expect(mockNavigation.navigate).toHaveBeenCalledWith('AttendanceSession', {
    periodId: 'period-1',
    date: row.date,
    mode: 'scheduled',
  });
});
test('no schedule, no submissions and no filtered matches have distinct copy', async () => {
  service.overview
    .mockResolvedValueOnce(empty)
    .mockResolvedValueOnce(page)
    .mockResolvedValue({ ...page, items: [], total: 0 });
  const tree = await mount(overviewElement());
  expect(content(tree)).toContain('No scheduled sessions');
  await refresh(tree);
  expect(content(tree)).toContain('No attendance submissions yet');
  await press(tree, 'Submitted');
  expect(content(tree)).toContain('No matching filtered sessions');
});
test('backend failure is an error, retry fetches data without fabricated zero counts', async () => {
  service.overview
    .mockRejectedValueOnce(new Error('Unable to load attendance'))
    .mockResolvedValue(page);
  const tree = await mount(overviewElement());
  expect(content(tree)).toContain('Unable to Load Attendance');
  expect(content(tree)).not.toContain('No scheduled sessions');
  await press(tree, 'Retry');
  expect(content(tree)).toContain(row.teacherName);
});
test('school date, status and search are server filters with reset pagination', async () => {
  const tree = await mount(overviewElement());
  await input(tree, 'Attendance date', '2026-10-20');
  await press(tree, 'Apply Date');
  expect(service.overview).toHaveBeenLastCalledWith(
    'token',
    expect.objectContaining({ date: '2026-10-20', offset: 0 }),
  );
  await press(tree, 'Needs Attention');
  expect(service.overview).toHaveBeenLastCalledWith(
    'token',
    expect.objectContaining({ state: 'needs_attention' }),
  );
  await input(tree, 'Search attendance', 'Science');
  await press(tree, 'Search Sessions');
  expect(service.overview).toHaveBeenLastCalledWith(
    'token',
    expect.objectContaining({ search: 'Science' }),
  );
  await press(tree, 'Today');
  expect(service.overview).toHaveBeenLastCalledWith(
    'token',
    expect.objectContaining({ date: undefined, offset: 0 }),
  );
});
test('Class and Section filters use searchable paginated Hira dialogs', async () => {
  service.filters.mockImplementation(async (_token, kind) => ({
    items: [
      { id: kind + '-1', label: kind === 'class' ? 'Grade 8' : 'Section A' },
    ],
    total: 21,
    nextOffset: 20,
  }));
  const tree = await mount(overviewElement());
  await press(tree, 'Class: All');
  expect(tree.root.findByType(AdminDialog).props.visible).toBe(true);
  await input(tree, 'Search class', 'Grade');
  await press(tree, 'Find Options');
  expect(service.filters).toHaveBeenLastCalledWith(
    'token',
    'class',
    expect.objectContaining({ search: 'Grade', offset: 0 }),
  );
  await press(tree, 'More Options');
  expect(service.filters).toHaveBeenLastCalledWith(
    'token',
    'class',
    expect.objectContaining({ offset: 20 }),
  );
  await press(tree, 'Grade 8');
  expect(service.overview).toHaveBeenLastCalledWith(
    'token',
    expect.objectContaining({ classId: 'class-1', offset: 0 }),
  );
  await press(tree, 'Section: All');
  expect(service.filters).toHaveBeenLastCalledWith(
    'token',
    'section',
    expect.objectContaining({ classId: 'class-1' }),
  );
  await press(tree, 'Section A');
  expect(service.overview).toHaveBeenLastCalledWith(
    'token',
    expect.objectContaining({ classId: 'class-1', sectionId: 'section-1' }),
  );
  await press(tree, 'Clear Context Filters');
  expect(service.overview).toHaveBeenLastCalledWith(
    'token',
    expect.objectContaining({ classId: undefined, sectionId: undefined }),
  );
});
test('native filter dialog Back closes through the existing Hira onClose', async () => {
  const tree = await mount(overviewElement());
  await press(tree, 'Teacher: All');
  await act(async () => tree.root.findByType(AdminDialog).props.onClose());
  expect(tree.root.findAllByType(AdminDialog)).toHaveLength(0);
});
test('history and pattern navigation preserve current context', async () => {
  const tree = await mount(overviewElement());
  await press(tree, 'Submitted History');
  expect(service.overview).toHaveBeenLastCalledWith(
    'token',
    expect.objectContaining({ mode: 'history', state: 'all' }),
  );
  await press(tree, 'Absence & Late Patterns');
  expect(mockNavigation.navigate).toHaveBeenCalledWith(
    'AttendancePatterns',
    expect.any(Object),
  );
});
test('session pagination is a bounded server request', async () => {
  service.overview.mockResolvedValue({ ...page, nextOffset: 20, total: 21 });
  const tree = await mount(overviewElement());
  await press(tree, 'Next Sessions');
  expect(service.overview).toHaveBeenLastCalledWith(
    'token',
    expect.objectContaining({ offset: 20 }),
  );
  await press(tree, 'Previous Sessions');
  expect(service.overview).toHaveBeenLastCalledWith(
    'token',
    expect.objectContaining({ offset: 0 }),
  );
});
test('Teacher submission elsewhere replaces the old unmarked status on refresh', async () => {
  service.overview.mockResolvedValueOnce(page).mockResolvedValue({
    ...page,
    summary: { ...page.summary, unmarked: 0, submitted: 1 },
    items: [{ ...row, state: 'submitted', sessionId: 'session-1' }],
  });
  const tree = await mount(overviewElement());
  await refresh(tree);
  const cards = tree.root.findAllByType(StatCard);
  expect(cards.find(n => n.props.label === 'Unmarked')!.props.value).toBe(0);
  expect(cards.find(n => n.props.label === 'Submitted')!.props.value).toBe(1);
});
test('failed refresh clears old session cards and unsafe review entry points', async () => {
  service.overview
    .mockResolvedValueOnce(page)
    .mockRejectedValue(new Error('Permission denied'));
  const tree = await mount(overviewElement());
  await refresh(tree);
  expect(content(tree)).not.toContain(row.teacherName);
  expect(titles(tree)).not.toContain('View Session');
  expect(content(tree)).toContain('Permission denied');
});
test('Branch/auth change replaces the entire oversight resource', async () => {
  service.overview.mockResolvedValueOnce(page).mockResolvedValue(empty);
  const tree = await mount(overviewElement());
  mockUser = { ...mockUser, branchId: 'branch-2' };
  await act(async () => tree.update(overviewElement()));
  expect(service.overview).toHaveBeenCalledTimes(2);
  expect(content(tree)).not.toContain(row.teacherName);
});
test('out-of-order refresh cannot restore an older unmarked row', async () => {
  let resolveOlder!: (value: AttendanceOverview) => void;
  service.overview
    .mockResolvedValueOnce(page)
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveOlder = resolve;
        }),
    )
    .mockResolvedValueOnce({
      ...page,
      summary: { ...page.summary, unmarked: 0, submitted: 1 },
      items: [{ ...row, state: 'submitted' }],
    });
  const tree = await mount(overviewElement());
  let older!: Promise<void>;
  await act(async () => {
    older = tree.root.findByType(DashboardShell).props.onRefresh();
  });
  expect(titles(tree)).not.toContain('View Session');
  await refresh(tree);
  await act(async () => {
    resolveOlder(page);
    await older;
  });
  expect(content(tree)).toContain('Submitted');
  expect(content(tree)).not.toContain('No attendance submissions yet');
});
test('detail shows roster, leave, academic context and links existing correction review', async () => {
  const tree = await mount(detailElement());
  for (const text of [
    'Eligible roster:',
    'Unmarked:',
    'Learner One',
    'Approved leave on file',
    row.teacherName,
    row.subjectName,
  ])
    expect(content(tree)).toContain(text);
  await press(tree, 'Open Correction Review');
  expect(mockNavigation.navigate).toHaveBeenCalledWith('AttendanceReview', {
    approvalId: 'approval-1',
  });
});
test('leave review uses the same existing typed review screen', async () => {
  service.detail.mockResolvedValue({
    ...session,
    amendments: [
      {
        ...session.amendments[0],
        kind: 'leave',
        fromDate: row.date,
        untilDate: row.date,
      },
    ],
  });
  const tree = await mount(detailElement());
  await press(tree, 'Open Leave Review');
  expect(mockNavigation.navigate).toHaveBeenCalledWith('AttendanceReview', {
    approvalId: 'approval-1',
  });
});
test('correction approved elsewhere updates effective marks and history on refresh', async () => {
  service.detail.mockResolvedValueOnce(session).mockResolvedValue({
    ...session,
    counts: { ...session.counts, late: 1, unmarked: 0 },
    students: [
      {
        ...session.students[0],
        status: 'late',
        originalStatus: 'absent',
        effectiveRevision: 1,
      },
    ],
    amendments: [{ ...session.amendments[0], state: 'approved' }],
    operationHistory: [
      {
        action: 'submit',
        resultingRevision: 1,
        createdAt: '2026-10-25T08:00:00Z',
      },
    ],
  });
  const tree = await mount(detailElement());
  await refresh(tree);
  expect(content(tree)).toContain('approved correction applied');
  expect(content(tree)).toContain('approved');
  expect(content(tree)).toContain('Submitted');
});
test('detail permission loss removes stale roster and review action', async () => {
  service.detail
    .mockResolvedValueOnce(session)
    .mockRejectedValue(new Error('Attendance permission changed'));
  const tree = await mount(detailElement());
  await refresh(tree);
  expect(content(tree)).not.toContain('Learner One');
  expect(titles(tree)).not.toContain('Open Correction Review');
});
test('detail actor and occurrence replacement discard previous state', async () => {
  service.detail
    .mockResolvedValueOnce(session)
    .mockResolvedValue({ ...session, amendments: [], students: [] });
  const tree = await mount(detailElement());
  mockToken = 'new-token';
  await act(async () => tree.update(detailElement('period-2')));
  expect(service.detail).toHaveBeenLastCalledWith(
    'new-token',
    'period-2',
    expect.objectContaining({ date: row.date }),
  );
  expect(content(tree)).not.toContain('Learner One');
});
test('roster and amendment history have independent pagination', async () => {
  service.detail.mockResolvedValue({
    ...session,
    nextOffset: 50,
    nextHistoryOffset: 20,
  });
  const tree = await mount(detailElement());
  await press(tree, 'Next Students');
  expect(service.detail).toHaveBeenLastCalledWith(
    'token',
    'period-1',
    expect.objectContaining({ offset: 50, historyOffset: 0 }),
  );
  await press(tree, 'Older Requests');
  expect(service.detail).toHaveBeenLastCalledWith(
    'token',
    'period-1',
    expect.objectContaining({ offset: 50, historyOffset: 20 }),
  );
});
test('read-only attendance permission does not display unavailable review links', async () => {
  service.detail.mockResolvedValue({
    ...session,
    amendments: [{ ...session.amendments[0], canOpenReview: false }],
  });
  const tree = await mount(detailElement());
  expect(titles(tree)).not.toContain('Open Correction Review');
});
test('pattern view uses bounded server ranges and does not treat unmarked as absent', async () => {
  service.patterns.mockResolvedValue({
    from: '2026-10-19',
    until: row.date,
    timezone: 'Asia/Karachi',
    items: [
      {
        studentId: 's1',
        fullName: 'Learner One',
        admissionNumber: 'A1',
        absent: 2,
        late: 1,
        sessions: 3,
      },
    ],
    total: 1,
    nextOffset: null,
  });
  const tree = await mount(
    <PrincipalAttendancePatternsScreen
      {...({ route: { params: { classId: 'class-1' } } } as any)}
    />,
  );
  expect(content(tree)).toContain('Absent periods:');
  expect(content(tree)).toContain('unmarked sessions are excluded');
  await input(tree, 'From school date', '2026-10-01');
  await input(tree, 'Until school date', '2026-10-25');
  await press(tree, 'Apply Range');
  expect(service.patterns).toHaveBeenLastCalledWith(
    'token',
    expect.objectContaining({
      classId: 'class-1',
      from: '2026-10-01',
      until: row.date,
    }),
  );
});
test('Home shows canonical session counts and no legacy attendance percentage', async () => {
  const open = jest.fn();
  const tree = await mount(
    <PrincipalDashboardScreen
      onOpenApprovals={jest.fn()}
      onOpenInbox={jest.fn()}
      onOpenTasks={jest.fn()}
      onOpenSafety={jest.fn()}
      onOpenAttendance={open}
    />,
  );
  expect(content(tree)).toContain('Expected sessions:');
  expect(content(tree)).toContain('2026-10-25');
  expect(content(tree)).not.toContain('%');
  await press(tree, 'Open Attendance');
  expect(open).toHaveBeenCalled();
});
test('Home refresh failure removes stale operational summary', async () => {
  const tree = await mount(
    <PrincipalDashboardScreen
      onOpenApprovals={jest.fn()}
      onOpenInbox={jest.fn()}
      onOpenTasks={jest.fn()}
      onOpenSafety={jest.fn()}
    />,
  );
  expect(content(tree)).toContain('Expected sessions:');
  dashboard.getDashboard.mockRejectedValueOnce(new Error('Offline'));
  await act(async () =>
    tree.root.findByType(DashboardStateCard).props.onRetry(),
  );
  expect(content(tree)).not.toContain('Expected sessions:');
  expect(content(tree)).toContain('Attendance could not be loaded');
});
test('Attendance is discoverable in the existing Principal drawer', async () => {
  const tree = await mount(<PrincipalWorkspaceScreen />);
  await act(async () =>
    tree.root
      .findAll(
        n =>
          n.props.accessibilityLabel === 'Open navigation drawer' &&
          typeof n.props.onPress === 'function',
      )[0]
      .props.onPress(),
  );
  await act(async () =>
    tree.root
      .findAll(
        n =>
          n.props.accessibilityLabel === 'Attendance' &&
          typeof n.props.onPress === 'function',
      )[0]
      .props.onPress(),
  );
  expect(mockNavigation.navigate).toHaveBeenCalledWith('Attendance');
});

test('Home Branch context change with the same token hides the prior attendance summary while revalidating', async () => {
  const element = () => (
    <PrincipalDashboardScreen
      onOpenApprovals={jest.fn()}
      onOpenInbox={jest.fn()}
      onOpenTasks={jest.fn()}
      onOpenSafety={jest.fn()}
    />
  );
  const tree = await mount(element());
  expect(content(tree)).toContain('Expected sessions:');
  let rejectLatest!: (error: Error) => void;
  dashboard.getDashboard.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectLatest = reject;
      }),
  );
  mockUser = { ...mockUser, branchId: 'branch-2' };
  await act(async () => tree.update(element()));
  expect(content(tree)).not.toContain('Expected sessions:');
  await act(async () => rejectLatest(new Error('Permission changed')));
  expect(content(tree)).not.toContain('Expected sessions:');
});
