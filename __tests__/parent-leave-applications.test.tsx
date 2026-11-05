import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import Screen from '../src/screens/parent/ParentLeaveApplicationsScreen';
import ParentNavigator from '../src/navigation/ParentNavigator';
import ParentWorkspaceScreen from '../src/screens/parent/ParentWorkspaceScreen';
import { Button, WorkspaceTabs } from '../src/components/hiraDashboard';
import { ApiError } from '../src/services/api/apiClient';
import type { User } from '../src/types/auth';
import type { VerifiedChild } from '../src/services/parent/parentService';
import { parentService } from '../src/services/parent/parentService';
import type {
  LeaveDraft,
  LeavePage,
  LeaveTransport,
} from '../src/services/parent/leaveApplicationService';

let mockUser: User | null, mockToken: string | null;
const mockLogout = jest.fn(),
  mockNavigate = jest.fn();
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    accessToken: mockToken,
    logout: mockLogout,
  }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(effect, [effect]);
  },
}));
jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: 'StackNavigator',
    Screen: 'StackScreen',
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../src/services/parent/parentService', () => ({
  parentService: { me: jest.fn(), children: jest.fn() },
}));
const transport: jest.Mocked<LeaveTransport> = {
  list: jest.fn(),
  detail: jest.fn(),
  create: jest.fn(),
  edit: jest.fn(),
  submit: jest.fn(),
  withdraw: jest.fn(),
};
const childrenTransport = { children: jest.fn() };
const operationId = jest.fn();
const child = (id: string): VerifiedChild => ({
  studentId: id,
  fullName: `Child ${id}`,
  email: `${id}@test.invalid`,
  admissionNumber: id,
  relationship: 'guardian',
  enrollment: {
    enrollmentId: id,
    status: 'active',
    effectiveFrom: '2026-01-01',
    branch: { id: 'branch', name: 'Own Branch' },
    schoolClass: { id: 'class', name: 'Grade 8' },
    section: { id: 'section', name: 'A' },
    academicPeriod: { id: 'term', name: 'Term' },
  },
});
const draft = (
  id = 'draft-A',
  patch: Partial<LeaveDraft> = {},
): LeaveDraft => ({
  applicationId: id,
  studentId: 'A',
  state: 'draft',
  leaveType: 'Family leave',
  startDate: '2026-11-04',
  endDate: '2026-11-05',
  reason: `PRIVATE ${id}`,
  revision: 0,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  history: [
    { action: 'draft_created', revision: 0, at: '2026-11-01T10:00:00.000Z' },
  ],
  ...patch,
});
const page = (id = 'draft-A'): LeavePage => {
  const value = draft(id);
  const summary = {
    applicationId: value.applicationId,
    studentId: value.studentId,
    state: value.state,
    leaveType: value.leaveType,
    startDate: value.startDate,
    endDate: value.endDate,
    revision: value.revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
  return { items: [summary], total: 1, offset: 0, limit: 25 };
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void, reject!: (failure: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
let tree: Renderer.ReactTestRenderer;
const element = () => (
  <Screen
    transport={transport}
    childrenTransport={childrenTransport}
    operationId={operationId}
  />
);
async function mount(component = element()) {
  await act(async () => {
    tree = Renderer.create(component);
  });
}
const text = () => JSON.stringify(tree.toJSON());
const button = (title: string) =>
  tree.root.findAllByType(Button).find(node => node.props.title === title)!;
async function press(title: string) {
  await act(async () => {
    const node = button(title);
    expect(node).toBeDefined();
    expect(node.props.disabled).not.toBe(true);
    await node.props.onPress();
  });
}
async function change(label: string, value: string) {
  await act(async () =>
    tree.root
      .findAllByType(TextInput)
      .find(node => node.props.accessibilityLabel === label)!
      .props.onChangeText(value),
  );
}
async function fill() {
  for (const [label, value] of [
    ['Leave type', 'Family leave'],
    ['Start date', '2026-11-04'],
    ['End date', '2026-11-05'],
    ['Private reason', 'Private family reason'],
  ])
    await change(label, value);
}
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = {
    id: 'parent-A',
    role: 'parent',
    fullName: 'Parent',
    email: 'parent@test.invalid',
    branchId: 'branch',
  };
  mockToken = 'token-A';
  childrenTransport.children.mockResolvedValue({
    items: [child('A'), child('B')],
  });
  transport.list.mockReset().mockResolvedValue(page());
  transport.detail.mockReset().mockResolvedValue(draft());
  transport.create.mockReset().mockResolvedValue({
    applicationId: 'new-draft',
    replayed: false,
    application: draft('new-draft'),
  });
  transport.edit.mockReset().mockResolvedValue({
    applicationId: 'draft-A',
    replayed: false,
    operationRevision: 1,
    application: draft('draft-A', { revision: 1 }),
  });
  transport.submit.mockReset().mockResolvedValue(lifecycleResult('pending'));
  transport.withdraw
    .mockReset()
    .mockResolvedValue(lifecycleResult('withdrawn'));
  operationId
    .mockReset()
    .mockReturnValueOnce('operation-1')
    .mockReturnValue('operation-next');
  mockLogout.mockResolvedValue(undefined);
});
function lifecycleResult(state: 'pending' | 'withdrawn') {
  const value = draft();
  const history = [
    ...value.history,
    { action: 'submitted' as const, revision: 1, at: value.updatedAt },
  ];
  const revision = state === 'pending' ? 1 : 2;
  return {
    applicationId: value.applicationId,
    operationRevision: revision,
    operationState: state,
    replayed: false,
    application: {
      ...value,
      state,
      revision,
      history:
        state === 'pending'
          ? history
          : [
              ...history,
              {
                action: 'withdrawn' as const,
                revision,
                at: value.updatedAt,
              },
            ],
    },
  };
}
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
});

