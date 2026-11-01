import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import FinanceWorkspaceScreen from '../src/screens/finance/FinanceWorkspaceScreen';
import FinanceNavigator from '../src/navigation/FinanceNavigator';
import AppNavigator from '../src/navigation/AppNavigator';
import { financeService } from '../src/services/finance/financeService';
import { FeeCards } from '../src/components/hiraDashboard/FeeCards';
import { fees } from './helpers/fee-fixture';
import { ApiError } from '../src/services/api/apiClient';
import type { User } from '../src/types/auth';

let mockUser: User = {
  id: 'finance-a',
  fullName: 'Finance A',
  email: 'finance@test.invalid',
  role: 'finance',
};
const mockLogout = jest.fn();
let mockAccessToken = 'finance-token';
jest.mock('../src/context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    user: mockUser,
    accessToken: mockAccessToken,
    logout: mockLogout,
  }),
}));
jest.mock('@react-navigation/native', () => ({
  NavigationContainer: 'NavigationContainer',
  useNavigation: () => ({ navigate: jest.fn() }),
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
jest.mock('../src/services/finance/financeService', () => ({
  financeService: {
    summary: jest.fn(),
    fees: jest.fn(),
    payments: jest.fn(),
    reconciliation: jest.fn(),
    structures: jest.fn(),
    students: jest.fn(),
    createStructure: jest.fn(),
    assign: jest.fn(),
    record: jest.fn(),
    verify: jest.fn(),
    challan: jest.fn(),
    collectionReport: jest.fn(),
  },
}));
const service = jest.mocked(financeService);
let tree: Renderer.ReactTestRenderer;
const summary = {
  totalInvoices: 1,
  amountLabel: 'PKR 300.00',
  paidLabel: 'PKR 0.00',
  balanceLabel: 'PKR 300.00',
  legacyUnmigratedCount: 2,
};
const report = {
  summary: {
    obligationCount: 7,
    amountMinor: 98765,
    paidMinor: 12345,
    balanceMinor: 86420,
    amountLabel: 'SERVER CHARGES',
    paidLabel: 'SERVER SETTLED',
    balanceLabel: 'SERVER OUTSTANDING',
    unpaidCount: 3,
    statusCounts: {
      due: 1,
      overdue: 2,
      partial: 1,
      payment_pending: 1,
      paid: 2,
    },
  },
  filtersApplied: {
    dateBasis: 'obligation_due_date' as const,
    settlementBasis: 'all_settled' as const,
    dateFrom: null,
    dateTo: null,
    studentId: null,
    status: null,
    search: '',
  },
  items: fees.items,
  offset: 0,
  limit: 25,
  nextOffset: null as number | null,
};
const payment = {
  id: 'intent-1',
  feeId: 'fee-1',
  amountLabel: 'PKR 300.00',
  reference: 'BANK-001',
  status: 'awaiting_verification',
  method: 'bank_transfer',
  revision: 1,
  canVerify: false,
  expired: false,
  amountMinor: 30000,
  currency: 'PKR',
  createdAt: '2026-11-01T00:00:00Z',
  expiresAt: '2026-11-01T00:30:00Z',
};
async function mount(element = <FinanceWorkspaceScreen />) {
  await act(async () => {
    tree = Renderer.create(element);
  });
}
const text = () => JSON.stringify(tree.toJSON());
async function press(label: string) {
  const button = tree.root.findAll(
    node =>
      (node.props.accessibilityLabel === label ||
        node.props.children === label) &&
      typeof node.props.onPress === 'function',
  )[0];
  expect(button).toBeDefined();
  await act(async () => {
    button.props.onPress();
  });
}
async function fill(label: string, value: string) {
  const input = tree.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onChangeText === 'function',
  )[0];
  expect(input).toBeDefined();
  await act(async () => input.props.onChangeText(value));
}
beforeEach(() => {
  jest.clearAllMocks();
  mockAccessToken = 'finance-token';
  mockUser = {
    id: 'finance-a',
    fullName: 'Finance A',
    email: 'finance@test.invalid',
    role: 'finance',
  };
  service.summary.mockResolvedValue(summary);
  service.collectionReport.mockResolvedValue(report);
  service.fees.mockResolvedValue(fees);
  service.payments.mockResolvedValue({ items: [payment] });
  service.reconciliation.mockResolvedValue({ items: [], observations: [] });
  service.structures.mockResolvedValue({
    items: [
      {
        _id: 'structure-1',
        title: 'Tuition',
        amountMinor: 30000,
        currency: 'PKR',
      },
    ],
  });
  service.students.mockResolvedValue({
    items: [
      {
        id: 'student-1',
        fullName: 'Student A',
        admissionNumber: 'A1',
        enrollment: {
          id: 'enrollment-1',
          academicPeriod: 'Current term',
          className: 'Grade 8',
          sectionName: 'A',
        },
      },
    ],
  });
  service.challan.mockResolvedValue(fees.items[0]);
  service.record.mockResolvedValue(payment);
  service.verify.mockResolvedValue({ status: 'settled' });
  service.createStructure.mockResolvedValue({
    _id: 'structure-1',
    title: 'Tuition',
    amountMinor: 30000,
    currency: 'PKR',
  });
  service.assign.mockResolvedValue(fees.items[0]);
  mockLogout.mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => tree.unmount());
});
test('Finance uses canonical role routing with one root container', async () => {
  await mount(<AppNavigator />);
  expect(tree.root.findAllByType(FinanceNavigator)).toHaveLength(1);
  expect(
    tree.root.findAll(node => String(node.type) === 'NavigationContainer'),
  ).toHaveLength(1);
});
test('summary displays server totals, legacy migration warning and honest provider boundary', async () => {
  await mount();
  expect(text()).toContain('PKR 300.00');
  expect(text()).toContain('legacy records need migration');
  expect(text()).toContain('provider validation pending');
});
test('FeeCards renders server labels and only canonical settled receipts', async () => {
  await mount(
    <FeeCards
      data={{
        ...fees,
        items: [
          {
            ...fees.items[0],
            balanceLabel: 'SERVER BALANCE LABEL',
            receipts: [
              {
                id: 'r1',
                reference: 'RC-001',
                paymentReference: 'BANK-001',
                amountLabel: 'PKR 300.00',
                method: 'bank_transfer',
                paidAt: '2026-11-01',
                status: 'settled',
              },
            ],
          },
        ],
      }}
    />,
  );
  expect(text()).toContain('SERVER BALANCE LABEL');
  expect(text()).toContain('RC-001');
  expect(text()).not.toContain('Payment successful');
});
test('manual record retries retain operation key and never claim a paid balance', async () => {
  service.record.mockRejectedValueOnce(new Error('Network timed out'));
  await mount();
  await press('Fees');
  await press('CH-001');
  await fill('Bank payment reference', 'BANK-001');
  await press('Record bank payment');
  expect(text()).toContain('Network timed out');
  expect(text()).toContain('Reservation outcome is unknown');
  await press('Record bank payment');
  expect(service.record).toHaveBeenCalledTimes(2);
  const first = service.record.mock.calls[0][2],
    second = service.record.mock.calls[1][2];
  expect(first.operationId).toBe(second.operationId);
  expect(first).not.toHaveProperty('amountMinor');
  expect(first).not.toHaveProperty('status');
  expect(text()).toContain('PKR 0.00');
});

test('reservation UI displays server amount, pending status and timestamps without claiming settlement', async () => {
  service.record.mockResolvedValueOnce({
    ...payment,
    amountLabel: 'SERVER RESERVED AMOUNT',
  });
  await mount();
  await press('Fees');
  await press('CH-001');
  await fill('Bank payment reference', 'BANK-001');
  await press('Record bank payment');
  for (const label of [
    'SERVER RESERVED AMOUNT',
    'awaiting_verification',
    payment.createdAt,
    payment.expiresAt,
    'does not confirm payment',
  ])
    expect(text()).toContain(label);
  expect(text()).not.toContain('Payment successful');
  expect(service.verify).not.toHaveBeenCalled();
});

test.each([
  [401, 'Session expired. Sign in again.'],
  [403, 'Forbidden:'],
] as const)(
  'reservation %s is distinct from network uncertainty',
  async (status, label) => {
    service.record.mockRejectedValueOnce(new ApiError(status, 'Denied'));
    await mount();
    await press('Fees');
    await press('CH-001');
    await fill('Bank payment reference', 'BANK-001');
    await press('Record bank payment');
    expect(text()).toContain(label);
    expect(text()).not.toContain('Reservation outcome is unknown');
    expect(text()).not.toContain('Server reservation result');
  },
);

test('already paid and held-balance denials remain honest and do not render a successful reservation', async () => {
  service.fees.mockResolvedValue({
    ...fees,
    items: [{ ...fees.items[0], status: 'paid' }],
  });
  service.record.mockRejectedValueOnce(
    new ApiError(409, 'No unreserved balance is payable'),
  );
  await mount();
  await press('Fees');
  await press('CH-001');
  expect(text()).toContain('Already paid: no outstanding balance');
  await fill('Bank payment reference', 'BANK-001');
  await press('Record bank payment');
  expect(text()).toContain('No unreserved balance is payable');
  expect(text()).not.toContain('Server reservation result');
});

test('an old reservation cannot overwrite a new session for the same account', async () => {
  const pending = deferred<typeof payment>();
  service.record.mockReturnValueOnce(pending.promise);
  await mount();
  await press('Fees');
  await press('CH-001');
  await fill('Bank payment reference', 'BANK-001');
  await press('Record bank payment');
  expect(
    tree.root.findAll(
      node =>
        node.props.accessibilityLabel === 'Record bank payment' &&
        node.props.disabled === true,
    ).length,
  ).toBeGreaterThan(0);
  mockAccessToken = 'new-finance-session';
  await act(async () => tree.update(<FinanceWorkspaceScreen />));
  await press('Fees');
  await act(async () =>
    pending.resolve({ ...payment, amountLabel: 'STALE RESERVATION' }),
  );
  expect(text()).not.toContain('STALE RESERVATION');
  expect(text()).not.toContain('Server confirmed the operation');
});
test('maker gets no verify action; separate verifier submits revision and review note', async () => {
  await mount();
  await press('Payments');
  expect(
    tree.root.findAll(
      node => node.props.accessibilityLabel === 'Verify BANK-001',
    ),
  ).toHaveLength(0);
  service.payments.mockResolvedValueOnce({
    items: [{ ...payment, canVerify: true }],
  });
  await press('Summary');
  await press('Payments');
  await fill('Independent verification note', 'Checked bank statement');
  await press('Verify BANK-001');
  expect(service.verify).toHaveBeenCalledWith(
    'finance-token',
    'intent-1',
    expect.objectContaining({
      revision: 1,
      reviewNote: 'Checked bank statement',
      operationId: expect.any(String),
    }),
  );
});
test('fee setup assigns Student and structure IDs, never an amount override', async () => {
  await mount();
  await press('Fee setup');
  await press('Student A · A1');
  await press('Tuition · 30000 paisa');
  await fill('Fee due date YYYY-MM-DD', '2026-11-15');
  await press('Assign fee');
  expect(service.assign).toHaveBeenCalledWith(
    'finance-token',
    expect.objectContaining({
      studentId: 'student-1',
      structureId: 'structure-1',
      dueDate: '2026-11-15',
      operationId: expect.any(String),
    }),
  );
  expect(service.assign.mock.calls[0][1]).not.toHaveProperty('amountMinor');
});
test('reconciliation queue is read-only with an honest empty state', async () => {
  await mount();
  await press('Reconciliation');
  expect(text()).toContain('No reconciliation items.');
  expect(service.verify).not.toHaveBeenCalled();
});
test.each([
  [403, 'Forbidden:'],
  [401, 'Session expired'],
])('API failure %s has no fake balances', async (status, expected) => {
  service.summary.mockRejectedValueOnce(new ApiError(Number(status), 'Denied'));
  await mount();
  expect(text()).toContain(expected);
  expect(text()).not.toContain('PKR 300.00');
});
test('sign out delegates to canonical auth', async () => {
  await mount();
  await press('Sign out');
  expect(mockLogout).toHaveBeenCalledTimes(1);
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const studentResults = (name = 'Student A', id = 'student-1') => ({
  items: [
    {
      id,
      fullName: name,
      admissionNumber: 'A1',
      enrollment: {
        id: 'enrollment-1',
        className: 'Grade 8',
        sectionName: 'A',
        academicPeriod: 'Current term',
      },
    },
  ],
});

test('Student name search displays enrollment context and selects canonical dues filter', async () => {
  await mount();
  await press('Fees');
  await fill('Search Finance Students', 'Student A');
  expect(service.students).toHaveBeenCalledWith(
    'finance-token',
    'Student A',
    0,
  );
  expect(text()).toContain('Grade 8');
  await press('Filter fees for Student A (A1)');
  expect(service.fees).toHaveBeenLastCalledWith('finance-token', {
    studentId: 'student-1',
    offset: undefined,
  });
  expect(text()).toContain('Dues for');
  expect(text()).toContain('CH-001');
});

test('status/text filters serialize server values and clearing restores the canonical list', async () => {
  await mount();
  await press('Fees');
  await press('Payment pending');
  expect(service.fees).toHaveBeenLastCalledWith('finance-token', {
    status: 'payment_pending',
    offset: undefined,
  });
  await fill('Search obligations', 'CH-001');
  expect(service.fees).toHaveBeenLastCalledWith('finance-token', {
    status: 'payment_pending',
    search: 'CH-001',
    offset: undefined,
  });
  await press('Clear dues filters');
  expect(service.fees).toHaveBeenLastCalledWith('finance-token', {});
});

test('Student search shows loading, empty and network retry states', async () => {
  const waiting = deferred<ReturnType<typeof studentResults>>();
  service.students.mockReturnValueOnce(waiting.promise);
  await mount();
  await press('Fees');
  await fill('Search Finance Students', 'Nobody');
  expect(text()).toContain('Searching Students');
  await act(async () => waiting.resolve({ items: [] }));
  expect(text()).toContain('No permitted enrolled Students');
  service.students.mockRejectedValueOnce(new Error('Search offline'));
  await fill('Search Finance Students', 'Student A');
  expect(text()).toContain('Search offline');
  await press('Retry Student search');
  expect(text()).toContain('Filter fees for Student A');
});

test('rapid Student searches ignore older success and error responses', async () => {
  const old = deferred<ReturnType<typeof studentResults>>(),
    olderError = deferred<ReturnType<typeof studentResults>>();
  service.students
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(olderError.promise)
    .mockResolvedValueOnce(studentResults('Newest'));
  await mount();
  await press('Fees');
  await fill('Search Finance Students', 'Old');
  await fill('Search Finance Students', 'Older error');
  await fill('Search Finance Students', 'Newest');
  await act(async () => {
    old.resolve(studentResults('STALE STUDENT'));
    olderError.reject(new Error('STALE ERROR'));
  });
  expect(text()).toContain('Filter fees for Newest');
  expect(text()).not.toContain('STALE STUDENT');
  expect(text()).not.toContain('STALE ERROR');
});

test('older obligations cannot overwrite newer text/status/Student filters', async () => {
  const old = deferred<typeof fees>(),
    olderStudent = deferred<typeof fees>();
  await mount();
  await press('Fees');
  service.fees
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce({ items: [] });
  await fill('Search obligations', 'Old');
  await press('Paid');
  await act(async () =>
    old.resolve({
      ...fees,
      items: [{ ...fees.items[0], title: 'STALE OBLIGATION' }],
    }),
  );
  expect(text()).not.toContain('STALE OBLIGATION');
  service.students
    .mockResolvedValueOnce(studentResults('First'))
    .mockResolvedValueOnce(studentResults('Second', 'student-2'));
  await fill('Search Finance Students', 'First');
  service.fees.mockReturnValueOnce(olderStudent.promise);
  await press('Filter fees for First (A1)');
  await fill('Search Finance Students', 'Second');
  await press('Filter fees for Second (A1)');
  await act(async () =>
    olderStudent.resolve({
      ...fees,
      items: [{ ...fees.items[0], title: 'WRONG STUDENT FEES' }],
    }),
  );
  expect(text()).not.toContain('WRONG STUDENT FEES');
  expect(service.fees.mock.lastCall?.[1]?.studentId).toBe('student-2');
});

test('filtered obligation loading and error offer retry without stale rows', async () => {
  const pending = deferred<typeof fees>();
  await mount();
  await press('Fees');
  service.fees.mockReturnValueOnce(pending.promise);
  await fill('Search obligations', 'Tuition');
  expect(text()).not.toContain('CH-001');
  await act(async () => pending.reject(new Error('Fees unavailable')));
  expect(text()).toContain('Fees unavailable');
  await press('Tap to try again');
  expect(text()).toContain('CH-001');
});

test('challan lookup displays only the server obligation and calls no payment mutation', async () => {
  await mount();
  await press('Fees');
  await fill('Issued challan reference', 'CH-001');
  await press('Find challan');
  expect(service.challan).toHaveBeenCalledWith('finance-token', 'CH-001');
  expect(text()).toContain('Issued challan found.');
  expect(text()).toContain('does not confirm a payment');
  expect(text()).not.toContain('Payment verified');
  expect(service.record).not.toHaveBeenCalled();
  expect(service.verify).not.toHaveBeenCalled();
  expect(service.assign).not.toHaveBeenCalled();
});

test('unknown challan and network uncertainty have honest not-found/error retry states', async () => {
  service.challan
    .mockRejectedValueOnce(new ApiError(404, 'Unavailable'))
    .mockRejectedValueOnce(new Error('Lookup offline'));
  await mount();
  await press('Fees');
  await fill('Issued challan reference', 'CH-UNKNOWN');
  await press('Find challan');
  expect(text()).toContain('No issued challan found');
  await press('Retry challan lookup');
  expect(text()).toContain('Lookup offline');
  await press('Retry challan lookup');
  expect(text()).toContain('Issued challan found.');
});

test('changing reference invalidates old lookup and permits another independent request', async () => {
  const old = deferred<(typeof fees.items)[number]>();
  service.challan.mockReturnValueOnce(old.promise);
  await mount();
  await press('Fees');
  await fill('Issued challan reference', 'Old');
  await press('Find challan');
  expect(text()).toContain('Looking up challan');
  await fill('Issued challan reference', 'CH-001');
  await press('Find challan');
  await act(async () =>
    old.resolve({ ...fees.items[0], title: 'STALE CHALLAN' }),
  );
  expect(text()).not.toContain('STALE CHALLAN');
  expect(text()).toContain('Issued challan found.');
});

test('unmount and account switch invalidate outstanding lookup/search responses', async () => {
  const old = deferred<(typeof fees.items)[number]>(),
    search = deferred<ReturnType<typeof studentResults>>();
  service.challan.mockReturnValueOnce(old.promise);
  service.students.mockReturnValueOnce(search.promise);
  await mount();
  await press('Fees');
  await fill('Search Finance Students', 'Old');
  await fill('Issued challan reference', 'Old');
  await press('Find challan');
  mockUser = { ...mockUser, id: 'finance-b' };
  await act(async () => tree.update(<FinanceWorkspaceScreen />));
  await press('Fees');
  await act(async () => {
    old.resolve({ ...fees.items[0], title: 'PREVIOUS ACCOUNT' });
    search.resolve(studentResults('PREVIOUS STUDENT'));
  });
  expect(text()).not.toContain('PREVIOUS ACCOUNT');
  expect(text()).not.toContain('PREVIOUS STUDENT');
});

test('obligation and Student next-page actions use server offsets', async () => {
  service.fees.mockResolvedValueOnce({ ...fees, nextOffset: 100 });
  service.students.mockResolvedValueOnce({
    ...studentResults(),
    nextOffset: 50,
  });
  await mount();
  await press('Fees');
  await press('Next obligations');
  expect(service.fees).toHaveBeenLastCalledWith('finance-token', {
    offset: 100,
  });
  await fill('Search Finance Students', 'Student');
  await press('Next Student results');
  expect(service.students).toHaveBeenLastCalledWith(
    'finance-token',
    'Student',
    50,
  );
});

test('collection report renders server summary labels, counts, rows and explicit due-date semantics', async () => {
  await mount();
  await press('Collection report');
  expect(service.collectionReport).toHaveBeenCalledWith('finance-token', {});
  for (const label of [
    'SERVER CHARGES',
    'SERVER SETTLED',
    'SERVER OUTSTANDING',
    'CH-001',
    'Dates select obligation due dates',
    'regardless of payment date',
    'every page',
  ])
    expect(text()).toContain(label);
  expect(text()).toContain('No settled payment');
  expect(service.record).not.toHaveBeenCalled();
  expect(service.verify).not.toHaveBeenCalled();
  expect(service.assign).not.toHaveBeenCalled();
  expect(service.createStructure).not.toHaveBeenCalled();
  expect(service.challan).not.toHaveBeenCalled();
});

test('report date, status, Student and text filters compose and clearing restores the base report', async () => {
  await mount();
  await press('Collection report');
  await fill('Report due date from', '2024-01-01');
  await fill('Report due date to', '2024-01-31');
  await press('Paid');
  await fill('Search Finance Students', 'Student A');
  await press('Filter fees for Student A (A1)');
  await fill('Search obligations', 'CH-001');
  expect(service.collectionReport).toHaveBeenLastCalledWith('finance-token', {
    dateFrom: '2024-01-01',
    dateTo: '2024-01-31',
    status: 'paid',
    studentId: 'student-1',
    search: 'CH-001',
    offset: undefined,
  });
  await press('Clear report filters');
  expect(service.collectionReport).toHaveBeenLastCalledWith(
    'finance-token',
    {},
  );
});

test('report pagination uses server offsets and resets when filters change', async () => {
  service.collectionReport.mockResolvedValue({ ...report, nextOffset: 25 });
  await mount();
  await press('Collection report');
  await press('Next report page');
  expect(service.collectionReport).toHaveBeenLastCalledWith('finance-token', {
    offset: 25,
  });
  await press('Overdue');
  expect(service.collectionReport).toHaveBeenLastCalledWith('finance-token', {
    status: 'overdue',
    offset: undefined,
  });
});

test('report loading and network failure hide prior totals and allow retry', async () => {
  const pending = deferred<typeof report>();
  await mount();
  await press('Collection report');
  service.collectionReport.mockReturnValueOnce(pending.promise);
  await fill('Search obligations', 'Tuition');
  expect(text()).toContain('Loading your school overview');
  expect(text()).not.toContain('SERVER CHARGES');
  await act(async () => pending.reject(new Error('Report offline')));
  expect(text()).toContain('Report offline');
  expect(text()).not.toContain('SERVER SETTLED');
  await press('Tap to try again');
  expect(text()).toContain('SERVER CHARGES');
});

test.each([
  [403, 'Forbidden:'],
  [401, 'Session expired. Sign in again.'],
] as const)(
  'report %s is distinct from an empty or zero collection result',
  async (status, label) => {
    service.collectionReport.mockRejectedValueOnce(
      new ApiError(status, 'Denied'),
    );
    await mount();
    await press('Collection report');
    expect(text()).toContain(label);
    expect(text()).not.toContain('SERVER CHARGES');
    expect(text()).not.toContain('No obligations match');
    await press('Tap to try again');
    expect(text()).toContain('SERVER CHARGES');
  },
);

test('report distinguishes filtered-empty obligations from zero settled collections', async () => {
  service.collectionReport.mockResolvedValueOnce({
    ...report,
    items: [],
    summary: { ...report.summary, obligationCount: 0 },
  });
  await mount();
  await press('Collection report');
  expect(text()).toContain('No obligations match this report scope');
  expect(text()).not.toContain('No settled collections for these obligations');
  service.collectionReport.mockResolvedValueOnce({
    ...report,
    summary: { ...report.summary, paidMinor: 0, paidLabel: 'PKR 0.00' },
  });
  await press('Clear report filters');
  expect(text()).toContain('No settled collections for these obligations');
  expect(text()).not.toContain('No obligations match');
});

test('rapid report filters ignore older successes and errors', async () => {
  const old = deferred<typeof report>(),
    olderError = deferred<typeof report>();
  await mount();
  await press('Collection report');
  service.collectionReport
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(olderError.promise)
    .mockResolvedValueOnce(report);
  await fill('Search obligations', 'Old');
  await press('Partial');
  await fill('Report due date to', '2024-01-31');
  await act(async () => {
    old.resolve({
      ...report,
      summary: { ...report.summary, amountLabel: 'STALE REPORT TOTAL' },
    });
    olderError.reject(new Error('STALE REPORT ERROR'));
  });
  expect(text()).toContain('SERVER CHARGES');
  expect(text()).not.toContain('STALE REPORT');
});

test('switching Finance accounts or unmounting invalidates outstanding report completion', async () => {
  const old = deferred<typeof report>();
  service.collectionReport.mockReturnValueOnce(old.promise);
  await mount();
  await press('Collection report');
  mockUser = { ...mockUser, id: 'finance-b' };
  await act(async () => tree.update(<FinanceWorkspaceScreen />));
  await press('Collection report');
  await act(async () =>
    old.resolve({
      ...report,
      summary: { ...report.summary, amountLabel: 'OTHER ACCOUNT TOTAL' },
    }),
  );
  expect(text()).toContain('SERVER CHARGES');
  expect(text()).not.toContain('OTHER ACCOUNT TOTAL');
});
