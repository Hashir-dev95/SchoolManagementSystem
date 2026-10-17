import React from 'react';
import { Text, TextInput } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import TeacherAcademicScreen from '../src/screens/teacher/TeacherAcademicScreen';
import TeacherLessonScreen from '../src/screens/teacher/TeacherLessonScreen';
import {
  academicService,
  type AcademicContext,
  type LessonPlan,
} from '../src/services/teacher/academicService';
import {
  AdminDialog,
  AdminSelect,
} from '../src/components/hiraDashboard/AdminForm';
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
    create: jest.fn(),
    update: jest.fn(),
    submit: jest.fn(),
    coverage: jest.fn(),
    revise: jest.fn(),
  },
}));
const service = jest.mocked(academicService);
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
const navigation = { navigate: jest.fn() };
let trees: Renderer.ReactTestRenderer[] = [];
const mount = async (element: React.ReactElement) => {
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(element);
  });
  trees.push(tree);
  return tree;
};
const academic = () => (
  <TeacherAcademicScreen {...({ route: { params: ids }, navigation } as any)} />
);
const editor = (existing?: LessonPlan, override = {}) => (
  <TeacherLessonScreen
    {...({
      route: { params: { ...ids, ...override, lesson: existing } },
    } as any)}
  />
);
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
  await act(async () => {
    button(tree, title).props.onPress();
  });
};
const input = async (
  tree: Renderer.ReactTestRenderer,
  label: string,
  value: string,
) => {
  await act(async () => {
    tree.root
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === label)!
      .props.onChangeText(value);
  });
};
beforeEach(() => {
  jest.clearAllMocks();
  service.context.mockResolvedValue(context);
  service.lessons.mockResolvedValue([]);
  service.coverage.mockResolvedValue(null);
  service.create.mockResolvedValue(lesson);
  service.update.mockResolvedValue({ ...lesson, revision: 2 });
  service.submit.mockResolvedValue({
    ...lesson,
    state: 'submitted',
    revision: 2,
  });
});
afterEach(async () => {
  await act(async () => {
    trees.forEach(t => t.unmount());
    trees = [];
  });
});
test('professional context opens roster, timetable, syllabus hierarchy and lessons without fake progress', async () => {
  const tree = await mount(academic());
  const copy = contents(tree);
  for (const text of [
    'Grade 8',
    'Section A',
    'Mathematics',
    'Ayesha',
    '2026–27',
  ])
    expect(copy).toContain(text);
  await press(tree, 'Roster');
  expect(navigation.navigate).toHaveBeenCalledWith('TeacherRoster', ids);
  await press(tree, 'Timetable');
  expect(navigation.navigate).toHaveBeenCalledWith('TeacherTimetable');
  await press(tree, 'Syllabus');
  for (const text of [
    'Published',
    'Numbers',
    'Integers',
    'Algebra',
    'Compare integers',
  ])
    expect(contents(tree)).toContain(text);
  expect(contents(tree)).not.toMatch(/%|completed|coverage/i);
  await press(tree, 'Lessons');
  expect(contents(tree)).toContain('No lesson plans');
  await press(tree, 'Create Lesson Plan');
  expect(navigation.navigate).toHaveBeenCalledWith('TeacherLesson', ids);
});
test('loading, empty syllabus and error/retry', async () => {
  let resolve!: (v: AcademicContext) => void;
  service.context.mockReturnValueOnce(
    new Promise(r => {
      resolve = r;
    }),
  );
  const tree = await mount(academic());
  expect(contents(tree)).toContain('Loading academic context');
  await act(async () => {
    resolve({ ...context, syllabus: null });
  });
  await press(tree, 'Syllabus');
  expect(contents(tree)).toContain('No published syllabus');
  service.context.mockRejectedValueOnce(new Error('Connection failed'));
  const failed = await mount(academic());
  expect(contents(failed)).toContain('Connection failed');
  await act(async () => {
    failed.root
      .findAll(
        n =>
          n.props.accessibilityLabel === 'Retry' &&
          typeof n.props.onPress === 'function',
      )[0]
      .props.onPress();
  });
  expect(contents(failed)).toContain('Grade 8');
});
test('unit selection clears topics and form validation prevents invalid writes', async () => {
  const tree = await mount(editor());
  await press(tree, 'Save Draft');
  expect(service.create).not.toHaveBeenCalled();
  expect(contents(tree)).toContain('Complete lesson details');
  await act(async () => {
    tree.root.findByType(AdminSelect).props.onSelect('numbers');
  });
  await press(tree, 'Integers');
  expect(contents(tree)).toContain('Selected: Integers');
  await act(async () => {
    tree.root.findByType(AdminSelect).props.onSelect('algebra');
  });
  expect(contents(tree)).not.toContain('Selected: Integers');
  expect(contents(tree)).toContain('Expressions');
});
test('save mapped draft, server confirmation, retained fields on failure and safe retry operation', async () => {
  const tree = await mount(editor());
  await input(tree, 'Teaching date', lesson.teachingDate);
  await input(tree, 'objectives', lesson.objectives);
  await input(tree, 'teachingActivities', lesson.teachingActivities);
  await act(async () => {
    tree.root.findByType(AdminSelect).props.onSelect('numbers');
  });
  await press(tree, 'Integers');
  service.create.mockRejectedValueOnce(new Error('Network failure'));
  await press(tree, 'Save Draft');
  expect(contents(tree)).toContain('Network failure');
  expect(
    tree.root
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === 'objectives')!.props.value,
  ).toBe(lesson.objectives);
  await press(tree, 'Save Draft');
  expect(contents(tree)).toContain('Server confirmed revision 1');
  expect(service.create.mock.calls[0][1]).toEqual(
    service.create.mock.calls[1][1],
  );
  expect(service.create.mock.calls[0][1]).toMatchObject({
    ...ids,
    syllabusId: 'syllabus',
    unitId: 'numbers',
    topicIds: ['integers'],
  });
});
test('duplicate taps fenced, confirmation summarizes context, submitted state is frozen', async () => {
  const tree = await mount(editor(lesson));
  await press(tree, 'Submit Lesson');
  const dialog = tree.root
    .findAllByType(AdminDialog)
    .find(d => d.props.title === 'Submit lesson?')!;
  expect(dialog.props.visible).toBe(true);
  expect(contents(tree)).toContain('authorized Principal review');
  const submit = dialog.props.onConfirm;
  await act(async () => {
    submit();
    submit();
  });
  expect(service.submit).toHaveBeenCalledTimes(1);
  expect(contents(tree)).toContain('read-only');
  expect(
    tree.root.findAllByType(TextInput).every(n => n.props.editable === false),
  ).toBe(true);
});
test('revision conflict retains local content and prevents blind overwrite', async () => {
  const tree = await mount(editor(lesson));
  await input(tree, 'objectives', 'Local revision');
  service.update.mockRejectedValueOnce(new ApiError(409, 'Changed'));
  await press(tree, 'Save Draft');
  expect(contents(tree)).toContain('Revision conflict');
  expect(button(tree, 'Save Draft').props.disabled).toBe(true);
  expect(
    tree.root
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === 'objectives')!.props.value,
  ).toBe('Local revision');
});
test('stale academic response cannot replace new context', async () => {
  let resolve!: (v: AcademicContext) => void;
  service.context.mockReturnValueOnce(
    new Promise(r => {
      resolve = r;
    }),
  );
  const tree = await mount(editor());
  await act(async () => {
    tree.update(editor(undefined, { subjectId: 'science' }));
  });
  await act(async () => {
    resolve({ ...context, teacherName: 'Stale teacher' });
  });
  expect(contents(tree)).not.toContain('Stale teacher');
});

test('saving unchanged draft still obtains server confirmation and checks revision', async () => {
  service.update.mockResolvedValueOnce({
    ...lesson,
    revision: 2,
    objectives: 'Latest server content',
  });
  const tree = await mount(editor(lesson));
  await press(tree, 'Save Draft');
  expect(service.update).toHaveBeenCalledWith(
    'token',
    lesson.lessonPlanId,
    expect.objectContaining({ revision: 1 }),
  );
  expect(contents(tree)).toContain('Server confirmed revision 2');
  expect(
    tree.root
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === 'objectives')!.props.value,
  ).toBe('Latest server content');
});
