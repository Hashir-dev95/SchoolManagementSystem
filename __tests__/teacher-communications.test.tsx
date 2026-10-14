import React from 'react';
import { Text, TextInput } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import { Button } from '../src/components/hiraDashboard';
import { DashboardShell } from '../src/components/hiraDashboard/DashboardShell';
import TeacherInboxScreen from '../src/screens/teacher/TeacherInboxScreen';
import TeacherTasksScreen from '../src/screens/teacher/TeacherTasksScreen';
import TeacherNoticeScreen from '../src/screens/teacher/TeacherNoticeScreen';
import TeacherWorkScreen from '../src/screens/teacher/TeacherWorkScreen';
import { TeacherButton } from '../src/screens/teacher/teacherUi';
import {
  communicationService,
  type TeacherNotice,
  type TeacherWork,
  type TeacherQueue,
} from '../src/services/teacher/communicationService';
import {
  teacherService,
  type TeacherAssignment,
} from '../src/services/teacher/teacherService';
import { ApiError } from '../src/services/api/apiClient';
jest.mock('../src/services/teacher/communicationService', () => ({
  communicationService: {
    inbox: jest.fn(),
    notice: jest.fn(),
    preview: jest.fn(),
    draft: jest.fn(),
    send: jest.fn(),
    tasks: jest.fn(),
    work: jest.fn(),
    complete: jest.fn(),
  },
  noticeOperationId: jest.fn(() => 'stable_client_operation_01'),
}));
jest.mock('../src/services/teacher/teacherService', () => ({
  teacherService: { getAssignedClasses: jest.fn() },
}));
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ accessToken: 'token', user: { role: 'teacher' } }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}));
jest.setTimeout(20000);
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
const service = jest.mocked(communicationService),
  academic = jest.mocked(teacherService);
