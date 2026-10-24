import RoomsScreen from '../src/screens/admin/RoomsScreen';
import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import {TextInput} from 'react-native';
import Screen from '../src/screens/admin/AcademicSetupScreen';
import {Button} from '../src/components/hiraDashboard';
import {AdminDialog, AdminSelect, AdminDateField} from '../src/components/hiraDashboard/AdminForm';
import {academicSetupService as service, type CatalogRecord} from '../src/services/admin/academicSetupService';
import {ApiError} from '../src/services/api/apiClient';
let mockRole = 'principal';
jest.mock('../src/context/AuthContext', () => ({useAuth: () => ({user: {role: mockRole}, accessToken: 'token'})}));
jest.mock('@react-navigation/native', () => ({useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect])}));
jest.mock('react-native-safe-area-context', () => ({SafeAreaView: 'SafeAreaView'}));
jest.mock('../src/services/admin/academicSetupService', () => ({academicSetupService: {branches: jest.fn(), periods: jest.fn(), list: jest.fn(), create: jest.fn(), update: jest.fn(), lifecycle: jest.fn()}}));
const api = jest.mocked(service), trees: Renderer.ReactTestRenderer[] = [];
const current = {id: 'period-private', name: 'Academic Year 2026', code: 'AY26', startDate: '2026-08-01', endDate: '2027-07-31', status: 'active' as const, revision: 1};
const classRow: CatalogRecord = {id: 'class-private', name: 'Grade 8', code: 'G8', academicPeriodId: current.id, periodName: current.name, periodStatus: 'active', isActive: true, revision: 1};
const page = (items: any[]) => ({items, total: items.length, nextOffset: null, branchName: 'Main Campus'});
const text = (tree: Renderer.ReactTestRenderer): string => {
  const content = (node: any): string => typeof node === 'string' ? node : Array.isArray(node) ? node.map(content).join('') : node?.children ? content(node.children) : '';
  return content(tree.toJSON());
};
const button = (tree: Renderer.ReactTestRenderer, title: string) => tree.root.findAllByType(Button).find(n => n.props.title === title)!;
const dialog = (tree: Renderer.ReactTestRenderer) => tree.root.findAllByType(AdminDialog).find(n => n.props.visible)!;
const press = async (tree: Renderer.ReactTestRenderer, title: string) => {await act(async () => button(tree, title).props.onPress());};
const tab = async (tree: Renderer.ReactTestRenderer, title: string) => {await act(async () => tree.root.findAll(n => n.props.accessibilityRole === 'tab' && n.props.accessibilityLabel === title && typeof n.props.onPress === 'function')[0].props.onPress());};
async function render(element = <Screen />) {let tree!: Renderer.ReactTestRenderer; await act(async () => {tree = Renderer.create(element);}); trees.push(tree); return tree;}
async function fill(tree: Renderer.ReactTestRenderer, name: string, code?: string) {
  await act(async () => {
    tree.root.findAllByType(TextInput).find(n => n.props.accessibilityLabel === 'Name')!.props.onChangeText(name);
  });
  if (code) await act(async () => tree.root.findAllByType(TextInput).find(n => n.props.accessibilityLabel === 'Code')!.props.onChangeText(code));
}
beforeEach(() => {
  jest.clearAllMocks(); mockRole = 'principal';
  api.branches.mockResolvedValue({items: [{id: 'branch-private', name: 'Main Campus', code: 'MAIN'}]});
  api.periods.mockResolvedValue({...page([current]), current});
  api.list.mockImplementation(async (_token, kind) => page(kind === 'classes' ? [classRow] : []));
  api.create.mockResolvedValue(classRow); api.update.mockResolvedValue(classRow); api.lifecycle.mockResolvedValue(classRow);
});
afterEach(async () => {await act(async () => trees.splice(0).forEach(t => t.unmount()));});
test('Principal sees current period dates read-only and no raw identifiers', async () => {
  const tree = await render(); await tab(tree, 'Academic Period');
  expect(text(tree)).toContain('2026-08-01'); expect(text(tree)).toContain('read-only');
  expect(button(tree, 'Create Academic Period')).toBeUndefined();
  expect(button(tree, 'Close Academic Year 2026')).toBeUndefined();
  expect(text(tree)).not.toContain('period-private'); expect(text(tree)).not.toContain('branch-private');
  expect(api.periods).toHaveBeenLastCalledWith('token', {offset: 0});
});
test('Class loading, empty and retry states use the existing resource flow', async () => {
  let resolve!: (value: any) => void;
  api.list.mockImplementationOnce(() => new Promise(r => {resolve = r;}));
  const tree = await render(); expect(text(tree)).toContain('Loading academic setup');
  await act(async () => resolve(page([]))); expect(text(tree)).toContain('No classes yet');
  api.list.mockRejectedValueOnce(new Error('Network unavailable'));
  await tab(tree, 'Subjects'); expect(text(tree)).toContain('Network unavailable');
  await press(tree, 'Retry academic setup'); expect(text(tree)).toContain('No subjects yet');
});
test('Class create validates and shows success only after server confirmation', async () => {
  const tree = await render(); await press(tree, 'Create Class');
  await act(async () => dialog(tree).props.onConfirm()); expect(api.create).not.toHaveBeenCalled();
  await fill(tree, 'Grade 9', 'G9');
  let resolve!: (value: any) => void; api.create.mockImplementationOnce(() => new Promise(r => {resolve = r;}));
  await act(async () => dialog(tree).props.onConfirm());
  expect(text(tree)).not.toContain('The server confirmed'); expect(dialog(tree).props.busy).toBe(true);
  expect(api.create).toHaveBeenCalledWith('token', 'classes', {}, {name: 'Grade 9', code: 'G9', academicPeriodId: current.id});
  await act(async () => resolve(classRow)); expect(text(tree)).toContain('Class saved');
});
test.each([new ApiError(409, 'Record changed; refresh before saving'), new ApiError(403, 'Forbidden'), new ApiError(404, 'Concealed record'), new Error('Network request failed')])('failed Class mutation keeps the form and never claims success: %s', async error => {
  const tree = await render(); await press(tree, 'Edit Grade 8'); await fill(tree, 'Grade Eight');
  api.update.mockRejectedValueOnce(error); await act(async () => dialog(tree).props.onConfirm());
  expect(dialog(tree).props.visible).toBe(true); expect(text(tree)).not.toContain('The server confirmed');
  expect(text(tree)).toContain(error instanceof ApiError && error.status === 403 ? 'no longer have permission' : error instanceof ApiError && error.status === 404 ? 'no longer available in your branch' : error.message);
  await act(async () => dialog(tree).props.onConfirm());
  expect(api.update).toHaveBeenLastCalledWith('token', 'classes', {}, classRow.id, {name: 'Grade Eight', code: 'G8', revision: 1});
  expect(text(tree)).toContain('Class saved');
});
test('Class lifecycle confirms, shows conflicts, and supports inactive records', async () => {
  const tree = await render(); await press(tree, 'Deactivate Grade 8');
  expect(api.lifecycle).not.toHaveBeenCalled();
  api.lifecycle.mockRejectedValueOnce(new ApiError(409, 'This Class has Sections'));
  await act(async () => dialog(tree).props.onConfirm()); expect(text(tree)).toContain('This Class has Sections');
  await act(async () => dialog(tree).props.onClose());
  api.list.mockResolvedValue(page([{...classRow, isActive: false}]));
  await tab(tree, 'Subjects'); await tab(tree, 'Classes');
  expect(button(tree, 'Reactivate Grade 8')).toBeDefined(); expect(text(tree)).toContain('Inactive');
});
test('Sections are contextual to the selected Class and support create/edit/deactivate', async () => {
  const tree = await render(); await press(tree, 'Sections for Grade 8');
  expect(api.list).toHaveBeenLastCalledWith('token', 'sections', {classId: classRow.id, offset: 0});
  expect(text(tree)).toContain('Grade 8'); await press(tree, 'Create Section'); await fill(tree, 'Blue', 'B');
  api.list.mockResolvedValue(page([{id: 'section-private', name: 'Blue', code: 'B', classId: classRow.id, revision: 1, isActive: true}]));
  await act(async () => dialog(tree).props.onConfirm());
  expect(api.create).toHaveBeenLastCalledWith('token', 'sections', {}, {name: 'Blue', code: 'B', classId: classRow.id});
  await press(tree, 'Edit Blue'); await fill(tree, 'Blue Section'); await act(async () => dialog(tree).props.onConfirm());
  expect(api.update).toHaveBeenLastCalledWith('token', 'sections', {}, 'section-private', {name: 'Blue Section', code: 'B', revision: 1});
  await press(tree, 'Deactivate Blue'); await act(async () => dialog(tree).props.onConfirm());
  expect(api.lifecycle).toHaveBeenLastCalledWith('token', 'sections', {}, 'section-private', 'deactivate', 1);
});
test('Subject catalog create/edit/deactivate uses server-confirmed changes', async () => {
  const tree = await render(); await tab(tree, 'Subjects'); await press(tree, 'Create Subject'); await fill(tree, 'Science');
  api.list.mockResolvedValue(page([{id: 'subject-private', name: 'Science', isActive: true, revision: 1}]));
  await act(async () => dialog(tree).props.onConfirm());
  expect(api.create).toHaveBeenLastCalledWith('token', 'subjects', {}, {name: 'Science'});
  await press(tree, 'Edit Science'); await fill(tree, 'Physics'); await act(async () => dialog(tree).props.onConfirm());
  expect(api.update).toHaveBeenLastCalledWith('token', 'subjects', {}, 'subject-private', {name: 'Physics', revision: 1});
  await press(tree, 'Deactivate Science'); await act(async () => dialog(tree).props.onConfirm());
  expect(api.lifecycle).toHaveBeenLastCalledWith('token', 'subjects', {}, 'subject-private', 'deactivate', 1);
});
test('no active period blocks Class creation while legacy records remain readable', async () => {
  api.periods.mockResolvedValue({...page([]), current: null});
  api.list.mockResolvedValue(page([{...classRow, academicPeriodId: null, legacy: true}]));
  const tree = await render(); expect(text(tree)).toContain('No current Academic Period');
  expect(text(tree)).toContain('Legacy Class'); expect(button(tree, 'Create Class').props.disabled).toBe(true);
  expect(text(tree)).toContain('Ask your Super Admin to create and activate');
  expect(button(tree, 'Edit Grade 8')).toBeUndefined(); expect(button(tree, 'Sections for Grade 8')).toBeDefined();
});
test('Super Admin can bootstrap the first period through a named Branch selector', async () => {
  mockRole = 'super_admin'; api.periods.mockResolvedValue({...page([]), current: null});
  const tree = await render(); expect(api.periods).not.toHaveBeenCalled();
  await act(async () => tree.root.findByType(AdminSelect).props.onSelect('branch-private'));
  await press(tree, 'Create Academic Period'); await fill(tree, 'Next Year', 'NEXT');
  await act(async () => tree.root.findAllByType(AdminDateField)[0].props.onChange('2027-08-01'));
  await act(async () => tree.root.findAllByType(AdminDateField)[1].props.onChange('2028-07-31'));
  api.periods.mockResolvedValue({...page([{...current, status: 'draft'}]), current: null});
  await act(async () => dialog(tree).props.onConfirm());
  expect(api.create).toHaveBeenLastCalledWith('token', 'periods', {branchId: 'branch-private'}, {name: 'Next Year', code: 'NEXT', startDate: '2027-08-01', endDate: '2028-07-31'});
  await press(tree, 'Activate Academic Year 2026'); await act(async () => dialog(tree).props.onConfirm());
  expect(api.lifecycle).toHaveBeenLastCalledWith('token', 'periods', {branchId: 'branch-private'}, current.id, 'activate', 1);
});

