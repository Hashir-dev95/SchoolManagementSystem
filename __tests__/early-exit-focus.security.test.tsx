import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import ParentScreen from '../src/screens/parent/ParentEarlyExitRequestsScreen';
import PrincipalScreen from '../src/screens/principal/PrincipalEarlyExitReviewScreen';
import {
  Button,
  DashboardStateCard,
  WorkspaceTabs,
} from '../src/components/hiraDashboard';
import { ApiError } from '../src/services/api/apiClient';
import type {
  EarlyExitTransport,
  EarlyExitDetail,
  EarlyExitResult,
} from '../src/services/parent/earlyExitService';
import type {
  EarlyExitReviewTransport,
  EarlyExitReviewDetail,
} from '../src/services/principal/earlyExitReviewService';
import {
  earlyExitChild,
  earlyExitDetail,
  earlyExitReview,
  earlyExitResult,
  earlyExitFields,
  deferredEarlyExit,
} from './helpers/early-exit-fixture';
import {
  NavigationContext,
  createFocusNavigation,
} from './helpers/early-exit-real-navigation.fixture';

let mockAuth: {
  user: { id: string; role: string; branchId: string } | null;
  accessToken: string | null;
  logout: jest.Mock;
};
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('@react-navigation/native', () =>
  jest.requireActual('./helpers/early-exit-real-navigation.fixture'),
);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

const parent: jest.Mocked<EarlyExitTransport> = {
  list: jest.fn(),
  detail: jest.fn(),
  write: jest.fn(),
};
const principal: jest.Mocked<EarlyExitReviewTransport> = {
  list: jest.fn(),
  detail: jest.fn(),
  decide: jest.fn(),
};
const childrenTransport = { children: jest.fn() },
  operationId = jest.fn();
let focus: ReturnType<typeof createFocusNavigation>,
  tree: Renderer.ReactTestRenderer | undefined;
type Role = 'parent' | 'principal';
const marker = 'PROTECTED_PRIOR_FOCUS';
const currentMarker = 'CURRENT_AUTHORIZED_FOCUS';
const output = () => JSON.stringify(tree!.toJSON());
const button = (title: string) =>
  tree!.root.findAllByType(Button).find(node => node.props.title === title)!;
const element = (role: Role) => (
  <NavigationContext.Provider value={focus.navigation}>
    {role === 'parent' ? (
      <ParentScreen
        transport={parent}
        childrenTransport={childrenTransport}
        operationId={operationId}
      />
    ) : (
      <PrincipalScreen
        route={{ params: { approvalId: 'approval-A' } }}
        transport={principal}
        operationId={operationId}
      />
    )}
  </NavigationContext.Provider>
);
async function mount(role: Role) {
  mockAuth.user = { id: `${role}-A`, role, branchId: 'branch' };
  await act(async () => {
    tree = Renderer.create(element(role));
  });
}
async function press(title: string) {
  await act(async () => {
    const node = button(title);
    expect(node).toBeDefined();
    expect(node.props.disabled).not.toBe(true);
    await node.props.onPress();
  });
}
async function cycle() {
  // No intermediate render/flush between the two real navigation events.
  await act(async () => {
    focus.blur();
    focus.focus();
  });
}
function freshReads(role: Role) {
  return role === 'parent'
    ? childrenTransport.children.mock.calls.length
    : principal.detail.mock.calls.length;
}
async function holdRead(role: Role) {
  if (role === 'parent') {
    const waiting = deferredEarlyExit<EarlyExitDetail>();
    parent.detail.mockReturnValueOnce(waiting.promise);
    await mount(role);
    await act(async () => {
      button(`View Draft request ${earlyExitFields.exitDate}`).props.onPress();
    });
    return {
      fail: waiting.reject,
      succeed: () => waiting.resolve(earlyExitDetail({ reason: marker })),
    };
  }
  const waiting = deferredEarlyExit<EarlyExitReviewDetail>();
  principal.detail.mockReturnValueOnce(waiting.promise);
  await mount(role);
  return {
    fail: waiting.reject,
    succeed: () => waiting.resolve(earlyExitReview({ reason: marker })),
  };
}
async function openCurrent(role: Role) {
  if (role === 'parent')
    await press(`View Draft request ${earlyExitFields.exitDate}`);
}
async function change(label: string, value: string) {
  await act(async () =>
    tree!.root
      .findAllByType(TextInput)
      .find(node => node.props.accessibilityLabel === label)!
      .props.onChangeText(value),
  );
}
async function prepareMutation(role: Role) {
  if (role === 'parent') {
    await press('New Early Exit draft');
    await change('Exit date', earlyExitFields.exitDate);
    await change('Private reason', earlyExitFields.reason);
    return 'Save draft';
  }
  await press('Reject request');
  await change('Decision explanation', 'A current school explanation.');
  return 'Confirm Early Exit decision';
}