test('saved drafts require confirmation and show pending and withdrawn only after server responses', async () => {
  await mount();
  await press('Open draft draft-A');
  await press('Submit for Approval');
  expect(transport.submit).not.toHaveBeenCalled();
  expect(text()).not.toContain('Application submitted for approval.');
  await press('Cancel');
  expect(button('Confirm submission')).toBeUndefined();
  await press('Submit for Approval');
  await press('Confirm submission');
  expect(transport.submit).toHaveBeenCalledWith(
    'token-A',
    'A',
    'draft-A',
    0,
    'operation-1',
  );
  expect(text()).toContain('Application submitted for approval.');
  expect(text()).toContain('Pending');
  expect(button('Save draft')).toBeUndefined();
  await press('Withdraw');
  expect(transport.withdraw).not.toHaveBeenCalled();
  await press('Confirm withdrawal');
  expect(transport.withdraw).toHaveBeenCalledWith(
    'token-A',
    'A',
    'draft-A',
    1,
    'operation-next',
  );
  expect(text()).toContain('Application withdrawn.');
  expect(text()).toContain('Application history');
  expect(button('Withdraw')).toBeUndefined();
});

test('unsaved edits cannot be submitted and uncertain submission reuses the same operation', async () => {
  transport.submit.mockRejectedValueOnce(new Error('network failure'));
  await mount();
  await press('Open draft draft-A');
  await change('Private reason', 'Changed locally');
  expect(button('Submit for Approval').props.disabled).toBe(true);
  await press('Reload draft');
  await press('Submit for Approval');
  await press('Confirm submission');
  expect(text()).not.toContain('Application submitted for approval.');
  await press('Retry action');
  expect(transport.submit.mock.calls[0]).toEqual(
    transport.submit.mock.calls[1],
  );
  expect(text()).toContain('Application submitted for approval.');
});

