import React from 'react';
import { Alert, Text } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import TeacherAttendanceScreen from '../src/screens/teacher/TeacherAttendanceScreen';
import TeacherAttendanceQueueScreen from '../src/screens/teacher/TeacherAttendanceQueueScreen';
import {
  attendanceService,
  type AttendanceDetail,
  type AttendanceQueue,
} from '../src/services/teacher/attendanceService';
import {
  Button,
  Card,
  ScreenHeading,
  SectionCard,
  StatusBadge,
} from '../src/components/hiraDashboard';
import { DashboardShell } from '../src/components/hiraDashboard/DashboardShell';
import { ApiError } from '../src/services/api/apiClient';

jest.mock('../src/services/teacher/attendanceService', () => ({
  ...jest.requireActual('../src/services/teacher/attendanceService'),
  attendanceService: {
    open: jest.fn(),
    getPending: jest.fn(),
    getSession: jest.fn(),
    save: jest.fn(),
  },
}));
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ accessToken: 'token', user: { role: 'teacher' } }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}));
const mockFocus: { focus: () => void; blur: () => void }[] = [];
let mockPrevent: { enabled: boolean; callback: (event: unknown) => void };
jest.mock('@react-navigation/native', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    usePreventRemove: (
      enabled: boolean,
      callback: (event: unknown) => void,
    ) => {
      mockPrevent = { enabled, callback };
    },
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
jest.setTimeout(15000); // React Native's first cold render initializes native mocks.
const service = jest.mocked(attendanceService);
const detail: AttendanceDetail = {
  sessionId: 'session',
  revision: 0,
  rosterVersion: 'a'.repeat(64),
  rosterChanged: false,
  state: 'open',
  submittedAt: null,
  canSave: true,
  period: {
    periodId: 'period',
    date: '2026-10-13',
    startTime: '09:00',
    endTime: '09:40',
    room: 'Room 8',
    classId: 'c8',
    className: 'Class 8',
    sectionId: 's8',
    sectionName: 'A',
    subjectId: 'math',
    subjectName: 'Math',
    approvedVersion: {
      versionId: 'v1',
      versionNumber: 1,
      effectiveFrom: '2026-10-01',
      effectiveUntil: '2026-11-01',
    },
    isSubstitute: false,
    substituteId: null,
    substituteStatus: null,
    acknowledgedAt: null,
    issueStatus: null,
    canRequestIssue: true,
    canAcknowledgeSubstitute: false,
  },
  students: [
    {
      studentId: 's1',
      fullName: 'Learner One',
      admissionNumber: 'A1',
      status: null,
    },
    {
      studentId: 's2',
      fullName: 'Learner Two',
      admissionNumber: 'A2',
      status: null,
    },
  ],
};
const queue = (
  sessions: AttendanceQueue['sessions'] = [
    { sessionId: null, period: detail.period, state: 'open', revision: 0 },
  ],
): AttendanceQueue => ({
  date: detail.period.date,
  timezone: 'Asia/Karachi',
  total: sessions.length,
  sessions,
});
const navigation = { navigate: jest.fn(), dispatch: jest.fn() };
const editor = (date = detail.period.date) => (
  <TeacherAttendanceScreen
    navigation={navigation as never}
    route={{ params: { periodId: 'period', date } } as never}
  />
);
const list = () => (
  <TeacherAttendanceQueueScreen
    navigation={navigation as never}
    route={{} as never}
  />
);
const trees: Renderer.ReactTestRenderer[] = [];
async function mount(element: React.ReactElement) {
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
    .map(n => n.props.children)
    .flat(Infinity)
    .join(' ')
    .replace(/\s+/g, ' ');
const button = (tree: Renderer.ReactTestRenderer, title: string) =>
  tree.root.findAllByType(Button).find(b => b.props.title === title)!;
const press = async (tree: Renderer.ReactTestRenderer, title: string) => {
  await act(async () => {
    await button(tree, title).props.onPress();
  });
};
const mark = async (tree: Renderer.ReactTestRenderer, status: string) => {
  await act(async () => {
    tree.root
      .findAll(n => n.props.accessibilityLabel === 'Learner One: ' + status)[0]!
      .props.onPress();
  });
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
beforeEach(() => {
  jest.resetAllMocks();
  service.open.mockResolvedValue(detail);
  service.getPending.mockResolvedValue(queue());
  service.getSession.mockResolvedValue({
    ...detail,
    revision: 1,
    state: 'draft',
    students: detail.students.map(s => ({ ...s, status: 'present' })),
  });
  service.save.mockResolvedValue({
    sessionId: 'session',
    revision: 1,
    state: 'draft',
    replayed: false,
  });
});
afterEach(async () => {
  await act(async () => {
    trees.splice(0).forEach(t => t.unmount());
  });
});
test('queue renders real pending periods and opens identifier-only attendance context', async () => {
  const tree = await mount(list());
  expect(text(tree)).toContain('Class 8');
  await press(tree, 'Open attendance');
  expect(navigation.navigate).toHaveBeenCalledWith('TeacherAttendance', {
    periodId: 'period',
    date: '2026-10-13',
  });
  expect(text(tree)).toContain('Selected occurrence');
});
test('queue empty state is truthful and refresh uses shared queue service', async () => {
  service.getPending.mockResolvedValue(queue([]));
  const tree = await mount(list());
  expect(text(tree)).toContain('No attendance sessions are pending');
  await act(async () => {
    await tree.root.findByType(DashboardShell).props.onRefresh();
  });
  expect(service.getPending).toHaveBeenCalledTimes(2);
});
test('queue error and retry recover', async () => {
  service.getPending.mockRejectedValueOnce(new Error('Network failure'));
  const tree = await mount(list());
  expect(text(tree)).toContain('Network failure');
  await press(tree, 'Retry');
  expect(text(tree)).toContain('Class 8');
});
test('queue latest response wins over an older request', async () => {
  const old = deferred<AttendanceQueue>();
  service.getPending.mockReturnValueOnce(old.promise);
  const tree = await mount(list());
  await act(async () => {
    mockFocus[0].focus();
  });
  await act(async () => {
    old.resolve(queue([]));
  });
  expect(text(tree)).toContain('Class 8');
});
test('editor initial loading, explicit Unmarked and shared Hira components', async () => {
  const waiting = deferred<AttendanceDetail>();
  service.open.mockReturnValueOnce(waiting.promise);
  const tree = await mount(editor());
  expect(text(tree)).toContain('Loading');
  await act(async () => {
    waiting.resolve(detail);
  });
  expect(text(tree)).toContain('Status: Unmarked');
  for (const component of [Card, ScreenHeading, SectionCard, StatusBadge])
    expect(tree.root.findAllByType(component).length).toBeGreaterThan(0);
  expect(service.save).not.toHaveBeenCalled();
});
test.each(['present', 'absent', 'late', 'leave'])(
  'individual %s is explicit and other learner stays unmarked',
  async status => {
    const tree = await mount(editor());
    await mark(tree, status);
    expect(text(tree)).toContain('Status: ' + status);
    expect(text(tree)).toContain('Status: Unmarked');
  },
);
test('bulk mark is explicit and allows individual override afterward', async () => {
  const tree = await mount(editor());
  await press(tree, 'Mark all present');
  await mark(tree, 'absent');
  await press(tree, 'Save draft');
  expect(service.save.mock.calls[0][3].marks).toEqual([
    { studentId: 's1', status: 'absent' },
    { studentId: 's2', status: 'present' },
  ]);
});
test('draft explicitly sends null for unmarked and reloads after confirmed save', async () => {
  const tree = await mount(editor());
  await mark(tree, 'late');
  await press(tree, 'Save draft');
  expect(service.save.mock.calls[0][2]).toBe('draft');
  expect(service.save.mock.calls[0][3].marks[1].status).toBeNull();
  expect(service.getSession).toHaveBeenCalled();
  expect(text(tree)).toContain('Draft save confirmed');
});
test('incomplete submit does not send or infer absent', async () => {
  const tree = await mount(editor());
  await press(tree, 'Submit attendance');
  expect(text(tree)).toContain('Explicitly mark every student');
  expect(service.save).not.toHaveBeenCalled();
});
test('successful complete submit waits for server and displays immutable state', async () => {
  service.getSession.mockResolvedValue({
    ...detail,
    state: 'submitted',
    canSave: false,
    revision: 1,
    students: detail.students.map(s => ({ ...s, status: 'present' })),
  });
  const tree = await mount(editor());
  await press(tree, 'Mark all present');
  await press(tree, 'Submit attendance');
  expect(service.save.mock.calls[0][2]).toBe('submit');
  expect(text(tree)).toContain('Attendance submission confirmed');
  expect(button(tree, 'Save draft')).toBeUndefined();
});
test('uncertain failure preserves marks and retry uses identical operation ID', async () => {
  service.save.mockRejectedValueOnce(new Error('Timeout'));
  const tree = await mount(editor());
  await press(tree, 'Mark all present');
  await press(tree, 'Save draft');
  expect(text(tree)).toContain('Status: present');
  await press(tree, 'Save draft');
  expect(service.save.mock.calls[0][3].clientOperationId).toBe(
    service.save.mock.calls[1][3].clientOperationId,
  );
});
test('editing after failed attempt uses a new operation ID', async () => {
  service.save.mockRejectedValueOnce(new Error('Timeout'));
  const tree = await mount(editor());
  await press(tree, 'Mark all present');
  await press(tree, 'Save draft');
  await mark(tree, 'leave');
  await press(tree, 'Save draft');
  expect(service.save.mock.calls[0][3].clientOperationId).not.toBe(
    service.save.mock.calls[1][3].clientOperationId,
  );
});
test('active duplicate press sends one request and no optimistic success', async () => {
  const waiting =
    deferred<Awaited<ReturnType<typeof attendanceService.save>>>();
  service.save.mockReturnValueOnce(waiting.promise);
  const tree = await mount(editor());
  await press(tree, 'Mark all present');
  await act(async () => {
    button(tree, 'Save draft').props.onPress();
    button(tree, 'Save draft').props.onPress();
  });
  expect(service.save).toHaveBeenCalledTimes(1);
  expect(text(tree)).not.toContain('Draft save confirmed');
  await act(async () => {
    waiting.resolve({
      sessionId: 'session',
      revision: 1,
      state: 'draft',
      replayed: false,
    });
  });
});
test('409 preserves local edits and requires explicit review before another save', async () => {
  service.save.mockRejectedValueOnce(new ApiError(409, 'Roster changed'));
  service.open
    .mockResolvedValueOnce(detail)
    .mockResolvedValue({ ...detail, revision: 2 });
  const tree = await mount(editor());
  await mark(tree, 'leave');
  await press(tree, 'Save draft');
  expect(text(tree)).toContain('Roster changed');
  expect(text(tree)).toContain('Status: leave');
  expect(button(tree, 'Save draft').props.disabled).toBe(true);
  await press(tree, 'Use reviewed server state');
  expect(text(tree)).toContain('Status: Unmarked');
});
test.each([401, 403, 404])(
  '%s mutation invalidation reloads and hides stale capabilities',
  async status => {
    service.save.mockRejectedValueOnce(
      new ApiError(status, 'Access withdrawn'),
    );
    service.open
      .mockResolvedValueOnce(detail)
      .mockRejectedValueOnce(new ApiError(404, 'Not found'));
    const tree = await mount(editor());
    await mark(tree, 'present');
    await press(tree, 'Save draft');
    expect(service.open).toHaveBeenCalledTimes(2);
    expect(button(tree, 'Save draft')).toBeUndefined();
    expect(text(tree)).toContain('Access withdrawn');
  },
);
test('focus refresh preserves dirty edits until explicit server review', async () => {
  const tree = await mount(editor());
  await mark(tree, 'leave');
  await act(async () => {
    mockFocus[0].blur();
    mockFocus[0].focus();
  });
  expect(text(tree)).toContain('Status: leave');
  expect(text(tree)).toContain('Review current server attendance');
});
test('unsaved back warns; confirmed discard dispatches the requested action', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const tree = await mount(editor());
  expect(mockPrevent.enabled).toBe(false);
  await mark(tree, 'present');
  expect(mockPrevent.enabled).toBe(true);
  mockPrevent.callback({ data: { action: { type: 'GO_BACK' } } });
  expect(alert).toHaveBeenCalled();
  alert.mock.calls[0][2]![1].onPress!();
  expect(navigation.dispatch).toHaveBeenCalledWith({ type: 'GO_BACK' });
  alert.mockRestore();
});
test('empty roster and concealed 404 are truthful', async () => {
  service.open.mockResolvedValueOnce({ ...detail, students: [] });
  const tree = await mount(editor());
  expect(text(tree)).toContain('No currently enrolled students');
  service.open.mockRejectedValueOnce(new ApiError(404, 'Not found'));
  await act(async () => {
    mockFocus[0].focus();
  });
  expect(text(tree)).toContain('unavailable or you no longer have access');
});
test('late old detail response cannot overwrite latest focused resource', async () => {
  const old = deferred<AttendanceDetail>();
  service.open.mockReturnValueOnce(old.promise);
  const tree = await mount(editor());
  await act(async () => {
    mockFocus[0].focus();
  });
  await act(async () => {
    old.resolve({ ...detail, students: [] });
  });
  expect(text(tree)).toContain('Learner One');
});
test('an old error cannot replace newer successful attendance detail', async () => {
  const old = deferred<AttendanceDetail>();
  service.open.mockReturnValueOnce(old.promise);
  const tree = await mount(editor());
  await act(async () => {
    mockFocus[0].focus();
  });
  await act(async () => {
    old.reject(new Error('Stale failure'));
  });
  expect(text(tree)).toContain('Learner One');
  expect(text(tree)).not.toContain('Stale failure');
});
test('changing occurrence discards old operation identity and loads new date context', async () => {
  service.save.mockRejectedValueOnce(new Error('Timeout'));
  const tree = await mount(editor());
  await press(tree, 'Mark all present');
  await press(tree, 'Save draft');
  service.open.mockResolvedValue({
    ...detail,
    period: { ...detail.period, date: '2026-10-06' },
  });
  await act(async () => {
    tree.update(editor('2026-10-06'));
  });
  await press(tree, 'Mark all present');
  await press(tree, 'Save draft');
  expect(service.save.mock.calls[0][3].clientOperationId).not.toBe(
    service.save.mock.calls[1][3].clientOperationId,
  );
  expect(service.open).toHaveBeenLastCalledWith(
    'token',
    'period',
    '2026-10-06',
  );
});
test('confirmed draft then intentional later edit generates a new operation ID', async () => {
  const tree = await mount(editor());
  await press(tree, 'Mark all present');
  await press(tree, 'Save draft');
  await mark(tree, 'leave');
  await press(tree, 'Save draft');
  expect(service.save.mock.calls[0][3].clientOperationId).not.toBe(
    service.save.mock.calls[1][3].clientOperationId,
  );
  expect(service.save.mock.calls[1][3].revision).toBe(1);
});
test('failed submission retains every explicit edit without manufacturing absence', async () => {
  service.save.mockRejectedValueOnce(new Error('Network unavailable'));
  const tree = await mount(editor());
  await press(tree, 'Mark all present');
  await mark(tree, 'leave');
  await press(tree, 'Submit attendance');
  expect(text(tree)).toContain('Status: leave');
  expect(text(tree)).toContain('Status: present');
  expect(text(tree)).toContain('Network unavailable');
  expect(service.getSession).not.toHaveBeenCalled();
});
test('editor Retry clears a prior read error after successful reload', async () => {
  service.open.mockRejectedValueOnce(new Error('Initial read failed'));
  const tree = await mount(editor());
  expect(text(tree)).toContain('Initial read failed');
  await press(tree, 'Retry');
  expect(text(tree)).toContain('Learner One');
  expect(text(tree)).not.toContain('Initial read failed');
});
