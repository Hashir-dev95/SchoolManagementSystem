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
jest.mock('../src/context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    user: mockUser,
    accessToken: 'finance-token',
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
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  )[0];
  expect(button).toBeDefined();
  await act(async () => button.props.onPress());
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
  mockUser = {
    id: 'finance-a',
    fullName: 'Finance A',
    email: 'finance@test.invalid',
    role: 'finance',
  };
  service.summary.mockResolvedValue(summary);
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
    items: [{ id: 'student-1', fullName: 'Student A', admissionNumber: 'A1' }],
  });
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
  await press('Record bank payment');
  expect(service.record).toHaveBeenCalledTimes(2);
  const first = service.record.mock.calls[0][2],
    second = service.record.mock.calls[1][2];
  expect(first.operationId).toBe(second.operationId);
  expect(first).not.toHaveProperty('amountMinor');
  expect(first).not.toHaveProperty('status');
  expect(text()).toContain('PKR 0.00');
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
