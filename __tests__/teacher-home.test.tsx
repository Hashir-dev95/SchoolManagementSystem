import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Button, Card, HeroBanner } from '../src/components/hiraDashboard';
import {
  DashboardShell,
  DashboardStateCard,
} from '../src/components/hiraDashboard/DashboardShell';
import TeacherHomeScreen from '../src/screens/teacher/TeacherHomeScreen';
import TeacherWorkspaceScreen from '../src/screens/teacher/TeacherWorkspaceScreen';
import {
  homeService,
  type TeacherHome,
} from '../src/services/teacher/homeService';
import { ApiError } from '../src/services/api/apiClient';
let mockToken: string | null = 'token';
let mockRole = 'teacher';
const mockFocus: { focus: () => void; blur: () => void }[] = [];
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({
    accessToken: mockToken,
    user: { id: 'teacher', role: mockRole, fullName: 'Ayesha Khan' },
    logout: jest.fn(),
  }),
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void | (() => void)) =>
    jest.requireActual('react').useEffect(() => {
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
    }, [effect]),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}));
jest.mock('../src/services/teacher/homeService', () => ({
  homeService: { getHome: jest.fn() },
}));
jest.mock('../src/services/teacher/teacherService', () => ({
  teacherService: { getAssignedClasses: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../src/services/teacher/communicationService', () => ({
  communicationService: {
    tasks: jest
      .fn()
      .mockResolvedValue({ total: 0, items: [], nextOffset: null }),
    inbox: jest
      .fn()
      .mockResolvedValue({ total: 0, items: [], nextOffset: null }),
  },
}));
const period = {
  periodId: 'period',
  date: '2026-10-14',
  startTime: '13:20',
  endTime: '14:00',
  className: 'Grade 8',
  sectionName: 'A',
  subjectName: 'Mathematics',
  room: 'Room 204',
  isSubstitute: false,
};
const fixture: TeacherHome = {
  teacher: { id: 'teacher', fullName: 'Ayesha Khan' },
  schoolDate: '2026-10-14',
  timezone: 'Asia/Karachi',
  hero: {
    state: 'next',
    greeting: 'Good afternoon',
    periodCount: 3,
    currentOrNextPeriod: period,
  },
  primaryAction: {
    type: 'attendance',
    count: 2,
    routeTarget: 'TeacherAttendanceQueue',
  },
};
const api = jest.mocked(homeService),
  onAction = jest.fn(),
  trees: Renderer.ReactTestRenderer[] = [];
const text = (tree: Renderer.ReactTestRenderer) =>
  JSON.stringify(tree.toJSON(), (key, value) =>
    key === 'props' ? undefined : value,
  );
async function render(onOpenLiveLesson?: (occurrence: {periodId: string; date: string}) => void) {
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(<TeacherHomeScreen onAction={onAction} onOpenLiveLesson={onOpenLiveLesson} />);
  });
  trees.push(tree);
  return tree;
}
const button = (tree: Renderer.ReactTestRenderer, title: string) =>
  tree.root.findAllByType(Button).find(n => n.props.title === title)!;
