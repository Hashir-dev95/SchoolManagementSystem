import React from 'react';
import { Text, TextInput } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import TeacherTimetableScreen from '../src/screens/teacher/TeacherTimetableScreen';
import TeacherPeriodScreen from '../src/screens/teacher/TeacherPeriodScreen';
import {
  timetableService,
  TeacherPeriod,
  TeacherTimetable,
} from '../src/services/teacher/timetableService';
import {
  Button,
  Card,
  SectionCard,
  ScreenHeading,
  StatusBadge,
} from '../src/components/hiraDashboard';
import { DashboardShell } from '../src/components/hiraDashboard/DashboardShell';
import { ApiError } from '../src/services/api/apiClient';

jest.mock('../src/services/teacher/timetableService', () => ({
  timetableService: {
    getToday: jest.fn(),
    getWeek: jest.fn(),
    getPeriod: jest.fn(),
    acknowledge: jest.fn(),
    requestIssue: jest.fn(),
  },
}));
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ accessToken: 'token', user: { role: 'teacher' } }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
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
const service = jest.mocked(timetableService);
const period: TeacherPeriod = {
  periodId: 'period',
  date: '2026-10-13',
  startTime: '09:00',
  endTime: '10:00',
  room: 'Room 8',
  classId: 'c8',
  className: 'Class 8',
  sectionId: 'a',
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
  canAcknowledgeSubstitute: false,
  canRequestIssue: true,
};
const substitute: TeacherPeriod = {
  ...period,
  isSubstitute: true,
  substituteId: 'sub',
  substituteStatus: 'needs_acknowledgement',
  canAcknowledgeSubstitute: true,
};
const queue = (periods = [period]): TeacherTimetable => ({
  timezone: 'Asia/Karachi',
  today: period.date,
  start: period.date,
  end: period.date,
  periods,
});
const navigation = { navigate: jest.fn(), goBack: jest.fn() };
const list = () => (
  <TeacherTimetableScreen
    navigation={navigation as never}
    route={{} as never}
  />
);
const detail = (id = period.periodId) => (
  <TeacherPeriodScreen
    navigation={navigation as never}
    route={{ params: { periodId: id, date: period.date } } as never}
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
    .map(n =>
      React.Children.toArray(n.props.children)
        .filter(c => typeof c === 'string' || typeof c === 'number')
        .join(''),
    )
    .join(' ');
const buttons = (tree: Renderer.ReactTestRenderer, title: string) =>
  tree.root.findAllByType(Button).filter(n => n.props.title === title);
async function press(tree: Renderer.ReactTestRenderer, title: string) {
  await act(async () => {
    await buttons(tree, title)[0].props.onPress();
  });
}
async function input(
  tree: Renderer.ReactTestRenderer,
  label: string,
  value: string,
) {
  await act(async () => {
    tree.root
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === label)!
      .props.onChangeText(value);
  });
}
async function refresh(tree: Renderer.ReactTestRenderer) {
  await act(async () => {
    tree.root.findByType(DashboardShell).props.onRefresh();
  });
}
async function returnFocus() {
  await act(async () => {
    [...mockFocus].forEach(e => e.blur());
    [...mockFocus].forEach(e => e.focus());
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  jest.clearAllMocks();
  service.getToday.mockReset().mockResolvedValue(queue());
  service.getWeek.mockReset().mockResolvedValue(queue());
  service.getPeriod.mockReset().mockResolvedValue(period);
  service.acknowledge.mockReset().mockResolvedValue({
    ...substitute,
    substituteStatus: 'acknowledged',
    canAcknowledgeSubstitute: false,
  });
  service.requestIssue
    .mockReset()
    .mockResolvedValue({ ...period, issueStatus: 'open' });
});
afterEach(async () => {
  await act(async () => {
    trees.splice(0).forEach(t => t.unmount());
  });
});

test('loading and server-authoritative context use shared Hira presentation', async () => {
  const pending = deferred<TeacherTimetable>();
  service.getToday.mockReturnValueOnce(pending.promise);
  const tree = await mount(list());
  expect(text(tree)).toContain('Loading');
  await act(async () => pending.resolve(queue()));
  expect(text(tree)).toContain('Room 8');
  expect(text(tree)).toContain('Math');
  expect(text(tree)).toContain('Asia/Karachi');
  expect(tree.root.findAllByType(Card).length).toBeGreaterThan(0);
  expect(tree.root.findAllByType(SectionCard)).toHaveLength(1);
  expect(tree.root.findAllByType(ScreenHeading)).toHaveLength(1);
});
test('empty queue is truthful', async () => {
  service.getToday.mockResolvedValueOnce(queue([]));
  expect(text(await mount(list()))).toContain('No effective assigned periods');
});
test('error and Retry load current data', async () => {
  service.getToday.mockRejectedValueOnce(new Error('Offline'));
  const tree = await mount(list());
  expect(text(tree)).toContain('Offline');
  await press(tree, 'Retry');
  expect(text(tree)).toContain('Room 8');
  expect(text(tree)).not.toContain('Offline');
});
test('date validation, day/week selection and Today use the typed service', async () => {
  const tree = await mount(list());
  await input(tree, 'Timetable date', '2026-02-30');
  await press(tree, 'Apply date');
  expect(text(tree)).toContain('Enter a valid date');
  expect(service.getToday).toHaveBeenCalledTimes(1);
  await input(tree, 'Timetable date', '2026-10-14');
  await press(tree, 'Apply date');
  expect(service.getToday).toHaveBeenLastCalledWith('token', '2026-10-14');
  await press(tree, 'Show week');
  expect(service.getWeek).toHaveBeenLastCalledWith('token', '2026-10-14');
  await press(tree, 'Today');
  expect(service.getToday).toHaveBeenLastCalledWith('token', undefined);
});
test('pull and focus refresh preserve selection/date and identifier-only navigation', async () => {
  const tree = await mount(list());
  await input(tree, 'Timetable date', period.date);
  await press(tree, 'Apply date');
  await press(tree, 'Show week');
  await press(tree, 'Open period');
  expect(navigation.navigate).toHaveBeenCalledWith('TeacherPeriod', {
    periodId: 'period',
    date: period.date,
  });
  await returnFocus();
  await refresh(tree);
  expect(service.getWeek).toHaveBeenLastCalledWith('token', period.date);
  expect(text(tree)).toContain('Selected period');
  expect(tree.root.findByType(DashboardShell).props.refreshing).toBe(false);
  service.getWeek.mockResolvedValueOnce(queue([]));
  await refresh(tree);
  expect(text(tree)).not.toContain('Selected period');
});
test('late success cannot overwrite a newer date queue', async () => {
  const old = deferred<TeacherTimetable>();
  service.getToday.mockReturnValueOnce(old.promise);
  const tree = await mount(list());
  await input(tree, 'Timetable date', '2026-10-14');
  service.getToday.mockResolvedValueOnce(
    queue([{ ...period, room: 'New room' }]),
  );
  await press(tree, 'Apply date');
  await act(async () => old.resolve(queue([{ ...period, room: 'Old room' }])));
  expect(text(tree)).toContain('New room');
  expect(text(tree)).not.toContain('Old room');
});
test('old request error cannot replace newer success or loading state', async () => {
  const old = deferred<TeacherTimetable>();
  service.getToday.mockReturnValueOnce(old.promise);
  const tree = await mount(list());
  await refresh(tree);
  await act(async () => old.reject(new Error('Old failure')));
  expect(text(tree)).toContain('Room 8');
  expect(text(tree)).not.toContain('Old failure');
  expect(tree.root.findByType(DashboardShell).props.refreshing).toBe(false);
});
test('concealed 404 and permission denial are truthful and clear stale periods', async () => {
  const tree = await mount(list());
  service.getToday.mockRejectedValueOnce(new ApiError(404, 'hidden'));
  await refresh(tree);
  expect(text(tree)).toContain('unavailable or you no longer have access');
  expect(text(tree)).not.toContain('Room 8');
  service.getToday.mockRejectedValueOnce(
    new ApiError(403, 'Permission denied'),
  );
  await press(tree, 'Retry');
  expect(text(tree)).toContain('Permission denied');
});
test('substitute status uses shared badges and actions require backend capabilities', async () => {
  service.getToday.mockResolvedValueOnce(queue([substitute]));
  const tree = await mount(list());
  expect(tree.root.findAllByType(StatusBadge).length).toBeGreaterThan(0);
  expect(buttons(tree, 'Acknowledge substitute')).toHaveLength(1);
  service.getToday.mockResolvedValueOnce(
    queue([{ ...period, canRequestIssue: false }]),
  );
  await refresh(tree);
  expect(buttons(tree, 'Acknowledge substitute')).toHaveLength(0);
  expect(buttons(tree, 'Request issue')).toHaveLength(0);
});
test('acknowledgement awaits server, blocks duplicate clicks and refreshes the card', async () => {
  service.getToday.mockResolvedValueOnce(queue([substitute]));
  const waiting = deferred<TeacherPeriod>();
  service.acknowledge.mockReturnValueOnce(waiting.promise);
  const tree = await mount(list());
  const handler = buttons(tree, 'Acknowledge substitute')[0].props.onPress;
  await act(async () => {
    handler();
    handler();
  });
  expect(service.acknowledge).toHaveBeenCalledTimes(1);
  expect(text(tree)).not.toContain('acknowledgement confirmed');
  expect(buttons(tree, 'Open period')[0].props.disabled).toBe(true);
  service.getToday.mockResolvedValueOnce(
    queue([
      {
        ...substitute,
        substituteStatus: 'acknowledged',
        canAcknowledgeSubstitute: false,
      },
    ]),
  );
  await act(async () => waiting.resolve(substitute));
  expect(text(tree)).toContain('acknowledgement confirmed');
  expect(buttons(tree, 'Acknowledge substitute')).toHaveLength(0);
});
test('failed acknowledgement keeps unchanged state and can retry', async () => {
  service.getToday.mockResolvedValueOnce(queue([substitute]));
  service.acknowledge.mockRejectedValueOnce(new Error('Network failed'));
  const tree = await mount(list());
  await press(tree, 'Acknowledge substitute');
  expect(text(tree)).toContain('Network failed');
  expect(text(tree)).not.toContain('acknowledgement confirmed');
  expect(buttons(tree, 'Acknowledge substitute')[0].props.disabled).toBe(false);
  await press(tree, 'Acknowledge substitute');
  expect(service.acknowledge).toHaveBeenCalledTimes(2);
});
test('detail reloads identifiers and handles unavailable period', async () => {
  service.getPeriod.mockRejectedValueOnce(new ApiError(404, 'hidden'));
  const tree = await mount(detail());
  expect(service.getPeriod).toHaveBeenCalledWith(
    'token',
    'period',
    period.date,
  );
  expect(text(tree)).toContain('unavailable or you no longer have access');
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
  await press(tree, 'Retry');
  expect(text(tree)).toContain('Room 8');
});
test('detail acknowledgement refreshes confirmed status', async () => {
  service.getPeriod.mockResolvedValueOnce(substitute).mockResolvedValueOnce({
    ...substitute,
    substituteStatus: 'acknowledged',
    canAcknowledgeSubstitute: false,
  });
  const tree = await mount(detail());
  await press(tree, 'Acknowledge substitute');
  expect(service.getPeriod).toHaveBeenCalledTimes(2);
  expect(text(tree)).toContain('acknowledgement confirmed');
});
test('issue validation, failed submission preserves text, success trims and refreshes', async () => {
  const tree = await mount(detail());
  await input(tree, 'Issue reason', '  ');
  await press(tree, 'Submit issue');
  expect(service.requestIssue).not.toHaveBeenCalled();
  expect(text(tree)).toContain('Enter a reason');
  await input(tree, 'Issue reason', 'x'.repeat(501));
  await press(tree, 'Submit issue');
  expect(service.requestIssue).not.toHaveBeenCalled();
  expect(tree.root.findByType(TextInput).props.maxLength).toBe(500);
  await input(tree, 'Issue reason', '  Room conflict  ');
  service.requestIssue.mockRejectedValueOnce(new Error('Offline'));
  await press(tree, 'Submit issue');
  expect(tree.root.findByType(TextInput).props.value).toBe('  Room conflict  ');
  expect(text(tree)).toContain('Offline');
  expect(text(tree)).not.toContain('Issue request confirmed');
  service.getPeriod.mockResolvedValueOnce({ ...period, issueStatus: 'open' });
  await press(tree, 'Submit issue');
  expect(service.requestIssue).toHaveBeenLastCalledWith(
    'token',
    'period',
    period.date,
    'Room conflict',
    expect.stringMatching(/^[A-Za-z0-9_-]{16,80}$/),
  );
  expect(text(tree)).toContain('Issue request confirmed');
  expect(tree.root.findByType(TextInput).props.value).toBe('');
  expect(service.getPeriod).toHaveBeenCalledTimes(2);
});
test('issue duplicate-click guard and blur prevent late confirmation or cleared draft', async () => {
  const waiting = deferred<TeacherPeriod>();
  service.requestIssue.mockReturnValueOnce(waiting.promise);
  const tree = await mount(detail());
  await input(tree, 'Issue reason', 'Keep my text');
  const handler = buttons(tree, 'Submit issue')[0].props.onPress;
  await act(async () => {
    handler();
    handler();
  });
  expect(service.requestIssue).toHaveBeenCalledTimes(1);
  await act(async () => mockFocus.forEach(e => e.blur()));
  await act(async () => waiting.resolve(period));
  expect(text(tree)).not.toContain('Issue request confirmed');
  expect(tree.root.findByType(TextInput).props.value).toBe('Keep my text');
});
test('unmount invalidates pending loads and mutation completions', async () => {
  const waiting = deferred<TeacherTimetable>();
  service.getToday.mockReturnValueOnce(waiting.promise);
  const tree = await mount(list());
  await act(async () => tree.unmount());
  trees.splice(trees.indexOf(tree), 1);
  await act(async () => waiting.resolve(queue()));
  expect(mockFocus).toHaveLength(0);
});
test('safe period presentation does not render arbitrary private payload properties', async () => {
  service.getPeriod.mockResolvedValueOnce({
    ...period,
    guardianPhone: 'PRIVATE-PHONE',
    medical: 'PRIVATE-MEDICAL',
  } as TeacherPeriod);
  const tree = await mount(detail());
  expect(text(tree)).not.toContain('PRIVATE-');
  expect(text(tree)).toContain('Class 8');
});

test('uncertain retry reuses identity; confirmed new report receives a new identity', async () => {
  const tree = await mount(detail());
  await input(tree, 'Issue reason', 'First legitimate issue');
  service.requestIssue.mockRejectedValueOnce(
    new Error('Timeout after possible commit'),
  );
  await press(tree, 'Submit issue');
  const firstId = service.requestIssue.mock.calls[0][4];
  await press(tree, 'Submit issue');
  expect(service.requestIssue.mock.calls[1][4]).toBe(firstId);
  expect(tree.root.findByType(TextInput).props.value).toBe('');
  await input(tree, 'Issue reason', 'Second legitimate issue');
  await press(tree, 'Submit issue');
  expect(service.requestIssue.mock.calls[2][4]).not.toBe(firstId);
  expect(service.requestIssue.mock.calls[2][3]).toBe('Second legitimate issue');
});
test('mutation scope denial refreshes detail and removes stale capabilities', async () => {
  service.getPeriod
    .mockResolvedValueOnce(substitute)
    .mockRejectedValueOnce(new ApiError(404, 'Unavailable'));
  service.acknowledge.mockRejectedValueOnce(
    new ApiError(404, 'Authority withdrawn'),
  );
  const tree = await mount(detail());
  await press(tree, 'Acknowledge substitute');
  expect(service.getPeriod).toHaveBeenCalledTimes(2);
  expect(buttons(tree, 'Acknowledge substitute')).toHaveLength(0);
  expect(text(tree)).toContain('unavailable');
});
