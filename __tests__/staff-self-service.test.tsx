import React from 'react';
import { Text, TextInput } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import TeacherSelfServiceScreen from '../src/screens/teacher/TeacherSelfServiceScreen';
import { Button } from '../src/components/hiraDashboard';
import { AdminSelect } from '../src/components/hiraDashboard/AdminForm';
import { TeacherButton } from '../src/screens/teacher/teacherUi';
import {
  staffSelfService,
  type SelfServiceData,
} from '../src/services/teacher/staffSelfService';
import { ApiError } from '../src/services/api/apiClient';
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(effect, [effect]);
  },
}));
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ accessToken: mockAccessToken, user: { role: 'teacher' } }),
}));
jest.mock('../src/services/teacher/staffSelfService', () => ({
  staffOperationId: () => 'stable_operation_0001',
  staffFilesSupported: () => true,
  staffSelfService: {
    summary: jest.fn(),
    students: jest.fn(),
    leave: jest.fn(),
    slot: jest.fn(),
    change: jest.fn(),
    openFile: jest.fn(),
  },
}));
const service = jest.mocked(staffSelfService);
let mockAccessToken = 'token';
const meeting = {
  appointmentId: 'a1',
  title: 'Family consultation',
  date: '2027-01-04',
  startTime: '10:00',
  endTime: '11:00',
  status: 'available',
  revision: 1,
  studentName: null,
  context: null,
  history: [
    {
      action: 'offered',
      date: '2027-01-04',
      startTime: '10:00',
      endTime: '11:00',
      createdAt: '2026-10-19T10:00:00Z',
    },
  ],
};
const initial = (): SelfServiceData => ({
  leave: {
    items: [],
    balances: [
      {
        leaveType: 'personal',
        available: null,
        approvedDays: 2,
        pendingDays: 1,
      },
    ],
    balancePolicy: 'Not configured',
    cancellationSupported: false,
  },
  payslips: {
    items: [
      {
        payslipId: 'p1',
        period: '2026-09',
        status: 'approved',
        approvedAt: '2026-10-01T10:00:00Z',
        netAmount: 100,
        currency: 'PKR',
        canDownload: true,
      },
    ],
  },
  documents: {
    items: [
      {
        documentId: 'd1',
        title: 'Teaching certificate',
        documentType: 'Certificate',
        expiresOn: '2026-11-01',
        status: 'expiring_soon',
        canDownload: true,
      },
    ],
  },
  appointments: {
    items: [meeting],
    timezone: 'Asia/Karachi',
    today: '2026-10-19',
    time: '12:00',
    parentBookingSupported: false,
  },
});
const trees: Renderer.ReactTestRenderer[] = [];
async function mount() {
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(<TeacherSelfServiceScreen />);
  });
  trees.push(tree);
  return tree;
}
const contents = (t: Renderer.ReactTestRenderer) =>
  t.root
    .findAllByType(Text)
    .map(n => React.Children.toArray(n.props.children).join(''))
    .join(' ');
async function press(t: Renderer.ReactTestRenderer, title: string) {
  await act(async () => {
    const n = t.root.findAllByType(Button).find(b => b.props.title === title);
    if (!n) throw new Error('Missing button ' + title);
    await n.props.onPress();
  });
}
async function field(
  t: Renderer.ReactTestRenderer,
  name: string,
  value: string,
) {
  await act(async () =>
    t.root
      .findAllByType(TextInput)
      .find(n => n.props.accessibilityLabel === name)!
      .props.onChangeText(value),
  );
}
async function fillLeave(t: Renderer.ReactTestRenderer) {
  await field(t, 'Leave start date', '2027-01-04');
  await field(t, 'Leave end date', '2027-01-05');
  await field(t, 'Leave reason', 'Family commitment');
}
beforeEach(() => {
  mockAccessToken = 'token';
  jest.clearAllMocks();
  service.summary.mockResolvedValue(initial());
  service.students.mockResolvedValue({ items: [] });
  service.leave.mockResolvedValue({
    leaveId: 'l1',
    leaveType: 'personal',
    startDate: '2027-01-04',
    endDate: '2027-01-05',
    days: 2,
    reason: 'Family commitment',
    status: 'pending',
    history: [],
  });
  service.slot.mockResolvedValue(meeting);
  service.change.mockResolvedValue({ ...meeting, revision: 2 });
  service.openFile.mockResolvedValue(undefined);
});
afterEach(async () =>
  act(async () => trees.splice(0).forEach(t => t.unmount())),
);
test('summary and unknown balance are truthful', async () => {
  const t = await mount();
  expect(contents(t)).toContain('Staff Self-Service');
  expect(contents(t)).toContain('Available: Not configured');
  expect(contents(t)).toContain('2026-09');
  expect(contents(t)).toContain('No upcoming confirmed meetings.');
});

