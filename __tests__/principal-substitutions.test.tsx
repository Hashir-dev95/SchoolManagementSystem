import React from 'react';
import { Text, TextInput } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import Screen from '../src/screens/principal/PrincipalSubstitutionsScreen';
import { Button } from '../src/components/hiraDashboard';
import {
  AdminDialog,
  AdminSelect,
} from '../src/components/hiraDashboard/AdminForm';
import {
  substitutionService,
  type SubstitutionOccurrence,
} from '../src/services/principal/substitutionService';
import { ApiError } from '../src/services/api/apiClient';
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@react-navigation/native', () => {
  const R = jest.requireActual('react');
  return {
    useFocusEffect: (effect: () => void) => R.useEffect(effect, [effect]),
  };
});
let mockRole = 'principal';
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({
    accessToken: 'token',
    user: { id: 'p', role: mockRole, branchId: 'b' },
  }),
}));
jest.mock('../src/services/principal/substitutionService', () => ({
  substitutionService: {
    overview: jest.fn(),
    candidates: jest.fn(),
    assign: jest.fn(),
    cancel: jest.fn(),
  },
}));
const service = jest.mocked(substitutionService);
const row: SubstitutionOccurrence = {
  periodId: 'p',
  versionId: 'v',
  date: '2026-10-27',
  revision: 'revision',
  className: 'Long Grade Eight Class',
  sectionName: 'A',
  subjectName: 'Science',
  startTime: '09:00',
  endTime: '10:00',
  room: 'Room A',
  originalTeacher: { id: 'a', name: 'Original Teacher' },
  substituteTeacher: null,
  substituteId: null,
  reason: null,
  canManage: true,
  history: [],
};
let renderer: Renderer.ReactTestRenderer;
const page = (items = [row]) => ({
  date: row.date,
  today: '2026-10-25',
  timezone: 'Asia/Karachi',
  items,
  nextOffset: null,
});
beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'principal';
  service.overview.mockResolvedValue(page());
  service.candidates.mockResolvedValue({
    revision: row.revision,
    policy: 'Temporary duty',
    items: [
      {
        id: 'b',
        name: 'Available Teacher with a long name',
        eligibility: 'Available',
      },
    ],
    nextOffset: null,
  });
  service.assign.mockResolvedValue({});
  service.cancel.mockResolvedValue({});
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
});
async function render() {
  await act(async () => {
    renderer = Renderer.create(<Screen />);
  });
}
async function press(title: string) {
  await act(async () => {
    renderer.root
      .findAllByType(Button)
      .find(b => b.props.title === title)!
      .props.onPress();
  });
}
const text = () =>
  renderer.root
    .findAllByType(Text)
    .map(t => t.props.children)
    .flat(Infinity)
    .join(' ');