test('period Save changes button validates, prevents duplicate requests, and renders the refreshed draft', async () => {
  mockRole = 'super_admin'; api.periods.mockResolvedValue({...page([]), current: null});
  const tree = await render();
  await act(async () => tree.root.findByType(AdminSelect).props.onSelect('branch-private'));
  await press(tree, 'Create Academic Period');
  await press(tree, 'Save changes');
  expect(api.create).not.toHaveBeenCalled(); expect(text(tree)).toContain('Enter a name');
  await fill(tree, 'Next Year', 'NEXT');
  await act(async () => tree.root.findAllByType(AdminDateField)[0].props.onChange('2027-08-01'));
  await act(async () => tree.root.findAllByType(AdminDateField)[1].props.onChange('2028-07-31'));
  let resolve!: (value: any) => void;
  api.create.mockImplementationOnce(() => new Promise(r => {resolve = r;}));
  const submit = button(tree, 'Save changes').props.onPress;
  await act(async () => {submit(); submit();});
  expect(api.create).toHaveBeenCalledTimes(1); expect(dialog(tree).props.busy).toBe(true);
  const draft = {...current, name: 'Next Year', code: 'NEXT', status: 'draft' as const};
  api.periods.mockResolvedValue({...page([draft]), current: null});
  await act(async () => resolve(draft));
  expect(text(tree)).toContain('Academic Period saved'); expect(button(tree, 'Edit Next Year')).toBeDefined();
  expect(api.periods).toHaveBeenCalledTimes(2);
});

