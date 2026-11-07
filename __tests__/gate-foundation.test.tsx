import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import GateFoundationScreen from '../src/screens/gate/GateFoundationScreen';
import { Button } from '../src/components/hiraDashboard';
import { PERMISSIONS, ROLE_PERMISSIONS } from '../src/constants/permissions';

const mockLogout = jest.fn();
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ logout: mockLogout }),
}));
let tree: Renderer.ReactTestRenderer;
beforeEach(async () => {
  mockLogout.mockReset().mockResolvedValue(undefined);
  await act(async () => {
    tree = Renderer.create(<GateFoundationScreen />);
  });
});
afterEach(async () => {
  await act(async () => tree.unmount());
});

test('Gate Staff has a safe account destination with sign-out as the only action', () => {
  expect(JSON.stringify(tree.toJSON())).toContain('Gate Staff');
  expect(
    tree.root.findAllByType(Button).map(button => button.props.title),
  ).toEqual(['Sign out']);
  expect(ROLE_PERMISSIONS.gate_staff).toEqual([]);
});

test('the foundation account can sign out through the canonical session context', async () => {
  await act(async () => {
    await tree.root.findByType(Button).props.onPress();
  });
  expect(mockLogout).toHaveBeenCalledTimes(1);
});

test('sign-out transport failure is handled by the existing local-clear boundary', async () => {
  mockLogout.mockRejectedValueOnce(new Error('Offline'));
  await act(async () => {
    await tree.root.findByType(Button).props.onPress();
  });
  expect(mockLogout).toHaveBeenCalledTimes(1);
});

test('all mobile roles exclude physical gate operation grants', () => {
  const operational = [
    PERMISSIONS.GATE_ENTRY_RECORD,
    PERMISSIONS.GATE_PICKUP_VERIFY,
    PERMISSIONS.GATE_EXIT_CONFIRM,
    PERMISSIONS.GATE_TASKS_VIEW,
    PERMISSIONS.GATE_INCIDENT_ESCALATE,
  ];
  for (const permissions of Object.values(ROLE_PERMISSIONS)) {
    expect(
      operational.some(permission => permissions.includes(permission)),
    ).toBe(false);
  }
});