const pending = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { resolve, promise };
};
beforeEach(() => {
  jest.clearAllMocks();
  mockToken = 'token'; mockRole = 'teacher';
  api.getHome.mockReset().mockResolvedValue(fixture);
});
afterEach(async () => {
  await act(async () => trees.splice(0).forEach(t => t.unmount()));
  jest.restoreAllMocks();
});
test('Hero uses real Teacher name, school date and next class/subject/room without duplicate context', async () => {
  const tree = await render(),
    hero = tree.root.findByType(HeroBanner);
  expect(hero.props.title).toBe('Good afternoon, Ayesha Khan');
  expect(hero.props.dateLabel).toContain('Wednesday');
  expect(hero.props.dateLabel).toContain('14 October');
  expect(hero.props.subtitle).toContain('Next period: Grade 8');
  expect(hero.props.subtitle).toContain('Mathematics');
  expect(hero.props.subtitle).toContain('Room 204');
  expect(hero.props.subtitle).toContain('1:20 PM');
  expect(tree.root.findAllByType(HeroBanner)).toHaveLength(1);
  expect(text(tree)).not.toContain('Up Next');
});
test('current substitute occurrence shows effective teaching context', async () => {
  api.getHome.mockResolvedValue({
    ...fixture,
    hero: {
      ...fixture.hero,
      state: 'current',
      currentOrNextPeriod: {
        ...period,
        room: 'Effective room',
        isSubstitute: true,
      },
    },
  });
  const tree = await render();
  expect(text(tree)).toContain('Now teaching');
  expect(text(tree)).toContain('Effective room');
  expect(text(tree)).toContain('Substitute duty');
});
test.each([
  ['finished', 'No more periods today'],
  ['no_periods', 'No periods scheduled today'],
] as const)('%s has a truthful period fallback', async (state, label) => {
  api.getHome.mockResolvedValue({
    ...fixture,
    hero: { ...fixture.hero, state, currentOrNextPeriod: null },
    primaryAction: null,
  });
  const tree = await render();
  expect(text(tree)).toContain(label);
  expect(text(tree)).toContain('all caught up');
  expect(tree.root.findAllByType(Button)).toHaveLength(0);
});
test('one Attendance action displays exact queue count and delegates deep-link', async () => {
  const tree = await render();
  expect(text(tree)).toContain('Attendance Pending');
  expect(text(tree)).toContain('2 periods');
  await act(async () => button(tree, 'Mark Attendance').props.onPress());
  expect(onAction).toHaveBeenCalledWith(fixture.primaryAction);
  expect(tree.root.findAllByType(Card)).toHaveLength(1);
  expect(tree.root.findAllByType(Button)).toHaveLength(1);
});
test.each([
  { type: 'work', count: 53, routeTarget: 'Tasks' },
  {
    type: 'notice',
    noticeId: 'n',
    title: 'Important instructions',
    routeTarget: 'Inbox',
  },
] as const)('server-resolved $type action renders alone', async action => {
  api.getHome.mockResolvedValue({ ...fixture, primaryAction: action });
  const tree = await render();
  expect(text(tree)).not.toContain('Attendance Pending');
  expect(tree.root.findAllByType(Card)).toHaveLength(1);
  await act(async () => tree.root.findByType(Button).props.onPress());
  expect(onAction).toHaveBeenCalledWith(action);
});
test('Home has no module grid, duplicated queues or invented domains', async () => {
  const tree = await render();
  for (const name of [
    'View assigned classes',
    'Roster',
    'Submissions',
    'Catch-up',
    'Homework',
    'Marks',
    'Profile',
    'Open timetable',
  ])
    expect(text(tree)).not.toContain(name);
  expect(tree.root.findAllByType(Card)).toHaveLength(1);
});
test('initial loading hides summaries and caught-up claims', async () => {
  api.getHome.mockReturnValue(pending<TeacherHome>().promise);
  const tree = await render();
  expect(tree.root.findByType(DashboardStateCard).props.loading).toBe(true);
  expect(tree.root.findAllByType(HeroBanner)).toHaveLength(0);
  expect(text(tree)).not.toContain('all caught up');
});
test('network error supports retry and never claims success', async () => {
  api.getHome.mockRejectedValueOnce(new Error('Network request failed'));
  const tree = await render();
  expect(text(tree)).toContain('Network request failed');
  expect(text(tree)).not.toContain('all caught up');
  await act(async () =>
    tree.root.findByType(DashboardStateCard).props.onRetry(),
  );
  expect(text(tree)).toContain('Ayesha Khan');
  expect(api.getHome).toHaveBeenCalledTimes(2);
});
test('focus refresh hides prior sensitive context and rejects stale responses', async () => {
  const tree = await render(),
    old = pending<TeacherHome>(),
    latest = pending<TeacherHome>();
  api.getHome
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(latest.promise);
  await act(async () => {
    mockFocus[0].blur();
    mockFocus[0].focus();
  });
  expect(text(tree)).not.toContain('Ayesha Khan');
  await act(async () => {
    tree.root.findByType(DashboardShell).props.onRefresh();
  });
  await act(async () =>
    latest.resolve({
      ...fixture,
      teacher: { ...fixture.teacher, fullName: 'Current name' },
    }),
  );
  await act(async () =>
    old.resolve({
      ...fixture,
      teacher: { ...fixture.teacher, fullName: 'STALE PRIVATE NAME' },
    }),
  );
  expect(text(tree)).toContain('Current name');
  expect(text(tree)).not.toContain('STALE PRIVATE NAME');
});
test('revoked authorization clears old projection on refresh', async () => {
  const tree = await render();
  api.getHome.mockRejectedValueOnce(new ApiError(401, 'Session revoked'));
  await act(async () => tree.root.findByType(DashboardShell).props.onRefresh());
  expect(text(tree)).toContain('Session revoked');
  expect(text(tree)).not.toContain('Ayesha Khan');
  expect(tree.root.findAllByType(Card)).toHaveLength(0);
});
test('token change invalidates in-flight result and does not retain identity', async () => {
  const stale = pending<TeacherHome>();
  api.getHome.mockReturnValueOnce(stale.promise);
  const tree = await render();
  mockToken = null;
  await act(async () => tree.update(<TeacherHomeScreen onAction={onAction} />));
  await act(async () => stale.resolve(fixture));
  expect(text(tree)).not.toContain('Ayesha Khan');
  expect(text(tree)).toContain('Sign in again');
});
test.each(['attendance', 'work', 'notice'] as const)(
  'workspace $type action opens existing workflow/tab and returning Home refreshes',
  async type => {
    const action =
      type === 'attendance'
        ? fixture.primaryAction!
        : type === 'work'
        ? { type: 'work' as const, count: 1, routeTarget: 'Tasks' as const }
        : {
            type: 'notice' as const,
            noticeId: 'n',
            title: 'Instructions',
            routeTarget: 'Inbox' as const,
          };
    api.getHome.mockResolvedValue({ ...fixture, primaryAction: action });
    const navigation = { navigate: jest.fn() };
    let tree!: Renderer.ReactTestRenderer;
    await act(async () => {
      tree = Renderer.create(
        <TeacherWorkspaceScreen
          navigation={navigation as never}
          route={{} as never}
        />,
      );
    });
    trees.push(tree);
    await act(async () =>
      tree.root.findByType(TeacherHomeScreen).props.onAction(action),
    );
    if (type === 'attendance') {
      expect(navigation.navigate).toHaveBeenCalledWith(
        'TeacherAttendanceQueue',
      );
    } else {
      expect(tree.root.findAllByType(TeacherHomeScreen)).toHaveLength(0);
      const calls = api.getHome.mock.calls.length;
      await act(async () =>
        tree.root
          .findAll(
            n =>
              n.props.accessibilityRole === 'tab' &&
              n.props.accessibilityLabel === 'Home',
          )[0]
          .props.onPress(),
      );
      expect(api.getHome.mock.calls.length).toBeGreaterThan(calls);
    }
  },
);
test('visible Home revalidates its clock and queues each minute without remounting', async () => {
  jest.useFakeTimers();
  try {
    const tree = await render(),
      calls = api.getHome.mock.calls.length;
    api.getHome.mockResolvedValue({ ...fixture, primaryAction: null });
    await act(async () => {
      jest.advanceTimersByTime(60000);
    });
    expect(api.getHome.mock.calls.length).toBe(calls + 1);
    expect(text(tree)).toContain('all caught up');
    await act(async () => tree.unmount());
    const stopped = api.getHome.mock.calls.length;
    await act(async () => {
      jest.advanceTimersByTime(60000);
    });
    expect(api.getHome.mock.calls.length).toBe(stopped);
  } finally {
    jest.useRealTimers();
  }
});