test('withdrawal conflict requires reload and does not report success', async () => {
  transport.detail.mockResolvedValue(lifecycleResult('pending').application);
  transport.withdraw.mockRejectedValueOnce(
    new ApiError(409, 'Application changed'),
  );
  await mount();
  await press('Open draft draft-A');
  await press('Withdraw');
  await press('Confirm withdrawal');
  expect(text()).not.toContain('Application withdrawn.');
  expect(button('Withdraw').props.disabled).toBe(true);
  await press('Reload application');
  expect(button('Withdraw').props.disabled).not.toBe(true);
});

for (const status of [401, 403, 404]) {
  test(`current lifecycle denial ${status} conceals private detail`, async () => {
    transport.submit.mockRejectedValueOnce(new ApiError(status, 'Denied'));
    await mount();
    await press('Open draft draft-A');
    await press('Submit for Approval');
    await press('Confirm submission');
    expect(text()).not.toContain('PRIVATE draft-A');
    expect(text()).not.toContain('Application submitted for approval.');
    expect(button('Confirm submission')).toBeUndefined();
  });
}

for (const scope of ['child', 'account', 'token', 'branch'] as const) {
  test(`late submission response cannot publish into a new ${scope} scope`, async () => {
    const slow = deferred<Awaited<ReturnType<LeaveTransport['submit']>>>();
    transport.submit.mockReturnValueOnce(slow.promise);
    await mount();
    await press('Open draft draft-A');
    await press('Submit for Approval');
    await act(async () => {
      button('Confirm submission').props.onPress();
    });
    if (scope === 'child') {
      await act(async () => {
        const tabs = tree.root.findByType(WorkspaceTabs);
        tabs.props.onSelect(tabs.props.items[1]);
      });
    } else {
      if (scope === 'account') mockUser = { ...mockUser!, id: 'parent-B' };
      if (scope === 'token') mockToken = 'token-B';
      if (scope === 'branch') mockUser = { ...mockUser!, branchId: 'other' };
      await act(async () => {
        tree.update(element());
      });
    }
    await act(async () => {
      slow.resolve(lifecycleResult('pending'));
    });
    expect(text()).not.toContain('Application submitted for approval.');
    expect(text()).not.toContain('PRIVATE draft-A');
  });
}

