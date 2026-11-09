import React from 'react';
import { Text } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import DeveloperPreview from '../src/devPreview/DeveloperPreview';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import { apiClient, ApiError } from '../src/services/api/apiClient';
import { authService } from '../src/services/auth/authService';
import type { User } from '../src/types/auth';

jest.mock(
  '../src/navigation/SuperAdminNavigator',
  () => () => 'Canonical Super Admin',
);
jest.mock(
  '../src/navigation/PrincipalNavigator',
  () => () => 'Canonical Principal',
);
jest.mock(
  '../src/navigation/TeacherNavigator',
  () => () => 'Canonical Teacher',
);
jest.mock('../src/services/auth/authService', () => ({
  authService: { logout: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

let auth!: ReturnType<typeof useAuth>;
let tree: Renderer.ReactTestRenderer;
const actualUser: User = {
  id: 'real-session-user',
  fullName: 'Test learner',
  email: 'test@example.invalid',
  role: 'student',
  branchId: 'own-branch',
};
const development = __DEV__;
const runtime = globalThis as typeof globalThis & { __DEV__: boolean };
function Probe() {
  auth = useAuth();
  return <Text>Normal canonical app</Text>;
}
async function press(label: string) {
  const button = tree.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  )[0];
  if (!button) {
    throw new Error(`Missing button ${label}: ${output()}`);
  }
  await act(async () => button!.props.onPress());
}
function output() {
  return JSON.stringify(tree.toJSON());
}
async function signIn() {
  await act(async () => auth.login(actualUser, 'real-test-token'));
}

beforeEach(async () => {
  jest.clearAllMocks();
  runtime.__DEV__ = true;
  jest
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Unexpected network request'));
  await act(async () => {
    tree = Renderer.create(
      <AuthProvider>
        <DeveloperPreview>
          <Probe />
        </DeveloperPreview>
      </AuthProvider>,
    );
  });
});
afterEach(async () => {
  await act(async () => tree.unmount());
  runtime.__DEV__ = development;
  jest.restoreAllMocks();
});

test('signed-out users keep the canonical path and cannot open preview', () => {
  expect(output()).toContain('Normal canonical app');
  expect(output()).not.toContain('Open Developer Preview');
});
test('a user without a token cannot open preview', async () => {
  await act(async () => auth.login(actualUser, ''));
  expect(output()).not.toContain('Open Developer Preview');
});
test.each(['Super Admin', 'Principal', 'Teacher'])(
  '%s selects the existing canonical navigator without changing the real session',
  async role => {
    await signIn();
    await press('Open Developer Preview');
    await press(role);
    expect(output()).toContain(`Canonical ${role}`);
    expect(auth.user).toBe(actualUser);
    expect(auth.accessToken).toBe('real-test-token');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    await press('Exit Developer Preview');
    expect(output()).toContain('Normal canonical app');
  },
);
test.each(['Student', 'Parent', 'Finance'])(
  '%s renders only sample UI, supports local navigation and makes no requests',
  async role => {
    await signIn();
    await press('Open Developer Preview');
    await press(role);
    expect(output()).toContain(`${role} preview · FICTIONAL SAMPLE DATA`);
    if (role === 'Student') {
      await press('Homework');
      expect(output()).toContain('Fractions practice');
    } else if (role === 'Parent') {
      await press('Sara Khan');
      expect(output()).toContain('English · Reading practice');
    } else {
      await press('Fees & challans');
      expect(output()).toContain('DEMO-2026-01');
    }
    expect(auth.user).toBe(actualUser);
    expect(auth.accessToken).toBe('real-test-token');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    await press('Back to preview roles');
    expect(output()).toContain('Developer Preview');
    expect(output()).not.toContain('FICTIONAL SAMPLE DATA');
  },
);
test('logout removes preview and a later login cannot inherit the selected role', async () => {
  await signIn();
  await press('Open Developer Preview');
  await press('Finance');
  await act(async () => auth.logout());
  expect(output()).not.toContain('FICTIONAL SAMPLE DATA');
  expect(output()).not.toContain('Open Developer Preview');
  await signIn();
  expect(output()).toContain('Normal canonical app');
  expect(output()).not.toContain('FICTIONAL SAMPLE DATA');
  expect(authService.logout).toHaveBeenCalledWith('real-test-token');
});

test('Parent pickup Design Preview is fictional, read-only and never changes real authentication', async () => {
  await signIn();
  await press('Open Developer Preview');
  await press('Parent');
  expect(output()).toContain('Pickup Persons · Design Preview');
  for (const label of ['Pending', 'Changes Requested', 'Rejected', 'School verification unavailable', 'Policy-blocked approval']) expect(output()).toContain(label);
  await press('Preview Sample Guardian Two');
  expect(output()).toContain('Sample explanation: revise the proposed contact details.');
  expect(output()).toContain('Approve unavailable — school policy required');
  expect(output()).not.toContain('Confirm exit');
  expect(output()).not.toContain('Show QR');
  expect(output()).not.toContain('Save draft');
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(auth.user).toBe(actualUser);
  expect(auth.accessToken).toBe('real-test-token');
  await press('Sara Khan');
  expect(output()).not.toContain('Fictional pickup detail');
  expect(authService.logout).not.toHaveBeenCalled();
});
test('production guard prevents switching even with a real authenticated session', async () => {
  runtime.__DEV__ = false;
  await signIn();
  expect(output()).toContain('Normal canonical app');
  expect(output()).not.toContain('Open Developer Preview');
});

test.each(['Draft', 'Pending', 'Changes Requested', 'Rejected', 'Withdrawn'])(
  'Early Exit %s preview is fictional and read-only with no network or authentication writes', async state => {
    await signIn();
    await press('Open Developer Preview');
    await press('Parent');
    expect(output()).toContain('Early Exit · Design Preview');
    await press(`Preview Early Exit ${state}`);
    expect(output()).toContain('Fictional Early Exit detail');
    expect(output()).toContain('No connected Student, Parent or Principal record.');
    expect(output()).not.toContain('Confirm Early Exit decision');
    expect(output()).not.toContain('Save draft');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(auth.user).toBe(actualUser);
    expect(auth.accessToken).toBe('real-test-token');
    await press('Sara Khan');
    expect(output()).not.toContain('Fictional Early Exit detail');
    expect(authService.logout).not.toHaveBeenCalled();
  },
);
test('selecting a privileged UI does not change API authorization or swallow a 403', async () => {
  await signIn();
  await press('Open Developer Preview');
  await press('Super Admin');
  jest.mocked(globalThis.fetch).mockResolvedValueOnce({
    ok: false,
    status: 403,
    json: async () => ({ message: 'Forbidden' }),
  } as Response);
  await expect(
    apiClient.request('/admin/dashboard', { token: auth.accessToken! }),
  ).rejects.toEqual(new ApiError(403, 'Forbidden'));
  expect(globalThis.fetch).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer real-test-token',
      },
    }),
  );
  expect(auth.user?.role).toBe('student');
});
