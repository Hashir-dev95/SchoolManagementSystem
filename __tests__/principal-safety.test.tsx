import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Button } from '../src/components/hiraDashboard';
import { DashboardShell } from '../src/components/hiraDashboard/DashboardShell';
import PrincipalSafetyOverviewScreen from '../src/screens/principal/PrincipalSafetyOverviewScreen';
import PrincipalSafetyDetailScreen from '../src/screens/principal/PrincipalSafetyDetailScreen';
import { ApiError } from '../src/services/api/apiClient';
import {
  SafetyAlert,
  principalService,
} from '../src/services/principal/principalService';

jest.mock('../src/services/principal/principalService', () => ({
  principalService: {
    getSafetyAlerts: jest.fn(),
    getSafetyAlert: jest.fn(),
    getSafetyOfficers: jest.fn(),
    processSafetyAlert: jest.fn(),
  },
}));
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ accessToken: 'token' }),
}));
jest.mock('../src/components/hiraDashboard/DashboardShell', () => ({
  DashboardShell: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@react-navigation/native', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useFocusEffect: function useFocusEffect(effect: () => void | (() => void)) {
      useEffect(() => effect(), [effect]);
    },
  };
});
const service = jest.mocked(principalService);
const officer = { _id: 'teacher', fullName: 'Teacher One', role: 'teacher' };
const alert: SafetyAlert = {
  id: 'alert',
  title: 'Attendance gap',
  type: 'missing_attendance',
  description: 'Check register',
  severity: 'high',
  status: 'open',
  assignedTo: null,
  createdAt: '2026-10-12T00:00:00Z',
  updatedAt: '2026-10-12T00:00:00Z',
  history: [],
  capabilities: {
    allowedActions: ['assign', 'resolve', 'escalate'],
    canViewDetail: true,
  },
};
const resolved: SafetyAlert = {
  ...alert,
  status: 'resolved',
  resolvedAt: '2026-10-12T12:00:00Z',
  capabilities: { allowedActions: [], canViewDetail: true },
};
const navigation = { navigate: jest.fn(), goBack: jest.fn() };
const trees: Renderer.ReactTestRenderer[] = [];
async function mount(element: React.ReactElement) {
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(element);
  });
  trees.push(tree);
  return tree;
}
const button = (tree: Renderer.ReactTestRenderer, title: string) =>
  tree.root.findAllByType(Button).find(item => item.props.title === title);
async function press(tree: Renderer.ReactTestRenderer, title: string) {
  const target = button(tree, title)!;
  expect(target).toBeDefined();
  expect(target.props.disabled).toBeFalsy();
  await act(async () => {
    await target.props.onPress();
  });
}
const contents = (tree: Renderer.ReactTestRenderer) =>
  JSON.stringify(tree.toJSON());
const list = () => (
  <PrincipalSafetyOverviewScreen
    navigation={navigation as never}
    route={{} as never}
  />
);
const detail = () => (
  <PrincipalSafetyDetailScreen
    navigation={navigation as never}
    route={{ params: { alertId: 'alert' } } as never}
  />
);
beforeEach(() => {
  jest.resetAllMocks();
  service.getSafetyAlerts.mockResolvedValue({ data: [alert], message: '' });
  service.getSafetyAlert.mockResolvedValue({ data: alert, message: '' });
  service.getSafetyOfficers.mockResolvedValue({ data: [officer], message: '' });
  service.processSafetyAlert.mockResolvedValue({
    data: resolved,
    message: 'Confirmed by server',
  });
});
afterEach(async () => {
  await act(async () => {
    for (const tree of trees.splice(0)) tree.unmount();
  });
});

