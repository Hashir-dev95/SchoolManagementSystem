import React from 'react';
import {Text, TextInput} from 'react-native';
import Renderer, {act} from 'react-test-renderer';
import {Button} from '../src/components/hiraDashboard';
import TeacherReviewQueueScreen from '../src/screens/teacher/TeacherReviewQueueScreen';
import TeacherReviewScreen from '../src/screens/teacher/TeacherReviewScreen';
import {academicReviewService, type ReviewDetail} from '../src/services/teacher/academicReviewService';

jest.mock('../src/context/AuthContext', () => ({useAuth: () => ({accessToken: 'token'})}));
jest.mock('@react-navigation/native', () => {
  const {useEffect} = jest.requireActual('react');
  return {useFocusEffect: (effect: () => void) => useEffect(effect, [effect])};
});
jest.mock('../src/services/teacher/academicReviewService', () => ({
  academicReviewService: {queue: jest.fn(), detail: jest.fn(), mutate: jest.fn()}, reviewOperationId: jest.fn((action: string) => `${action}_operation_001`),
}));
const service = jest.mocked(academicReviewService), navigation = {navigate: jest.fn(), goBack: jest.fn()};
const detail: ReviewDetail = {
  targetType: 'homework_submission', work: {workId: 'homework', title: 'Integer practice', publishedRevision: 1,
    className: 'Grade 8', sectionName: 'A', subjectName: 'Mathematics'},
  student: {studentId: 'student', fullName: 'Learner One', admissionNumber: 'A-1'},
  evidence: {submissionId: 'evidence', revision: 1, status: 'submitted', revisions: [{revision: 1, content: 'My work', timing: 'on_time'}]},
  review: null, rubric: null,
};
const review = {reviewId: 'review', revision: 1, state: 'review_draft', evidenceRevision: 1, rubricRevision: 1,
  scores: [{criterionId: 'overall', score: 8}], totalScore: 8, maxScore: 10, feedback: 'Good work', privateNote: '', history: [
    {revision: 1, action: 'save_draft', feedback: 'Good work', returnReason: null, createdAt: 'now'},
  ]};
const rubric = {rubricId: 'rubric', revision: 1, status: 'draft' as const,
  criteria: [{criterionId: 'overall', title: 'Overall quality', description: 'Evidence', maxScore: 10}], totalMax: 10};
let trees: Renderer.ReactTestRenderer[] = [];
const mount = async (element: React.ReactElement) => {let tree!: Renderer.ReactTestRenderer; await act(async () => {tree = Renderer.create(element);}); trees.push(tree); return tree;};
const text = (tree: Renderer.ReactTestRenderer) => tree.root.findAllByType(Text).flatMap(n => React.Children.toArray(n.props.children)).filter(v => typeof v === 'string' || typeof v === 'number').join(' ');
const press = async (tree: Renderer.ReactTestRenderer, title: string) => act(async () => tree.root.findAllByType(Button).find(n => n.props.title === title)!.props.onPress());
const input = async (tree: Renderer.ReactTestRenderer, label: string, value: string) => act(async () => tree.root.findAllByType(TextInput).find(n => n.props.accessibilityLabel === label)!.props.onChangeText(value));
beforeEach(() => {
  jest.clearAllMocks(); service.queue.mockResolvedValue({items: [{targetType: 'homework_submission', evidenceId: 'evidence', workId: 'homework',
    title: 'Integer practice', student: {fullName: 'Learner One', admissionNumber: 'A-1'}, evidenceRevision: 1,
    submissionState: 'submitted', reviewState: 'pending_review', reviewRevision: 0, submittedAt: 'now', timing: 'on_time'}], total: 1});
  service.detail.mockResolvedValue(detail); service.mutate.mockResolvedValue({review, rubric});
});
afterEach(async () => act(async () => {trees.forEach(tree => tree.unmount()); trees = [];}));

