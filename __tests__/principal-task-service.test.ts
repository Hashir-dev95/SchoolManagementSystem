import { apiClient } from '../src/services/api/apiClient';
import {
  CreateTaskInput,
  principalService,
} from '../src/services/principal/principalService';
afterEach(() => jest.restoreAllMocks());

test('task list serializes only typed filters and preserves canAssign', async () => {
  const call = jest
    .spyOn(apiClient, 'request')
    .mockResolvedValue({ data: [], canAssign: true, message: 'Tasks' });
  expect(
    await principalService.getTasks('token', {
      search: 'A & B',
      status: 'pending',
      priority: 'high',
    }),
  ).toEqual({ data: [], canAssign: true, message: 'Tasks' });
  expect(call).toHaveBeenCalledWith(
    '/principal/tasks?status=pending&priority=high&search=A%20%26%20B',
    { token: 'token' },
  );
});

test('task assignees use the scoped authenticated endpoint', async () => {
  const call = jest
    .spyOn(apiClient, 'request')
    .mockResolvedValue({ data: [], message: '' });
  await principalService.getTaskAssignees('token');
  expect(call).toHaveBeenCalledWith('/principal/task-assignees', {
    token: 'token',
  });
});

test('task create cannot forward unexpected internal fields even from an untyped caller', async () => {
  const call = jest
    .spyOn(apiClient, 'request')
    .mockResolvedValue({ data: { _id: 'task' }, message: 'Created' });
  const input = {
    title: 'New task',
    assignedTo: 'teacher',
    priority: 'normal',
    dueDate: '2000-01-02',
    branchId: 'foreign',
    createdBy: 'other',
    status: 'completed',
    completedAt: 'now',
    history: [],
  };
  await principalService.createTask('token', input as CreateTaskInput);
  expect(call).toHaveBeenCalledWith('/principal/tasks', {
    token: 'token',
    method: 'POST',
    body: {
      title: 'New task',
      assignedTo: 'teacher',
      priority: 'normal',
      dueDate: '2000-01-02',
    },
  });
});

test.each(['start', 'complete', 'cancel'] as const)(
  'task %s sends action only',
  async action => {
    const call = jest
      .spyOn(apiClient, 'request')
      .mockResolvedValue({ data: { _id: 'task' }, message: 'Confirmed' });
    await principalService.processTask('token', 'task', action);
    expect(call).toHaveBeenCalledWith('/principal/tasks/task', {
      method: 'PATCH',
      token: 'token',
      body: { action },
    });
  },
);

test('task detail uses the selected record ID', async () => {
  const call = jest
    .spyOn(apiClient, 'request')
    .mockResolvedValue({ data: { _id: 'task' }, message: '' });
  await principalService.getTask('token', 'task');
  expect(call).toHaveBeenCalledWith('/principal/tasks/task', {
    token: 'token',
  });
});
