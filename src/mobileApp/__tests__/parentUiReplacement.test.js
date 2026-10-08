import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import HiraHome from '../HiraHome';
import MessagesInbox from '../MessagesInbox';
import MobileApp from '../MobileApp';
import ParentSchoolStory from '../ParentSchoolStory';
import { parentApi } from '../parentService';

jest.mock('../parentService', () => ({
  parentApi: {
    getChildren: jest.fn(),
    getChild: jest.fn(),
    getAttendance: jest.fn(),
    getResults: jest.fn(),
    getHomework: jest.fn(),
    getFees: jest.fn(),
    getFeedback: jest.fn(),
    getProgress: jest.fn(),
    getNotifications: jest.fn(),
    markNotificationRead: jest.fn(),
    getNotification: jest.fn(),
  },
}));

// Keep the navigation-shell test focused on its own routes. Importing the real
// dashboards pulls in native-only modules (for example the document picker).
jest.mock('../RoleDashboard', () => () => null);
jest.mock('../FeaturePage', () => () => null);
jest.mock('../TeacherApplicationsPage', () => () => null);
jest.mock('../NotificationDrawer', () => () => null);

const flush = () => new Promise(resolve => setImmediate(resolve));
const visibleText = tree =>
  tree.root
    .findAll(node => node.children.some(child => typeof child === 'string'))
    .flatMap(node => node.children.filter(child => typeof child === 'string'))
    .join(' ');

describe('Parent UI replacement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    parentApi.getChildren.mockResolvedValue([]);
    parentApi.getChild.mockResolvedValue(null);
    parentApi.getAttendance.mockResolvedValue([]);
    parentApi.getResults.mockResolvedValue([]);
    parentApi.getHomework.mockResolvedValue([]);
    parentApi.getFees.mockResolvedValue([]);
    parentApi.getFeedback.mockResolvedValue({});
    parentApi.getProgress.mockResolvedValue([]);
    parentApi.getNotifications.mockResolvedValue({
      notifications: [],
      unreadCount: 0,
    });
  });

  test('Parent Home quick links open the requested sections', async () => {
    const navigate = jest.fn();
    let tree;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <HiraHome
          role="Parent"
          previewOnly
          user={{ fullName: 'Demo Parent' }}
          reducedMotion
          onNavigate={navigate}
        />,
      );
      await flush();
    });
    expect(visibleText(tree)).toContain('Stay connected');
    expect(visibleText(tree)).toContain('A date for your diary');
    act(() => tree.root.findByProps({ accessibilityLabel: 'Inbox' }).props.onPress());
    expect(navigate).toHaveBeenCalledWith('Inbox');
    act(() => tree.unmount());
  });

  test('Progress switches child and clears the previous child summary', async () => {
    let tree;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <ParentSchoolStory previewOnly onNavigate={() => {}} />,
      );
      await flush();
    });
    expect(visibleText(tree)).toContain('Ahmed Khan’s school story');
    expect(visibleText(tree)).toContain('5,250');

    act(() =>
      tree.root.findByProps({ accessibilityLabel: 'Switch child' }).props.onPress(),
    );
    const childOption = tree.root.findAll(node =>
      String(node.props.accessibilityLabel || '').startsWith('Sara Khan.'),
    )[0];
    expect(childOption?.props.onPress).toEqual(expect.any(Function));
    act(() => childOption.props.onPress());

    expect(visibleText(tree)).toContain('Sara Khan’s school story');
    expect(visibleText(tree)).not.toContain('5,250');
    act(() => tree.unmount());
  });

  test('Inbox keeps messages separate, searchable and preview-only', async () => {
    let tree;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <MessagesInbox role="Parent" previewOnly onNavigate={() => {}} />,
      );
      await flush();
    });
    expect(visibleText(tree)).toContain('School inbox');
    expect(visibleText(tree)).toContain('Transport office');
    expect(tree.root.findAllByType('TextInput')).toHaveLength(1);
    act(() => tree.unmount());

    await act(async () => {
      tree = ReactTestRenderer.create(
        <MessagesInbox role="Parent" onNavigate={() => {}} />,
      );
      await flush();
    });
    expect(visibleText(tree)).toContain('Messaging isn’t available yet');
    expect(visibleText(tree)).not.toContain('Miss Ayesha');
    act(() => tree.unmount());
  });

  test('left drawer opens with the Parent navigation', async () => {
    let tree;
    await act(async () => {
      tree = ReactTestRenderer.create(<MobileApp developmentPreview />);
      await flush();
    });
    act(() =>
      tree.root
        .findByProps({ accessibilityLabel: 'Open left navigation' })
        .props.onPress(),
    );
    expect(visibleText(tree)).toContain('YOUR SCHOOL WORKSPACE');
    expect(visibleText(tree)).toContain('Student Progress Tracking');
    act(() => tree.unmount());
  });
});
