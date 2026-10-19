import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import Panel from '../src/screens/admin/ClassSubjectsPanel';
import Screen from '../src/screens/admin/AcademicSetupScreen';
import {Button} from '../src/components/hiraDashboard';
import {AdminDialog, AdminSelect} from '../src/components/hiraDashboard/AdminForm';
import {classSubjectService as service} from '../src/services/admin/classSubjectService';
import {academicSetupService as setupService} from '../src/services/admin/academicSetupService';
import {ApiError} from '../src/services/api/apiClient';
let mockRole = 'principal';
jest.mock('../src/context/AuthContext', () => ({useAuth: () => ({user: {role: mockRole}, accessToken: 'token'})}));
jest.mock('@react-navigation/native', () => ({useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect])}));
jest.mock('react-native-safe-area-context', () => ({SafeAreaView: 'SafeAreaView'}));
jest.mock('../src/services/admin/classSubjectService', () => ({classSubjectService: {list: jest.fn(), options: jest.fn(), create: jest.fn(), lifecycle: jest.fn()}}));
jest.mock('../src/services/admin/academicSetupService', () => ({academicSetupService: {branches: jest.fn(), periods: jest.fn(), list: jest.fn()}}));
const api = jest.mocked(service), setup = jest.mocked(setupService), trees: Renderer.ReactTestRenderer[] = [];
const row = {id: 'mapping-private', subject: {id: 'subject-private', name: 'Mathematics', isActive: true}, isActive: true, revision: 1};
const context = {class: {id: 'class-private', name: 'Grade 8', code: 'G8', isActive: true}, period: {id: 'period-private', name: 'Academic Year 2026', code: 'AY26', status: 'active'}, writable: true, total: 1, nextOffset: null, items: [row]};
const text = (tree: Renderer.ReactTestRenderer) => {const flatten = (node: any): string => typeof node === 'string' ? node : Array.isArray(node) ? node.map(flatten).join('') : node?.children ? flatten(node.children) : ''; return flatten(tree.toJSON());};
const button = (tree: Renderer.ReactTestRenderer, title: string) => tree.root.findAllByType(Button).find(node => node.props.title === title)!;
const dialog = (tree: Renderer.ReactTestRenderer) => tree.root.findAllByType(AdminDialog).find(node => node.props.visible)!;
const press = async (tree: Renderer.ReactTestRenderer, title: string) => {await act(async () => button(tree, title).props.onPress());};
async function render(element = <Panel classId="class-private" />) {let tree!: Renderer.ReactTestRenderer; await act(async () => {tree = Renderer.create(element);}); trees.push(tree); return tree;}
beforeEach(() => {
  jest.clearAllMocks(); mockRole = 'principal';
  api.list.mockResolvedValue(context); api.options.mockResolvedValue({items: [{id: 'science-private', name: 'Science'}], total: 1, nextOffset: null}); api.create.mockResolvedValue(row); api.lifecycle.mockResolvedValue(row);
  setup.branches.mockResolvedValue({items: [{id: 'branch-private', name: 'Main Campus', code: 'MAIN'}]});
  setup.periods.mockResolvedValue({items: [], total: 0, nextOffset: null, branchName: 'Main Campus', current: {id: 'period-private', name: 'Academic Year 2026', code: 'AY26', startDate: '2026-08-01', endDate: '2027-07-31', revision: 1, status: 'active'}});
  setup.list.mockResolvedValue({items: [{id: 'class-private', name: 'Grade 8', code: 'G8', academicPeriodId: 'period-private', isActive: true, revision: 1}], total: 1, nextOffset: null, branchName: 'Main Campus'});
});
afterEach(async () => {await act(async () => trees.splice(0).forEach(tree => tree.unmount()));});
test('Principal navigates Academic Setup to selected-Class Subjects', async () => {
  const tree = await render(<Screen />); await press(tree, 'Subjects for Grade 8');
  expect(api.list).toHaveBeenLastCalledWith('token', 'class-private', undefined, 0);
  expect(text(tree)).toContain('Class Subjects'); expect(text(tree)).toContain('Grade 8'); expect(text(tree)).toContain('Academic Year 2026');
  expect(text(tree)).not.toContain('private');
});
test('mapping list and valid Subject choices are separate; mapped names are excluded from selector', async () => {
  const tree = await render(); expect(text(tree)).toContain('Mathematics'); await press(tree, 'Add Subject to Class');
  const choices = tree.root.findByType(AdminSelect).props.options;
  expect(choices).toEqual([{id: 'science-private', label: 'Science'}]);
  expect(choices.map((value: any) => value.label)).not.toContain('Mathematics');
});
test('empty mapping and exhausted Subject options have clear states', async () => {
  api.list.mockResolvedValue({...context, items: [], total: 0}); api.options.mockResolvedValue({items: [], total: 0, nextOffset: null});
  const tree = await render(); expect(text(tree)).toContain('No Class Subjects yet'); await press(tree, 'Add Subject to Class'); expect(text(tree)).toContain('No Subjects remain to add');
  await act(async () => dialog(tree).props.onConfirm()); expect(api.create).not.toHaveBeenCalled(); expect(text(tree)).toContain('Select an available Branch Subject');
});
test('add validates, prevents repeat submit and waits for server-confirmed success', async () => {
  const tree = await render(); await press(tree, 'Add Subject to Class');
  await act(async () => tree.root.findByType(AdminSelect).props.onSelect('science-private'));
  let finish!: (value: any) => void; api.create.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
  await act(async () => {dialog(tree).props.onConfirm(); dialog(tree).props.onConfirm();});
  expect(api.create).toHaveBeenCalledTimes(1); expect(dialog(tree).props.busy).toBe(true); expect(text(tree)).not.toContain('server confirmed');
  await act(async () => finish(row)); expect(text(tree)).toContain('Subject added to Class');
  expect(api.create).toHaveBeenCalledWith('token', 'class-private', 'science-private', undefined);
});
test.each([new ApiError(409, 'Subject is already added'), new ApiError(403, 'Forbidden'), new ApiError(404, 'Unavailable'), new Error('Network request failed')])('create failure retains form and offers retry: %s', async error => {
  const tree = await render(); await press(tree, 'Add Subject to Class'); await act(async () => tree.root.findByType(AdminSelect).props.onSelect('science-private'));
  api.create.mockRejectedValueOnce(error); await act(async () => dialog(tree).props.onConfirm());
  expect(dialog(tree).props.visible).toBe(true); expect(text(tree)).toContain('Change not saved'); expect(text(tree)).not.toContain('server confirmed');
  await act(async () => dialog(tree).props.onConfirm()); expect(text(tree)).toContain('Subject added to Class');
});
test('deactivation requires confirmation and surfaces dependency conflict without success', async () => {
  const tree = await render(); await press(tree, 'Deactivate Mathematics'); expect(api.lifecycle).not.toHaveBeenCalled();
  api.lifecycle.mockRejectedValueOnce(new ApiError(409, 'Revoke active Teacher Assignments first')); await act(async () => dialog(tree).props.onConfirm());
  expect(text(tree)).toContain('Revoke active Teacher Assignments first'); expect(dialog(tree).props.visible).toBe(true);
  await act(async () => dialog(tree).props.onConfirm());
  expect(api.lifecycle).toHaveBeenLastCalledWith('token', 'class-private', row, 'deactivate', undefined);
});
test('inactive mapping can be reactivated; inactive catalog Subject cannot', async () => {
  api.list.mockResolvedValue({...context, items: [{...row, isActive: false}]});
  const tree = await render(); expect(text(tree)).toContain('Inactive'); await press(tree, 'Reactivate Mathematics'); await act(async () => dialog(tree).props.onConfirm()); expect(api.lifecycle).toHaveBeenLastCalledWith('token', 'class-private', {...row, isActive: false}, 'reactivate', undefined);
  api.list.mockResolvedValue({...context, items: [{...row, isActive: false, subject: {...row.subject, isActive: false}}]});
  const inactiveCatalog = await render(); expect(button(inactiveCatalog, 'Reactivate Mathematics').props.disabled).toBe(true);
  expect(text(inactiveCatalog)).toContain('Subject is inactive in the Branch catalog.');
});
test('network loading failure has retry and loading state', async () => {
  let finish!: (value: any) => void; api.list.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
  const tree = await render(); expect(tree.root.findAll(node => node.props.accessibilityLabel === 'Loading Class Subjects').length).toBeGreaterThan(0);
  await act(async () => finish(context)); api.list.mockRejectedValueOnce(new Error('Network unavailable'));
  // Remount represents returning to this Class; shared resource also revalidates on focus.
  const another = await render(); expect(text(another)).toContain('Network unavailable'); await press(another, 'Retry Class Subjects'); expect(text(another)).toContain('Mathematics');
});
test('closed-period context is read-only; Teacher cannot see management controls', async () => {
  api.list.mockResolvedValue({...context, writable: false, period: {...context.period, status: 'closed'}});
  const tree = await render(); expect(button(tree, 'Add Subject to Class')).toBeUndefined(); expect(api.options).not.toHaveBeenCalled();
  mockRole = 'teacher'; const teacherTree = await render(); expect(button(teacherTree, 'Deactivate Mathematics')).toBeUndefined();
});
test('stale mapping revision can reload authoritative state before retrying', async () => {
  const tree = await render(); await press(tree, 'Deactivate Mathematics');
  api.lifecycle.mockRejectedValueOnce(new ApiError(409, 'Class Subject changed; refresh before saving'));
  await act(async () => dialog(tree).props.onConfirm());
  api.list.mockResolvedValue({...context, items: [{...row, revision: 2}]});
  await press(tree, 'Reload Class Subjects'); await press(tree, 'Deactivate Mathematics'); await act(async () => dialog(tree).props.onConfirm());
  expect(api.lifecycle).toHaveBeenLastCalledWith('token', 'class-private', {...row, revision: 2}, 'deactivate', undefined);
});