test('verified child list, Draft status and private details/history load only on open', async () => {
  await mount();
  expect(transport.list).toHaveBeenCalledWith('token-A', 'A', 0);
  expect(text()).toContain('Draft');
  expect(text()).not.toContain('PRIVATE draft-A');
  await press('Open draft draft-A');
  expect(text()).toContain('PRIVATE draft-A');
  expect(text()).toContain('Draft history');
  expect(transport.detail).toHaveBeenCalledWith('token-A', 'A', 'draft-A');
  for (const title of ['Submit', 'Approve', 'Withdraw'])
    expect(button(title)).toBeUndefined();
});
test('field feedback blocks invalid date ranges and missing required fields', async () => {
  await mount();
  await press('New leave draft');
  await press('Save draft');
  expect(text()).toContain('Enter a leave type');
  expect(transport.create).not.toHaveBeenCalled();
  await fill();
  await change('End date', '2026-02-30');
  await press('Save draft');
  expect(text()).toContain('Enter a valid date');
  expect(transport.create).not.toHaveBeenCalled();
  await change('End date', '2026-01-01');
  await press('Save draft');
  expect(text()).toContain('End date must be');
});
test('save draft confirms server state and edit uses the loaded revision', async () => {
  await mount();
  await press('New leave draft');
  await fill();
  await press('Save draft');
  expect(transport.create).toHaveBeenCalledWith(
    'token-A',
    'A',
    {
      leaveType: 'Family leave',
      startDate: '2026-11-04',
      endDate: '2026-11-05',
      reason: 'Private family reason',
    },
    'operation-1',
  );
  expect(text()).toContain('Draft saved. It has not been submitted.');
  await change('Private reason', 'Edited reason');
  await press('Save draft');
  expect(transport.edit.mock.calls[0][2]).toBe('new-draft');
  expect(transport.edit.mock.calls[0][4]).toBe(0);
});
test('uncertain create retries the identical payload/operation; double tap creates once', async () => {
  transport.create.mockRejectedValueOnce(new Error('network failure'));
  await mount();
  await press('New leave draft');
  await fill();
  await press('Save draft');
  expect(text()).toContain('Save not confirmed');
  expect(button('Close editor').props.disabled).toBe(true);
  expect(
    tree.root
      .findAllByType(TextInput)
      .every(node => node.props.editable === false),
  ).toBe(true);
  await press('Retry save');
  expect(transport.create.mock.calls[0]).toEqual(
    transport.create.mock.calls[1],
  );
  expect(operationId).toHaveBeenCalledTimes(1);
});
test('simultaneous Save presses are guarded before React state commits', async () => {
  const slow = deferred<Awaited<ReturnType<LeaveTransport['create']>>>();
  transport.create.mockReturnValue(slow.promise);
  await mount();
  await press('New leave draft');
  await fill();
  const save = button('Save draft').props.onPress;
  await act(async () => {
    save();
    save();
  });
  expect(transport.create).toHaveBeenCalledTimes(1);
  await act(async () =>
    slow.resolve({
      applicationId: 'saved',
      replayed: false,
      application: draft('saved'),
    }),
  );
});
test('edit timeout retries original revision and receipt; conflict requires reload', async () => {
  transport.edit.mockRejectedValueOnce(new Error('timeout'));
  await mount();
  await press('Open draft draft-A');
  await change('Private reason', 'Edited');
  await press('Save draft');
  await press('Retry save');
  expect(transport.edit.mock.calls[0]).toEqual(transport.edit.mock.calls[1]);
  transport.edit.mockRejectedValueOnce(new ApiError(409, 'Conflict'));
  await press('Save draft');
  expect(button('Save draft').props.disabled).toBe(true);
  expect(text()).toContain('Reload it');
  await press('Reload draft');
  expect(button('Save draft').props.disabled).toBe(false);
});
test('confirmed save followed by list failure never reports an unconfirmed save or repeats the write', async () => {
  await mount();
  await press('New leave draft');
  await fill();
  transport.list.mockRejectedValueOnce(new Error('offline'));
  await press('Save draft');
  expect(text()).toContain('Draft saved, but the list could not refresh');
  expect(button('Retry save')).toBeUndefined();
  await press('Close editor');
  await press('Refresh drafts');
  expect(transport.create).toHaveBeenCalledTimes(1);
});
test('secure operation ID failure never claims a draft was saved', async () => {
  operationId.mockReset().mockImplementation(() => {
    throw new Error('unavailable native randomness');
  });
  await mount();
  await press('New leave draft');
  await fill();
  await press('Save draft');
  expect(text()).toContain('Could not start a secure save');
  expect(text()).not.toContain('Draft saved');
  expect(transport.create).not.toHaveBeenCalled();
});
for (const status of [401, 403, 404]) {
  test(`current list ${status} clears protected summaries`, async () => {
    await mount();
    transport.list.mockRejectedValueOnce(new ApiError(status, 'Denied'));
    await press('Refresh drafts');
    expect(text()).not.toContain('Family leave');
    expect(text()).not.toContain('Child A');
  });
  test(`current detail ${status} clears cached summaries and private editor`, async () => {
    await mount();
    await press('Open draft draft-A');
    transport.detail.mockRejectedValueOnce(new ApiError(status, 'Denied'));
    await press('Reload draft');
    expect(text()).not.toContain('Family leave');
    expect(text()).not.toContain('PRIVATE');
    expect(text()).not.toContain('Child A');
    if (status === 401) expect(mockLogout).toHaveBeenCalledTimes(1);
  });
  test(`current save ${status} conceals entered private data`, async () => {
    await mount();
    await press('New leave draft');
    await fill();
    transport.create.mockRejectedValueOnce(new ApiError(status, 'Denied'));
    await press('Save draft');
    expect(text()).not.toContain('Private family reason');
    expect(text()).not.toContain('Family leave');
  });
}
test('switching children immediately drops private state and ignores a late detail', async () => {
  const slow = deferred<LeaveDraft>();
  transport.detail.mockReturnValueOnce(slow.promise);
  await mount();
  await act(async () => {
    button('Open draft draft-A').props.onPress();
  });
  await act(async () =>
    tree.root
      .findByType(WorkspaceTabs)
      .props.onSelect('Child B · Own Branch · Grade 8 A'),
  );
  expect(transport.list).toHaveBeenLastCalledWith('token-A', 'B', 0);
  await act(async () => slow.resolve(draft('OLD SECRET')));
  expect(text()).not.toContain('OLD SECRET');
});
for (const scope of ['account', 'token', 'branch', 'role'] as const) {
  test(`${scope} change drops data; late old denial cannot clear newer account`, async () => {
    const slow = deferred<LeaveDraft>();
    await mount();
    transport.detail.mockReturnValueOnce(slow.promise);
    await act(async () => {
      button('Open draft draft-A').props.onPress();
    });
    if (scope === 'account') mockUser = { ...mockUser!, id: 'parent-B' };
    if (scope === 'token') mockToken = 'token-B';
    if (scope === 'branch') mockUser = { ...mockUser!, branchId: 'new-branch' };
    if (scope === 'role') mockUser = { ...mockUser!, role: 'student' };
    transport.list.mockResolvedValue(page('NEW ACCOUNT'));
    await act(async () => tree.update(element()));
    await act(async () => slow.reject(new ApiError(401, 'Old session denied')));
    expect(mockLogout).not.toHaveBeenCalled();
    if (scope === 'role') expect(text()).not.toContain('NEW ACCOUNT');
    else expect(text()).toContain('NEW ACCOUNT');
  });
}
test('late save from old child cannot populate or clear the new child', async () => {
  const slow = deferred<Awaited<ReturnType<LeaveTransport['create']>>>();
  transport.create.mockReturnValueOnce(slow.promise);
  await mount();
  await press('New leave draft');
  await fill();
  await act(async () => {
    button('Save draft').props.onPress();
  });
  await act(async () =>
    tree.root
      .findByType(WorkspaceTabs)
      .props.onSelect('Child B · Own Branch · Grade 8 A'),
  );
  await act(async () =>
    slow.resolve({
      applicationId: 'OLD SECRET',
      replayed: false,
      application: draft('OLD SECRET'),
    }),
  );
  expect(text()).not.toContain('OLD SECRET');
  expect(text()).not.toContain('Private family reason');
});
test('loading, empty, retry and unauthenticated states are honest', async () => {
  childrenTransport.children.mockResolvedValueOnce({ items: [] });
  await mount();
  expect(text()).toContain('No verified children');
  childrenTransport.children.mockRejectedValueOnce(new Error('offline'));
  await press('Refresh verified children');
  expect(text()).toContain('Could not load verified children');
  await press('Refresh verified children');
  expect(text()).toContain('Child A');
  mockUser = null;
  mockToken = null;
  await act(async () => tree.update(element()));
  expect(text()).toContain('Session unavailable');
  expect(text()).not.toContain('Family leave');
});
test('Parent navigation registers and opens the leave screen', async () => {
  await mount(<ParentNavigator />);
  expect(text()).toContain('ParentLeaveApplications');
  await act(async () => tree.unmount());
  jest.mocked(parentService.children).mockResolvedValue({ items: [] });
  jest.mocked(parentService.me).mockResolvedValue({ fullName: 'Parent' });
  await mount(<ParentWorkspaceScreen />);
  await press('Leave applications');
  expect(mockNavigate).toHaveBeenCalledWith('ParentLeaveApplications');
});
