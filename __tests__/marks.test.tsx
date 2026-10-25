import React from 'react';
import { Text, TextInput } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import { Button, DashboardShell } from '../src/components/hiraDashboard';
import PrincipalApprovalsScreen from '../src/screens/principal/PrincipalApprovalsScreen';
import PrincipalResultsScreen from '../src/screens/principal/PrincipalResultsScreen';
import { principalService as inboxService } from '../src/services/principal/principalService';
import PrincipalResultModerationScreen from '../src/screens/principal/PrincipalResultModerationScreen';
import TeacherMarksScreen from '../src/screens/teacher/TeacherMarksScreen';
import { ApiError } from '../src/services/api/apiClient';
import { resultModerationService } from '../src/services/principal/resultModerationService';
import {
  resultService,
  type TeacherResult,
} from '../src/services/teacher/resultService';

jest.mock('@react-navigation/native', () => {
  const ReactModule = jest.requireActual('react');
  return {
    useFocusEffect: (effect: () => void) =>
      ReactModule.useEffect(effect, [effect]),
  };
});
let mockAccessToken = 'token';
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ accessToken: mockAccessToken }),
}));
jest.mock('../src/services/teacher/resultService', () => ({
  resultService: {
    list: jest.fn(),
    create: jest.fn(),
    detail: jest.fn(),
    mutate: jest.fn(),
  },
  resultOperationId: (action: string) => `${action}_operation_123456`,
}));
jest.mock('../src/services/principal/resultModerationService', () => ({
  resultModerationService: {
    list: jest.fn(),
    detail: jest.fn(),
    moderate: jest.fn(),
    publish: jest.fn(),
  },
}));