test.each(['current', 'next'] as const)('Home Go Live opens the existing occurrence route for %s teaching duty', async state => {
  api.getHome.mockResolvedValue({...fixture, hero: {...fixture.hero, state, currentOrNextPeriod: {...period, isSubstitute: true}}});
  const navigation = {navigate: jest.fn()};
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {tree = Renderer.create(<TeacherWorkspaceScreen navigation={navigation as never} route={{} as never} />);});
  trees.push(tree);
  expect(text(tree)).toContain('Live Lesson');
  expect(button(tree, 'Go Live').props.disabled).toBe(false);
  await act(async () => button(tree, 'Go Live').props.onPress());
  expect(navigation.navigate).toHaveBeenCalledWith('TeacherLiveLesson', {periodId: period.periodId, date: period.date});
});
test.each(['finished', 'no_periods'] as const)('Home %s keeps a clear safe Live Lesson state without fabricating an occurrence', async state => {
  api.getHome.mockResolvedValue({...fixture, hero: {...fixture.hero, state, currentOrNextPeriod: null}});
  const open = jest.fn(), tree = await render(open);
  expect(text(tree)).toContain('No live lesson is available to start right now.');
  expect(button(tree, 'Go Live').props.disabled).toBe(true);
  await act(async () => button(tree, 'Go Live').props.onPress());
  expect(open).not.toHaveBeenCalled();
});
test.each(['principal', 'student', 'super_admin'])('role %s cannot expose Teacher hosting through Home', async role => {
  mockRole = role;
  const open = jest.fn(), tree = await render(open);
  expect(button(tree, 'Go Live')).toBeUndefined(); expect(open).not.toHaveBeenCalled();
  expect(api.getHome).not.toHaveBeenCalled();
});
test('Home authorization refresh removes the previously available live occurrence', async () => {
  const open = jest.fn(), tree = await render(open);
  expect(button(tree, 'Go Live')).toBeDefined();
  api.getHome.mockRejectedValueOnce(new ApiError(403, 'Teacher authority changed'));
  await act(async () => tree.root.findByType(DashboardShell).props.onRefresh());
  expect(text(tree)).toContain('Teacher authority changed'); expect(button(tree, 'Go Live')).toBeUndefined();
});
