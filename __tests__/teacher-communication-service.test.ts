import {
  communicationService,
  noticeOperationId,
} from '../src/services/teacher/communicationService';
import { apiClient } from '../src/services/api/apiClient';
jest.mock('../src/services/api/apiClient', () => ({
  apiClient: { request: jest.fn() },
}));
const client = jest.mocked(apiClient);
const context = {
  classId: 'class',
  sectionId: 'section',
  subjectId: 'subject',
};
const content = {
  ...context,
  title: 'Title',
  body: 'Message',
  language: 'en' as const,
  audienceType: 'class_students' as const,
};
beforeEach(() => {
  client.request
    .mockReset()
    .mockResolvedValue({ success: true, data: { total: 3 } });
});
test('preview sends only server-resolved tuple and audience without recipients', async () => {
  // The composer passes its full form object; preview must project the tuple.
  await communicationService.preview('token', content);
  expect(client.request).toHaveBeenCalledWith('/teacher/notices/preview', {
    token: 'token',
    method: 'POST',
    body: { ...context, audienceType: 'class_students' },
  });
});
test('draft create/update preserve content, identity comes exclusively from token', async () => {
  await communicationService.draft('token', content);
  expect(client.request).toHaveBeenLastCalledWith('/teacher/notices', {
    token: 'token',
    method: 'POST',
    body: content,
  });
  await communicationService.draft('token', content, {
    noticeId: 'draft/id',
    revision: 2,
  });
  expect(client.request).toHaveBeenLastCalledWith(
    '/teacher/notices/draft%2Fid',
    { token: 'token', method: 'PATCH', body: { ...content, revision: 2 } },
  );
});
test('send retries preserve explicit operation and revision without trusting preview count', async () => {
  await communicationService.send('token', 'notice', 2, 'operation');
  await communicationService.send('token', 'notice', 2, 'operation');
  expect(client.request.mock.calls[0]).toEqual(client.request.mock.calls[1]);
  expect(client.request).toHaveBeenLastCalledWith(
    '/teacher/notices/notice/send',
    {
      token: 'token',
      method: 'POST',
      body: { revision: 2, clientOperationId: 'operation' },
    },
  );
});
test('queues and object operations use Teacher routes and bounded page offsets', async () => {
  expect(await communicationService.inbox('token', 50)).toEqual({ total: 3 });
  expect(client.request).toHaveBeenLastCalledWith('/teacher/inbox?offset=50', {
    token: 'token',
    method: 'GET',
  });
  await communicationService.tasks('token');
  expect(client.request).toHaveBeenLastCalledWith('/teacher/tasks?offset=0', {
    token: 'token',
    method: 'GET',
  });
  await communicationService.work('token', 'work/id');
  expect(client.request).toHaveBeenLastCalledWith('/teacher/tasks/work%2Fid', {
    token: 'token',
    method: 'GET',
  });
  await communicationService.complete('token', 'work');
  expect(client.request).toHaveBeenLastCalledWith(
    '/teacher/tasks/work/complete',
    { token: 'token', method: 'POST', body: {} },
  );
  expect(JSON.stringify(client.request.mock.calls)).not.toContain('/principal');
});
test('new intentional sends get distinct operation identities', () => {
  const first = noticeOperationId(),
    second = noticeOperationId();
  expect(first).not.toBe(second);
  expect(first).toMatch(/^[A-Za-z0-9_-]{16,80}$/);
});