test('overview loading then populated records display branch fields and navigate with alert ID', async () => {
  let finish!: (value: { data: SafetyAlert[]; message: string }) => void;
  service.getSafetyAlerts.mockReturnValueOnce(
    new Promise(resolve => {
      finish = resolve;
    }),
  );
  const tree = await mount(list());
  expect(contents(tree)).toContain('Loading safety alerts');
  await act(async () => {
    finish({ data: [alert], message: '' });
  });
  expect(contents(tree)).toContain('Attendance gap');
  expect(contents(tree)).toContain('Missing attendance');
  expect(contents(tree)).toContain('High');
  await press(tree, 'Open alert: Attendance gap');
  expect(navigation.navigate).toHaveBeenCalledWith('SafetyDetail', {
    alertId: 'alert',
  });
});
test('overview empty and error states provide truthful retry', async () => {
  service.getSafetyAlerts.mockRejectedValueOnce(new ApiError(403, 'Denied'));
  const tree = await mount(list());
  expect(contents(tree)).toContain('(403)');
  service.getSafetyAlerts.mockResolvedValueOnce({ data: [], message: '' });
  await press(tree, 'Retry safety alerts');
  expect(contents(tree)).toContain('No safety alerts match');
});
test('overview filters survive pull-to-refresh and back keeps navigation context', async () => {
  const tree = await mount(list());
  await press(tree, 'In progress');
  await press(tree, 'Critical');
  await press(tree, 'Helpdesk');
  const filters = {
    status: 'in_progress',
    severity: 'critical',
    type: 'helpdesk',
  };
  expect(service.getSafetyAlerts).toHaveBeenLastCalledWith('token', filters);
  await act(async () => {
    await tree.root.findByType(DashboardShell).props.onRefresh();
  });
  expect(service.getSafetyAlerts).toHaveBeenLastCalledWith('token', filters);
  await press(tree, 'Back');
  expect(navigation.goBack).toHaveBeenCalled();
});
test('overview hides detail action without server capability', async () => {
  service.getSafetyAlerts.mockResolvedValue({
    data: [
      { ...alert, capabilities: { allowedActions: [], canViewDetail: false } },
    ],
    message: '',
  });
  const tree = await mount(list());
  expect(button(tree, 'Open alert: Attendance gap')).toBeUndefined();
  expect(contents(tree)).toContain('safety-view permission');
});
test('detail displays description scoped identities history and no invented affected-record link', async () => {
  service.getSafetyAlert.mockResolvedValue({
    data: {
      ...alert,
      history: [
        {
          _id: 'history',
          action: 'assign',
          createdAt: alert.createdAt,
          performer: {
            id: 'principal',
            fullName: 'Principal One',
            role: 'principal',
          },
          assignedOfficer: {
            id: 'teacher',
            fullName: 'Teacher One',
            role: 'teacher',
          },
        },
      ],
    },
    message: '',
  });
  const tree = await mount(detail());
  expect(contents(tree)).toContain('Check register');
  expect(contents(tree)).toContain('Principal One');
  expect(contents(tree)).toContain('Teacher One');
  expect(contents(tree)).toContain('No affected-record reference');
  expect(button(tree, 'Open affected record')).toBeUndefined();
});
test('assign form loads eligible officers requires selection and updates confirmed state', async () => {
  service.processSafetyAlert.mockResolvedValue({
    data: {
      ...alert,
      status: 'in_progress',
      assignedTo: { id: 'teacher', fullName: 'Teacher One', role: 'teacher' },
    },
    message: 'Officer assigned',
  });
  const tree = await mount(detail());
  await press(tree, 'Assign officer');
  expect(service.getSafetyOfficers).toHaveBeenCalledWith('token', 'alert');
  expect(button(tree, 'Confirm officer')!.props.disabled).toBeTruthy();
  await press(tree, 'Select Teacher One (Teacher)');
  await press(tree, 'Confirm officer');
  expect(service.processSafetyAlert).toHaveBeenCalledWith(
    'token',
    'alert',
    'assign',
    'teacher',
  );
  expect(contents(tree)).toContain('Officer assigned');
  expect(contents(tree)).toContain('Teacher One');
  expect(button(tree, 'Confirm officer')).toBeUndefined();
});
test('no eligible officers cannot submit and cancel restores decision actions', async () => {
  service.getSafetyOfficers.mockResolvedValue({ data: [], message: '' });
  const tree = await mount(detail());
  await press(tree, 'Assign officer');
  expect(contents(tree)).toContain('No eligible officers');
  expect(button(tree, 'Confirm officer')!.props.disabled).toBeTruthy();
  await press(tree, 'Cancel assignment');
  expect(button(tree, 'Review resolution')!.props.disabled).toBeFalsy();
});
test('officer fetch failure is retryable without sending mutation', async () => {
  service.getSafetyOfficers.mockRejectedValueOnce(
    new ApiError(404, 'Officer unavailable'),
  );
  const tree = await mount(detail());
  await press(tree, 'Assign officer');
  expect(contents(tree)).toContain('(404)');
  await press(tree, 'Retry officers');
  expect(button(tree, 'Select Teacher One (Teacher)')).toBeDefined();
  expect(service.processSafetyAlert).not.toHaveBeenCalled();
});
test('resolution review explicitly finalizes only after backend confirms', async () => {
  const tree = await mount(detail());
  await press(tree, 'Review resolution');
  expect(contents(tree)).toContain('finalizes this alert');
  expect(service.processSafetyAlert).not.toHaveBeenCalled();
  await press(tree, 'Mark resolved');
  expect(service.processSafetyAlert).toHaveBeenCalledWith(
    'token',
    'alert',
    'resolve',
    undefined,
  );
  expect(contents(tree)).toContain('Confirmed by server');
  expect(contents(tree)).toContain('Resolved');
  expect(button(tree, 'Assign officer')).toBeUndefined();
  expect(button(tree, 'Escalate')).toBeUndefined();
});
test('escalation updates confirmed severity and hides repeated escalation', async () => {
  service.processSafetyAlert.mockResolvedValue({
    data: {
      ...alert,
      severity: 'critical',
      status: 'in_progress',
      capabilities: {
        allowedActions: ['assign', 'resolve'],
        canViewDetail: true,
      },
    },
    message: 'Escalated',
  });
  const tree = await mount(detail());
  await press(tree, 'Escalate');
  expect(service.processSafetyAlert).toHaveBeenCalledWith(
    'token',
    'alert',
    'escalate',
    undefined,
  );
  expect(contents(tree)).toContain('Critical');
  expect(button(tree, 'Escalate')).toBeUndefined();
});
test.each([400, 401, 403, 404, 409])(
  'action error %s refreshes confirmed state and clears assignment mode',
  async status => {
    const tree = await mount(detail());
    await press(tree, 'Assign officer');
    await press(tree, 'Select Teacher One (Teacher)');
    service.processSafetyAlert.mockRejectedValueOnce(
      new ApiError(status, 'Action rejected'),
    );
    service.getSafetyAlert.mockResolvedValueOnce({
      ...{
        data: {
          ...alert,
          capabilities: { allowedActions: ['resolve'], canViewDetail: true },
        },
        message: '',
      },
    });
    await press(tree, 'Confirm officer');
    expect(contents(tree)).toContain(`(${status})`);
    expect(contents(tree)).not.toContain('Confirmed by server');
    expect(button(tree, 'Confirm officer')).toBeUndefined();
    expect(button(tree, 'Review resolution')!.props.disabled).toBeFalsy();
  },
);
test('409 refresh to resolved removes stale actions', async () => {
  const tree = await mount(detail());
  service.processSafetyAlert.mockRejectedValueOnce(
    new ApiError(409, 'Already resolved'),
  );
  service.getSafetyAlert.mockResolvedValueOnce({ data: resolved, message: '' });
  await press(tree, 'Escalate');
  expect(button(tree, 'Review resolution')).toBeUndefined();
  expect(button(tree, 'Assign officer')).toBeUndefined();
});
test('uncertain network action reports ambiguity and refreshes without automatic retry', async () => {
  const tree = await mount(detail());
  service.processSafetyAlert.mockRejectedValueOnce(
    new Error('Network unavailable'),
  );
  service.getSafetyAlert.mockResolvedValueOnce({ data: resolved, message: '' });
  await press(tree, 'Escalate');
  expect(contents(tree)).toContain('may have reached the server');
  expect(service.processSafetyAlert).toHaveBeenCalledTimes(1);
  expect(button(tree, 'Escalate')).toBeUndefined();
});
test('failed reconciliation hides stale detail and actions until retry succeeds', async () => {
  const tree = await mount(detail());
  service.processSafetyAlert.mockRejectedValueOnce(
    new ApiError(409, 'Changed'),
  );
  service.getSafetyAlert.mockRejectedValueOnce(new Error('Offline'));
  await press(tree, 'Escalate');
  expect(button(tree, 'Escalate')).toBeUndefined();
  expect(button(tree, 'Retry alert')).toBeDefined();
  await press(tree, 'Retry alert');
  expect(button(tree, 'Escalate')).toBeDefined();
});
test('duplicate action calls from the same render are locked until confirmation', async () => {
  let finish!: (value: { data: SafetyAlert; message: string }) => void;
  service.processSafetyAlert.mockReturnValueOnce(
    new Promise(resolve => {
      finish = resolve;
    }),
  );
  const tree = await mount(detail());
  const handler = button(tree, 'Escalate')!.props.onPress;
  await act(async () => {
    handler();
    handler();
  });
  expect(service.processSafetyAlert).toHaveBeenCalledTimes(1);
  expect(button(tree, 'Escalate')!.props.disabled).toBeTruthy();
  expect(contents(tree)).not.toContain('Confirmed by server');
  await act(async () => {
    finish({ data: resolved, message: 'Confirmed by server' });
  });
  expect(contents(tree)).toContain('Confirmed by server');
});
test('detail refresh applies new state and preserves navigation record ID', async () => {
  const tree = await mount(detail());
  service.getSafetyAlert.mockResolvedValueOnce({ data: resolved, message: '' });
  await act(async () => {
    await tree.root.findByType(DashboardShell).props.onRefresh();
  });
  expect(service.getSafetyAlert).toHaveBeenLastCalledWith('token', 'alert');
  expect(button(tree, 'Review resolution')).toBeUndefined();
  await press(tree, 'Back to safety overview');
  expect(navigation.goBack).toHaveBeenCalled();
});
