import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import {TextInput} from 'react-native';
import Screen from '../src/screens/principal/StudentEnrollmentScreen';
import Workspace from '../src/screens/principal/PrincipalWorkspaceScreen';
import {Button} from '../src/components/hiraDashboard';
import {AdminDialog, AdminSelect} from '../src/components/hiraDashboard/AdminForm';
import {enrollmentService as service} from '../src/services/admin/enrollmentService';
import {ApiError} from '../src/services/api/apiClient';
const mockNavigate = jest.fn();
jest.mock('../src/context/AuthContext', () => ({useAuth: () => ({user: {role: 'principal'}, accessToken: 'token', logout: jest.fn()})}));
jest.mock('@react-navigation/native', () => ({useNavigation: () => ({navigate: mockNavigate}), useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect])}));
jest.mock('react-native-safe-area-context', () => ({SafeAreaView: 'SafeAreaView'}));
jest.mock('../src/screens/principal/PrincipalDashboardScreen', () => () => 'Principal Home');
jest.mock('../src/screens/principal/PrincipalApprovalsScreen', () => () => 'Approvals');
jest.mock('../src/screens/principal/PrincipalInboxScreen', () => () => 'Inbox');
jest.mock('../src/services/admin/enrollmentService', () => ({enrollmentService: {list: jest.fn(), detail: jest.fn(), options: jest.fn(), mutate: jest.fn()}}));
const api = jest.mocked(service), trees: Renderer.ReactTestRenderer[] = [];
const enrollment = {id: 'enrollment-private', period: {id: 'period-private', name: 'Academic Year 2026', code: 'AY26', status: 'active'}, class: {id: 'class-private', name: 'Grade 8', code: 'G8'}, section: {id: 'section-private', name: 'Section A', code: 'A'}, status: 'active', revision: 1, effectiveFrom: '2026-09-01T00:00:00Z', effectiveTo: null, reason: 'Initial enrollment', closedReason: null};
const detail = {student: {id: 'student-private', fullName: 'Ayesha Ahmed', admissionNumber: 'A-100', isActive: true}, current: enrollment, legacy: false, history: [enrollment], nextOffset: null, actions: {enroll: false, transfer: true, promote: true, withdraw: true}};
const options = {period: enrollment.period, classes: [enrollment.class], sections: [enrollment.section, {id: 'section-b', name: 'Section B', code: 'B'}], nextOffset: null};
const text = (tree: Renderer.ReactTestRenderer) => {const flatten = (node: any): string => typeof node === 'string' ? node : Array.isArray(node) ? node.map(flatten).join('') : node?.children ? flatten(node.children) : ''; return flatten(tree.toJSON());};
const button = (tree: Renderer.ReactTestRenderer, title: string) => tree.root.findAllByType(Button).find(n => n.props.title === title)!;
const dialog = (tree: Renderer.ReactTestRenderer) => tree.root.findAllByType(AdminDialog).find(n => n.props.visible)!;
const select = async (tree: Renderer.ReactTestRenderer, title: string, value: string) => {await act(async () => tree.root.findAllByType(AdminSelect).find(n => n.props.label === title)!.props.onSelect(value));};
const press = async (tree: Renderer.ReactTestRenderer, title: string) => {await act(async () => button(tree, title).props.onPress());};
async function render(element = <Screen />) {let tree!: Renderer.ReactTestRenderer; await act(async () => {tree = Renderer.create(element);}); trees.push(tree); return tree;}
async function open(tree: Renderer.ReactTestRenderer) {await press(tree, 'Enrollment for Ayesha Ahmed');}
async function reason(tree: Renderer.ReactTestRenderer) {await act(async () => tree.root.findAllByType(TextInput).find(n => n.props.accessibilityLabel === 'Reason')!.props.onChangeText!('Principal reviewed placement'));}
beforeEach(() => {jest.clearAllMocks(); api.list.mockResolvedValue({items: [{id: detail.student.id, fullName: detail.student.fullName, admissionNumber: 'A-100', current: enrollment, legacy: false}], total: 1, nextOffset: null}); api.detail.mockResolvedValue(detail); api.options.mockResolvedValue(options); api.mutate.mockResolvedValue({enrollment, action: 'enroll'});});
afterEach(async () => {await act(async () => trees.splice(0).forEach(tree => tree.unmount()));});
test('Principal drawer opens dedicated Students & Enrollment without changing Home', async () => {
  const tree = await render(<Workspace />); await act(async () => tree.root.findAll(n => n.props.accessibilityLabel === 'Open navigation drawer' && typeof n.props.onPress === 'function')[0].props.onPress()); const action = tree.root.findAll(n => n.props.accessibilityLabel === 'Students & Enrollment' && typeof n.props.onPress === 'function')[0]; await act(async () => action.props.onPress()); expect(mockNavigate).toHaveBeenCalledWith('StudentsEnrollment');
});
test('Student list/search and detail show named current enrollment and history without raw IDs', async () => {
  const tree = await render(); expect(text(tree)).toContain('Ayesha Ahmed'); await act(async () => tree.root.findAllByType(TextInput).find(n => n.props.accessibilityLabel === 'Search Students')!.props.onChangeText!('A-100'));
  expect(api.list).toHaveBeenLastCalledWith('token', 'A-100', '', 0); await open(tree); expect(text(tree)).toContain('Enrollment History'); expect(text(tree)).toContain('Academic Year 2026 / Grade 8 / Section A'); expect(text(tree)).not.toContain('private');
});
test('initial enrollment validates target/reason and waits for explicit review and server confirmation', async () => {
  api.detail.mockResolvedValue({...detail, current: null, legacy: true, history: [], actions: {...detail.actions, enroll: true, transfer: false, promote: false, withdraw: false}});
  const tree = await render(); await open(tree); await press(tree, 'Enroll'); await act(async () => dialog(tree).props.onConfirm()); expect(api.mutate).not.toHaveBeenCalled(); expect(text(tree)).toContain('Complete enrollment details');
  await select(tree, 'Target Class', 'class-private'); await select(tree, 'Target Section', 'section-b'); await reason(tree); await act(async () => dialog(tree).props.onConfirm()); expect(dialog(tree).props.title).toBe('Confirm Enroll'); expect(text(tree)).toContain('Target: Academic Year 2026 / Grade 8 / Section B'); expect(api.mutate).not.toHaveBeenCalled();
  await act(async () => dialog(tree).props.onConfirm()); expect(api.mutate).toHaveBeenCalledWith('token', 'student-private', 'enroll', null, expect.objectContaining({classId: 'class-private', sectionId: 'section-b', reason: 'Principal reviewed placement', operationId: expect.any(String)})); expect(text(tree)).toContain('Enrollment updated');
});
test.each(['transfer', 'promote', 'withdraw'] as const)('%s shows Student, current and target confirmation and retains historical entries after success', async action => {
  const tree = await render(); await open(tree); await press(tree, action === 'transfer' ? 'Transfer Section' : action === 'promote' ? 'Promote' : 'Withdraw');
  if (action !== 'withdraw') {if(action === 'promote') await select(tree, 'Target Class', 'class-private'); await select(tree, 'Target Section', 'section-b');} await reason(tree); await act(async () => dialog(tree).props.onConfirm()); expect(text(tree)).toContain('Current: Academic Year 2026 / Grade 8 / Section A'); expect(text(tree)).toContain(action === 'withdraw' ? 'Target: Withdrawn' : 'Section B');
  await act(async () => dialog(tree).props.onConfirm()); expect(api.mutate.mock.calls[0][2]).toBe(action); expect(text(tree)).toContain('Enrollment History'); expect(text(tree)).toContain('Initial enrollment');
});
test.each([new ApiError(403, 'Forbidden'), new ApiError(409, 'Enrollment changed'), new Error('Network unavailable')])('failed mutation keeps retry operation identity and never fabricates success: %s', async failure => {
  const tree = await render(); await open(tree); await press(tree, 'Withdraw'); await reason(tree); await act(async () => dialog(tree).props.onConfirm()); api.mutate.mockRejectedValueOnce(failure);
  await act(async () => dialog(tree).props.onConfirm()); expect(text(tree)).toContain('Change not confirmed'); expect(text(tree)).not.toContain('Enrollment updated'); const first = api.mutate.mock.calls[0][4]; await act(async () => dialog(tree).props.onConfirm()); expect(api.mutate.mock.calls[1][4]).toEqual(first); expect(text(tree)).toContain('Enrollment updated');
});
test('duplicate confirm taps send one mutation and no success appears until server resolves', async () => {
  const tree = await render(); await open(tree); await press(tree, 'Withdraw'); await reason(tree); await act(async () => dialog(tree).props.onConfirm()); let finish!: (value: any) => void; api.mutate.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
  await act(async () => {dialog(tree).props.onConfirm(); dialog(tree).props.onConfirm();}); expect(api.mutate).toHaveBeenCalledTimes(1); expect(dialog(tree).props.busy).toBe(true); expect(text(tree)).not.toContain('Enrollment updated'); await act(async () => finish({enrollment, action: 'withdraw'})); expect(text(tree)).toContain('Enrollment updated');
});
test('server read-only actions remain hidden; detail load failure offers authoritative refresh', async () => {
  api.detail.mockRejectedValueOnce(new ApiError(404, 'Unavailable')); const tree = await render(); await open(tree); expect(text(tree)).toContain('Student unavailable'); await press(tree, 'Refresh enrollment'); expect(text(tree)).toContain('Ayesha Ahmed');
  api.detail.mockResolvedValue({...detail, actions: {enroll: false, transfer: false, promote: false, withdraw: false}}); await press(tree, 'Refresh enrollment'); expect(button(tree, 'Withdraw')).toBeUndefined();
});
test('empty list and network failure provide clear retry', async () => {
  api.list.mockRejectedValueOnce(new Error('Network unavailable')); const tree = await render(); expect(text(tree)).toContain('Students unavailable'); api.list.mockResolvedValue({items: [], total: 0, nextOffset: null}); await press(tree, 'Retry Students'); expect(text(tree)).toContain('No Students found');
});

