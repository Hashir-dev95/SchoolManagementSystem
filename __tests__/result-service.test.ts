import {apiClient} from '../src/services/api/apiClient';
import {resultModerationService} from '../src/services/principal/resultModerationService';
import {studentResultService} from '../src/services/student/resultService';
import {resultService} from '../src/services/teacher/resultService';

jest.mock('../src/services/api/apiClient', () => ({apiClient: {request: jest.fn()}}));
const request = jest.mocked(apiClient.request);
beforeEach(() => request.mockResolvedValue({success: true, data: {items: [], total: 0}} as never));

test('Teacher result service scopes list reads and mutation endpoints', async () => {
  await resultService.list('token', {classId: 'class A', sectionId: 'section', subjectId: 'subject'});
  expect(request).toHaveBeenLastCalledWith('/teacher/results?classId=class%20A&sectionId=section&subjectId=subject', {token: 'token', method: 'GET'});
  await resultService.mutate('token', 'result/1', {action: 'submit'});
  expect(request).toHaveBeenLastCalledWith('/teacher/results/result%2F1', {token: 'token', method: 'POST', body: {action: 'submit'}});
});

test('Principal moderation and publication use distinct endpoints', async () => {
  await resultModerationService.moderate('token', 'approval', {action: 'approve'});
  expect(request).toHaveBeenLastCalledWith('/principal/results/approval/moderate', {token: 'token', method: 'POST', body: {action: 'approve'}});
  await resultModerationService.publish('token', 'approval', {recordRevision: 2});
  expect(request).toHaveBeenLastCalledWith('/principal/results/approval/publish', {token: 'token', method: 'POST', body: {recordRevision: 2}});
});

test('Student result contract has read-only list and encoded own-result detail endpoints', async () => {
  expect(Object.keys(studentResultService).sort()).toEqual(['detail', 'list']);
  await studentResultService.list('student-token');
  expect(request).toHaveBeenLastCalledWith('/student/results', {token: 'student-token'});
  await studentResultService.detail('student-token', 'result/1');
  expect(request).toHaveBeenLastCalledWith('/student/results/result%2F1', {token: 'student-token'});
});