test('period edit uses PATCH contract, keeps server errors visible, and refreshes the revised name', async () => {
  mockRole = 'super_admin';
  const draft = {...current, status: 'draft' as const};
  api.periods.mockResolvedValue({...page([draft]), current: null});
  const tree = await render();
  await act(async () => tree.root.findByType(AdminSelect).props.onSelect('branch-private'));
  await press(tree, 'Edit Academic Year 2026'); await fill(tree, 'Revised Year');
  api.update.mockRejectedValueOnce(new ApiError(409, 'Record changed; refresh before saving'));
  await press(tree, 'Save changes');
  expect(text(tree)).toContain('Record changed; refresh before saving'); expect(dialog(tree).props.visible).toBe(true);
  api.periods.mockResolvedValue({...page([{...draft, name: 'Revised Year', revision: 2}]), current: null});
  await press(tree, 'Save changes');
  expect(api.update).toHaveBeenLastCalledWith('token', 'periods', {branchId: 'branch-private'}, draft.id, {name: 'Revised Year', startDate: draft.startDate, endDate: draft.endDate, revision: 1});
  expect(button(tree, 'Edit Revised Year')).toBeDefined(); expect(text(tree)).toContain('Academic Period saved');
});

test('Super Admin Class creation uses the existing branch-scoped flow and refreshes the list', async () => {
  mockRole = 'super_admin'; const tree = await render();
  await act(async () => tree.root.findByType(AdminSelect).props.onSelect('branch-private'));
  await tab(tree, 'Classes'); await press(tree, 'Create Class'); await fill(tree, 'Grade 9', 'G9');
  api.list.mockResolvedValue(page([{...classRow, name: 'Grade 9', code: 'G9'}]));
  await press(tree, 'Save changes');
  expect(api.create).toHaveBeenLastCalledWith('token', 'classes', {branchId: 'branch-private'}, {name: 'Grade 9', code: 'G9', academicPeriodId: current.id});
  expect(button(tree, 'Edit Grade 9')).toBeDefined();
});


