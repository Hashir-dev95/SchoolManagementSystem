import React from 'react';
import { Text, TextInput } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import TeacherDeliveryScreen from '../src/screens/teacher/TeacherDeliveryScreen';
import PrincipalLessonReviewScreen from '../src/screens/principal/PrincipalLessonReviewScreen';
import SyllabusCoverage from '../src/components/academic/SyllabusCoverage';
import TeacherAcademicScreen from '../src/screens/teacher/TeacherAcademicScreen';
import {
  academicService,
  lessonReviewService,
  type DeliveryContext,
  type LessonReviewContext,
  type Coverage,
  type AcademicContext,
  type LessonPlan,
} from '../src/services/teacher/academicService';
import { AdminDialog } from '../src/components/hiraDashboard/AdminForm';
import { Button } from '../src/components/hiraDashboard';
import { ApiError } from '../src/services/api/apiClient';

jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ accessToken: 'token' }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}));
jest.mock('@react-navigation/native', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});
jest.mock('../src/services/teacher/academicService', () => ({
  ...jest.requireActual('../src/services/teacher/academicService'),
  academicService: {
    context: jest.fn(),
    lessons: jest.fn(),
    coverage: jest.fn(),
    deliveryContext: jest.fn(),
    recordDelivery: jest.fn(),
    revise: jest.fn(),
  },
  lessonReviewService: { detail: jest.fn(), decide: jest.fn() },
}));
const ids = { classId: 'class', sectionId: 'section', subjectId: 'subject' };
const context: AcademicContext = {
  assignment: {
    ...ids,
    assignmentId: 'assignment',
    className: 'Grade 8',
    sectionName: 'A',
    subjectName: 'Mathematics',
  },
  teacherName: 'Ayesha',
  academicYear: '2026–27',
  syllabus: {
    syllabusId: 'syllabus',
    title: 'Mathematics curriculum',
    academicYear: '2026–27',
    version: 1,
    revision: 2,
    status: 'published',
    units: [
      {
        unitId: 'numbers',
        title: 'Numbers',
        order: 1,
        topics: [
          {
            topicId: 'integers',
            title: 'Integers',
            order: 1,
            outcomes: ['Compare integers'],
          },
        ],
      },
      {
        unitId: 'algebra',
        title: 'Algebra',
        order: 2,
        topics: [
          {
            topicId: 'expressions',
            title: 'Expressions',
            order: 1,
            outcomes: [],
          },
        ],
      },
    ],
  },
};
const lesson: LessonPlan = {
  ...ids,
  lessonPlanId: 'lesson',
  syllabusId: 'syllabus',
  academicYear: '2026–27',
  unitId: 'numbers',
  topicIds: ['integers'],
  teachingDate: '2026-11-01',
  objectives: 'Compare integers',
  teachingActivities: 'Practice',
  resources: '',
  notes: '',
  state: 'draft',
  revision: 1,
  submittedAt: null,
};

const pendingCoverage: Coverage = {
  syllabusId: 'syllabus',
  version: 1,
  sectionId: 'section',
  totalTopics: 2,
  completedTopics: 0,
  partialTopics: 0,
  pendingTopics: 2,
  completedPercentage: 0,
  units: context.syllabus!.units.map(u => ({
    unitId: u.unitId,
    title: u.title,
    totalTopics: 1,
    completedTopics: 0,
    partialTopics: 0,
    pendingTopics: 1,
    topics: u.topics.map(t => ({
      topicId: t.topicId,
      title: t.title,
      state: 'pending',
    })),
  })),
};
const deliveryContext: DeliveryContext = {
  lesson: { ...lesson, state: 'approved', revision: 3, approvedRevision: 2 },
  syllabus: context.syllabus!,
  teacherName: 'Ayesha',
  className: 'Grade 8',
  sectionName: 'A',
  today: '2026-11-02',
  canRecord: true,
  delivery: null,
  period: null,
  coverage: pendingCoverage,
};
const reviewContext: LessonReviewContext = {
  ...deliveryContext,
  lesson: {
    ...deliveryContext.lesson,
    state: 'submitted',
    revision: 2,
    submissions: [
      { revision: 2, content: lesson, submittedAt: '2026-11-01T00:00:00Z' },
    ],
  },
  approvalId: 'approval',
  submittedRevision: 2,
  submittedContent: lesson,
  canReview: true,
};
const service = jest.mocked(academicService),
  reviews = jest.mocked(lessonReviewService);
