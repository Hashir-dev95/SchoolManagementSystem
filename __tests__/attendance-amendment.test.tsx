import React from 'react';
import { TextInput } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import TeacherAttendanceReviewScreen from '../src/screens/teacher/TeacherAttendanceReviewScreen';
import PrincipalAttendanceReviewScreen from '../src/screens/principal/PrincipalAttendanceReviewScreen';
import { Button, StatusBadge } from '../src/components/hiraDashboard';
import {
  AdminSelect,
  AdminDialog,
  AdminDateField,
} from '../src/components/hiraDashboard/AdminForm';
import {
  DashboardShell,
  DashboardStateCard,
} from '../src/components/hiraDashboard/DashboardShell';
import {
  amendmentService,
  type AttendanceReview,
  type PrincipalAttendanceReview,
} from '../src/services/teacher/amendmentService';
import { ApiError } from '../src/services/api/apiClient';
jest.setTimeout(15000); // Cold React Native native-mock initialization.
let mockToken: string | null = 'token';
const mockFocus: { focus: () => void; blur: () => void }[] = [];
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ accessToken: mockToken }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
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
jest.mock('../src/services/teacher/amendmentService', () => ({
  amendmentService: {
    context: jest.fn(),
    create: jest.fn(),
    review: jest.fn(),
    decide: jest.fn(),
  },
}));
const fixture: AttendanceReview = {
  sessionId: 'session',
  teacherName: 'Ayesha Teacher',
  student: {
    studentId: 'student',
    fullName: 'Ayesha Khan',
    admissionNumber: 'ST-001',
  },
  period: {
    periodId: 'period',
    date: '2026-10-14',
    startTime: '09:00',
    endTime: '09:40',
    room: 'Room 204',
    classId: 'class',
    className: 'Grade 8',
    sectionId: 'section',
    sectionName: 'A',
    subjectId: 'subject',
    subjectName: 'Mathematics',
    approvedVersion: {
      versionId: 'version',
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
    canRequestIssue: false,
  },
  submitted: true,
  submittedRevision: 1,
  effective: {
    originalStatus: 'absent',
    status: 'absent',
    effectiveRevision: 0,
  },
  canRequestCorrection: true,
  canRequestLeave: true,
  approvedLeaveId: null,
  corrections: [],
  leaves: [],
  total: 0,
  nextOffset: null,
};
const request = {
  requestId: 'request',
  approvalId: 'approval',
  requestedStatus: 'present' as const,
  originalStatus: 'absent' as const,
  baseStatus: 'absent' as const,
  reason: 'Marked absent by mistake during roll call.',
  state: 'pending' as const,
  requestedBy: 'Ayesha Teacher',
  requestedAt: '2026-10-14T06:00:00Z',
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  revision: 0,
};
const review: PrincipalAttendanceReview = {
  approvalId: 'approval',
  kind: 'correction',
  reviewerRole: 'Principal',
  student: fixture.student,
  period: fixture.period,
  effective: fixture.effective,
  request,
  canReview: true,
};
const api = jest.mocked(amendmentService),
  trees: Renderer.ReactTestRenderer[] = [];
const contents = (tree: Renderer.ReactTestRenderer) =>
  JSON.stringify(tree.toJSON(), (key, value) =>
    key === 'props' ? undefined : value,
  );
const button = (tree: Renderer.ReactTestRenderer, title: string) =>
  tree.root.findAllByType(Button).find(n => n.props.title === title)!;
const press = async (tree: Renderer.ReactTestRenderer, title: string) => {
  await act(async () => button(tree, title).props.onPress());
};
const props = (sessionId = 'session') => ({
  route: { params: { sessionId, studentId: 'student' } } as never,
  navigation: {} as never,
});
async function mount(principal = false) {
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(
      principal ? (
        <PrincipalAttendanceReviewScreen
          route={{ params: { approvalId: 'approval' } } as never}
          navigation={{} as never}
        />
      ) : (
        <TeacherAttendanceReviewScreen {...props()} />
      ),
    );
  });
  trees.push(tree);
  return tree;
}
async function fill(
  tree: Renderer.ReactTestRenderer,
  status = 'present',
  reason = request.reason,
) {
  await act(async () => {
    tree.root.findByType(AdminSelect).props.onSelect(status);
    tree.root
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === 'Reason')!
      .props.onChangeText(reason);
  });
}
const pending = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { resolve, promise };
};
beforeEach(() => {
  jest.clearAllMocks();
  mockToken = 'token';
  api.context.mockReset().mockResolvedValue(fixture);
  api.review.mockReset().mockResolvedValue(review);
  api.create.mockReset().mockResolvedValue({
    requestId: 'request',
    approvalId: 'approval',
    state: 'pending',
    replayed: false,
  });
  api.decide
    .mockReset()
    .mockResolvedValue({ state: 'approved', replayed: false });
});
afterEach(async () => {
  await act(async () => trees.splice(0).forEach(t => t.unmount()));
});
test('Teacher detail explains named student, Teacher, occurrence, original and effective status', async () => {
  const tree = await mount(),
    text = contents(tree);
  for (const expected of [
    'Attendance review',
    'Ayesha Teacher',
    'Ayesha Khan',
    'ST-001',
    'Grade 8',
    'Mathematics',
    '2026-10-14',
    'Original submitted status:',
    'absent',
    'Effective status:',
    'Correction history',
    'Student leave history',
  ])
    expect(text).toContain(expected);
  expect(button(tree, 'Request Correction')).toBeTruthy();
  expect(api.context).toHaveBeenCalledWith('token', 'session', 'student', 0);
});
test('required status, reason bounds and no-op prevent confirmation', async () => {
  const tree = await mount();
  expect(button(tree, 'Review Correction Request').props.disabled).toBeTruthy();
  await fill(tree, 'absent');
  expect(button(tree, 'Review Correction Request').props.disabled).toBeTruthy();
  await fill(tree, 'present', 'short');
  expect(button(tree, 'Review Correction Request').props.disabled).toBeTruthy();
  await fill(tree);
  expect(button(tree, 'Review Correction Request').props.disabled).toBe(false);
  expect(api.create).not.toHaveBeenCalled();
});
test('confirmation contains student/current/requested/reason; duplicate taps send one operation', async () => {
  const tree = await mount();
  await fill(tree);
  await press(tree, 'Review Correction Request');
  const dialog = tree.root
    .findAllByType(AdminDialog)
    .find(n => n.props.title === 'Request attendance correction?')!;
  expect(dialog.props.visible).toBe(true);
  const waiting =
    pending<Awaited<ReturnType<typeof amendmentService.create>>>();
  api.create.mockReturnValueOnce(waiting.promise);
  await act(async () => {
    dialog.props.onConfirm();
    dialog.props.onConfirm();
  });
  expect(api.create).toHaveBeenCalledTimes(1);
  expect(
    tree.root.findAllByProps({
      accessibilityLabel: 'Submitting attendance request',
    }).length,
  ).toBeGreaterThan(0);
  expect(api.create.mock.calls[0][4]).toMatchObject({
    requestedStatus: 'present',
    reason: request.reason,
    submittedRevision: 1,
    effectiveRevision: 0,
    clientOperationId: expect.any(String),
  });
  await act(async () =>
    waiting.resolve({
      requestId: 'request',
      approvalId: 'approval',
      state: 'pending',
      replayed: false,
    }),
  );
  expect(contents(tree)).toContain('Correction request submitted.');
  expect(contents(tree)).toContain('only after an approved correction');
  expect(api.context).toHaveBeenCalledTimes(2);
});
for (const [code, message] of [
  [403, 'Your permission changed'],
  [404, 'unavailable'],
  [409, 'changed. Review refreshed history'],
] as const)
  test(code + ' preserves reason/status and refreshes authority', async () => {
    const tree = await mount();
    await fill(tree);
    api.create.mockRejectedValueOnce(new ApiError(code, 'server error'));
    await press(tree, 'Review Correction Request');
    const dialog = tree.root
      .findAllByType(AdminDialog)
      .find(n => n.props.title === 'Request attendance correction?')!;
    await act(async () => dialog.props.onConfirm());
    expect(contents(tree)).toContain(message);
    expect(
      tree.root
        .findAllByType(TextInput)
        .find(n => n.props.accessibilityLabel === 'Reason')!.props.value,
    ).toBe(request.reason);
    expect(tree.root.findByType(AdminSelect).props.value).toBe('present');
    expect(api.context).toHaveBeenCalledTimes(2);
  });