test('summary skips meetings that have already ended in school time', async () => {
  const data = initial();
  data.appointments.items = [
    { ...meeting, status: 'confirmed', date: data.appointments.today },
  ];
  service.summary.mockResolvedValue(data);
  const t = await mount();
  expect(contents(t)).toContain('No upcoming confirmed meetings.');
});

test('screen invalidates a pending file response when the account changes', async () => {
  let finish!: () => void, isCurrent!: () => boolean;
  service.openFile.mockImplementation((_token, _kind, _id, current) => {
    isCurrent = current!;
    return new Promise<void>(r => {
      finish = r;
    });
  });
  const t = await mount();
  await press(t, 'Payslips');
  let opening!: Promise<unknown>;
  await act(async () => {
    opening = t.root
      .findAllByType(Button)
      .find(n => n.props.title === 'Open payslip 2026-09')!
      .props.onPress();
  });
  expect(isCurrent()).toBe(true);
  await act(async () => {
    mockAccessToken = 'next-token';
    t.update(<TeacherSelfServiceScreen />);
  });
  expect(isCurrent()).toBe(false);
  await act(async () => {
    finish();
    await opening;
  });
  expect(contents(t)).not.toContain('File viewer opened.');
});
test('leave form rejects missing and impossible dates without a request', async () => {
  const t = await mount();
  await press(t, 'Request Leave');
  await press(t, 'Request leave');
  expect(service.leave).not.toHaveBeenCalled();
  expect(contents(t)).toContain('Enter valid leave dates');
  await fillLeave(t);
  await field(t, 'Leave start date', '2027-02-30');
  await press(t, 'Request leave');
  expect(service.leave).not.toHaveBeenCalled();
});
test('leave success is server-confirmed and refreshed status remains pending', async () => {
  const t = await mount();
  await press(t, 'Request Leave');
  await fillLeave(t);
  const next = initial();
  next.leave.items = [
    {
      leaveId: 'l1',
      leaveType: 'personal',
      startDate: '2027-01-04',
      endDate: '2027-01-05',
      days: 2,
      reason: 'Family commitment',
      status: 'pending',
      history: [{ action: 'requested', createdAt: '2026-10-19T10:00:00Z' }],
    },
  ];
  service.summary.mockResolvedValue(next);
  await press(t, 'Request leave');
  expect(service.leave).toHaveBeenCalledWith(
    'token',
    expect.objectContaining({
      clientOperationId: 'stable_operation_0001',
      reason: 'Family commitment',
    }),
  );
  expect(contents(t)).toContain('submitted for approval');
  expect(contents(t)).toContain('pending');
});
test('offline leave retry keeps intent ID and never claims success on failure', async () => {
  const t = await mount();
  service.leave.mockRejectedValueOnce(new Error('Network offline'));
  await press(t, 'Request Leave');
  await fillLeave(t);
  await press(t, 'Request leave');
  expect(contents(t)).toContain('Network offline');
  expect(contents(t)).not.toContain('submitted for approval');
  await press(t, 'Request leave');
  expect(service.leave.mock.calls[0][1]).toEqual(
    service.leave.mock.calls[1][1],
  );
});
test('pending mutation disables submission and duplicate clicks send one request', async () => {
  let done!: (value: any) => void;
  service.leave.mockImplementation(
    () =>
      new Promise(r => {
        done = r;
      }),
  );
  const t = await mount();
  await press(t, 'Request Leave');
  await fillLeave(t);
  const confirm = t.root
    .findAllByType(Button)
    .find(n => n.props.title === 'Request leave')!;
  let first!: Promise<unknown>;
  await act(async () => {
    first = confirm.props.onPress();
    confirm.props.onPress();
  });
  expect(service.leave).toHaveBeenCalledTimes(1);
  expect(
    t.root
      .findAllByType(Button)
      .some(n => n.props.title === 'Saving...' && n.props.disabled),
  ).toBe(true);
  await act(async () => {
    done({});
    await first;
  });
});
test('Payslips shows approved records and opens authenticated file only on action', async () => {
  const t = await mount();
  await press(t, 'Payslips');
  expect(contents(t)).toContain('Net amount: PKR 100');
  expect(service.openFile).not.toHaveBeenCalled();
  await press(t, 'Open payslip 2026-09');
  expect(service.openFile).toHaveBeenCalledWith(
    'token',
    'payslips',
    'p1',
    expect.any(Function),
  );
});
test('defensive approved-only UI hides draft payslip data', async () => {
  const data = initial();
  data.payslips.items.push({
    ...data.payslips.items[0],
    payslipId: 'secret',
    period: 'Draft salary',
    status: 'draft' as never,
  });
  service.summary.mockResolvedValue(data);
  const t = await mount();
  await press(t, 'Payslips');
  expect(contents(t)).not.toContain('Draft salary');
});
test('file failure has no false opened confirmation', async () => {
  const t = await mount();
  service.openFile.mockRejectedValue(new ApiError(404, 'File unavailable'));
  await press(t, 'Payslips');
  await press(t, 'Open payslip 2026-09');
  expect(contents(t)).toContain('File unavailable');
  expect(contents(t)).not.toContain('File viewer opened.');
});
test('Documents shows deterministic expiry status and authorized file action', async () => {
  const t = await mount();
  await press(t, 'Documents');
  expect(contents(t)).toContain('Teaching certificate');
  expect(contents(t)).toContain('expiring soon');
  await press(t, 'Open Teaching certificate');
  expect(service.openFile).toHaveBeenCalledWith(
    'token',
    'documents',
    'd1',
    expect.any(Function),
  );
});
test('Appointments shows school timezone and history', async () => {
  const t = await mount();
  await press(t, 'PTM / Appointments');
  expect(contents(t)).toContain('Asia/Karachi');
  await press(t, 'Meeting history: Family consultation');
  expect(contents(t)).toContain('offered');
});
test('slot validation prevents invalid range', async () => {
  const t = await mount();
  await press(t, 'PTM / Appointments');
  await press(t, 'Offer Slot');
  await press(t, 'Offer slot');
  expect(service.slot).not.toHaveBeenCalled();
  expect(contents(t)).toContain('valid date');
});
async function fillSlot(t: Renderer.ReactTestRenderer) {
  await field(t, 'Meeting title', 'Parent consultation');
  await field(t, 'Meeting date', '2027-01-04');
  await field(t, 'Meeting start time', '12:00');
  await field(t, 'Meeting end time', '13:00');
}
test('offered slot waits for server confirmation', async () => {
  const t = await mount();
  await press(t, 'PTM / Appointments');
  await press(t, 'Offer Slot');
  await fillSlot(t);
  await press(t, 'Offer slot');
  expect(service.slot).toHaveBeenCalledWith(
    'token',
    expect.objectContaining({
      title: 'Parent consultation',
      startTime: '12:00',
    }),
  );
  expect(contents(t)).toContain('Meeting update confirmed');
});
test('409 slot conflict is shown without success', async () => {
  const t = await mount();
  service.slot.mockRejectedValue(
    new ApiError(409, 'This time overlaps another offered slot'),
  );
  await press(t, 'PTM / Appointments');
  await press(t, 'Offer Slot');
  await fillSlot(t);
  await press(t, 'Offer slot');
  expect(contents(t)).toContain('overlaps another');
  expect(contents(t)).not.toContain('Meeting update confirmed');
});
test('reschedule preserves original time text and sends revision', async () => {
  const t = await mount();
  await press(t, 'PTM / Appointments');
  await press(t, 'Reschedule: Family consultation');
  expect(contents(t)).toContain('original time remains in history');
  await field(t, 'Meeting start time', '14:00');
  await field(t, 'Meeting end time', '15:00');
  await press(t, 'Reschedule meeting');
  expect(service.change).toHaveBeenCalledWith(
    'token',
    'a1',
    'reschedule',
    expect.objectContaining({ revision: 1, startTime: '14:00' }),
  );
});
test('PTM confirmation uses selected roster context', async () => {
  service.students.mockResolvedValue({
    items: [
      {
        studentId: 's1',
        fullName: 'Learner',
        admissionNumber: '1',
        classId: 'c',
        sectionId: 's',
        subjectId: 'u',
        context: 'Grade 8 / A / Math',
      },
    ],
  });
  const t = await mount();
  await press(t, 'PTM / Appointments');
  await press(t, 'Confirm: Family consultation');
  await act(async () =>
    t.root
      .findAllByType(AdminSelect)
      .find(n => n.props.label === 'PTM student')!
      .props.onSelect('0'),
  );
  await press(t, 'Confirm meeting');
  expect(service.change).toHaveBeenCalledWith(
    'token',
    'a1',
    'confirm',
    expect.objectContaining({
      studentId: 's1',
      classId: 'c',
      sectionId: 's',
      subjectId: 'u',
    }),
  );
});
test('cancellation requires explicit dialog confirmation', async () => {
  const t = await mount();
  await press(t, 'PTM / Appointments');
  await press(t, 'Cancel: Family consultation');
  expect(service.change).not.toHaveBeenCalled();
  await press(t, 'Cancel meeting');
  expect(service.change).toHaveBeenCalledWith(
    'token',
    'a1',
    'cancel',
    expect.objectContaining({ revision: 1 }),
  );
});
test('empty sections describe real missing records', async () => {
  const data = initial();
  data.payslips.items = [];
  data.documents.items = [];
  data.appointments.items = [];
  service.summary.mockResolvedValue(data);
  const t = await mount();
  expect(contents(t)).toContain('No leave requests yet.');
  await press(t, 'Payslips');
  expect(contents(t)).toContain('No approved payslips available.');
  await press(t, 'Documents');
  expect(contents(t)).toContain('No staff documents');
  await press(t, 'PTM / Appointments');
  expect(contents(t)).toContain('No offered slots');
});
test('loading hides old private records', async () => {
  service.summary.mockImplementation(() => new Promise(() => {}));
  const t = await mount();
  expect(contents(t)).toContain('Loading your staff records');
  expect(contents(t)).not.toContain('Net amount');
});
test.each([
  new ApiError(403, 'Permission denied'),
  new ApiError(404, 'Unavailable'),
  new Error('Network offline'),
])('load errors offer retry and hide data: %s', async failure => {
  service.summary.mockRejectedValueOnce(failure);
  const t = await mount();
  expect(contents(t)).not.toContain('At a glance');
  expect(
    t.root.findAllByType(TeacherButton).some(n => n.props.title === 'Retry'),
  ).toBe(true);
  await act(async () =>
    t.root
      .findAllByType(TeacherButton)
      .find(n => n.props.title === 'Retry')!
      .props.onPress(),
  );
  expect(contents(t)).toContain('At a glance');
});