const dateValidationMessage = 'Enter valid dates in YYYY-MM-DD format. The end date must be after the start date.';
async function periodForm() {
  mockRole = 'super_admin';
  const tree = await render();
  await act(async () => tree.root.findByType(AdminSelect).props.onSelect('branch-private'));
  await press(tree, 'Create Academic Period'); await fill(tree, 'Date audit', 'DATES');
  return tree;
}
async function enterDates(tree: Renderer.ReactTestRenderer, start: string, end: string) {
  for (const [label, value] of [['First day of academic period', start], ['Last day of academic period', end]]) {
    await act(async () => tree.root.findAllByType(TextInput).find(n => n.props.accessibilityLabel === label)!.props.onChangeText(value));
  }
}
test.each([
  ['', '2027-03-31'], ['2026-04-01\n', '2027-03-31'], [' 2026-04-01', '2027-03-31'],
  ['0000-01-01', '2027-03-31'], ['2026-02-29', '2027-03-31'],
  ['1900-02-29', '1900-03-01'], ['2026-04-31', '2027-03-31'],
  ['2026-00-01', '2027-03-31'], ['2026-13-01', '2027-03-31'],
  ['2026-04-00', '2027-03-31'], ['01-04-2026', '2027-03-31'],
  ['04/01/2026', '2027-03-31'], ['2026-4-1', '2027-03-31'],
  ['2026-04-01T00:00:00Z', '2027-03-31'], ['2026-04-01', '2026-04-01'],
  ['2026-04-02', '2026-04-01'], ['2026-04-01', '2027-02-29'],
])('period rejects invalid or ambiguous date range %s to %s before API submission', async (start, end) => {
  const tree = await periodForm(); await enterDates(tree, start, end); await press(tree, 'Save changes');
  expect(api.create).not.toHaveBeenCalled(); expect(text(tree)).toContain(dateValidationMessage);
});
test.each([
  ['2026-04-01', '2027-03-31'], ['2028-02-29', '2028-03-01'],
  ['2000-02-29', '2000-03-01'], ['0096-02-29', '0096-03-01'],
])('period date inputs, payload, rendered result and edit values preserve %s to %s', async (startDate, endDate) => {
  const tree = await periodForm();
  const inputs = tree.root.findAllByType(TextInput);
  expect(inputs.find(n => n.props.accessibilityLabel === 'First day of academic period')!.props.placeholder).toBe('2026-04-01');
  expect(inputs.find(n => n.props.accessibilityLabel === 'Last day of academic period')!.props.placeholder).toBe('2027-03-31');
  expect(text(tree)).toContain('The date the academic period begins.');
  expect(text(tree)).toContain('The closing date of the academic period.');
  await enterDates(tree, startDate, endDate);
  const draft = {...current, name: 'Date audit', code: 'DATES', startDate, endDate, status: 'draft' as const};
  api.periods.mockResolvedValue({...page([draft]), current: null});
  await press(tree, 'Save changes');
  expect(api.create).toHaveBeenLastCalledWith('token', 'periods', {branchId: 'branch-private'}, {name: 'Date audit', code: 'DATES', startDate, endDate});
  expect(text(tree)).toContain(startDate + ' to ' + endDate);
  await press(tree, 'Edit Date audit');
  expect(tree.root.findAllByType(AdminDateField).map(n => n.props.value)).toEqual([startDate, endDate]);
  await press(tree, 'Save changes');
  expect(api.update).toHaveBeenLastCalledWith('token', 'periods', {branchId: 'branch-private'}, draft.id, {name: 'Date audit', startDate, endDate, revision: 1});
});