jest.mock('../src/services/principal/principalService', () => ({
  principalService: { getPendingApprovals: jest.fn() },
}));
const teacherService = jest.mocked(resultService);
const principalService = jest.mocked(resultModerationService);
const source = {
  targetType: 'homework_submission' as const,
  evidenceId: 'submission-1',
  reviewId: 'review-1',
  title: 'Integer practice',
  student: { fullName: 'Learner One', admissionNumber: 'A-1' },
  score: 8,
  maxScore: 10,
  resultId: null,
};
const result: TeacherResult = {
  resultId: 'result-1',
  recordRevision: 1,
  currentRevision: 1,
  status: 'draft',
  academic: {
    classId: 'class-1',
    sectionId: 'section-1',
    subjectId: 'subject-1',
    className: 'Grade 8',
    sectionName: 'A',
    subjectName: 'Mathematics',
    academicYear: '2026',
  },
  student: {
    studentId: 'student-1',
    fullName: 'Learner One',
    admissionNumber: 'A-1',
  },
  assessmentTitle: 'Integer practice',
  source: {
    type: 'homework_submission',
    workId: 'homework-1',
    publishedRevision: 1,
    evidenceId: 'submission-1',
    evidenceRevision: 1,
    reviewId: 'review-1',
    reviewRevision: 2,
    reviewState: 'reviewed',
    score: 8,
    maxScore: 10,
  },
  revisions: [
    {
      revision: 1,
      awardedMarks: 8,
      maxMarks: 10,
      sourceScore: 8,
      sourceMax: 10,
      overrideReason: '',
      teacherPrivateNote: 'Teacher only',
      createdAt: 'now',
      submittedAt: null,
    },
  ],
  submittedRevision: null,
  moderationHistory: [],
  publishedRevision: null,
  publishedAt: null,
  history: [
    {
      resultRevision: 1,
      action: 'draft_created',
      actorRole: 'teacher',
      reason: '',
      createdAt: 'now',
    },
  ],
};
const params = {
  classId: 'class-1',
  sectionId: 'section-1',
  subjectId: 'subject-1',
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
    .flatMap(node => React.Children.toArray(node.props.children))
    .join(' ');
const press = async (tree: Renderer.ReactTestRenderer, title: string) =>
  act(async () =>
    tree.root
      .findAllByType(Button)
      .find(node => node.props.title === title)!
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
      .find(node => node.props.accessibilityLabel === label)!
      .props.onChangeText(value),
  );

beforeEach(() => {
  mockAccessToken = 'token';
  jest.clearAllMocks();
  teacherService.list.mockResolvedValue({
    sources: [source],
    items: [],
    total: 0,
  });
  teacherService.create.mockResolvedValue(result);
  teacherService.mutate.mockResolvedValue(result);
  principalService.detail.mockResolvedValue({
    approvalId: 'approval-1',
    approvalStatus: 'pending',
    canModerate: true,
    canPublish: false,
    result,
  });
  principalService.moderate.mockImplementation(async () => {
    const next = {
      approvalId: 'approval-1',
      approvalStatus: 'approved',
      canModerate: false,
      canPublish: true,
      result: { ...result, status: 'moderated_approved' as const },
    };
    principalService.detail.mockResolvedValue(next);
    return next;
  });
  principalService.publish.mockImplementation(async () => {
    const next = {
      approvalId: 'approval-1',
      approvalStatus: 'approved',
      canModerate: false,
      canPublish: false,
      result: {
        ...result,
        status: 'published' as const,
        publishedRevision: 1,
        publishedAt: '2026-10-24T10:00:00Z',
      },
    };
    principalService.detail.mockResolvedValue(next);
    return next;
  });
});
afterEach(async () =>
  act(async () => {
    trees.forEach(tree => tree.unmount());
    trees = [];
  }),
);

test('Teacher marks workspace creates a server-validated draft from reviewed evidence', async () => {
  const tree = await mount(
    <TeacherMarksScreen {...({ route: { params } } as any)} />,
  );
  await press(tree, 'Learner One - Integer practice - 8/10');
  expect(content(tree)).toContain('Reviewed 8/10');
  await input(tree, 'Awarded marks', '7.5');
  await input(tree, 'Override reason', 'Partial method credit');
  await input(tree, 'Teacher private note', 'Teacher only');
  await press(tree, 'Create Result Draft');
  expect(teacherService.create).toHaveBeenCalledWith(
    'token',
    expect.objectContaining({
      targetType: 'homework_submission',
      evidenceId: 'submission-1',
      awardedMarks: 7.5,
      overrideReason: 'Partial method credit',
    }),
  );
  expect(content(tree)).toContain('Result updated');
});

test('draft save and submit send the optimistic record revision', async () => {
  teacherService.list.mockResolvedValue({
    sources: [{ ...source, resultId: result.resultId }],
    items: [result],
    total: 1,
  });
  const tree = await mount(
    <TeacherMarksScreen {...({ route: { params } } as any)} />,
  );
  await press(tree, 'Learner One - Integer practice - draft');
  await press(tree, 'Save Draft');
  expect(teacherService.mutate).toHaveBeenLastCalledWith(
    'token',
    'result-1',
    expect.objectContaining({ action: 'save_draft', recordRevision: 1 }),
  );
  await press(tree, 'Submit for Moderation');
  expect(teacherService.mutate).toHaveBeenLastCalledWith(
    'token',
    'result-1',
    expect.objectContaining({ action: 'submit', recordRevision: 1 }),
  );
  expect(content(tree)).toContain('History');
});

test('returned result exposes revision creation while submitted and published states remain frozen', async () => {
  const returned = { ...result, status: 'returned_for_revision' as const };
  teacherService.list.mockResolvedValue({
    sources: [{ ...source, resultId: result.resultId }],
    items: [returned],
    total: 1,
  });
  const tree = await mount(
    <TeacherMarksScreen {...({ route: { params } } as any)} />,
  );
  await press(tree, 'Learner One - Integer practice - returned for revision');
  expect(
    tree.root.findAllByType(Button).map(node => node.props.title),
  ).toContain('Create Revision');
  expect(
    tree.root.findAllByType(Button).map(node => node.props.title),
  ).not.toContain('Submit for Moderation');
});

test('stale Teacher mutation is surfaced without claiming success', async () => {
  teacherService.list.mockResolvedValue({
    sources: [{ ...source, resultId: result.resultId }],
    items: [result],
    total: 1,
  });
  teacherService.mutate.mockRejectedValue(
    new Error('Result changed; refresh required'),
  );
  const tree = await mount(
    <TeacherMarksScreen {...({ route: { params } } as any)} />,
  );
  await press(tree, 'Learner One - Integer practice - draft');
  await press(tree, 'Save Draft');
  expect(content(tree)).toContain('Result changed; refresh required');
  expect(content(tree)).not.toContain('Result updated');
});

test('Principal moderation records a decision without publishing', async () => {
  const tree = await mount(
    <PrincipalResultModerationScreen
      {...({ route: { params: { approvalId: 'approval-1' } } } as any)}
    />,
  );
  expect(content(tree)).toContain('Approval and publication are separate');
  await input(tree, 'Moderation reason', 'Evidence verified');
  await press(tree, 'Approve');
  expect(principalService.moderate).toHaveBeenCalledWith(
    'token',
    'approval-1',
    expect.objectContaining({
      action: 'approve',
      reason: 'Evidence verified',
      recordRevision: 1,
    }),
  );
  expect(principalService.publish).not.toHaveBeenCalled();
  expect(content(tree)).toContain('without publishing');
});

test('Principal return/reject actions and explicit publish are state-gated', async () => {
  const tree = await mount(
    <PrincipalResultModerationScreen
      {...({ route: { params: { approvalId: 'approval-1' } } } as any)}
    />,
  );
  await input(tree, 'Moderation reason', 'Revise evidence');
  await press(tree, 'Return for Changes');
  expect(principalService.moderate).toHaveBeenCalledWith(
    'token',
    'approval-1',
    expect.objectContaining({ action: 'return', reason: 'Revise evidence' }),
  );
  principalService.detail.mockResolvedValue({
    approvalId: 'approval-1',
    approvalStatus: 'approved',
    canModerate: false,
    canPublish: true,
    result: { ...result, status: 'moderated_approved' },
  });
  const publishTree = await mount(
    <PrincipalResultModerationScreen
      {...({ route: { params: { approvalId: 'approval-1' } } } as any)}
    />,
  );
  expect(
    publishTree.root.findAllByType(Button).map(node => node.props.title),
  ).toEqual(expect.arrayContaining(['Publish Result']));
  expect(
    publishTree.root.findAllByType(Button).map(node => node.props.title),
  ).not.toContain('Approve');
  await press(publishTree, 'Publish Result');
  expect(principalService.publish).not.toHaveBeenCalled();
  await press(publishTree, 'Publish Result');
  expect(principalService.publish).toHaveBeenCalledWith(
    'token',
    'approval-1',
    expect.objectContaining({ recordRevision: 1 }),
  );
});

test('authoritative refresh discards a previous mutation DTO and its Publish capability', async () => {
  const tree = await mount(
    <PrincipalResultModerationScreen
      {...({ route: { params: { approvalId: 'approval-1' } } } as any)}
    />,
  );
  await press(tree, 'Approve');
  principalService.detail.mockResolvedValue({
    approvalId: 'approval-1',
    approvalStatus: 'approved',
    canModerate: false,
    canPublish: false,
    result: {
      ...result,
      status: 'published',
      publishedRevision: 1,
      publishedAt: 'now',
    },
  });
  const shell = tree.root.findByType(DashboardShell);
  await act(async () => shell.props.onRefresh());
  expect(
    tree.root.findAllByType(Button).map(node => node.props.title),
  ).not.toContain('Publish Result');
  expect(content(tree)).toContain('published');
});

const approvedDetail = () => ({
  approvalId: 'approval-1',
  approvalStatus: 'approved',
  canModerate: false,
  canPublish: true,
  result: { ...result, status: 'moderated_approved' as const },
});
const publishedDetail = () => ({
  ...approvedDetail(),
  canPublish: false,
  result: {
    ...result,
    status: 'published' as const,
    publishedAt: '2026-10-24T10:00:00Z',
    publishedRevision: 1,
  },
});
test('publication confirmation cancel does not mutate and success refresh removes capability', async () => {
  principalService.detail.mockResolvedValue(approvedDetail());
  const tree = await mount(
    <PrincipalResultModerationScreen
      {...({ route: { params: { approvalId: 'approval-1' } } } as any)}
    />,
  );
  await press(tree, 'Publish Result');
  expect(content(tree)).toContain('This result will become visible');
  await press(tree, 'Cancel');
  expect(principalService.publish).not.toHaveBeenCalled();
  await press(tree, 'Publish Result');
  await press(tree, 'Publish Result');
  expect(content(tree)).toContain('Result Published');
  expect(principalService.detail).toHaveBeenCalledTimes(2);
  expect(tree.root.findAllByType(Button).map(n => n.props.title)).not.toContain(
    'Publish Result',
  );
});
test('publication conflict refreshes latest published state with safe Hira feedback', async () => {
  principalService.detail
    .mockResolvedValueOnce(approvedDetail())
    .mockResolvedValue(publishedDetail());
  principalService.publish.mockRejectedValue(
    new ApiError(409, 'Mongo internal revision details'),
  );
  const tree = await mount(
    <PrincipalResultModerationScreen
      {...({ route: { params: { approvalId: 'approval-1' } } } as any)}
    />,
  );
  await press(tree, 'Publish Result');
  await press(tree, 'Publish Result');
  expect(content(tree)).toContain('Result Updated');
  expect(content(tree)).not.toContain('Mongo');
  expect(tree.root.findAllByType(Button).map(n => n.props.title)).not.toContain(
    'Publish Result',
  );
});
for (const status of [401, 403, 404])
  test(
    'authority loss ' + status + ' clears obsolete result actions',
    async () => {
      principalService.detail
        .mockResolvedValueOnce(approvedDetail())
        .mockRejectedValue(new ApiError(status, 'Internal permission state'));
      principalService.publish.mockRejectedValue(
        new ApiError(status, 'Internal permission state'),
      );
      const tree = await mount(
        <PrincipalResultModerationScreen
          {...({ route: { params: { approvalId: 'approval-1' } } } as any)}
        />,
      );
      await press(tree, 'Publish Result');
      await press(tree, 'Publish Result');
      expect(content(tree)).toContain('Action Not Available');
      expect(
        tree.root.findAllByType(Button).map(n => n.props.title),
      ).not.toContain('Publish Result');
      expect(content(tree)).not.toContain('Internal permission');
    },
  );
test('record ID change discards capabilities and local reason while the next record loads', async () => {
  principalService.detail
    .mockResolvedValueOnce(approvedDetail())
    .mockResolvedValue({ ...publishedDetail(), approvalId: 'approval-2' });
  const tree = await mount(
    <PrincipalResultModerationScreen
      {...({ route: { params: { approvalId: 'approval-1' } } } as any)}
    />,
  );
  await act(async () =>
    tree.update(
      <PrincipalResultModerationScreen
        {...({ route: { params: { approvalId: 'approval-2' } } } as any)}
      />,
    ),
  );
  expect(principalService.detail).toHaveBeenLastCalledWith(
    'token',
    'approval-2',
  );
  expect(tree.root.findAllByType(Button).map(n => n.props.title)).not.toContain(
    'Publish Result',
  );
});
test('refresh clears capabilities during loading and on failure, then retry loads latest', async () => {
  principalService.detail
    .mockResolvedValueOnce(approvedDetail())
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValue(publishedDetail());
  const tree = await mount(
    <PrincipalResultModerationScreen
      {...({ route: { params: { approvalId: 'approval-1' } } } as any)}
    />,
  );
  await act(async () => tree.root.findByType(DashboardShell).props.onRefresh());
  expect(content(tree)).toContain('Unable to Load Result');
  expect(tree.root.findAllByType(Button).map(n => n.props.title)).not.toContain(
    'Publish Result',
  );
  await press(tree, 'Retry');
  expect(content(tree)).toContain('published');
});
test('detail shows academic context, status and existing result history', async () => {
  principalService.detail.mockResolvedValue({
    ...approvedDetail(),
    teacherName: 'Ayesha Teacher',
  });
  const tree = await mount(
    <PrincipalResultModerationScreen
      {...({ route: { params: { approvalId: 'approval-1' } } } as any)}
    />,
  );
  for (const text of [
    'Grade 8',
    'Mathematics',
    '2026',
    'Ayesha Teacher',
    'Unpublished',
    'Result History',
    'draft created',
  ])
    expect(content(tree)).toContain(text);
});

test('Principal approves, leaves, rediscovers, reopens and explicitly publishes the result', async () => {
  const request = {
    _id: 'approval-1',
    entityType: 'academic_result',
    entityId: 'result-1',
    approvalType: 'result',
    requesterId: 'teacher-1',
    reason: 'Integer practice',
    status: 'pending',
    createdAt: '2026-10-24T10:00:00Z',
  };
  let approved = false,
    published = false;
  jest
    .mocked(inboxService.getPendingApprovals)
    .mockImplementation(
      async () => ({ data: { requests: approved ? [] : [request] } } as any),
    );
  principalService.detail.mockImplementation(async () =>
    published
      ? publishedDetail()
      : approved
      ? approvedDetail()
      : {
          ...approvedDetail(),
          approvalStatus: 'pending',
          canModerate: true,
          canPublish: false,
          result: { ...result, status: 'submitted_for_moderation' },
        },
  );
  principalService.moderate.mockImplementation(async () => {
    approved = true;
    return approvedDetail();
  });
  principalService.publish.mockImplementation(async () => {
    published = true;
    return publishedDetail();
  });
  principalService.list.mockImplementation(async () => ({
    items:
      approved && !published
        ? [
            {
              approvalId: 'approval-1',
              resultId: 'result-1',
              assessmentTitle: result.assessmentTitle,
              status: 'moderated_approved',
              recordRevision: 3,
              academicYear: '2026',
              className: 'Grade 8',
              sectionName: 'A',
              subjectName: 'Mathematics',
              teacherName: 'Ayesha Teacher',
            },
          ]
        : [],
    total: approved && !published ? 1 : 0,
    nextOffset: null,
    configurationIssueCount: 0,
  }));
  function Journey() {
    const [screen, setScreen] = React.useState('approvals');
    return (
      <>
        {screen !== 'approvals' ? (
          <Button
            title="Back to Approvals"
            onPress={() => setScreen('approvals')}
          />
        ) : null}
        {screen === 'approvals' ? (
          <PrincipalApprovalsScreen
            onReview={() => setScreen('detail')}
            onOpenResults={() => setScreen('results')}
          />
        ) : screen === 'results' ? (
          <PrincipalResultsScreen
            {...({
              navigation: { navigate: () => setScreen('detail') },
            } as any)}
          />
        ) : (
          <PrincipalResultModerationScreen
            {...({ route: { params: { approvalId: 'approval-1' } } } as any)}
          />
        )}
      </>
    );
  }
  const tree = await mount(<Journey />);
  await press(tree, 'Review');
  await press(tree, 'Approve');
  expect(principalService.publish).not.toHaveBeenCalled();
  await press(tree, 'Back to Approvals');
  expect(content(tree)).toContain('Nothing waiting for you');
  await press(tree, 'Results / Awaiting Publication');
  expect(content(tree)).toContain('Approved · Unpublished');
  await press(tree, 'Review Result');
  await press(tree, 'Publish Result');
  expect(principalService.publish).not.toHaveBeenCalled();
  await press(tree, 'Publish Result');
  expect(content(tree)).toContain('Result Published');
  expect(tree.root.findAllByType(Button).map(n => n.props.title)).not.toContain(
    'Publish Result',
  );
});

test('authenticated actor change discards the previous result and publication capability', async () => {
  principalService.detail
    .mockResolvedValueOnce(approvedDetail())
    .mockResolvedValue(publishedDetail());
  const tree = await mount(
    <PrincipalResultModerationScreen
      {...({ route: { params: { approvalId: 'approval-1' } } } as any)}
    />,
  );
  mockAccessToken = 'new-actor-token';
  await act(async () =>
    tree.update(
      <PrincipalResultModerationScreen
        {...({ route: { params: { approvalId: 'approval-1' } } } as any)}
      />,
    ),
  );
  expect(principalService.detail).toHaveBeenLastCalledWith(
    'new-actor-token',
    'approval-1',
  );
  expect(tree.root.findAllByType(Button).map(n => n.props.title)).not.toContain(
    'Publish Result',
  );
});
test('authoritative revision refresh resets moderation input and obsolete capabilities', async () => {
  principalService.detail
    .mockResolvedValueOnce({
      ...approvedDetail(),
      canModerate: true,
      canPublish: false,
    })
    .mockResolvedValue({
      ...publishedDetail(),
      result: {
        ...publishedDetail().result,
        recordRevision: 9,
        currentRevision: 2,
        revisions: [{ ...result.revisions[0], revision: 2 }],
      },
    });
  const tree = await mount(
    <PrincipalResultModerationScreen
      {...({ route: { params: { approvalId: 'approval-1' } } } as any)}
    />,
  );
  await input(tree, 'Moderation reason', 'Old revision note');
  await act(async () => tree.root.findByType(DashboardShell).props.onRefresh());
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
  expect(tree.root.findAllByType(Button).map(n => n.props.title)).not.toContain(
    'Approve',
  );
});

test('return and rejection require useful moderation feedback before sending a mutation', async () => {
  const tree = await mount(
    <PrincipalResultModerationScreen
      {...({ route: { params: { approvalId: 'approval-1' } } } as any)}
    />,
  );
  await press(tree, 'Return for Changes');
  expect(content(tree)).toContain('Reason Required');
  expect(principalService.moderate).not.toHaveBeenCalled();
  await input(tree, 'Moderation reason', 'Please review the evidence');
  await press(tree, 'Reject');
  expect(principalService.moderate).toHaveBeenCalledWith(
    'token',
    'approval-1',
    expect.objectContaining({
      action: 'reject',
      reason: 'Please review the evidence',
    }),
  );
});
