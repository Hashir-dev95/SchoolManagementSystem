import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Alert, AppState } from 'react-native';
import LiveLessonRoomScreen from '../src/screens/liveLessons/LiveLessonRoomScreen';
import { Button } from '../src/components/hiraDashboard';
import { liveLessonService } from '../src/services/liveLessons/liveLessonService';
import { mediaPermissions } from '../src/services/liveLessons/mediaPermissions';
import { createLiveLessonClient } from '../src/services/liveLessons/rtc/ZegoLiveLessonClient';
import {
  initialRtcState,
  type RtcState,
} from '../src/services/liveLessons/rtc/types';
import { ApiError } from '../src/services/api/apiClient';
import type { AuthorizedRoom } from '../src/services/liveLessons/liveLessonService';
let mockRole = 'teacher';
const mockNavigation = { goBack: jest.fn() };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  usePreventRemove: jest.fn(),
}));
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ accessToken: 'auth', user: { role: mockRole } }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}));
jest.mock('../src/services/teacher/timetableService', () => ({
  timetableService: {
    getPeriod: jest.fn().mockResolvedValue({
      className: 'Class 8',
      sectionName: 'A',
      subjectName: 'Math',
      date: '2026-10-20',
      startTime: '12:00',
      endTime: '13:00',
    }),
  },
}));
jest.mock('../src/services/liveLessons/liveLessonService', () => ({
  ...jest.requireActual('../src/services/liveLessons/liveLessonService'),
  liveLessonService: {
    previewConfig: jest.fn(),
    startLesson: jest.fn(),
    getJoinToken: jest.fn(),
    endLesson: jest.fn(),
    requestAdmission: jest.fn(),
    classroom: jest.fn(),
    moderate: jest.fn(),
    hand: jest.fn(),
  },
}));
jest.mock('../src/services/liveLessons/mediaPermissions', () => ({
  ...jest.requireActual('../src/services/liveLessons/mediaPermissions'),
  mediaPermissions: {
    check: jest.fn(),
    request: jest.fn(),
    settings: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../src/services/liveLessons/rtc/ZegoLiveLessonClient', () => ({
  createLiveLessonClient: jest.fn(),
}));
jest.mock('../src/services/liveLessons/rtc/ZegoVideo', () => ({
  ZegoVideo: function Video({
    onReady,
  }: {
    onReady: (handle: number) => void;
  }) {
    const R = jest.requireActual('react');
    R.useEffect(() => {
      onReady(5);
    }, [onReady]);
    return R.createElement('Video');
  },
}));
let tree: Renderer.ReactTestRenderer | undefined;
let state: RtcState, subscriber: (value: RtcState) => void;
const client = {
  subscribe: jest.fn(),
  prepare: jest.fn(),
  preview: jest.fn(),
  connect: jest.fn(),
  attachRemote: jest.fn(),
  muteMicrophone: jest.fn(),
  enableCamera: jest.fn(),
  renew: jest.fn(),
  dispose: jest.fn(),
  onTokenExpiring: jest.fn(),
};
const teacherTarget = {
  kind: 'teacher' as const,
  periodId: 'period',
  date: '2026-10-20',
};
function response(student = false): AuthorizedRoom {
  return {
    session: {
      id: 'lesson',
      periodId: 'period',
      date: '2026-10-20',
      academicPeriodId: 'year',
      classId: 'class',
      sectionId: 'section',
      subjectId: 'subject',
      revision: 3,
      startedAt: null,
      endedAt: null,
      status: 'live',
      scheduledStart: new Date().toISOString(),
      scheduledEnd: new Date(Date.now() + 3600000).toISOString(),
    },
    connection: {
      provider: 'zegocloud',
      appId: 123,
      role: student ? 'participant' : 'host',
      roomId: 'room',
      userId: 'user',
      token: 'synthetic',
      expiresAt: new Date(Date.now() + 300000).toISOString(),
    },
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(liveLessonService.requestAdmission).mockResolvedValue({
    session: response(true).session,
    participant: {
      id: 'student',
      displayName: 'You',
      role: 'participant',
      admission: 'admitted',
      connectionState: 'disconnected',
      handRaised: false,
      reconnectCount: 0,
      enforcement: 'none',
    },
  });
  jest.mocked(liveLessonService.classroom).mockResolvedValue({
    session: response().session,
    participant: {
      id: 'own',
      displayName: 'You',
      role: 'host',
      admission: 'admitted',
      connectionState: 'connected',
      handRaised: false,
      reconnectCount: 0,
      enforcement: 'none',
    },
    participants: [],
  });
  jest.mocked(liveLessonService.moderate).mockResolvedValue({});
  jest.mocked(liveLessonService.hand).mockResolvedValue({});

  mockRole = 'teacher';
  state = { ...initialRtcState, participants: [] };
  jest.mocked(createLiveLessonClient).mockReturnValue(client);
  client.subscribe.mockImplementation(listener => {
    subscriber = listener;
    listener(state);
    return jest.fn();
  });
  for (const method of [
    client.prepare,
    client.attachRemote,
    client.renew,
    client.dispose,
  ])
    method.mockResolvedValue(undefined);
  client.preview.mockImplementation(async () => {
    state = { ...state, cameraEnabled: true };
    subscriber(state);
  });
  client.connect.mockImplementation(async () => {
    state = { ...state, connection: 'connected' };
    subscriber(state);
  });
  client.muteMicrophone.mockImplementation(async muted => {
    state = { ...state, microphoneMuted: muted };
    subscriber(state);
  });
  client.enableCamera.mockImplementation(async enabled => {
    state = { ...state, cameraEnabled: enabled };
    subscriber(state);
  });
  jest
    .mocked(liveLessonService.previewConfig)
    .mockResolvedValue({ provider: 'zegocloud', appId: 123 });
  jest
    .mocked(liveLessonService.startLesson)
    .mockResolvedValue(
      response() as Awaited<ReturnType<typeof liveLessonService.startLesson>>,
    );
  jest
    .mocked(liveLessonService.getJoinToken)
    .mockResolvedValue(
      response(true) as Awaited<
        ReturnType<typeof liveLessonService.getJoinToken>
      >,
    );
  jest
    .mocked(liveLessonService.endLesson)
    .mockResolvedValue({ ...response().session, status: 'ended' } as Awaited<
      ReturnType<typeof liveLessonService.endLesson>
    >);
  jest
    .mocked(mediaPermissions.check)
    .mockResolvedValue({ camera: 'granted', microphone: 'granted' });
  jest
    .mocked(mediaPermissions.request)
    .mockResolvedValue({ camera: 'granted', microphone: 'granted' });
});
afterEach(async () => {
  if (tree) {
    await act(async () => tree!.unmount());
    tree = undefined;
  }
  jest.restoreAllMocks();
  jest.useRealTimers();
});
const text = () => JSON.stringify(tree!.toJSON());
const button = (title: string) =>
  tree!.root.findAllByType(Button).find(n => n.props.title === title)!;
async function render(student = false) {
  if (student) mockRole = 'student';
  await act(async () => {
    tree = Renderer.create(
      <LiveLessonRoomScreen
        target={
          student ? { kind: 'student', sessionId: 'lesson' } : teacherTarget
        }
      />,
    );
  });
}
async function tap(title: string) {
  await act(async () => {
    button(title).props.onPress();
  });
}
async function preview() {
  await render();
  await tap('Enable camera and microphone');
}
test('teacher preview has trusted period metadata and starts only after preview', async () => {
  await render();
  expect(text()).toContain('Class 8');
  expect(text()).toContain('Math');
  expect(button('Start Lesson').props.disabled).toBe(true);
  await tap('Enable camera and microphone');
  expect(client.preview).toHaveBeenCalledWith(5);
  expect(button('Start Lesson').props.disabled).toBe(false);
  await tap('Start Lesson');
  expect(liveLessonService.startLesson).toHaveBeenCalledWith(
    'auth',
    'period',
    '2026-10-20',
    expect.any(String),
  );
  expect(client.connect).toHaveBeenCalled();
});

test('Student waiting state withholds RTC and capture, then admission renders hand controls', async () => {
  jest.useFakeTimers();
  const participant = {
    id: 'student',
    displayName: 'You',
    role: 'participant' as const,
    admission: 'waiting' as const,
    connectionState: 'disconnected' as const,
    handRaised: false,
    reconnectCount: 0,
    enforcement: 'none' as const,
  };
  jest
    .mocked(liveLessonService.requestAdmission)
    .mockResolvedValue({ session: response(true).session, participant });
  await render(true);
  await tap('Join Lesson');
  expect(text()).toContain('Waiting for teacher admission');
  expect(client.connect).not.toHaveBeenCalled();
  expect(mediaPermissions.request).not.toHaveBeenCalled();
  jest.mocked(liveLessonService.classroom).mockResolvedValue({
    session: response(true).session,
    participant: { ...participant, admission: 'admitted' },
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(5000);
  });
  expect(client.connect).toHaveBeenCalledTimes(1);
  expect(button('Raise hand')).toBeDefined();
  await tap('Raise hand');
  expect(liveLessonService.hand).toHaveBeenCalledWith(
    'auth',
    'lesson',
    expect.any(String),
    true,
  );
  jest.mocked(liveLessonService.classroom).mockResolvedValue({
    session: response(true).session,
    participant: { ...participant, admission: 'removed' },
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(5000);
  });
  expect(text()).toContain('teacher removed');
  expect(client.dispose).toHaveBeenCalled();
});

test('Teacher waiting panel has named actions, hand status and confirmed destructive remove flow', async () => {
  jest.useFakeTimers();
  const waiting = {
    id: 'student',
    displayName: 'A learner',
    role: 'participant' as const,
    admission: 'waiting' as const,
    connectionState: 'disconnected' as const,
    handRaised: false,
    reconnectCount: 0,
    enforcement: 'none' as const,
  };
  jest.mocked(liveLessonService.classroom).mockResolvedValue({
    session: response().session,
    participant: {
      ...waiting,
      id: 'host',
      role: 'host',
      admission: 'admitted',
    },
    participants: [waiting],
  });
  await preview();
  await tap('Start Lesson');
  await act(async () => {
    await jest.advanceTimersByTimeAsync(5000);
  });
  expect(text()).toContain('Waiting:');
  expect(button('Admit A learner')).toBeDefined();
  await tap('Admit A learner');
  expect(liveLessonService.moderate).toHaveBeenCalledWith(
    'auth',
    'lesson',
    'student',
    'admit',
  );
  await tap('Reject A learner');
  expect(liveLessonService.moderate).toHaveBeenCalledWith(
    'auth',
    'lesson',
    'student',
    'reject',
  );
  jest.mocked(liveLessonService.classroom).mockResolvedValue({
    session: response().session,
    participant: {
      ...waiting,
      id: 'host',
      role: 'host',
      admission: 'admitted',
    },
    participants: [{ ...waiting, admission: 'admitted', handRaised: true }],
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(5000);
  });
  expect(text()).toContain('Hand raised');
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await tap('Remove A learner');
  expect(alert).toHaveBeenCalledWith(
    'Remove participant?',
    expect.any(String),
    expect.any(Array),
  );
  expect(liveLessonService.moderate).not.toHaveBeenCalledWith(
    'auth',
    'lesson',
    'student',
    'remove',
  );
});
test('Start disabled while backend request is pending', async () => {
  await preview();
  let resolve!: (
    value: Awaited<ReturnType<typeof liveLessonService.startLesson>>,
  ) => void;
  jest.mocked(liveLessonService.startLesson).mockReturnValue(
    new Promise(r => {
      resolve = r;
    }),
  );
  await tap('Start Lesson');
  expect(button('Start Lesson').props.disabled).toBe(true);
  await act(async () => {
    resolve(response());
  });
});
test('backend 403 never logs into provider', async () => {
  await preview();
  jest
    .mocked(liveLessonService.startLesson)
    .mockRejectedValue(new ApiError(403, 'denied'));
  await tap('Start Lesson');
  expect(client.connect).not.toHaveBeenCalled();
  expect(text()).toContain('do not have permission');
});
test('provider login failure is distinct and can still end backend session', async () => {
  await preview();
  client.connect.mockRejectedValue(new Error('private'));
  await tap('Start Lesson');
  expect(text()).toContain(
    'School access was granted, but media connection failed',
  );
  expect(button('End Lesson')).toBeTruthy();
  expect(text()).not.toContain('private');
});
test('mic/camera controls delegate and reflect confirmed state', async () => {
  await preview();
  await tap('Microphone muted · Unmute');
  expect(client.muteMicrophone).toHaveBeenCalledWith(false);
  expect(button('Microphone on · Mute')).toBeTruthy();
  await tap('Camera on · Turn off');
  expect(client.enableCamera).toHaveBeenCalledWith(false);
  expect(button('Camera off · Turn on')).toBeTruthy();
});
test('Teacher End confirms, calls backend and cleans media', async () => {
  await preview();
  await tap('Start Lesson');
  const alert = jest.spyOn(Alert, 'alert');
  await tap('End Lesson');
  const confirm = alert.mock.calls[0][2]!.find(b => b.text === 'End Lesson')!;
  await act(async () => {
    await confirm.onPress!();
  });
  expect(liveLessonService.endLesson).toHaveBeenCalledWith('auth', 'lesson');
  expect(client.dispose).toHaveBeenCalled();
});
test.each(['camera', 'microphone'] as const)(
  '%s denied prevents preview/start and offers settings',
  async permission => {
    jest.mocked(mediaPermissions.request).mockResolvedValue({
      camera: 'granted',
      microphone: 'granted',
      [permission]: 'blocked',
    });
    await render();
    await tap('Enable camera and microphone');
    expect(client.prepare).not.toHaveBeenCalled();
    expect(button('Start Lesson').props.disabled).toBe(true);
    expect(text()).toContain('blocked');
    await tap('Open device settings');
    expect(mediaPermissions.settings).toHaveBeenCalled();
  },
);
test('permission retry can enable a previously denied preview', async () => {
  jest
    .mocked(mediaPermissions.request)
    .mockResolvedValueOnce({ camera: 'denied', microphone: 'granted' })
    .mockResolvedValueOnce({ camera: 'granted', microphone: 'granted' });
  await render();
  await tap('Enable camera and microphone');
  expect(client.preview).not.toHaveBeenCalled();
  await tap('Enable camera and microphone');
  expect(client.preview).toHaveBeenCalled();
});
test('student joins exact credential without teacher controls or capture permissions and leaves without end', async () => {
  await render(true);
  await tap('Join Lesson');
  expect(client.connect).toHaveBeenCalledWith(
    expect.objectContaining({ roomId: 'room', role: 'participant' }),
  );
  expect(
    tree!.root.findAllByType(Button).some(n => n.props.title === 'End Lesson'),
  ).toBe(false);
  expect(mediaPermissions.request).not.toHaveBeenCalled();
  await tap('Leave Lesson');
  expect(client.dispose).toHaveBeenCalled();
  expect(liveLessonService.endLesson).not.toHaveBeenCalled();
});
test('student enrollment denial never calls SDK', async () => {
  jest
    .mocked(liveLessonService.getJoinToken)
    .mockRejectedValue(new ApiError(403, 'enrollment'));
  await render(true);
  await tap('Join Lesson');
  expect(client.connect).not.toHaveBeenCalled();
  expect(text()).toContain('do not have permission');
});
test('unmount and background close owned resources', async () => {
  const spy = jest.spyOn(AppState, 'addEventListener');
  await preview();
  const handler = spy.mock.calls.find(call => call[0] === 'change')![1];
  await act(async () => {
    handler('background');
  });
  expect(client.dispose).toHaveBeenCalled();
  await act(async () => {
    tree!.unmount();
  });
  tree = undefined;
  expect(client.dispose).toHaveBeenCalled();
});


test('occurrence rejected during preview shows a safe error and cannot start or connect media', async () => {
  jest.mocked(liveLessonService.previewConfig).mockRejectedValueOnce(new ApiError(403, 'Occurrence no longer authorized'));
  await render();
  expect(text()).toContain('do not have permission');
  expect(button('Start Lesson').props.disabled).toBe(true);
  expect(liveLessonService.startLesson).not.toHaveBeenCalled();
  expect(client.preview).not.toHaveBeenCalled(); expect(client.connect).not.toHaveBeenCalled();
});