beforeEach(() => {
  jest.clearAllMocks();
  focus = createFocusNavigation();
  mockAuth = {
    user: null,
    accessToken: 'token-A',
    logout: jest.fn().mockResolvedValue(undefined),
  };
  childrenTransport.children
    .mockReset()
    .mockResolvedValue({ items: [earlyExitChild()] });
  parent.list
    .mockReset()
    .mockResolvedValue({ items: [earlyExitDetail()], nextOffset: null });
  parent.detail
    .mockReset()
    .mockResolvedValue(earlyExitDetail({ reason: currentMarker }));
  parent.write
    .mockReset()
    .mockResolvedValue(earlyExitResult(earlyExitDetail()));
  principal.list
    .mockReset()
    .mockResolvedValue({ items: [earlyExitReview()], nextOffset: null });
  principal.detail
    .mockReset()
    .mockResolvedValue(earlyExitReview({ reason: currentMarker }));
  principal.decide
    .mockReset()
    .mockResolvedValue(earlyExitResult(earlyExitReview()));
  operationId
    .mockReset()
    .mockReturnValueOnce('nonce-1')
    .mockReturnValue('nonce-2');
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
});

for (const role of ['parent', 'principal'] as const) {
  test(`${role}: batched blur/refocus rejects prior-focus success and revalidates authority`, async () => {
    if (role === 'parent') {
      const waiting = deferredEarlyExit<EarlyExitDetail>();
      parent.detail.mockReturnValueOnce(waiting.promise);
      await mount(role);
      await act(async () => {
        button(
          `View Draft request ${earlyExitFields.exitDate}`,
        ).props.onPress();
      });
      await cycle();
      await act(async () =>
        waiting.resolve(earlyExitDetail({ reason: marker })),
      );
    } else {
      const waiting = deferredEarlyExit<EarlyExitReviewDetail>();
      principal.detail.mockReturnValueOnce(waiting.promise);
      await mount(role);
      await cycle();
      await act(async () =>
        waiting.resolve(earlyExitReview({ reason: marker })),
      );
    }
    expect({
      priorFocusVisible: output().includes(marker),
      protectedReads: freshReads(role),
    }).toEqual({ priorFocusVisible: false, protectedReads: 2 });
  });

  test(`${role}: an old 401 delivered inside the blur/refocus batch cannot log out the valid lifetime`, async () => {
    if (role === 'parent') {
      const waiting = deferredEarlyExit<EarlyExitDetail>();
      parent.detail.mockReturnValueOnce(waiting.promise);
      await mount(role);
      await act(async () => {
        button(
          `View Draft request ${earlyExitFields.exitDate}`,
        ).props.onPress();
      });
      await act(async () => {
        focus.blur();
        focus.focus();
        waiting.reject(new ApiError(401, 'old focus'));
        await Promise.resolve();
      });
    } else {
      const waiting = deferredEarlyExit<EarlyExitReviewDetail>();
      principal.detail.mockReturnValueOnce(waiting.promise);
      await mount(role);
      await act(async () => {
        focus.blur();
        focus.focus();
        waiting.reject(new ApiError(401, 'old focus'));
        await Promise.resolve();
      });
    }
    expect(mockAuth.logout).not.toHaveBeenCalled();
    expect(freshReads(role)).toBe(2);
  });

  test.each([401, 403, 404])(
    `${role}: late prior-focus %s cannot clear freshly authorized data`,
    async status => {
      const old = await holdRead(role);
      await cycle();
      await openCurrent(role);
      expect(output()).toContain(currentMarker);
      await act(async () =>
        old.fail(new ApiError(status, 'OLD_PRIVATE_DENIAL')),
      );
      expect(output()).toContain(currentMarker);
      expect(output()).not.toContain('OLD_PRIVATE_DENIAL');
      expect(mockAuth.logout).not.toHaveBeenCalled();
      expect(freshReads(role)).toBe(2);
    },
  );

  test.each([403, 404])(
    `${role}: prior-focus %s inside the same event batch stays invalid`,
    async status => {
      const old = await holdRead(role);
      await act(async () => {
        focus.blur();
        focus.focus();
        old.fail(new ApiError(status, 'OLD_PRIVATE_DENIAL'));
        await Promise.resolve();
      });
      await openCurrent(role);
      expect(output()).toContain(currentMarker);
      expect(output()).not.toContain('OLD_PRIVATE_DENIAL');
      expect(mockAuth.logout).not.toHaveBeenCalled();
      expect(freshReads(role)).toBe(2);
    },
  );

  test.each([401, 403, 404])(
    `${role}: fresh current authority denial %s conceals previous private detail`,
    async status => {
      await mount(role);
      await openCurrent(role);
      expect(output()).toContain(currentMarker);
      if (role === 'parent')
        childrenTransport.children.mockRejectedValueOnce(
          new ApiError(status, 'CURRENT_PRIVATE_DENIAL'),
        );
      else
        principal.detail.mockRejectedValueOnce(
          new ApiError(status, 'CURRENT_PRIVATE_DENIAL'),
        );
      await cycle();
      expect(output()).not.toContain(currentMarker);
      expect(output()).not.toContain('CURRENT_PRIVATE_DENIAL');
      expect(output()).toContain('unavailable in your current scope');
      expect(mockAuth.logout).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
      expect(freshReads(role)).toBe(2);
    },
  );

  test.each(['account', 'token', 'role', 'branch', 'logout'])(
    `${role}: real-hook ${'%s'} isolation rejects a late old 401`,
    async kind => {
      const old = await holdRead(role);
      if (kind === 'account')
        mockAuth.user = { ...mockAuth.user!, id: `${role}-B` };
      if (kind === 'token') mockAuth.accessToken = 'token-B';
      if (kind === 'role')
        mockAuth.user = { ...mockAuth.user!, role: 'student' };
      if (kind === 'branch') {
        mockAuth.user = { ...mockAuth.user!, branchId: 'branch-B' };
        const child = earlyExitChild();
        child.enrollment.branch.id = 'branch-B';
        childrenTransport.children.mockResolvedValue({ items: [child] });
        principal.detail.mockResolvedValue(
          earlyExitReview({
            reason: currentMarker,
            student: { ...earlyExitReview().student, branchId: 'branch-B' },
          }),
        );
      }
      if (kind === 'logout') {
        mockAuth.user = null;
        mockAuth.accessToken = null;
      }
      await act(async () => tree!.update(element(role)));
      await act(async () => old.fail(new ApiError(401, 'OLD_PRIVATE_DENIAL')));
      expect(mockAuth.logout).not.toHaveBeenCalled();
      expect(output()).not.toContain(marker);
      expect(output()).not.toContain('OLD_PRIVATE_DENIAL');
    },
  );

  test(`${role}: each successive batched focus entry reloads current authority`, async () => {
    await mount(role);
    await openCurrent(role);
    for (let entry = 2; entry <= 4; entry++) {
      await cycle();
      expect(freshReads(role)).toBe(entry);
    }
  });

  test(`${role}: duplicate focus notification cannot reset a pending nonce or bypass duplicate-tap guards`, async () => {
    await mount(role);
    const submitTitle = await prepareMutation(role);
    if (role === 'parent')
      parent.write.mockRejectedValueOnce(new Error('timeout'));
    else principal.decide.mockRejectedValueOnce(new Error('timeout'));
    const retained = button(submitTitle).props.onPress;
    await act(async () => {
      await retained();
    });
    await act(async () => {
      focus.focus();
      await retained();
    });
    expect(freshReads(role)).toBe(1);
    expect(operationId).toHaveBeenCalledTimes(1);
    if (role === 'parent') {
      expect(parent.write).toHaveBeenCalledTimes(1);
      await press('Retry same operation');
      expect(parent.write.mock.calls[1]).toEqual(parent.write.mock.calls[0]);
    } else {
      expect(principal.decide).toHaveBeenCalledTimes(1);
      await press('Retry same decision');
      expect(principal.decide.mock.calls[1]).toEqual(
        principal.decide.mock.calls[0],
      );
    }
    expect(operationId).toHaveBeenCalledTimes(1);
  });

  test(`${role}: focus re-entry does not enable approval or trigger domain writes`, async () => {
    await mount(role);
    await cycle();
    await openCurrent(role);
    for (const node of tree!.root.findAllByType(Button)) {
      if (/approve|checkout|confirm exit|QR|OTP/i.test(node.props.title))
        expect(node.props.disabled).toBe(true);
    }
    expect(parent.write).not.toHaveBeenCalled();
    expect(principal.decide).not.toHaveBeenCalled();
  });

  test.each(['success', 'denied'] as const)(
    `${role}: prior-focus mutation %s cannot affect the re-entered workspace`,
    async result => {
      await mount(role);
      const submitTitle = await prepareMutation(role);
      if (role === 'parent') {
        const waiting = deferredEarlyExit<EarlyExitResult>();
        parent.write.mockReturnValueOnce(waiting.promise);
        await act(async () => {
          button(submitTitle).props.onPress();
        });
        await cycle();
        await act(async () => {
          if (result === 'success')
            waiting.resolve(
              earlyExitResult(earlyExitDetail({ reason: marker })),
            );
          else waiting.reject(new ApiError(401, 'OLD_PRIVATE_DENIAL'));
        });
        expect(parent.write).toHaveBeenCalledTimes(1);
      } else {
        const waiting =
          deferredEarlyExit<EarlyExitResult<EarlyExitReviewDetail>>();
        principal.decide.mockReturnValueOnce(waiting.promise);
        await act(async () => {
          button(submitTitle).props.onPress();
        });
        await cycle();
        await act(async () => {
          if (result === 'success')
            waiting.resolve(
              earlyExitResult(earlyExitReview({ reason: marker })),
            );
          else waiting.reject(new ApiError(401, 'OLD_PRIVATE_DENIAL'));
        });
        expect(principal.decide).toHaveBeenCalledTimes(1);
      }
      expect(output()).not.toContain(marker);
      expect(output()).not.toContain('OLD_PRIVATE_DENIAL');
      expect(mockAuth.logout).not.toHaveBeenCalled();
      expect(operationId).toHaveBeenCalledTimes(1);
    },
  );
}