const tuple: TeacherAssignment = {
  assignmentId: 'assignment',
  classId: 'class',
  className: 'Class Eight',
  sectionId: 'section',
  sectionName: 'Section A',
  subjectId: 'math',
  subjectName: 'Math',
};
const notice: TeacherNotice = {
  noticeId: 'notice',
  kind: 'class_notice',
  title: 'Class announcement',
  body: 'Bring your books.',
  language: 'en',
  state: 'draft',
  revision: 0,
  classId: tuple.classId,
  sectionId: tuple.sectionId,
  subjectId: tuple.subjectId,
  audienceType: 'class_students',
  createdAt: '2026-10-14T00:00:00Z',
  updatedAt: '2026-10-14T00:00:00Z',
  publishedAt: null,
  recipientCount: 0,
  channel: 'school_app_internal',
  deliveryState: null,
  canEdit: true,
};
const work: TeacherWork = {
  workId: 'work',
  title: 'Review activity',
  summary: 'Check the activity plan.',
  sourceType: 'class_follow_up',
  source: { classId: 'class', sectionId: 'section', subjectId: 'math' },
  status: 'open',
  priority: 'high',
  dueAt: '2020-01-01T00:00:00Z',
  revision: 0,
  completedAt: null,
  createdAt: '2026-10-14T00:00:00Z',
  updatedAt: '2026-10-14T00:00:00Z',
  canComplete: true,
};
const queue = <T,>(items: T[]): TeacherQueue<T> => ({
  items,
  total: items.length,
  nextOffset: null,
});
const navigation = { navigate: jest.fn(), goBack: jest.fn() };
const trees: Renderer.ReactTestRenderer[] = [];
const mount = async (element: React.ReactElement) => {
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(element);
  });
  trees.push(tree);
  return tree;
};
const text = (tree: Renderer.ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .map(n =>
      React.Children.toArray(n.props.children)
        .filter(c => typeof c === 'string' || typeof c === 'number')
        .join(''),
    )
    .join(' ');
const press = async (tree: Renderer.ReactTestRenderer, title: string) => {
  await act(async () => {
    tree.root
      .findAllByType(Button)
      .find(n => n.props.title === title)!
      .props.onPress();
  });
};
const retry = async (tree: Renderer.ReactTestRenderer) => {
  await act(async () => {
    await tree.root
      .findAllByType(TeacherButton)
      .find(n => n.props.title === 'Retry')!
      .props.onPress();
  });
};
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (v: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const composer = (noticeId?: string) => (
  <TeacherNoticeScreen
    navigation={navigation as never}
    route={{ params: { noticeId } } as never}
  />
);
const workScreen = () => (
  <TeacherWorkScreen
    navigation={navigation as never}
    route={{ params: { workId: 'work' } } as never}
  />
);
beforeEach(() => {
  jest.clearAllMocks();
  service.inbox.mockReset().mockResolvedValue(queue([notice]));
  service.tasks.mockReset().mockResolvedValue(queue([work]));
  service.notice.mockReset().mockResolvedValue(notice);
  academic.getAssignedClasses.mockReset().mockResolvedValue([tuple]);
  service.preview.mockReset().mockResolvedValue({
    context: tuple,
    recipientCount: 2,
    audienceType: 'class_students',
    channel: 'school_app_internal',
  });
  service.draft.mockReset().mockResolvedValue(notice);
  service.send.mockReset().mockResolvedValue({
    ...notice,
    state: 'published',
    revision: 1,
    publishedAt: '2026-10-14T10:00:00Z',
    recipientCount: 1,
    deliveryState: 'accepted_internal',
    canEdit: false,
  });
  service.work.mockReset().mockResolvedValue(work);
  service.complete.mockReset().mockResolvedValue({
    ...work,
    status: 'completed',
    revision: 1,
    canComplete: false,
  });
});
afterEach(async () => {
  await act(async () => {
    trees.splice(0).forEach(t => t.unmount());
  });
});
for (const kind of ['inbox', 'tasks'] as const) {
  const screen = () =>
    kind === 'inbox' ? (
      <TeacherInboxScreen active onOpen={navigation.navigate} />
    ) : (
      <TeacherTasksScreen active onOpen={navigation.navigate} />
    );
  test(`${kind} loading and empty are explicit, without invented totals`, async () => {
    const pending = deferred<
      TeacherQueue<TeacherNotice> & TeacherQueue<TeacherWork>
    >();
    service[kind].mockReturnValue(pending.promise);
    const tree = await mount(screen());
    expect(text(tree)).toContain(
      kind === 'inbox' ? 'Loading notices' : 'Loading assigned work',
    );
    expect(text(tree)).not.toContain('0 open items');
    await act(async () => {
      pending.resolve({ total: 0, items: [], nextOffset: null });
    });
    expect(text(tree)).toContain(
      kind === 'inbox' ? 'No notices or drafts' : 'No current assigned work',
    );
  });
  test(`${kind} error, retry, pull refresh and focus refresh`, async () => {
    service[kind].mockRejectedValueOnce(new Error('Network unavailable'));
    const tree = await mount(screen());
    expect(text(tree)).toContain('Network unavailable');
    await retry(tree);
    expect(text(tree)).toContain(kind === 'inbox' ? notice.title : work.title);
    await act(async () => {
      await tree.root.findByType(DashboardShell).props.onRefresh();
    });
    await act(async () => {
      mockFocus[0].focus();
    });
    expect(service[kind]).toHaveBeenCalledTimes(4);
  });
  test(`${kind} ignores stale requests and hides rows during reauthorization`, async () => {
    const stale = deferred<
      TeacherQueue<TeacherNotice> & TeacherQueue<TeacherWork>
    >();
    service[kind].mockReturnValueOnce(stale.promise);
    const tree = await mount(screen());
    await act(async () => {
      await tree.root.findByType(DashboardShell).props.onRefresh();
    });
    await act(async () => {
      stale.resolve({ total: 0, items: [], nextOffset: null });
    });
    expect(text(tree)).toContain(kind === 'inbox' ? notice.title : work.title);
    const refresh = deferred<
      TeacherQueue<TeacherNotice> & TeacherQueue<TeacherWork>
    >();
    service[kind].mockReturnValueOnce(refresh.promise);
    await act(async () => {
      tree.root.findByType(DashboardShell).props.onRefresh();
    });
    expect(text(tree)).not.toContain(
      kind === 'inbox' ? notice.title : work.title,
    );
    await act(async () => {
      mockFocus[0].blur();
      refresh.resolve({ total: 0, items: [], nextOffset: null });
    });
    expect(text(tree)).not.toContain('0 open items');
  });
}
test('Inbox labels drafts and school notices without showing recipient or contact lists', async () => {
  service.inbox.mockResolvedValue(
    queue([
      notice,
      {
        ...notice,
        noticeId: 'school',
        kind: 'school_notice',
        state: 'published',
        canEdit: false,
      },
    ]),
  );
  const tree = await mount(
    <TeacherInboxScreen active onOpen={navigation.navigate} />,
  );
  expect(text(tree)).toContain('Draft');
  expect(text(tree)).toContain('School notice');
  await press(tree, `Open ${notice.title}`);
  expect(navigation.navigate).toHaveBeenCalledWith('notice');
  expect(text(tree)).not.toMatch(/phone|guardian|email|address|password/);
});
test('Tasks rows display source, priority, due state and selected work context', async () => {
  const tree = await mount(
    <TeacherTasksScreen active onOpen={navigation.navigate} />,
  );
  expect(text(tree)).toContain('Class follow-up');
  expect(text(tree)).toContain('High priority');
  expect(text(tree)).toContain('Overdue');
  await press(tree, `Open ${work.title}`);
  expect(navigation.navigate).toHaveBeenCalledWith('work');
});
const fill = async (tree: Renderer.ReactTestRenderer) => {
  await press(tree, 'Class Eight / Section A / Math');
  await act(async () => {
    tree.root
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === 'Notice title')!
      .props.onChangeText('Class announcement');
    tree.root
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === 'Notice body')!
      .props.onChangeText('Bring your books.');
  });
};
test('composer validates required input and only offers server-authorized tuples', async () => {
  const tree = await mount(composer());
  await press(tree, 'Preview recipients');
  expect(service.preview).not.toHaveBeenCalled();
  await fill(tree);
  await press(tree, 'Preview recipients');
  expect(service.preview).toHaveBeenCalledWith(
    'token',
    expect.objectContaining({
      classId: 'class',
      sectionId: 'section',
      subjectId: 'math',
    }),
  );
  expect(text(tree)).toContain('2 authorized recipients');
  expect(text(tree)).toContain('Internal school app only');
});
test('preview → draft → explicit send confirms server count and truthful internal status', async () => {
  const tree = await mount(composer());
  await fill(tree);
  await press(tree, 'Preview recipients');
  await press(tree, 'Save draft');
  expect(service.send).not.toHaveBeenCalled();
  expect(text(tree)).toContain('Draft saved');
  await press(tree, 'Send notice');
  expect(service.send).toHaveBeenCalledWith(
    'token',
    'notice',
    0,
    'stable_client_operation_01',
  );
  expect(text(tree)).toContain('Published internally for 1 current recipients');
  expect(text(tree)).toContain('read receipts are unavailable');
});
test('failed send preserves content and retries the same operation; duplicate clicks have one request', async () => {
  const tree = await mount(composer());
  await fill(tree);
  await press(tree, 'Preview recipients');
  await press(tree, 'Save draft');
  const pending = deferred<TeacherNotice>();
  service.send.mockReturnValueOnce(pending.promise);
  const sendButton = tree.root
    .findAllByType(Button)
    .find(n => n.props.title === 'Send notice')!;
  await act(async () => {
    sendButton.props.onPress();
    sendButton.props.onPress();
  });
  expect(service.send).toHaveBeenCalledTimes(1);
  await act(async () => {
    pending.reject(new Error('Timeout; retry'));
  });
  expect(
    tree.root
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === 'Notice body')!.props.value,
  ).toBe('Bring your books.');
  await press(tree, 'Send notice');
  expect(service.send.mock.calls[0]).toEqual(service.send.mock.calls[1]);
});
test('changing previewed input invalidates preview and requires saving current content', async () => {
  const tree = await mount(composer());
  await fill(tree);
  await press(tree, 'Preview recipients');
  await press(tree, 'Save draft');
  await act(async () => {
    tree.root
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === 'Notice body')!
      .props.onChangeText('Updated message');
  });
  expect(text(tree)).not.toContain('2 authorized recipients');
  await press(tree, 'Preview recipients');
  expect(
    tree.root.findAllByType(Button).find(n => n.props.title === 'Send notice')!
      .props.disabled,
  ).toBe(true);
});
test('revoked authority during send preserves inputs and removes send controls after reauthorization', async () => {
  const tree = await mount(composer('notice'));
  await press(tree, 'Preview recipients');
  service.send.mockRejectedValueOnce(new ApiError(404, 'Assignment revoked'));
  academic.getAssignedClasses.mockResolvedValue([]);
  service.notice.mockResolvedValue({ ...notice, canEdit: false });
  await press(tree, 'Send notice');
  expect(text(tree)).toContain('Assignment revoked');
  expect(text(tree)).toContain('no longer permits');
  expect(
    tree.root.findAllByType(Button).some(n => n.props.title === 'Send notice'),
  ).toBe(false);
});
test('composer ignores stale preview after blur and preserves selected context on return', async () => {
  const tree = await mount(composer());
  await fill(tree);
  const pending =
    deferred<Awaited<ReturnType<typeof communicationService.preview>>>();
  service.preview.mockReturnValueOnce(pending.promise);
  await press(tree, 'Preview recipients');
  await act(async () => {
    mockFocus.forEach(f => f.blur());
    pending.resolve({
      context: tuple,
      recipientCount: 99,
      audienceType: 'class_students',
      channel: 'school_app_internal',
    });
  });
  expect(text(tree)).not.toContain('99 authorized recipients');
  await act(async () => {
    mockFocus.forEach(f => f.focus());
  });
  expect(
    tree.root
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === 'Notice body')!.props.value,
  ).toBe('Bring your books.');
});
test('work opens class through a separately authorized roster route and completion is confirmed', async () => {
  const tree = await mount(workScreen());
  await press(tree, 'Open class source');
  expect(navigation.navigate).toHaveBeenCalledWith(
    'TeacherRoster',
    work.source,
  );
  await press(tree, 'Complete work');
  expect(service.complete).toHaveBeenCalledWith('token', 'work');
  expect(text(tree)).toContain('Completed');
});
test('concealed work 404 displays unavailable state without source or completion controls', async () => {
  service.work.mockRejectedValue(new ApiError(404, 'Concealed'));
  const tree = await mount(workScreen());
  expect(text(tree)).toContain('unavailable or was withdrawn');
  expect(text(tree)).not.toContain(work.summary);
  expect(
    tree.root
      .findAllByType(Button)
      .some(n => n.props.title === 'Complete work'),
  ).toBe(false);
});
test('withdrawal during completion removes stale work after reauthorization', async () => {
  const tree = await mount(workScreen());
  service.complete.mockRejectedValue(new ApiError(409, 'Work withdrawn'));
  service.work.mockRejectedValue(new ApiError(404, 'Concealed'));
  await press(tree, 'Complete work');
  expect(text(tree)).toContain('Work withdrawn');
  expect(text(tree)).not.toContain(work.summary);
});
test('work double clicks and blurred responses cannot update selected detail', async () => {
  const tree = await mount(workScreen());
  const pending = deferred<TeacherWork>();
  service.complete.mockReturnValue(pending.promise);
  const button = tree.root
    .findAllByType(Button)
    .find(n => n.props.title === 'Complete work')!;
  await act(async () => {
    button.props.onPress();
    button.props.onPress();
  });
  expect(service.complete).toHaveBeenCalledTimes(1);
  await act(async () => {
    mockFocus.forEach(f => f.blur());
    pending.resolve({ ...work, status: 'completed' });
  });
  expect(text(tree)).not.toContain('Completed');
});

