import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import StudentLiveLessonsScreen from '../src/screens/liveLessons/StudentLiveLessonsScreen';
import { liveLessonService } from '../src/services/liveLessons/liveLessonService';
import { Button } from '../src/components/hiraDashboard';
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}));
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({
    accessToken: 'auth',
    user: { role: 'student' },
    logout: jest.fn(),
  }),
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => {
    jest.requireActual('react').useEffect(callback, [callback]);
  },
}));
jest.mock('../src/services/liveLessons/liveLessonService', () => ({
  ...jest.requireActual('../src/services/liveLessons/liveLessonService'),
  liveLessonService: { available: jest.fn() },
}));
let tree: Renderer.ReactTestRenderer;
const text = () =>
  tree.root
    .findAllByType(Text)
    .map(node =>
      React.Children.toArray(node.props.children)
        .filter(child => typeof child === 'string')
        .join(''),
    )
    .join(' ');
afterEach(async () => {
  await act(async () => tree?.unmount());
});
test('available lesson navigates once with only the school session ID', async () => {
  jest.mocked(liveLessonService.available).mockResolvedValue({
    sessions: [
      {
        id: 'session',
        subjectName: 'Math',
        className: 'Class 8',
        sectionName: 'A',
        scheduledStart: new Date().toISOString(),
      } as Awaited<
        ReturnType<typeof liveLessonService.available>
      >['sessions'][number],
    ],
  });
  const navigate = jest.fn();
  await act(async () => {
    tree = Renderer.create(
      <StudentLiveLessonsScreen
        {...({ navigation: { navigate } } as unknown as React.ComponentProps<
          typeof StudentLiveLessonsScreen
        >)}
      />,
    );
  });
  expect(text()).toContain('Math');
  const button = tree.root
    .findAllByType(Button)
    .find(n => n.props.title === 'Open live lesson')!;
  await act(async () => {
    button.props.onPress();
    button.props.onPress();
  });
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(navigate).toHaveBeenCalledWith('StudentLiveRoom', {
    sessionId: 'session',
  });
});
test('empty managed-enrollment discovery does not offer arbitrary room entry', async () => {
  jest.mocked(liveLessonService.available).mockResolvedValue({ sessions: [] });
  await act(async () => {
    tree = Renderer.create(
      <StudentLiveLessonsScreen
        {...({
          navigation: { navigate: jest.fn() },
        } as unknown as React.ComponentProps<typeof StudentLiveLessonsScreen>)}
      />,
    );
  });
  expect(text()).toContain('active school enrollment is required');
  expect(
    tree.root
      .findAllByType(Button)
      .some(n => n.props.title === 'Open live lesson'),
  ).toBe(false);
});
