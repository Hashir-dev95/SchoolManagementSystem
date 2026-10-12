import React from 'react';
import { TextInput } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import { Button } from '../src/components/hiraDashboard';
import ApprovalDelegationForm from '../src/screens/principal/ApprovalDelegationForm';
import ApprovalDetailScreen from '../src/screens/principal/ApprovalDetailScreen';
import { ApiError } from '../src/services/api/apiClient';
import {
  ApprovalRequest,
  principalService,
} from '../src/services/principal/principalService';

jest.mock('../src/services/principal/principalService', () => ({
  principalService: {
    getEligibleDelegates: jest.fn(),
    processApproval: jest.fn(),
    getApprovalById: jest.fn(),
    getPendingApprovals: jest.fn(),
  },
}));
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ accessToken: 'token' }),
}));
jest.mock('../src/components/hiraDashboard/DashboardShell', () => ({
  DashboardShell: ({ children }: { children: React.ReactNode }) => children,
}));

const service = jest.mocked(principalService);
const request: ApprovalRequest = {
  _id: 'request',
  requesterId: 'Requester',
  entityType: 'student',
  approvalType: 'leave',
  reason: 'Leave request',
  status: 'pending',
  history: [],
  createdAt: '',
  updatedAt: '',
  capabilities: { canReview: true, canDelegate: true },
};
const updated: ApprovalRequest = {
  ...request,
  delegatedTo: {
    _id: 'peer',
    fullName: 'Peer Principal',
    email: '',
    role: 'principal',
  },
  delegationExpiresAt: '2099-01-01T00:00:00.000Z',
  history: [
    {
      action: 'delegated',
      performedBy: 'Reviewer',
      authority: 'direct',
      createdAt: '2026-10-12T00:00:00Z',
    },
  ],
  capabilities: { canReview: true, canDelegate: false },
};
const trees: Renderer.ReactTestRenderer[] = [];
async function mount(element: React.ReactElement) {
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(element);
  });
  trees.push(tree);
  return tree;
}
function button(tree: Renderer.ReactTestRenderer, title: string) {
  return tree.root
    .findAllByType(Button)
    .find(item => item.props.title === title)!;
}
async function press(tree: Renderer.ReactTestRenderer, title: string) {
  const target = button(tree, title);
  expect(target).toBeDefined();
  expect(target.props.disabled).toBeFalsy();
  await act(async () => {
    await target.props.onPress();
  });
}
const contents = (tree: Renderer.ReactTestRenderer) =>
  JSON.stringify(tree.toJSON());
let success: jest.Mock;
let failure: jest.Mock;
const form = () => (
  <ApprovalDelegationForm
    token="token"
    requestId="request"
    onSuccess={success}
    onFailure={failure}
    onCancel={jest.fn()}
    onBusyChange={jest.fn()}
  />
);
const detail = () => (
  <ApprovalDetailScreen
    route={{ params: { request } } as never}
    navigation={{ goBack: jest.fn() } as never}
  />
);

beforeEach(() => {
  jest.resetAllMocks();
  success = jest.fn();
  failure = jest.fn();
  service.getEligibleDelegates.mockResolvedValue({
    data: [{ _id: 'peer', fullName: 'Peer Principal' }],
    message: '',
  });
  service.getApprovalById.mockResolvedValue({ data: request, message: '' });
  service.processApproval.mockResolvedValue({
    data: updated,
    message: 'Delegation confirmed',
  });
});
afterEach(async () => {
  await act(async () => {
    trees.splice(0).forEach(tree => tree.unmount());
  });
  jest.restoreAllMocks();
});

test('Delegate appears only after server confirms pending review and delegation capabilities', async () => {
  const tree = await mount(detail());
  expect(button(tree, 'Delegate')).toBeDefined();
  for (const data of [
    {
      ...request,
      status: 'approved' as const,
      capabilities: { canReview: false, canDelegate: false },
    },
    { ...request, capabilities: { canReview: false, canDelegate: false } },
    { ...updated, capabilities: { canReview: true, canDelegate: false } },
  ]) {
    service.getApprovalById.mockResolvedValue({ data, message: '' });
    const restricted = await mount(detail());
    expect(button(restricted, 'Delegate')).toBeUndefined();
  }
});

test('form requires an eligible Principal and an explicitly chosen future expiry', async () => {
  const tree = await mount(form());
  await press(tree, 'Confirm delegation');
  expect(contents(tree)).toContain('Choose an eligible Principal.');
  await press(tree, 'Peer Principal');
  await press(tree, 'Confirm delegation');
  expect(contents(tree)).toContain('Choose a future delegation expiry.');
  expect(service.processApproval).not.toHaveBeenCalled();
  await press(tree, 'Expire in 1 hour');
  jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 7200000);
  await press(tree, 'Confirm delegation');
  expect(service.processApproval).not.toHaveBeenCalled();
});

test('empty candidates are explained and cannot submit', async () => {
  service.getEligibleDelegates.mockResolvedValue({ data: [], message: '' });
  const tree = await mount(form());
  expect(contents(tree)).toContain('No eligible Principals');
  expect(button(tree, 'Confirm delegation').props.disabled).toBe(true);
});