test('failed draft save preserves title, body and selected context for retry', async () => {
  const tree = await mount(composer());
  await fill(tree);
  await press(tree, 'Preview recipients');
  service.draft.mockRejectedValueOnce(
    new ApiError(400, 'Content needs correction'),
  );
  await press(tree, 'Save draft');
  expect(text(tree)).toContain('Content needs correction');
  expect(
    tree.root
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === 'Notice body')!.props.value,
  ).toBe('Bring your books.');
  await press(tree, 'Save draft');
  expect(service.draft.mock.calls[0]).toEqual(service.draft.mock.calls[1]);
});
test('changed draft revision preserves local content until explicit reload', async () => {
  const tree = await mount(composer('notice'));
  await act(async () => {
    tree.root
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === 'Notice body')!
      .props.onChangeText('Local edit');
  });
  await press(tree, 'Preview recipients');
  service.draft.mockRejectedValueOnce(new ApiError(409, 'Draft changed'));
  service.notice.mockResolvedValue({
    ...notice,
    body: 'Other saved edit',
    revision: 1,
  });
  await press(tree, 'Save draft');
  expect(
    tree.root
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === 'Notice body')!.props.value,
  ).toBe('Local edit');
  await press(tree, 'Reload saved draft');
  expect(
    tree.root
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === 'Notice body')!.props.value,
  ).toBe('Other saved edit');
});
test('recipient preview refresh reflects changed count without a recipient contact list', async () => {
  const tree = await mount(composer());
  await fill(tree);
  await press(tree, 'Preview recipients');
  service.preview.mockResolvedValue({
    context: tuple,
    recipientCount: 1,
    audienceType: 'class_students',
    channel: 'school_app_internal',
  });
  await press(tree, 'Preview recipients');
  expect(text(tree)).toContain('1 authorized recipients');
  expect(text(tree)).not.toContain('2 authorized recipients');
});
test('published detail is hidden during current-authority refresh and concealed on 404', async () => {
  service.notice.mockResolvedValue({
    ...notice,
    state: 'published',
    canEdit: false,
  });
  const tree = await mount(composer('notice'));
  expect(text(tree)).toContain(notice.body);
  const pending = deferred<TeacherNotice>();
  service.notice.mockReturnValueOnce(pending.promise);
  await act(async () => {
    tree.root.findByType(DashboardShell).props.onRefresh();
  });
  expect(text(tree)).not.toContain(notice.body);
  await act(async () => {
    pending.reject(new ApiError(404, 'Concealed'));
  });
  expect(text(tree)).not.toContain(notice.body);
});
test('persistent inactive tabs defer queue loads and refresh on activation without remounts', async () => {
  const tree = await mount(
    <TeacherInboxScreen active={false} onOpen={navigation.navigate} />,
  );
  expect(service.inbox).not.toHaveBeenCalled();
  await act(async () => {
    tree.update(<TeacherInboxScreen active onOpen={navigation.navigate} />);
  });
  expect(service.inbox).toHaveBeenCalledTimes(1);
  await press(tree, `Open ${notice.title}`);
  await act(async () => {
    tree.update(
      <TeacherInboxScreen active={false} onOpen={navigation.navigate} />,
    );
    tree.update(<TeacherInboxScreen active onOpen={navigation.navigate} />);
  });
  expect(navigation.navigate).toHaveBeenCalledWith('notice');
});
