import {
  academicService,
  lessonReviewService,
} from '../src/services/teacher/academicService';
import { apiClient } from '../src/services/api/apiClient';
jest.mock('../src/services/api/apiClient', () => ({
  apiClient: { request: jest.fn() },
}));
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(apiClient.request)
    .mockResolvedValue({ data: { confirmed: true } });
});
test('typed Principal review uses authenticated detail and revision/operation decision contract', async () => {
  await lessonReviewService.detail('token', 'approval');
  expect(apiClient.request).toHaveBeenCalledWith(
    '/principal/academic-review/approval',
    { token: 'token' },
  );
  const body = {
    action: 'needs_revision' as const,
    revision: 2,
    reviewNote: 'Add examples',
    clientOperationId: 'operation',
  };
  await lessonReviewService.decide('token', 'approval', body);
  expect(apiClient.request).toHaveBeenLastCalledWith(
    '/principal/academic-review/approval/decision',
    { token: 'token', method: 'POST', body },
  );
});
test('delivery evidence remains an explicit authenticated POST with approved revision', async () => {
  const body = {
    lessonPlanRevision: 2,
    revision: 0,
    clientOperationId: 'operation',
    deliveryStatus: 'not_delivered' as const,
    actualTeachingDate: '2026-10-15',
    topics: [
      {
        topicId: 'topic',
        state: 'not_covered' as const,
        evidence: 'Session cancelled',
      },
    ],
    teacherNotes: '',
    correctionReason: '',
  };
  await academicService.recordDelivery('token', 'lesson', body);
  expect(apiClient.request).toHaveBeenCalledWith(
    '/teacher/academic/lessons/lesson/deliveries',
    { token: 'token', method: 'POST', body },
  );
});
test('coverage, occurrence authority, revisions and review history use separate contracts', async () => {
  await academicService.coverage('token', {
    classId: 'class',
    sectionId: 'section',
    subjectId: 'subject',
  });
  expect(apiClient.request).toHaveBeenLastCalledWith(
    '/teacher/academic/coverage?classId=class&sectionId=section&subjectId=subject',
    expect.objectContaining({ method: 'GET', token: 'token' }),
  );
  await academicService.occurrenceLessons('token', 'period', '2026-10-15');
  expect(apiClient.request).toHaveBeenLastCalledWith(
    '/teacher/academic/occurrences/period/lessons?date=2026-10-15',
    expect.objectContaining({ method: 'GET' }),
  );
  await academicService.revise('token', 'lesson', 3, 'operation');
  expect(apiClient.request).toHaveBeenLastCalledWith(
    '/teacher/academic/lessons/lesson/revise',
    expect.objectContaining({
      method: 'POST',
      body: { revision: 3, clientOperationId: 'operation' },
    }),
  );
  await lessonReviewService.history('token');
  expect(apiClient.request).toHaveBeenLastCalledWith(
    '/principal/academic-review/history',
    { token: 'token' },
  );
});