test('Parent real-hook Draft refresh failure retains edit identity, fields and returned revision', async () => {
  await mount('parent');
  await openCurrent('parent');
  await press('Edit draft');
  await change('Private reason', 'RETAINED_DRAFT_EDIT');
  parent.write.mockRejectedValueOnce(new ApiError(400, 'field feedback'));
  await press('Save draft');
  parent.detail.mockRejectedValueOnce(new Error('read timeout'));
  const retry = async () => {
    await act(async () =>
      tree!.root
        .findAllByType(DashboardStateCard)
        .find(node => node.props.error)!
        .props.onRetry(),
    );
  };
  await retry();
  expect(output()).toContain('RETAINED_DRAFT_EDIT');
  expect(button('Save draft').props.disabled).toBe(true);
  await act(async () => button('Save draft').props.onPress());
  expect(parent.write).toHaveBeenCalledTimes(1);
  parent.detail.mockResolvedValueOnce(earlyExitDetail({ revision: 3 }));
  await retry();
  await press('Save draft');
  expect(parent.write.mock.calls[1][2]).toEqual({
    kind: 'edit',
    id: 'request-A',
    body: {
      ...earlyExitFields,
      reason: 'RETAINED_DRAFT_EDIT',
      applicationRevision: 3,
      clientOperationId: 'nonce-2',
    },
  });
});

test('Parent real-hook child switch keeps the old child response invalid without changing focus', async () => {
  childrenTransport.children.mockResolvedValue({
    items: [earlyExitChild(), earlyExitChild('B')],
  });
  parent.list.mockImplementation(async (_token, child) => ({
    items: [
      earlyExitDetail({ studentId: child, requestId: `request-${child}` }),
    ],
    nextOffset: null,
  }));
  const old = await holdRead('parent');
  await act(async () =>
    tree!.root
      .findAllByType(WorkspaceTabs)
      .find(node => node.props.accessibilityLabel === 'Verified children')!
      .props.onSelect('Child B · Grade 8 A · Own Branch'),
  );
  await act(async () => old.succeed());
  expect(output()).not.toContain(marker);
  expect(output()).toContain('Early Exit · Child B');
  expect(parent.list).toHaveBeenLastCalledWith('token-A', 'B', 0, undefined);
  expect(mockAuth.logout).not.toHaveBeenCalled();
});
