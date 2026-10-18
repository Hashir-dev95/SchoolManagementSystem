import React from 'react';
import {Text, TextInput} from 'react-native';
import Renderer, {act} from 'react-test-renderer';
import {Button} from '../src/components/hiraDashboard';
import PrincipalResultModerationScreen from '../src/screens/principal/PrincipalResultModerationScreen';
import TeacherMarksScreen from '../src/screens/teacher/TeacherMarksScreen';
import {resultModerationService} from '../src/services/principal/resultModerationService';
import {resultService, type TeacherResult} from '../src/services/teacher/resultService';

jest.mock('@react-navigation/native', () => {
  const ReactModule = jest.requireActual('react');
  return {useFocusEffect: (effect: () => void) => ReactModule.useEffect(effect, [effect])};
});
jest.mock('../src/context/AuthContext', () => ({useAuth: () => ({accessToken: 'token'})}));
jest.mock('../src/services/teacher/resultService', () => ({
  resultService: {list: jest.fn(), create: jest.fn(), detail: jest.fn(), mutate: jest.fn()},
  resultOperationId: (action: string) => `${action}_operation_123456`,
}));
jest.mock('../src/services/principal/resultModerationService', () => ({
  resultModerationService: {detail: jest.fn(), moderate: jest.fn(), publish: jest.fn()},
}));

const teacherService = jest.mocked(resultService);
const principalService = jest.mocked(resultModerationService);
const source = {targetType: 'homework_submission' as const, evidenceId: 'submission-1', reviewId: 'review-1', title: 'Integer practice',
  student: {fullName: 'Learner One', admissionNumber: 'A-1'}, score: 8, maxScore: 10, resultId: null};
const result: TeacherResult = {
  resultId: 'result-1', recordRevision: 1, currentRevision: 1, status: 'draft',
  academic: {classId: 'class-1', sectionId: 'section-1', subjectId: 'subject-1', className: 'Grade 8', sectionName: 'A', subjectName: 'Mathematics', academicYear: '2026'},
  student: {studentId: 'student-1', fullName: 'Learner One', admissionNumber: 'A-1'}, assessmentTitle: 'Integer practice',
  source: {type: 'homework_submission', workId: 'homework-1', publishedRevision: 1, evidenceId: 'submission-1', evidenceRevision: 1,
    reviewId: 'review-1', reviewRevision: 2, reviewState: 'reviewed', score: 8, maxScore: 10},
  revisions: [{revision: 1, awardedMarks: 8, maxMarks: 10, sourceScore: 8, sourceMax: 10, overrideReason: '', teacherPrivateNote: 'Teacher only', createdAt: 'now', submittedAt: null}],
  submittedRevision: null, moderationHistory: [], publishedRevision: null, publishedAt: null,
  history: [{resultRevision: 1, action: 'draft_created', actorRole: 'teacher', reason: '', createdAt: 'now'}],
};
const params = {classId: 'class-1', sectionId: 'section-1', subjectId: 'subject-1'};
let trees: Renderer.ReactTestRenderer[] = [];
const mount = async (element: React.ReactElement) => {let tree!: Renderer.ReactTestRenderer; await act(async () => {tree = Renderer.create(element);}); trees.push(tree); return tree;};
const content = (tree: Renderer.ReactTestRenderer) => tree.root.findAllByType(Text).flatMap(node => React.Children.toArray(node.props.children)).join(' ');
const press = async (tree: Renderer.ReactTestRenderer, title: string) => act(async () => tree.root.findAllByType(Button).find(node => node.props.title === title)!.props.onPress());
const input = async (tree: Renderer.ReactTestRenderer, label: string, value: string) => act(async () => tree.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === label)!.props.onChangeText(value));

beforeEach(() => {
  jest.clearAllMocks();
  teacherService.list.mockResolvedValue({sources: [source], items: [], total: 0});
  teacherService.create.mockResolvedValue(result);
  teacherService.mutate.mockResolvedValue(result);
  principalService.detail.mockResolvedValue({approvalId: 'approval-1', approvalStatus: 'pending', canModerate: true, canPublish: false, result});
  principalService.moderate.mockResolvedValue({approvalId: 'approval-1', approvalStatus: 'approved', canModerate: false, canPublish: true,
    result: {...result, status: 'moderated_approved'}});
  principalService.publish.mockResolvedValue({approvalId: 'approval-1', approvalStatus: 'approved', canModerate: false, canPublish: false,
    result: {...result, status: 'published', publishedRevision: 1, publishedAt: 'now'}});
});
afterEach(async () => act(async () => {trees.forEach(tree => tree.unmount()); trees = [];}));