test('network retry retains operation identity and form', async () => {
  const tree = await mount();
  await fill(tree);
  api.create.mockRejectedValueOnce(new Error('Network unavailable'));
  await press(tree, 'Review Correction Request');
  await act(async () =>
    tree.root
      .findAllByType(AdminDialog)
      .find(n => n.props.title === 'Request attendance correction?')!
      .props.onConfirm(),
  );
  expect(contents(tree)).toContain('Network unavailable');
  await press(tree, 'Review Correction Request');
  await act(async () =>
    tree.root
      .findAllByType(AdminDialog)
      .find(n => n.props.title === 'Request attendance correction?')!
      .props.onConfirm(),
  );
  expect(api.create.mock.calls[1][4]).toEqual(api.create.mock.calls[0][4]);
});
test('leave status requires proof and leave form uses independent confirmed request', async () => {
  const tree = await mount();
  await fill(tree, 'leave');
  expect(button(tree, 'Review Correction Request').props.disabled).toBeTruthy();
  expect(contents(tree)).toContain('Request student leave first');
  await press(tree, 'Request Student Leave');
  expect(
    tree.root.findAllByType(AdminDateField).map(n => n.props.value),
  ).toEqual(['2026-10-14', '2026-10-14']);
  await press(tree, 'Review Leave Request');
  await act(async () =>
    tree.root
      .findAllByType(AdminDialog)
      .find(n => n.props.title === 'Request student leave?')!
      .props.onConfirm(),
  );
  expect(api.create.mock.calls[0][3]).toBe('leave');
  expect(api.create.mock.calls[0][4]).toMatchObject({
    fromDate: '2026-10-14',
    untilDate: '2026-10-14',
    category: 'illness',
  });
  expect(contents(tree)).toContain('Student leave request submitted.');
});
test('history shows state in words, original, reason, actors and review note', async () => {
  api.context.mockResolvedValue({
    ...fixture,
    canRequestCorrection: false,
    corrections: [
      {
        ...request,
        state: 'approved',
        reviewedBy: 'Principal Person',
        reviewedAt: '2026-10-14T07:00:00Z',
        reviewNote: 'Evidence checked.',
      },
    ],
    total: 1,
  });
  const tree = await mount();
  expect(
    tree.root
      .findAllByType(StatusBadge)
      .some(n => n.props.label === 'Approved'),
  ).toBe(true);
  expect(contents(tree)).toContain('Principal Person');
  expect(contents(tree)).toContain('Evidence checked.');
  expect(
    tree.root
      .findAllByType(Button)
      .some(n => n.props.title === 'Request Correction'),
  ).toBe(false);
});
test('loading, error and retry recover without stale context', async () => {
  const waiting = pending<AttendanceReview>();
  api.context.mockReturnValueOnce(waiting.promise);
  const tree = await mount();
  expect(tree.root.findByType(DashboardStateCard).props.loading).toBe(true);
  await act(async () => waiting.resolve(fixture));
  api.context.mockRejectedValueOnce(new ApiError(403, 'Permission revoked'));
  await act(async () => tree.root.findByType(DashboardShell).props.onRefresh());
  expect(contents(tree)).not.toContain('Ayesha Khan');
  expect(contents(tree)).toContain('Permission revoked');
  await act(async () =>
    tree.root.findByType(DashboardStateCard).props.onRetry(),
  );
  expect(contents(tree)).toContain('Ayesha Khan');
});
test('focus refresh ignores a stale earlier response', async () => {
  const waiting = pending<AttendanceReview>();
  api.context.mockReturnValueOnce(waiting.promise);
  const tree = await mount();
  await act(async () => {
    mockFocus[0].blur();
    mockFocus[0].focus();
  });
  await act(async () =>
    waiting.resolve({ ...fixture, teacherName: 'Stale Teacher' }),
  );
  expect(contents(tree)).not.toContain('Stale Teacher');
  expect(contents(tree)).toContain('Ayesha Teacher');
});
test('route change invalidates mutation feedback for old student/session', async () => {
  const tree = await mount();
  await fill(tree);
  const waiting =
    pending<Awaited<ReturnType<typeof amendmentService.create>>>();
  api.create.mockReturnValueOnce(waiting.promise);
  await press(tree, 'Review Correction Request');
  await act(async () => {
    tree.root
      .findAllByType(AdminDialog)
      .find(n => n.props.title === 'Request attendance correction?')!
      .props.onConfirm();
  });
  await act(async () =>
    tree.update(<TeacherAttendanceReviewScreen {...props('another')} />),
  );
  await act(async () =>
    waiting.resolve({
      requestId: 'request',
      approvalId: 'approval',
      state: 'pending',
      replayed: false,
    }),
  );
  expect(contents(tree)).not.toContain('Correction request submitted.');
});
test('Principal context has purpose, student, period, original and requested status', async () => {
  const tree = await mount(true),
    text = contents(tree);
  for (const s of [
    'Attendance and leave review',
    'your authorized branch',
    'Ayesha Khan',
    'Grade 8',
    'Original:',
    'absent',
    'Requested: present',
    request.reason,
  ])
    expect(text).toContain(s);
  expect(api.review).toHaveBeenCalledWith('token', 'approval');
});
test('Principal approve is confirmed and refreshes effective history', async () => {
  const tree = await mount(true);
  await press(tree, 'Approve');
  const dialog = tree.root.findByType(AdminDialog);
  expect(dialog.props.visible).toBe(true);
  expect(dialog.props.title).toBe('Approve this request?');
  await act(async () => dialog.props.onConfirm());
  expect(api.decide).toHaveBeenCalledWith(
    'token',
    'approval',
    expect.objectContaining({
      action: 'approved',
      revision: 0,
      clientOperationId: expect.any(String),
    }),
  );
  expect(contents(tree)).toContain('Request approved.');
  expect(api.review).toHaveBeenCalledTimes(2);
});
test('Principal reject requires reason and sends confirmed rejection', async () => {
  const tree = await mount(true);
  expect(button(tree, 'Reject').props.disabled).toBe(true);
  await act(async () =>
    tree.root
      .findByType(TextInput)
      .props.onChangeText('Evidence does not support this correction.'),
  );
  expect(button(tree, 'Reject').props.disabled).toBe(false);
  api.decide.mockResolvedValueOnce({ state: 'rejected', replayed: false });
  await press(tree, 'Reject');
  expect(tree.root.findByType(AdminDialog).props.danger).toBe(true);
  await act(async () => tree.root.findByType(AdminDialog).props.onConfirm());
  expect(api.decide.mock.calls[0][2]).toMatchObject({
    action: 'rejected',
    reviewNote: 'Evidence does not support this correction.',
  });
  expect(contents(tree)).toContain('Request rejected.');
});
test('Principal stale decision retains review note; revoked branch clears sensitive data', async () => {
  const tree = await mount(true);
  await act(async () =>
    tree.root
      .findByType(TextInput)
      .props.onChangeText('Verified evidence with coordinator.'),
  );
  api.decide.mockRejectedValueOnce(new ApiError(409, 'Already reviewed'));
  await press(tree, 'Approve');
  await act(async () => tree.root.findByType(AdminDialog).props.onConfirm());
  expect(tree.root.findByType(TextInput).props.value).toBe(
    'Verified evidence with coordinator.',
  );
  expect(contents(tree)).toContain('Decision not confirmed');
  api.review.mockRejectedValueOnce(new ApiError(404, 'Foreign branch'));
  await act(async () => tree.root.findByType(DashboardShell).props.onRefresh());
  expect(contents(tree)).not.toContain('Ayesha Khan');
  expect(contents(tree)).toContain('outside your authorized branch');
});
test('reviewed Principal request has history and no further decision buttons', async () => {
  api.review.mockResolvedValue({
    ...review,
    canReview: false,
    request: {
      ...request,
      state: 'rejected',
      reviewedBy: 'Principal Person',
      reviewNote: 'Not supported by evidence.',
    },
  });
  const tree = await mount(true);
  expect(contents(tree)).toContain('Rejected');
  expect(
    tree.root.findAllByType(Button).some(n => n.props.title === 'Approve'),
  ).toBe(false);
});