let trees: Renderer.ReactTestRenderer[] = [];
const navigation = { navigate: jest.fn(), goBack: jest.fn() };
const mount = async (element: React.ReactElement) => {
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(element);
  });
  trees.push(tree);
  return tree;
};
const contents = (tree: Renderer.ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .map(n => n.props.children)
    .flat()
    .filter(v => typeof v === 'string' || typeof v === 'number')
    .join(' ');
const button = (tree: Renderer.ReactTestRenderer, title: string) =>
  tree.root.findAllByType(Button).find(b => b.props.title === title)!;
const press = async (tree: Renderer.ReactTestRenderer, title: string) => {
  await act(async () => button(tree, title).props.onPress());
};
const input = async (
  tree: Renderer.ReactTestRenderer,
  label: string,
  value: string,
) => {
  await act(async () =>
    tree.root
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === label)!
      .props.onChangeText(value),
  );
};
const delivery = () => (
  <TeacherDeliveryScreen
    {...({ route: { params: { lessonPlanId: 'lesson' } }, navigation } as any)}
  />
);
const review = () => (
  <PrincipalLessonReviewScreen
    {...({
      route: {
        params: { request: { _id: 'approval', entityType: 'lesson_plan' } },
      },
      navigation,
    } as any)}
  />
);
const confirm = async (tree: Renderer.ReactTestRenderer) => {
  await act(async () => tree.root.findByType(AdminDialog).props.onConfirm());
};
const fill = async (tree: Renderer.ReactTestRenderer, state = 'Completed') => {
  await press(tree, `${state} — Integers`);
  await input(
    tree,
    'Evidence for Integers',
    'Independent practice demonstrated understanding',
  );
};
beforeEach(() => {
  jest.clearAllMocks();
  service.deliveryContext.mockResolvedValue(deliveryContext);
  service.recordDelivery.mockResolvedValue({
    ...deliveryContext,
    coverage: {
      ...pendingCoverage,
      completedTopics: 1,
      pendingTopics: 1,
      completedPercentage: 50,
    },
    delivery: {
      deliveryId: 'delivery',
      lessonPlanId: 'lesson',
      lessonPlanRevision: 2,
      syllabusId: 'syllabus',
      syllabusVersion: 1,
      revision: 1,
      state: 'recorded',
      history: [
        {
          revision: 1,
          deliveryStatus: 'delivered',
          actualTeachingDate: '2026-11-01',
          topics: [
            { topicId: 'integers', state: 'completed', evidence: 'Practice' },
          ],
          teacherNotes: '',
          correctionReason: '',
          recordedAt: 'now',
          recordedBy: 'teacher',
        },
      ],
    },
  });
  reviews.detail.mockResolvedValue(reviewContext);
  reviews.decide.mockResolvedValue({
    ...reviewContext,
    canReview: false,
    lesson: { ...reviewContext.lesson, state: 'approved' },
  });
  service.context.mockResolvedValue(context);
  service.lessons.mockResolvedValue([deliveryContext.lesson]);
  service.coverage.mockResolvedValue(pendingCoverage);
});
afterEach(async () => {
  await act(async () => {
    trees.forEach(t => t.unmount());
    trees = [];
  });
});
test('Classes lessons opens approved delivery and syllabus shows evidence counts', async () => {
  const tree = await mount(
    <TeacherAcademicScreen
      {...({ route: { params: ids }, navigation } as any)}
    />,
  );
  await press(tree, 'Lessons');
  expect(contents(tree)).toContain('approved');
  await press(tree, 'Record Delivery');
  expect(navigation.navigate).toHaveBeenCalledWith('TeacherDelivery', {
    lessonPlanId: 'lesson',
  });
  await press(tree, 'Syllabus');
  expect(contents(tree)).toContain('Syllabus Progress');
  expect(contents(tree)).toMatch(/0\s*%/);
});
test('delivery form has context, planned topics, date, evidence and truthful pending coverage', async () => {
  const tree = await mount(delivery());
  const text = contents(tree);
  for (const label of [
    'Record Lesson Delivery',
    'Grade 8',
    'Section A',
    'Mathematics curriculum',
    'Numbers',
    'Integers',
    'Compare integers',
    'Actual Delivery',
    'Pending',
  ])
    expect(text).toContain(label);
  expect(service.recordDelivery).not.toHaveBeenCalled();
  expect(text).toMatch(/0\s*%/);
});
test('evidence validation prevents empty delivery and future dates', async () => {
  const tree = await mount(delivery());
  await press(tree, 'Confirm Delivery');
  expect(contents(tree)).toContain('Complete delivery evidence');
  await fill(tree);
  const dates = tree.root.findAllByType(
    require('../src/components/hiraDashboard/AdminForm').AdminDateField,
  );
  await act(async () => dates[0].props.onChange('2026-12-01'));
  await press(tree, 'Confirm Delivery');
  expect(service.recordDelivery).not.toHaveBeenCalled();
});
test.each(['Partial', 'Not covered'])(
  '%s evidence produces truthful overall status and confirmation',
  async state => {
    const tree = await mount(delivery());
    if (state === 'Partial') await press(tree, 'Partial — Integers');
    await input(
      tree,
      'Evidence for Integers',
      'Only initial examples, or session cancelled',
    );
    await press(tree, 'Confirm Delivery');
    expect(tree.root.findByType(AdminDialog).props.visible).toBe(true);
    expect(contents(tree)).toContain('Grade 8');
    await confirm(tree);
    expect(service.recordDelivery).toHaveBeenCalledWith(
      'token',
      'lesson',
      expect.objectContaining({
        deliveryStatus:
          state === 'Partial' ? 'partially_delivered' : 'not_delivered',
        topics: [
          expect.objectContaining({
            state: state === 'Partial' ? 'partial' : 'not_covered',
          }),
        ],
      }),
    );
  },
);
test('success awaits server transaction; duplicate confirmation is fenced and updated evidence renders', async () => {
  let resolve!: (v: DeliveryContext) => void;
  service.recordDelivery.mockReturnValueOnce(
    new Promise(r => {
      resolve = r;
    }),
  );
  const tree = await mount(delivery());
  await fill(tree);
  await press(tree, 'Confirm Delivery');
  const action = tree.root.findByType(AdminDialog).props.onConfirm;
  await act(async () => {
    action();
    action();
  });
  expect(service.recordDelivery).toHaveBeenCalledTimes(1);
  expect(contents(tree)).not.toContain(
    'Lesson delivery recorded successfully.',
  );
  expect(button(tree, 'Recording delivery...').props.disabled).toBe(true);
  await act(async () =>
    resolve({
      ...deliveryContext,
      coverage: {
        ...pendingCoverage,
        completedTopics: 1,
        completedPercentage: 50,
      },
    }),
  );
  expect(contents(tree)).toContain('Lesson delivery recorded successfully.');
  expect(contents(tree)).toMatch(/50\s*%/);
});
test('network failure retains evidence and retry reuses operation ID', async () => {
  service.recordDelivery.mockRejectedValueOnce(new Error('Network error'));
  const tree = await mount(delivery());
  await fill(tree);
  await press(tree, 'Confirm Delivery');
  await confirm(tree);
  expect(contents(tree)).toContain('Network error');
  expect(
    tree.root
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === 'Evidence for Integers')!.props
      .value,
  ).toContain('Independent practice');
  const op = service.recordDelivery.mock.calls[0][2].clientOperationId;
  await confirm(tree);
  expect(service.recordDelivery.mock.calls[1][2].clientOperationId).toBe(op);
});
test('revision conflict retains input and prevents blind evidence overwrite', async () => {
  service.recordDelivery.mockRejectedValue(new ApiError(409, 'Changed'));
  const tree = await mount(delivery());
  await fill(tree);
  await press(tree, 'Confirm Delivery');
  await confirm(tree);
  expect(contents(tree)).toContain('Delivery revision conflict');
  expect(button(tree, 'Confirm Delivery').props.disabled).toBe(true);
});
test('unapproved lesson has no enabled delivery action; loading and foreign scope fail closed', async () => {
  service.deliveryContext.mockResolvedValueOnce({
    ...deliveryContext,
    canRecord: false,
    lesson: { ...lesson, state: 'submitted' },
  });
  const tree = await mount(delivery());
  expect(button(tree, 'Confirm Delivery').props.disabled).toBe(true);
  service.deliveryContext.mockRejectedValueOnce(
    new ApiError(404, 'Outside branch'),
  );
  const denied = await mount(delivery());
  expect(contents(denied)).toContain('unavailable');
  expect(denied.root.findAllByType(TextInput)).toHaveLength(0);
});
test('Principal sees immutable submitted revision, review note, history and pending coverage', async () => {
  const tree = await mount(review());
  for (const text of [
    'Lesson Plan Review',
    'Submitted revision 2',
    'Compare integers',
    'No delivery evidence recorded',
    'Submission and Review History',
  ])
    expect(contents(tree)).toContain(text);
  expect(tree.root.findAllByType(TextInput)).toHaveLength(1);
  await press(tree, 'Request Revision');
  expect(contents(tree)).toContain('Review note required');
});
test.each([
  ['Approve Lesson', 'approved'],
  ['Request Revision', 'needs_revision'],
  ['Reject Lesson', 'rejected'],
])(
  'Principal %s is typed, confirmed and revision guarded',
  async (label, action) => {
    const tree = await mount(review());
    await input(tree, 'Lesson review note', 'Add guided practice');
    await press(tree, label);
    expect(reviews.decide).not.toHaveBeenCalled();
    expect(tree.root.findByType(AdminDialog).props.visible).toBe(true);
    await confirm(tree);
    expect(reviews.decide).toHaveBeenCalledWith(
      'token',
      'approval',
      expect.objectContaining({
        action,
        revision: 2,
        reviewNote: 'Add guided practice',
      }),
    );
    expect(contents(tree)).toContain('Lesson review recorded');
    expect(contents(tree)).toContain('does not record delivery');
  },
);
test('Principal branch denial displays error, no lesson content or enabled review', async () => {
  reviews.detail.mockRejectedValue(new ApiError(404, 'Outside branch'));
  const tree = await mount(review());
  expect(contents(tree)).toContain('unavailable');
  expect(contents(tree)).not.toContain('Compare integers');
});
test('Principal conflict retains note and blocks another decision', async () => {
  reviews.decide.mockRejectedValue(new ApiError(409, 'Stale revision'));
  const tree = await mount(review());
  await input(tree, 'Lesson review note', 'Retained note');
  await press(tree, 'Approve Lesson');
  await confirm(tree);
  expect(contents(tree)).toContain('Review revision conflict');
  expect(tree.root.findAllByType(TextInput)[0].props.value).toBe(
    'Retained note',
  );
  expect(button(tree, 'Approve Lesson').props.disabled).toBe(true);
});
test('canonical coverage view renders partial state and defined percentage without weighting it', async () => {
  const coverage: Coverage = {
    ...pendingCoverage,
    partialTopics: 1,
    pendingTopics: 1,
    units: [
      {
        ...pendingCoverage.units[0],
        partialTopics: 1,
        pendingTopics: 0,
        topics: [{ topicId: 'integers', title: 'Integers', state: 'partial' }],
      },
    ],
  };
  const tree = await mount(<SyllabusCoverage coverage={coverage} />);
  expect(contents(tree)).toContain('Partial');
  expect(contents(tree)).toMatch(/0\s*%/);
  expect(contents(tree)).toContain('Partial topics do not count as completed');
});