test('Tasks review queue shows safe learner evidence and opens its scoped review', async () => {
  const tree = await mount(<TeacherReviewQueueScreen {...({navigation} as any)} />);
  expect(text(tree)).toContain('Integer practice'); expect(text(tree)).toContain('Learner One'); expect(text(tree)).toContain('pending review');
  await press(tree, 'Review Learner One');
  expect(navigation.navigate).toHaveBeenCalledWith('TeacherReview', {targetType: 'homework_submission', evidenceId: 'evidence'});
});

test('rubric draft validates locally and sends structured score, feedback and private note', async () => {
  const tree = await mount(<TeacherReviewScreen {...({route: {params: {targetType: 'homework_submission', evidenceId: 'evidence'}}} as any)} />);
  await input(tree, 'Maximum score', '10'); await input(tree, 'Criterion score', '12'); await press(tree, 'Save Review Draft');
  expect(service.mutate).not.toHaveBeenCalled(); expect(text(tree)).toContain('Scores must be numeric');
  await input(tree, 'Criterion score', '8'); await input(tree, 'Learner feedback', 'Good work'); await input(tree, 'Teacher private note', 'Private');
  await press(tree, 'Save Review Draft');
  expect(service.mutate).toHaveBeenCalledWith('token', 'homework_submission', 'evidence', expect.objectContaining({
    action: 'save_draft', revision: 0, scores: [{criterionId: 'overall', score: 8}], feedback: 'Good work', privateNote: 'Private',
  }));
  expect(text(tree)).toContain('Review draft saved'); expect(text(tree)).toMatch(/Revision\s+1/);
});

test('finalize and release remain explicit separate actions', async () => {
  service.detail.mockResolvedValue({...detail, review, rubric});
  service.mutate.mockResolvedValueOnce({review: {...review, revision: 2, state: 'reviewed'}, rubric: {...rubric, status: 'frozen'}})
    .mockResolvedValueOnce({review: {...review, revision: 3, state: 'feedback_released'}, rubric: {...rubric, status: 'frozen'}});
  const tree = await mount(<TeacherReviewScreen {...({route: {params: {targetType: 'homework_submission', evidenceId: 'evidence'}}} as any)} />);
  await press(tree, 'Finalize Review'); expect(service.mutate).toHaveBeenLastCalledWith('token', 'homework_submission', 'evidence', expect.objectContaining({action: 'finalize', revision: 1}));
  expect(text(tree)).toContain('Review finalized'); await press(tree, 'Release Feedback');
  expect(service.mutate).toHaveBeenLastCalledWith('token', 'homework_submission', 'evidence', expect.objectContaining({action: 'release_feedback', revision: 2}));
  expect(text(tree)).toContain('Feedback released');
});

test('return for resubmit requires a reason and sends explicit permission', async () => {
  const tree = await mount(<TeacherReviewScreen {...({route: {params: {targetType: 'homework_submission', evidenceId: 'evidence'}}} as any)} />);
  await press(tree, 'Return for Resubmit'); expect(service.mutate).not.toHaveBeenCalled();
  await input(tree, 'Return reason', 'Add working'); await press(tree, 'Return for Resubmit');
  expect(service.mutate).toHaveBeenCalledWith('token', 'homework_submission', 'evidence', expect.objectContaining({
    action: 'return_for_resubmission', returnReason: 'Add working', resubmitAllowed: true,
  }));
});

test('returned evidence hides review actions until a new submission revision exists', async () => {
  service.detail.mockResolvedValue({...detail,
    evidence: {...detail.evidence, status: 'returned_for_resubmission'},
    review: {...review, state: 'returned_for_resubmission'}, rubric});
  const tree = await mount(<TeacherReviewScreen {...({route: {params: {targetType: 'homework_submission', evidenceId: 'evidence'}}} as any)} />);
  const titles = tree.root.findAllByType(Button).map(node => node.props.title);
  expect(titles).not.toContain('Save Review Draft');
  expect(titles).not.toContain('Finalize Review');
  expect(titles).not.toContain('Return for Resubmit');
  expect(tree.root.findAllByType(TextInput).every(node => node.props.editable === false)).toBe(true);
});
