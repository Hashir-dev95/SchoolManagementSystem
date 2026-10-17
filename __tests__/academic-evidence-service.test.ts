import {apiClient} from '../src/services/api/apiClient';
import {academicEvidenceService} from '../src/services/student/academicEvidenceService';
import {academicReviewService} from '../src/services/teacher/academicReviewService';

jest.mock('../src/services/api/apiClient', () => ({apiClient: {request: jest.fn()}}));
beforeEach(() => {jest.clearAllMocks(); jest.mocked(apiClient.request).mockResolvedValue({data: {}});});

test('Student Homework evidence uses an entitlement-scoped submit contract', async () => {
  await academicEvidenceService.submitHomework('token', 'homework', 'My work', 'operation');
  expect(apiClient.request).toHaveBeenCalledWith('/student/evidence/homework/homework/submit', {
    token: 'token', method: 'POST', body: {content: 'My work', clientOperationId: 'operation'},
  });
});

test('Student Quiz start, reconnect and submit use server attempt identifiers and revisions', async () => {
  await academicEvidenceService.startQuiz('token', 'quiz', 'start-operation');
  await academicEvidenceService.currentQuiz('token', 'quiz');
  await academicEvidenceService.submitQuiz('token', 'quiz', 'attempt', 2, [{questionId: 'q', booleanAnswer: true}], 'submit-operation');
  expect(apiClient.request).toHaveBeenLastCalledWith('/student/evidence/quiz/quiz/attempts/attempt/submit', {
    token: 'token', method: 'POST', body: {revision: 2, answers: [{questionId: 'q', booleanAnswer: true}], clientOperationId: 'submit-operation'},
  });
});

test('Teacher queue, detail and mutation remain separate contracts', async () => {
  await academicReviewService.queue('token');
  await academicReviewService.detail('token', 'homework_submission', 'evidence');
  await academicReviewService.mutate('token', 'homework_submission', 'evidence', {action: 'finalize', revision: 1});
  expect(apiClient.request).toHaveBeenLastCalledWith('/teacher/reviews/homework_submission/evidence', {
    token: 'token', method: 'POST', body: {action: 'finalize', revision: 1},
  });
});
