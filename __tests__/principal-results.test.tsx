import React from 'react';
import { Text, TextInput } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import { Button, DashboardShell } from '../src/components/hiraDashboard';
import PrincipalResultsScreen from '../src/screens/principal/PrincipalResultsScreen';
import {
  resultModerationService,
  type ResultQueue,
} from '../src/services/principal/resultModerationService';
import { ApiError } from '../src/services/api/apiClient';
jest.mock('@react-navigation/native', () => {
  const R = jest.requireActual('react');
  return {
    useFocusEffect: (effect: () => void) => R.useEffect(effect, [effect]),
  };
});
let mockToken = 'token';
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ accessToken: mockToken }),
}));
jest.mock('../src/services/principal/resultModerationService', () => ({
  resultModerationService: { list: jest.fn() },
}));
const service = jest.mocked(resultModerationService),
  navigate = jest.fn();
const row = {
  approvalId: 'approval-1',
  resultId: 'result-1',
  assessmentTitle: 'Integer practice',
  status: 'moderated_approved' as const,
  recordRevision: 3,
  academicYear: '2026',
  className: 'Grade 8',
  sectionName: 'A',
  subjectName: 'Mathematics',
  teacherName: 'Ayesha Teacher',
};
const empty: ResultQueue = {
  items: [],
  total: 0,
  nextOffset: null,
  configurationIssueCount: 0,
};
let trees: Renderer.ReactTestRenderer[] = [];
const element = () => (
  <PrincipalResultsScreen {...({ navigation: { navigate } } as any)} />
);
const mount = async () => {
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(element());
  });
  trees.push(tree);
  return tree;
};
const text = (tree: Renderer.ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .flatMap(n => React.Children.toArray(n.props.children))
    .join(' ');
const press = async (tree: Renderer.ReactTestRenderer, title: string) =>
  act(async () =>
    tree.root
      .findAllByType(Button)
      .find(n => n.props.title === title)!
      .props.onPress(),
  );
beforeEach(() => {
  jest.clearAllMocks();
  mockToken = 'token';
  service.list.mockResolvedValue(empty);
});
afterEach(async () =>
  act(async () => {
    trees.forEach(t => t.unmount());
    trees = [];
  }),
);
test('queue loading does not claim an empty queue', async () => {
  service.list.mockReturnValue(new Promise(() => {}));
  const tree = await mount();
  expect(text(tree)).toContain('Loading results');
  expect(text(tree)).not.toContain('No approved results');
});
for (const [title, message] of [
  ['Awaiting Publication', 'No approved results are awaiting publication'],
  ['Pending Review', 'No results are waiting for moderation'],
  ['Published', 'No results have been published'],
  ['Changes Requested', 'No results are awaiting Teacher changes'],
  ['Rejected', 'No results have been rejected'],
])
  test(title + ' has a distinct empty state', async () => {
    const tree = await mount();
    await press(tree, title);
    expect(text(tree)).toContain(message);
  });
test('queue error and retry are distinct from empty state', async () => {
  service.list
    .mockRejectedValueOnce(new Error('Database unavailable'))
    .mockResolvedValue(empty);
  const tree = await mount();
  expect(text(tree)).toContain('Unable to Load Results');
  expect(text(tree)).not.toContain('No approved results');
  await press(tree, 'Retry');
  expect(text(tree)).toContain('No approved results');
});
test('queue permission loss has safe feedback and hides previous results', async () => {
  service.list
    .mockResolvedValueOnce({ ...empty, items: [row], total: 1 })
    .mockRejectedValue(new ApiError(403, 'Internal policy'));
  const tree = await mount();
  await act(async () => tree.root.findByType(DashboardShell).props.onRefresh());
  expect(text(tree)).toContain('do not have permission');
  expect(text(tree)).not.toContain('Integer practice');
});
test('academic configuration problems are surfaced instead of silently empty results', async () => {
  service.list.mockResolvedValue({ ...empty, configurationIssueCount: 1 });
  const tree = await mount();
  expect(text(tree)).toContain('Academic Configuration');
});
test('approved result reopens existing moderation route and shows academic context', async () => {
  service.list.mockResolvedValue({ ...empty, items: [row], total: 1 });
  const tree = await mount();
  for (const label of [
    'Grade 8',
    'Ayesha Teacher',
    'Mathematics',
    'Approved · Unpublished',
  ])
    expect(text(tree)).toContain(label);
  await press(tree, 'Review Result');
  expect(navigate).toHaveBeenCalledWith('ResultModeration', {
    approvalId: 'approval-1',
  });
});
test('queue pagination and search are server requests, reset offset and preserve selected state', async () => {
  service.list
    .mockResolvedValueOnce({
      ...empty,
      items: [row],
      total: 21,
      nextOffset: 20,
    })
    .mockResolvedValue({ ...empty, items: [row], total: 21 });
  const tree = await mount();
  await press(tree, 'Next Page');
  expect(service.list).toHaveBeenLastCalledWith('token', {
    state: 'awaiting_publication',
    search: '',
    offset: 20,
  });
  await act(async () =>
    tree.root.findByType(TextInput).props.onChangeText('Science'),
  );
  await press(tree, 'Search');
  expect(service.list).toHaveBeenLastCalledWith('token', {
    state: 'awaiting_publication',
    search: 'Science',
    offset: 0,
  });
  await press(tree, 'Published');
  expect(service.list).toHaveBeenLastCalledWith('token', {
    state: 'published',
    search: 'Science',
    offset: 0,
  });
});
test('actor change replaces the resource instead of showing previous Branch results', async () => {
  service.list
    .mockResolvedValueOnce({ ...empty, items: [row], total: 1 })
    .mockResolvedValue(empty);
  const tree = await mount();
  mockToken = 'new-token';
  await act(async () => tree.update(element()));
  expect(text(tree)).not.toContain('Integer practice');
  expect(service.list).toHaveBeenLastCalledWith('new-token', expect.anything());
});