const roomRow: CatalogRecord={id:'room',name:'Science Lab',code:'LAB1',category:'science_lab',isActive:true,revision:1};
test('Rooms reuses catalog create/edit lifecycle with type, confirmation and immediate refresh',async()=>{
  api.list.mockResolvedValue(page([])); const tree=await render(<RoomsScreen/>);
  expect(text(tree)).toContain('No rooms yet'); expect(api.periods).not.toHaveBeenCalled();
  await press(tree,'Create Room'); await fill(tree,'Science Lab','LAB1');
  await act(async()=>tree.root.findAllByType(AdminSelect).find(n=>n.props.label==='Room Type')!.props.onSelect('science_lab'));
  api.list.mockResolvedValue(page([roomRow])); await act(async()=>dialog(tree).props.onConfirm());
  expect(api.create).toHaveBeenCalledWith('token','rooms',{}, {name:'Science Lab',code:'LAB1',category:'science_lab'});
  expect(text(tree)).toContain('Room saved');expect(text(tree)).toContain('Science Lab');
  await press(tree,'Edit Science Lab'); await fill(tree,'Chemistry Lab','LAB1');
  await act(async()=>dialog(tree).props.onConfirm());
  expect(api.update).toHaveBeenCalledWith('token','rooms',{},'room',expect.objectContaining({name:'Chemistry Lab',revision:1}));
  await press(tree,'Deactivate Science Lab'); await act(async()=>dialog(tree).props.onConfirm());
  expect(api.lifecycle).toHaveBeenCalledWith('token','rooms',{},'room','deactivate',1);
});
test('Rooms exposes load failure/retry, safe validation and search contract',async()=>{
  api.list.mockRejectedValueOnce(new Error('Unable to load rooms'));
  const tree=await render(<RoomsScreen/>);expect(text(tree)).toContain('Rooms unavailable');
  api.list.mockResolvedValue(page([roomRow]));await press(tree,'Retry Rooms');
  await act(async()=>tree.root.findAllByType(TextInput).find(n=>n.props.accessibilityLabel==='Search Rooms')!.props.onChangeText('LAB1'));
  expect(api.list).toHaveBeenLastCalledWith('token','rooms',{q:'LAB1',offset:0});
  await press(tree,'Create Room');await fill(tree,'','bad code');await act(async()=>dialog(tree).props.onConfirm());
  expect(api.create).not.toHaveBeenCalled();expect(text(tree)).toContain('Enter a name');
});
test('Rooms cannot be mounted by unauthorized role',async()=>{
  mockRole='teacher';const tree=await render(<RoomsScreen/>);
  expect(text(tree)).toContain('Room management is not permitted');expect(api.list).not.toHaveBeenCalled();
});
test('Rooms search discards an out-of-order catalog response',async()=>{
  api.list.mockResolvedValue(page([roomRow]));const tree=await render(<RoomsScreen/>);
  let old!: (value:ReturnType<typeof page>)=>void;
  api.list.mockImplementationOnce(()=>new Promise(resolve=>{old=resolve;}));
  const input=()=>tree.root.findAllByType(TextInput).find(n=>n.props.accessibilityLabel==='Search Rooms')!;
  await act(async()=>input().props.onChangeText('old'));
  api.list.mockResolvedValue(page([{...roomRow,name:'New Room'}]));
  await act(async()=>input().props.onChangeText('new'));
  await act(async()=>old(page([{...roomRow,name:'Stale Room'}])));
  expect(text(tree)).toContain('New Room');expect(text(tree)).not.toContain('Stale Room');
});
