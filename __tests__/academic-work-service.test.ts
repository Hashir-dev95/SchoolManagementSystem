import { academicWorkService } from '../src/services/teacher/academicWorkService';
import { apiClient } from '../src/services/api/apiClient';

jest.mock('../src/services/api/apiClient', () => ({ apiClient: { request: jest.fn() } }));
beforeEach(() => { jest.clearAllMocks(); jest.mocked(apiClient.request).mockResolvedValue({ data: {} }); });

test('context is lesson-scoped and authenticated', async () => {
  await academicWorkService.context('token', 'lesson id');
  expect(apiClient.request).toHaveBeenCalledWith('/teacher/academic-work/context?lessonPlanId=lesson%20id', {
    token: 'token', method: 'GET', body: undefined,
  });
});

test('Homework draft, preview and publication use separate contracts without recipients', async () => {
  const body = { lessonPlanId: 'lesson', topicIds: ['topic'], title: 'Practice', instructions: 'Complete', dueAt: '2026-10-20', clientOperationId: 'operation' };
  await academicWorkService.saveHomework('token', body);
  expect(apiClient.request).toHaveBeenLastCalledWith('/teacher/academic-work/homework', { token: 'token', method: 'POST', body });
  await academicWorkService.previewHomework('token', 'homework');
  expect(apiClient.request).toHaveBeenLastCalledWith('/teacher/academic-work/homework/homework/preview', { token: 'token', method: 'POST', body: {} });
  await academicWorkService.publishHomework('token', 'homework', 2, 'publish-operation');
  expect(apiClient.request).toHaveBeenLastCalledWith('/teacher/academic-work/homework/homework/publish', {
    token: 'token', method: 'POST', body: { revision: 2, clientOperationId: 'publish-operation' },
  });
});

test('Quiz draft preserves explicit question and attempt rules', async () => {
  const body = { lessonPlanId: 'lesson', questions: [{ questionId: 'q', type: 'true_false', text: 'True?', correctBoolean: true }] };
  await academicWorkService.saveQuiz('token', body, 'quiz');
  expect(apiClient.request).toHaveBeenLastCalledWith('/teacher/academic-work/quiz/quiz', { token: 'token', method: 'PATCH', body });
  await academicWorkService.previewQuiz('token', 'quiz');
  await academicWorkService.publishQuiz('token', 'quiz', 1, 'publish-operation');
  expect(apiClient.request).toHaveBeenLastCalledWith('/teacher/academic-work/quiz/quiz/publish', {
    token: 'token', method: 'POST', body: { revision: 1, clientOperationId: 'publish-operation' },
  });
});