test('readmission is explicit and confirmation retains withdrawn history', async () => {
  const withdrawn = {...enrollment, status: 'withdrawn', effectiveTo: '2026-10-01T00:00:00Z'};
  api.detail.mockResolvedValue({...detail, current: null, history: [withdrawn], actions: {enroll: true, transfer: false, promote: false, withdraw: false}});
  const tree = await render(); await open(tree); expect(text(tree)).toContain('withdrawn'); await press(tree, 'Readmit');
  await select(tree, 'Target Class', 'class-private'); await select(tree, 'Target Section', 'section-b'); await reason(tree); await act(async () => dialog(tree).props.onConfirm());
  expect(dialog(tree).props.title).toBe('Confirm Readmit'); expect(api.mutate).not.toHaveBeenCalled();
  await act(async () => dialog(tree).props.onConfirm()); expect(api.mutate.mock.calls[0][2]).toBe('enroll'); expect(text(tree)).toContain('withdrawn');
});
test('confirmed save followed by refresh failure preserves success and hides stale actions', async () => {
  const tree = await render(); await open(tree); await press(tree, 'Withdraw'); await reason(tree); await act(async () => dialog(tree).props.onConfirm());
  api.detail.mockRejectedValueOnce(new Error('Refresh network failed')); await act(async () => dialog(tree).props.onConfirm());
  expect(text(tree)).toContain('Enrollment saved'); expect(text(tree)).not.toContain('Change not confirmed'); expect(button(tree, 'Withdraw')).toBeUndefined(); expect(button(tree, 'Refresh enrollment')).toBeDefined();
});
test('failed target reload clears stale Section choices and offers retry', async () => {
  const tree = await render(); await open(tree); await press(tree, 'Promote');
  api.options.mockRejectedValueOnce(new Error('Options network failed')); await select(tree, 'Target Class', 'class-private');
  expect(tree.root.findAllByType(AdminSelect).find(n => n.props.label === 'Target Section')!.props.options).toEqual([]);
  expect(text(tree)).toContain('Academic options unavailable'); await press(tree, 'Retry academic options');
  expect(tree.root.findAllByType(AdminSelect).find(n => n.props.label === 'Target Section')!.props.options.length).toBe(2);
});