async function review() {
  await press('View Lesson');
  await press('Assign Substitute');
  await act(async () => {
    renderer.root
      .findAllByType(AdminSelect)
      .find(s => s.props.label === 'Replacement Teacher')!
      .props.onSelect('b');
  });
  await press('Review Assignment');
}
test('overview shows school date and original Teacher; detail is occurrence bounded', async () => {
  await render();
  expect(text()).toContain('Asia/Karachi');
  await press('View Lesson');
  expect(text()).toContain('This lesson and date only');
  expect(text()).toContain('Original Teacher');
});
test('empty lessons and retry are visible', async () => {
  service.overview.mockResolvedValue(page([]));
  await render();
  expect(text()).toContain('No scheduled lessons');
  await press('Refresh Lessons');
  expect(service.overview).toHaveBeenCalledTimes(2);
});
test('error clears lessons and retry recovers', async () => {
  service.overview.mockRejectedValueOnce(new Error('Offline'));
  await render();
  expect(text()).toContain('Offline');
  expect(
    renderer.root
      .findAllByType(Button)
      .some(b => b.props.title === 'View Lesson'),
  ).toBe(false);
  await press('Refresh Lessons');
  expect(text()).toContain('Science');
});
test('date is sent to server without device timezone conversion', async () => {
  await render();
  const field = renderer.root
    .findAllByType(TextInput)
    .find(t => t.props.value === '');
  await act(async () => field!.props.onChangeText('2026-10-28'));
  await press('Apply Date');
  expect(service.overview).toHaveBeenLastCalledWith('token', '2026-10-28', 0);
});
test('confirmation does not write until confirmed and refreshes after success', async () => {
  await render();
  await review();
  expect(service.assign).not.toHaveBeenCalled();
  const dialog = renderer.root
    .findAllByType(AdminDialog)
    .find(d => d.props.title === 'Assign Substitute?')!;
  await act(async () => dialog.props.onConfirm());
  expect(service.assign).toHaveBeenCalledWith(
    'token',
    row,
    'b',
    'Teacher absent',
  );
  expect(service.overview).toHaveBeenCalledTimes(2);
  expect(text()).toContain('Substitute Assigned');
});
test('closing confirmation makes no write', async () => {
  await render();
  await review();
  await act(async () =>
    renderer.root
      .findAllByType(AdminDialog)
      .find(d => d.props.title === 'Assign Substitute?')!
      .props.onClose(),
  );
  expect(service.assign).not.toHaveBeenCalled();
});
test('candidate errors and empty results do not offer confirmation', async () => {
  service.candidates.mockResolvedValue({
    revision: row.revision,
    policy: 'Temporary duty',
    items: [],
    nextOffset: null,
  });
  await render();
  await press('View Lesson');
  await press('Assign Substitute');
  expect(text()).toContain('No available Teachers');
  expect(
    renderer.root
      .findAllByType(Button)
      .find(b => b.props.title === 'Review Assignment')!.props.disabled,
  ).toBe(true);
});
test('stale candidate revision removes selection actions', async () => {
  service.candidates.mockResolvedValue({
    revision: 'new',
    policy: 'Temporary duty',
    items: [],
    nextOffset: null,
  });
  await render();
  await press('View Lesson');
  await press('Assign Substitute');
  expect(text()).toContain('Schedule updated');
  expect(renderer.root.findAllByType(AdminSelect)).toHaveLength(0);
});
test('conflict clears candidates and refreshes authoritative overview', async () => {
  service.assign.mockRejectedValue(new ApiError(409, 'Conflict'));
  await render();
  await review();
  await act(async () =>
    renderer.root
      .findAllByType(AdminDialog)
      .find(d => d.props.title === 'Assign Substitute?')!
      .props.onConfirm(),
  );
  expect(text()).toContain('Schedule Updated');
  expect(renderer.root.findAllByType(AdminSelect)).toHaveLength(0);
});
test('permission loss removes stale actions on refreshed failure', async () => {
  service.assign.mockRejectedValue(new ApiError(403, 'Denied'));
  await render();
  await review();
  service.overview.mockRejectedValue(new ApiError(403, 'Denied'));
  await act(async () =>
    renderer.root
      .findAllByType(AdminDialog)
      .find(d => d.props.title === 'Assign Substitute?')!
      .props.onConfirm(),
  );
  expect(text()).toContain('Access unavailable');
  expect(
    renderer.root
      .findAllByType(Button)
      .some(b => b.props.title === 'View Lesson'),
  ).toBe(false);
});
test('actor role change unmounts candidate state', async () => {
  await render();
  await review();
  mockRole = 'teacher';
  await act(async () => renderer.update(<Screen />));
  expect(text()).toContain('Access unavailable');
  expect(renderer.root.findAllByType(AdminSelect)).toHaveLength(0);
});
test('future cancellation uses confirmation and existing history', async () => {
  service.overview.mockResolvedValue(
    page([
      {
        ...row,
        substituteTeacher: { id: 'b', name: 'Replacement' },
        substituteId: 's',
        reason: 'Emergency',
      },
    ]),
  );
  await render();
  await press('View Lesson');
  await press('Cancel Substitution');
  await act(async () =>
    renderer.root
      .findAllByType(AdminDialog)
      .find(d => d.props.title === 'Cancel Substitution?')!
      .props.onConfirm(),
  );
  expect(service.cancel).toHaveBeenCalledTimes(1);
  expect(text()).toContain('Substitution Cancelled');
});