test('Teacher marks workspace creates a server-validated draft from reviewed evidence', async () => {
  const tree = await mount(<TeacherMarksScreen {...({route: {params}} as any)} />);
  await press(tree, 'Learner One - Integer practice - 8/10');
  expect(content(tree)).toContain('Reviewed 8/10');
  await input(tree, 'Awarded marks', '7.5');
  await input(tree, 'Override reason', 'Partial method credit');
  await input(tree, 'Teacher private note', 'Teacher only');
  await press(tree, 'Create Result Draft');
  expect(teacherService.create).toHaveBeenCalledWith('token', expect.objectContaining({targetType: 'homework_submission', evidenceId: 'submission-1', awardedMarks: 7.5, overrideReason: 'Partial method credit'}));
  expect(content(tree)).toContain('Result updated');
});

test('draft save and submit send the optimistic record revision', async () => {
  teacherService.list.mockResolvedValue({sources: [{...source, resultId: result.resultId}], items: [result], total: 1});
  const tree = await mount(<TeacherMarksScreen {...({route: {params}} as any)} />);
  await press(tree, 'Learner One - Integer practice - draft');
  await press(tree, 'Save Draft');
  expect(teacherService.mutate).toHaveBeenLastCalledWith('token', 'result-1', expect.objectContaining({action: 'save_draft', recordRevision: 1}));
  await press(tree, 'Submit for Moderation');
  expect(teacherService.mutate).toHaveBeenLastCalledWith('token', 'result-1', expect.objectContaining({action: 'submit', recordRevision: 1}));
  expect(content(tree)).toContain('History');
});

test('returned result exposes revision creation while submitted and published states remain frozen', async () => {
  const returned = {...result, status: 'returned_for_revision' as const};
  teacherService.list.mockResolvedValue({sources: [{...source, resultId: result.resultId}], items: [returned], total: 1});
  const tree = await mount(<TeacherMarksScreen {...({route: {params}} as any)} />);
  await press(tree, 'Learner One - Integer practice - returned for revision');
  expect(tree.root.findAllByType(Button).map(node => node.props.title)).toContain('Create Revision');
  expect(tree.root.findAllByType(Button).map(node => node.props.title)).not.toContain('Submit for Moderation');
});

test('stale Teacher mutation is surfaced without claiming success', async () => {
  teacherService.list.mockResolvedValue({sources: [{...source, resultId: result.resultId}], items: [result], total: 1});
  teacherService.mutate.mockRejectedValue(new Error('Result changed; refresh required'));
  const tree = await mount(<TeacherMarksScreen {...({route: {params}} as any)} />);
  await press(tree, 'Learner One - Integer practice - draft');
  await press(tree, 'Save Draft');
  expect(content(tree)).toContain('Result changed; refresh required');
  expect(content(tree)).not.toContain('Result updated');
});

test('Principal moderation records a decision without publishing', async () => {
  const tree = await mount(<PrincipalResultModerationScreen {...({route: {params: {approvalId: 'approval-1'}}} as any)} />);
  expect(content(tree)).toContain('Approval and publication are separate');
  await input(tree, 'Moderation reason', 'Evidence verified');
  await press(tree, 'Approve');
  expect(principalService.moderate).toHaveBeenCalledWith('token', 'approval-1', expect.objectContaining({action: 'approve', reason: 'Evidence verified', recordRevision: 1}));
  expect(principalService.publish).not.toHaveBeenCalled();
  expect(content(tree)).toContain('without publishing');
});

test('Principal return/reject actions and explicit publish are state-gated', async () => {
  const tree = await mount(<PrincipalResultModerationScreen {...({route: {params: {approvalId: 'approval-1'}}} as any)} />);
  await input(tree, 'Moderation reason', 'Revise evidence');
  await press(tree, 'Return for Changes');
  expect(principalService.moderate).toHaveBeenCalledWith('token', 'approval-1', expect.objectContaining({action: 'return', reason: 'Revise evidence'}));
  principalService.detail.mockResolvedValue({approvalId: 'approval-1', approvalStatus: 'approved', canModerate: false, canPublish: true,
    result: {...result, status: 'moderated_approved'}});
  const publishTree = await mount(<PrincipalResultModerationScreen {...({route: {params: {approvalId: 'approval-1'}}} as any)} />);
  expect(publishTree.root.findAllByType(Button).map(node => node.props.title)).toEqual(expect.arrayContaining(['Publish Result']));
  expect(publishTree.root.findAllByType(Button).map(node => node.props.title)).not.toContain('Approve');
  await press(publishTree, 'Publish Result');
  expect(principalService.publish).toHaveBeenCalledWith('token', 'approval-1', expect.objectContaining({recordRevision: 1}));
});