test('selected candidate and explicit timezone expiry are submitted once while in flight', async () => {
  let resolve!: (result: { data: ApprovalRequest; message: string }) => void;
  service.processApproval.mockReturnValue(
    new Promise(done => {
      resolve = done;
    }),
  );
  const tree = await mount(form());
  await press(tree, 'Peer Principal');
  await press(tree, 'Expire in 4 hours');
  const submit = button(tree, 'Confirm delegation').props.onPress;
  await act(async () => {
    submit();
    submit();
  });
  expect(service.processApproval).toHaveBeenCalledTimes(1);
  const args = service.processApproval.mock.calls[0];
  expect(args.slice(0, 4)).toEqual([
    'token',
    'request',
    'delegated',
    undefined,
  ]);
  expect(args[4]?.delegatedTo).toBe('peer');
  expect(args[4]?.delegationExpiresAt).toMatch(/Z$/);
  expect(new Date(args[4]!.delegationExpiresAt).getTime()).toBeGreaterThan(
    Date.now(),
  );
  expect(button(tree, 'Delegating...').props.disabled).toBe(true);
  expect(button(tree, 'Cancel delegation').props.disabled).toBe(true);
  expect(success).not.toHaveBeenCalled();
  await act(async () => {
    resolve({ data: updated, message: 'Confirmed' });
  });
  expect(success).toHaveBeenCalledWith(updated, 'Confirmed');
});

test.each([400, 403, 404, 409])(
  'backend %i errors retain status and allow refreshing candidates',
  async status => {
    service.processApproval.mockRejectedValue(
      new ApiError(status, 'Backend explanation'),
    );
    const tree = await mount(form());
    await press(tree, 'Peer Principal');
    await press(tree, 'Expire in 1 hour');
    await press(tree, 'Confirm delegation');
    expect(contents(tree)).toContain(`Backend explanation (${status})`);
    expect(success).not.toHaveBeenCalled();
    expect(button(tree, 'Confirm delegation').props.disabled).toBe(true);
    await press(tree, 'Refresh candidates');
    expect(service.getEligibleDelegates).toHaveBeenCalledTimes(2);
  },
);

test('candidate network failure offers retry', async () => {
  service.getEligibleDelegates.mockRejectedValueOnce(
    new Error('Network unavailable'),
  );
  const tree = await mount(form());
  expect(contents(tree)).toContain('Network unavailable');
  await press(tree, 'Refresh candidates');
  expect(button(tree, 'Peer Principal')).toBeDefined();
});

test('mutation network failure does not claim success and requires candidate refresh before retry', async () => {
  service.processApproval.mockRejectedValueOnce(new Error('Network unavailable'));
  const tree = await mount(form());
  await press(tree, 'Peer Principal');
  await press(tree, 'Expire in 1 hour');
  await press(tree, 'Confirm delegation');
  expect(success).not.toHaveBeenCalled();
  expect(contents(tree)).toContain('server may have received the request');
  expect(button(tree, 'Confirm delegation').props.disabled).toBe(true);
  await press(tree, 'Refresh candidates');
  await press(tree, 'Peer Principal');
  await press(tree, 'Confirm delegation');
  expect(service.processApproval).toHaveBeenCalledTimes(2);
  expect(success).toHaveBeenCalledWith(updated, 'Delegation confirmed');
});

test('failed delegation exits delegation mode when refreshed capabilities only permit review', async () => {
  service.getApprovalById
    .mockResolvedValueOnce({ data: request, message: '' })
    .mockResolvedValue({ data: updated, message: '' });
  service.processApproval.mockRejectedValueOnce(
    new ApiError(409, 'Request already has a delegation'),
  );
  const tree = await mount(detail());
  await act(async () => {
    tree.root.findByType(TextInput).props.onChangeText('Decision reason');
  });
  await press(tree, 'Delegate');
  expect(tree.root.findAllByType(ApprovalDelegationForm)).toHaveLength(1);
  expect(button(tree, 'Approve').props.disabled).toBe(true);
  await press(tree, 'Peer Principal');
  await press(tree, 'Expire in 1 hour');
  await press(tree, 'Confirm delegation');
  expect(service.processApproval).toHaveBeenCalledTimes(1);
  expect(service.getApprovalById).toHaveBeenCalledTimes(2);
  expect(contents(tree)).toContain('Request already has a delegation (409)');
  expect(contents(tree)).not.toContain('Delegation confirmed');
  expect(tree.root.findAllByType(ApprovalDelegationForm)).toHaveLength(0);
  expect(button(tree, 'Delegate')).toBeUndefined();
  for (const title of ['Approve', 'Reject', 'Request changes']) {
    expect(button(tree, title).props.disabled).toBe(false);
  }
});

test('confirmed delegation immediately updates detail, expiry and history', async () => {
  service.getApprovalById
    .mockResolvedValueOnce({ data: request, message: '' })
    .mockResolvedValue({ data: updated, message: '' });
  const tree = await mount(detail());
  await press(tree, 'Delegate');
  expect(service.getEligibleDelegates).toHaveBeenCalledWith('token', 'request');
  expect(button(tree, 'Approve').props.disabled).toBe(true);
  await press(tree, 'Peer Principal');
  await press(tree, 'Expire in 24 hours');
  await press(tree, 'Confirm delegation');
  expect(contents(tree)).toContain('Delegation confirmed');
  expect(contents(tree)).toContain('Delegated to');
  expect(contents(tree)).toContain('Peer Principal');
  expect(contents(tree)).toContain('Delegation expires');
  expect(contents(tree)).toContain('Authority: direct');
  expect(button(tree, 'Delegate')).toBeUndefined();
});
