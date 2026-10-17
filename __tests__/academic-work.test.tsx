import React from 'react';
import { Text, TextInput } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import TeacherHomeworkScreen from '../src/screens/teacher/TeacherHomeworkScreen';
import TeacherQuizScreen from '../src/screens/teacher/TeacherQuizScreen';
import TeacherAcademicScreen from '../src/screens/teacher/TeacherAcademicScreen';
import { academicWorkService, type AcademicWorkContext, type HomeworkRecord, type QuizRecord } from '../src/services/teacher/academicWorkService';
import { academicService } from '../src/services/teacher/academicService';
import { Button } from '../src/components/hiraDashboard';
import { AdminDateField, AdminDialog } from '../src/components/hiraDashboard/AdminForm';
import { ApiError } from '../src/services/api/apiClient';

jest.setTimeout(15000);

jest.mock('../src/context/AuthContext', () => ({ useAuth: () => ({ accessToken: 'token' }) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('@react-navigation/native', () => {
  const { useEffect } = jest.requireActual('react');
  return { useFocusEffect: (effect: () => void) => useEffect(effect, [effect]) };
});
jest.mock('../src/services/teacher/academicWorkService', () => ({
  ...jest.requireActual('../src/services/teacher/academicWorkService'),
  academicWorkService: { context: jest.fn(), saveHomework: jest.fn(), previewHomework: jest.fn(), publishHomework: jest.fn(), saveQuiz: jest.fn(), previewQuiz: jest.fn(), publishQuiz: jest.fn() },
}));
jest.mock('../src/services/teacher/academicService', () => ({
  academicService: { context: jest.fn(), lessons: jest.fn(), coverage: jest.fn() },
}));
const work = jest.mocked(academicWorkService), academic = jest.mocked(academicService);
const context: AcademicWorkContext = {
  lesson: {
    lessonPlanId: 'lesson', lessonState: 'approved', lessonPlanRevision: 2,
    classId: 'class', sectionId: 'section', subjectId: 'subject', className: 'Grade 8', sectionName: 'A',
    teacherName: 'Ayesha', academicYear: '2026–27', unitId: 'unit', topicIds: ['topic'], occurrence: null,
    syllabus: { syllabusId: 'syllabus', title: 'Mathematics', academicYear: '2026–27', version: 1, revision: 2, status: 'published', units: [
      { unitId: 'unit', title: 'Numbers', order: 1, topics: [{ topicId: 'topic', title: 'Integers', order: 1, outcomes: ['Compare'] }] },
    ] },
  },
  audience: { recipientCount: 28, students: [{ studentId: 'student', fullName: 'Learner', admissionNumber: 'A-1' }] },
  homework: [], quizzes: [], publicationPolicy: 'approved_lesson_required', schedulingSupported: false,
};
const homework: HomeworkRecord = {
  homeworkId: 'homework', type: 'homework', status: 'draft', revision: 1, publishedRevision: null,
  lessonPlanId: 'lesson', lessonPlanRevision: 2, lessonDeliveryId: null, topicIds: ['topic'], title: 'Practice',
  instructions: 'Complete exercises', dueAt: '2026-10-20', latePolicy: 'closed_after_due_date', recipientCount: 0, publishedAt: null,
};
const quiz: QuizRecord = {
  quizId: 'quiz', type: 'quiz', status: 'draft', revision: 1, publishedRevision: null, lessonPlanId: 'lesson',
  lessonPlanRevision: 2, lessonDeliveryId: null, topicIds: ['topic'], title: 'Check', instructions: 'Answer',
  questions: [{ questionId: 'question', type: 'true_false', text: 'Zero is positive', correctBoolean: false }],
  availableFrom: '2026-10-18', availableUntil: '2026-10-20', attemptLimit: 1, timeLimitMinutes: 20,
  shuffleQuestions: false, recipientCount: 0, publishedAt: null,
};
const navigation = { navigate: jest.fn() };
let trees: Renderer.ReactTestRenderer[] = [];
const mount = async (element: React.ReactElement) => { let tree!: Renderer.ReactTestRenderer; await act(async () => { tree = Renderer.create(element); }); trees.push(tree); return tree; };
const text = (tree: Renderer.ReactTestRenderer) => tree.root.findAllByType(Text).flatMap(node => node.props.children).filter(value => typeof value === 'string' || typeof value === 'number').join(' ');
const button = (tree: Renderer.ReactTestRenderer, title: string) => tree.root.findAllByType(Button).find(node => node.props.title === title)!;
const press = async (tree: Renderer.ReactTestRenderer, title: string) => act(async () => button(tree, title).props.onPress());
const input = async (tree: Renderer.ReactTestRenderer, label: string, value: string) => act(async () => tree.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === label)!.props.onChangeText(value));
const date = async (tree: Renderer.ReactTestRenderer, label: string, value: string) => act(async () => tree.root.findAllByType(AdminDateField).find(node => node.props.label === label)!.props.onChange(value));
const homeworkScreen = () => <TeacherHomeworkScreen {...({ route: { params: { lessonPlanId: 'lesson' } }, navigation } as any)} />;
const quizScreen = () => <TeacherQuizScreen {...({ route: { params: { lessonPlanId: 'lesson' } }, navigation } as any)} />;
beforeEach(() => {
  jest.clearAllMocks(); work.context.mockResolvedValue(context); work.saveHomework.mockResolvedValue(homework);
  work.previewHomework.mockResolvedValue({ ...context.audience, workType: 'homework', workId: 'homework', className: 'Grade 8', sectionName: 'A' });
  work.publishHomework.mockResolvedValue({ ...homework, status: 'published', publishedRevision: 1, recipientCount: 28, publishedAt: 'now' });
  work.saveQuiz.mockResolvedValue(quiz); work.previewQuiz.mockResolvedValue({ ...context.audience, workType: 'quiz', workId: 'quiz', className: 'Grade 8', sectionName: 'A' });
  work.publishQuiz.mockResolvedValue({ ...quiz, status: 'published', publishedRevision: 1, recipientCount: 28, publishedAt: 'now' });
});
afterEach(async () => act(async () => { trees.forEach(tree => tree.unmount()); trees = []; }));

test('Homework shows canonical context, topics, audience and due-date policy', async () => {
  const tree = await mount(homeworkScreen());
  for (const value of ['Create Homework', 'Grade 8', 'Section A', 'Mathematics', 'Integers', 'server re-resolves']) expect(text(tree)).toContain(value);
  expect(text(tree)).toMatch(/28\s+eligible students/);
  expect(tree.root.findAllByType(AdminDateField).some(node => node.props.label === 'Homework due date')).toBe(true);
});

test('Homework validates, previews, confirms and reports server-confirmed success', async () => {
  const tree = await mount(homeworkScreen());
  await input(tree, 'Homework title', 'Practice'); await input(tree, 'Homework instructions', 'Complete exercises');
  await press(tree, 'Integers'); await date(tree, 'Homework due date', '2026-10-20');
  await press(tree, 'Review & Publish Homework');
  expect(work.saveHomework).toHaveBeenCalled(); expect(work.previewHomework).toHaveBeenCalledWith('token', 'homework');
  expect(tree.root.findByType(AdminDialog).props.visible).toBe(true);
  await act(async () => tree.root.findByType(AdminDialog).props.onConfirm());
  expect(text(tree)).toContain('Homework published successfully.'); expect(text(tree)).toContain('28 learners assigned');
});

test('Homework review persists post-save edits and publishes the authoritative confirmed revision', async () => {
  const updated = { ...homework, revision: 2, title: 'Server-confirmed practice', instructions: 'Updated instructions' };
  work.saveHomework.mockResolvedValueOnce(homework).mockResolvedValueOnce(updated);
  work.publishHomework.mockResolvedValue({ ...updated, status: 'published', publishedRevision: 2, recipientCount: 28, publishedAt: 'now' });
  const tree = await mount(homeworkScreen());
  await input(tree, 'Homework title', 'Practice'); await input(tree, 'Homework instructions', 'Complete exercises');
  await press(tree, 'Integers'); await date(tree, 'Homework due date', '2026-10-20'); await press(tree, 'Save Homework Draft');
  await input(tree, 'Homework title', 'Edited practice'); await input(tree, 'Homework instructions', 'Updated instructions');
  await press(tree, 'Review & Publish Homework');
  expect(work.saveHomework).toHaveBeenCalledTimes(2);
  expect(work.saveHomework.mock.calls[1][1]).toEqual(expect.objectContaining({
    title: 'Edited practice', instructions: 'Updated instructions', revision: 1,
  }));
  expect(text(tree)).toContain('Server-confirmed practice'); expect(text(tree)).toContain('Updated instructions');
  await act(async () => tree.root.findByType(AdminDialog).props.onConfirm());
  expect(work.publishHomework).toHaveBeenCalledWith('token', 'homework', 2, expect.any(String));
});

test('Homework errors retain form and duplicate save taps are fenced', async () => {
  let reject!: (error: Error) => void; work.saveHomework.mockReturnValueOnce(new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
  const tree = await mount(homeworkScreen());
  await input(tree, 'Homework title', 'Retained'); await input(tree, 'Homework instructions', 'Retained instructions'); await press(tree, 'Integers'); await date(tree, 'Homework due date', '2026-10-20');
  const action = button(tree, 'Save Homework Draft').props.onPress; await act(async () => { action(); action(); });
  expect(work.saveHomework).toHaveBeenCalledTimes(1); await act(async () => reject(new Error('Network failure')));
  expect(text(tree)).toContain('Network failure'); expect(tree.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === 'Homework title')!.props.value).toBe('Retained');
});

test('Quiz builder supports MCQ, true/false and short-answer structures', async () => {
  const tree = await mount(quizScreen());
  await press(tree, 'Add Multiple Choice'); await press(tree, 'Add True / False'); await press(tree, 'Add Short Answer');
  expect(text(tree)).toContain('Questions • 3');
  expect(tree.root.findAllByType(TextInput).some(node => node.props.accessibilityLabel === 'Question 1 option 1')).toBe(true);
  expect(button(tree, 'Correct answer: True')).toBeTruthy();
  expect(tree.root.findAllByType(TextInput).some(node => node.props.accessibilityLabel === 'Question 3 expected answer')).toBe(true);
});

test('Quiz incomplete MCQ is rejected before service call', async () => {
  const tree = await mount(quizScreen()); await input(tree, 'Quiz title', 'Check'); await input(tree, 'Quiz instructions', 'Answer');
  await press(tree, 'Integers'); await press(tree, 'Add Multiple Choice'); await date(tree, 'Available from', '2026-10-18'); await date(tree, 'Available until', '2026-10-20');
  await press(tree, 'Save Quiz Draft'); expect(work.saveQuiz).not.toHaveBeenCalled(); expect(text(tree)).toContain('Complete the quiz draft');
});

test('Quiz preview confirmation includes question, window and audience summary', async () => {
  const tree = await mount(quizScreen()); await input(tree, 'Quiz title', 'Check'); await input(tree, 'Quiz instructions', 'Answer all'); await press(tree, 'Integers');
  await press(tree, 'Add True / False'); await input(tree, 'Question 1 text', 'Zero is positive'); await date(tree, 'Available from', '2026-10-18'); await date(tree, 'Available until', '2026-10-20');
  await press(tree, 'Review & Publish Quiz'); expect(work.saveQuiz).toHaveBeenCalled(); expect(work.previewQuiz).toHaveBeenCalled();
  expect(text(tree)).toContain('1 questions'); expect(text(tree)).toMatch(/28\s+recipients/);
  await act(async () => tree.root.findByType(AdminDialog).props.onConfirm()); expect(text(tree)).toContain('Quiz published successfully.');
});

test('Quiz review persists post-save edits and publishes the authoritative confirmed revision', async () => {
  const updated = { ...quiz, revision: 2, title: 'Server-confirmed check', attemptLimit: 2 };
  work.saveQuiz.mockResolvedValueOnce(quiz).mockResolvedValueOnce(updated);
  work.publishQuiz.mockResolvedValue({ ...updated, status: 'published', publishedRevision: 2, recipientCount: 28, publishedAt: 'now' });
  const tree = await mount(quizScreen());
  await input(tree, 'Quiz title', 'Check'); await input(tree, 'Quiz instructions', 'Answer'); await press(tree, 'Integers');
  await press(tree, 'Add True / False'); await input(tree, 'Question 1 text', 'Zero is positive');
  await date(tree, 'Available from', '2026-10-18'); await date(tree, 'Available until', '2026-10-20'); await press(tree, 'Save Quiz Draft');
  await input(tree, 'Quiz title', 'Edited check'); await input(tree, 'Attempt limit', '2');
  await press(tree, 'Review & Publish Quiz');
  expect(work.saveQuiz).toHaveBeenCalledTimes(2);
  expect(work.saveQuiz.mock.calls[1][1]).toEqual(expect.objectContaining({ title: 'Edited check', attemptLimit: 2, revision: 1 }));
  expect(text(tree)).toContain('Server-confirmed check'); expect(text(tree)).toMatch(/Attempt limit\s+2/);
  await act(async () => tree.root.findByType(AdminDialog).props.onConfirm());
  expect(work.publishQuiz).toHaveBeenCalledWith('token', 'quiz', 2, expect.any(String));
});

test('Quiz revision conflict retains questions and disables blind overwrite', async () => {
  work.saveQuiz.mockRejectedValue(new ApiError(409, 'Changed'));
  const tree = await mount(quizScreen()); await input(tree, 'Quiz title', 'Check'); await input(tree, 'Quiz instructions', 'Answer'); await press(tree, 'Integers');
  await press(tree, 'Add True / False'); await input(tree, 'Question 1 text', 'Retained question'); await date(tree, 'Available from', '2026-10-18'); await date(tree, 'Available until', '2026-10-20');
  await press(tree, 'Save Quiz Draft'); expect(text(tree)).toContain('Quiz revision conflict');
  expect(tree.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === 'Question 1 text')!.props.value).toBe('Retained question');
});

test('Classes lesson navigation opens Homework and Quiz while Home remains untouched', async () => {
  academic.context.mockResolvedValue({ assignment: { classId: 'class', sectionId: 'section', subjectId: 'subject', assignmentId: 'assignment', className: 'Grade 8', sectionName: 'A', subjectName: 'Math' }, teacherName: 'Ayesha', academicYear: '2026–27', syllabus: context.lesson.syllabus });
  academic.lessons.mockResolvedValue([{ lessonPlanId: 'lesson', classId: 'class', sectionId: 'section', subjectId: 'subject', syllabusId: 'syllabus', academicYear: '2026–27', unitId: 'unit', topicIds: ['topic'], teachingDate: '2026-10-17', objectives: 'Compare', teachingActivities: 'Practice', resources: '', notes: '', revision: 2, state: 'approved', submittedAt: 'now' }]);
  academic.coverage.mockResolvedValue(null);
  const tree = await mount(<TeacherAcademicScreen {...({ route: { params: { classId: 'class', sectionId: 'section', subjectId: 'subject' } }, navigation } as any)} />);
  await press(tree, 'Lessons'); await press(tree, 'Create Homework'); expect(navigation.navigate).toHaveBeenCalledWith('TeacherHomework', { lessonPlanId: 'lesson' });
  await press(tree, 'Create Quiz'); expect(navigation.navigate).toHaveBeenCalledWith('TeacherQuiz', { lessonPlanId: 'lesson' });
});
