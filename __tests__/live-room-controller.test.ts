import { LiveRoomController } from '../src/services/liveLessons/LiveRoomController';
import {
  liveLessonService,
  type AuthorizedRoom,
} from '../src/services/liveLessons/liveLessonService';
import { ApiError } from '../src/services/api/apiClient';
import {
  initialRtcState,
  RtcFailure,
  type LiveLessonClient,
} from '../src/services/liveLessons/rtc/types';
jest.mock('../src/services/liveLessons/liveLessonService', () => ({
  ...jest.requireActual('../src/services/liveLessons/liveLessonService'),
  liveLessonService: {
    startLesson: jest.fn(),
    getJoinToken: jest.fn(),
    getLiveLesson: jest.fn(),
    endLesson: jest.fn(),
    requestAdmission: jest.fn(),
    classroom: jest.fn(),
    moderate: jest.fn(),
    hand: jest.fn(),
  },
}));
const response = (role: 'host' | 'participant' = 'host'): AuthorizedRoom => ({
  session: {
    id: 'lesson',
    periodId: 'period',
    date: '2026-10-20',
    academicPeriodId: 'year',
    classId: 'class',
    sectionId: 'section',
    subjectId: 'subject',
    scheduledStart: new Date().toISOString(),
    scheduledEnd: new Date(Date.now() + 3600000).toISOString(),
    status: 'live',
    revision: 3,
    startedAt: null,
    endedAt: null,
  },
  connection: {
    provider: 'zegocloud',
    appId: 123,
    roomId: 'opaque-room',
    userId: 'opaque-user',
    token: 'synthetic',
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    role,
  },
});
function rtc(): jest.Mocked<LiveLessonClient> {
  return {
    subscribe: jest.fn(listener => {
      listener(initialRtcState);
      return () => {};
    }),
    prepare: jest.fn().mockResolvedValue(undefined),
    preview: jest.fn().mockResolvedValue(undefined),
    connect: jest.fn().mockResolvedValue(undefined),
    attachRemote: jest.fn().mockResolvedValue(undefined),
    muteMicrophone: jest.fn().mockResolvedValue(undefined),
    enableCamera: jest.fn().mockResolvedValue(undefined),
    renew: jest.fn().mockResolvedValue(undefined),
    onTokenExpiring: jest.fn(),
    onReconnect: jest.fn(),
    dispose: jest.fn().mockResolvedValue(undefined),
  };
}
let controllers: LiveRoomController[] = [];
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(liveLessonService.requestAdmission).mockResolvedValue({
    session: response('participant').session,
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
});
afterEach(async () => {
  await Promise.all(controllers.map(c => c.close()));
  controllers = [];
  jest.useRealTimers();
});
function make(student = false) {
  const client = rtc();
  const room = new LiveRoomController(
    student
      ? { kind: 'student', sessionId: 'lesson' }
      : { kind: 'teacher', periodId: 'period', date: '2026-10-20' },
    'auth',
    client,
  );
  controllers.push(room);
  return { room, client };
}

test('waiting never requests a media credential; admission poll connects once', async () => {
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
    .mockResolvedValue({ session: response().session, participant });
  const { room, client } = make(true);
  await room.enter();
  expect(client.prepare).not.toHaveBeenCalled();
  expect(liveLessonService.getJoinToken).not.toHaveBeenCalled();
  jest.mocked(liveLessonService.classroom).mockResolvedValue({
    session: response().session,
    participant: { ...participant, admission: 'admitted' },
  });
  jest
    .mocked(liveLessonService.getJoinToken)
    .mockResolvedValue(response('participant'));
  await Promise.all([room.refreshClassroom(), room.refreshClassroom()]);
  await room.refreshClassroom();
  expect(client.connect).toHaveBeenCalledTimes(1);
});

test.each(['rejected', 'removed'] as const)(
  '%s status closes media and cannot reconnect',
  async admission => {
    const { room, client } = make(true);
    jest
      .mocked(liveLessonService.getJoinToken)
      .mockResolvedValue(response('participant'));
    await room.enter();
    const states: string[] = [];
    room.subscribe(s => states.push(s.reliability ?? ''));
    jest.mocked(liveLessonService.classroom).mockResolvedValue({
      session: response().session,
      participant: {
        id: 'student',
        displayName: 'You',
        role: 'participant',
        admission,
        connectionState: 'disconnected',
        handRaised: false,
        reconnectCount: 0,
        enforcement: 'none',
      },
    });
    await room.refreshClassroom();
    expect(states).toContain(admission);
    expect(client.dispose).toHaveBeenCalled();
    await room.enter();
    expect(client.connect).toHaveBeenCalledTimes(1);
  },
);

test('late admission poll after disposal cannot prepare or login', async () => {
  jest.mocked(liveLessonService.requestAdmission).mockResolvedValue({
    session: response().session,
    participant: {
      id: 'student',
      displayName: 'You',
      role: 'participant',
      admission: 'waiting',
      connectionState: 'disconnected',
      handRaised: false,
      reconnectCount: 0,
      enforcement: 'none',
    },
  });
  const { room, client } = make(true);
  await room.enter();
  let resolve!: (
    r: Awaited<ReturnType<typeof liveLessonService.classroom>>,
  ) => void;
  jest.mocked(liveLessonService.classroom).mockReturnValueOnce(
    new Promise(r => {
      resolve = r;
    }),
  );
  const poll = room.refreshClassroom();
  await room.close();
  resolve({
    session: response().session,
    participant: {
      id: 'student',
      displayName: 'You',
      role: 'participant',
      admission: 'admitted',
      connectionState: 'connected',
      handRaised: false,
      reconnectCount: 0,
      enforcement: 'none',
    },
  });
  await poll;
  expect(client.prepare).not.toHaveBeenCalled();
  expect(client.connect).not.toHaveBeenCalled();
});

test('moderation and hand actions delegate only school session and participant identities', async () => {
  jest.mocked(liveLessonService.startLesson).mockResolvedValue(response());
  const host = make();
  await host.room.enter();
  await host.room.moderate('student', 'admit');
  expect(liveLessonService.moderate).toHaveBeenCalledWith(
    'auth',
    'lesson',
    'student',
    'admit',
  );
  jest
    .mocked(liveLessonService.getJoinToken)
    .mockResolvedValue(response('participant'));
  const learner = make(true);
  await learner.room.enter();
  await learner.room.hand(true);
  expect(liveLessonService.hand).toHaveBeenCalledWith(
    'auth',
    'lesson',
    expect.any(String),
    true,
  );
  await learner.room.moderate('student', 'remove');
  expect(liveLessonService.moderate).toHaveBeenCalledTimes(1);
});

test('school authorization loss and ended responses close the room; transient failures have a bounded budget', async () => {
  jest.mocked(liveLessonService.startLesson).mockResolvedValue(response());
  const { room, client } = make();
  await room.enter();
  jest
    .mocked(liveLessonService.classroom)
    .mockRejectedValue(new ApiError(403, 'private'));
  const states: string[] = [];
  room.subscribe(s => states.push(s.reliability ?? ''));
  await room.refreshClassroom();
  expect(states).toContain('authorization_lost');
  expect(client.dispose).toHaveBeenCalled();
  const other = make();
  await other.room.enter();
  jest
    .mocked(liveLessonService.classroom)
    .mockRejectedValue(new Error('network'));
  await other.room.refreshClassroom();
  await other.room.refreshClassroom();
  expect(other.client.dispose).not.toHaveBeenCalled();
  await other.room.refreshClassroom();
  expect(other.client.dispose).toHaveBeenCalled();
});

test('SDK reconnect revalidates school admission and credentials before reporting recovered', async () => {
  jest.mocked(liveLessonService.startLesson).mockResolvedValue(response());
  const { room, client } = make();
  await room.enter();
  const reconnect = jest.mocked(client.onReconnect!).mock.calls[0][0];
  const states: string[] = [];
  room.subscribe(s => states.push(s.reliability ?? ''));
  reconnect('reconnecting');
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(liveLessonService.classroom).toHaveBeenCalledWith(
    'auth',
    'lesson',
    expect.any(String),
    'reconnecting',
  );
  expect(client.renew).toHaveBeenCalledTimes(1);
  reconnect('recovered');
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(states).toContain('recovered');
  jest
    .mocked(liveLessonService.classroom)
    .mockRejectedValue(new ApiError(403, 'private'));
  reconnect('recovered');
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(client.dispose).toHaveBeenCalled();
  expect(states).toContain('authorization_lost');
});

test('an ended school session is refreshed separately from the disposed media state', async () => {
  jest.mocked(liveLessonService.startLesson).mockResolvedValue(response());
  const { room, client } = make();
  await room.enter();
  jest
    .mocked(liveLessonService.classroom)
    .mockRejectedValue(new ApiError(409, 'closed'));
  jest
    .mocked(liveLessonService.getLiveLesson)
    .mockResolvedValue({ ...response().session, status: 'ended' });
  let final:
    | { session: { status: string } | null; reliability?: string }
    | undefined;
  room.subscribe(s => {
    final = s;
  });
  await room.refreshClassroom();
  expect(final?.session?.status).toBe('ended');
  expect(final?.reliability).toBe('ended');
  expect(client.dispose).toHaveBeenCalled();
});
test('double start obtains one backend credential and uses exact returned room', async () => {
  let resolve!: (value: AuthorizedRoom) => void;
  jest.mocked(liveLessonService.startLesson).mockReturnValue(
    new Promise(r => {
      resolve = r;
    }),
  );
  const { room, client } = make();
  const first = room.enter();
  await room.enter();
  expect(liveLessonService.startLesson).toHaveBeenCalledTimes(1);
  resolve(response());
  await first;
  expect(client.connect).toHaveBeenCalledWith(
    expect.objectContaining({
      roomId: 'opaque-room',
      userId: 'opaque-user',
      role: 'host',
      token: 'synthetic',
    }),
  );
});
test.each([401, 403, 404, 409, 503])(
  'backend %s does not initialize/login media',
  async status => {
    jest
      .mocked(liveLessonService.startLesson)
      .mockRejectedValue(new ApiError(status, 'private error'));
    const { room, client } = make();
    await room.enter();
    expect(client.prepare).not.toHaveBeenCalled();
    expect(client.connect).not.toHaveBeenCalled();
  },
);
test('media failure is distinct from backend authorization and cleanup occurs', async () => {
  jest.mocked(liveLessonService.startLesson).mockResolvedValue(response());
  const { room, client } = make();
  client.connect.mockRejectedValue(new Error('private sdk payload'));
  const states: string[] = [];
  room.subscribe(s => {
    if (s.error) states.push(s.error);
  });
  await room.enter();
  expect(states.join()).toContain('School access was granted');
  expect(states.join()).not.toContain('private');
  expect(client.dispose).toHaveBeenCalled();
});
test('expired credential is reported separately from a provider login failure', async () => {
  jest.mocked(liveLessonService.startLesson).mockResolvedValue(response());
  const { room, client } = make();
  client.connect.mockRejectedValue(new RtcFailure('expired', 'expired'));
  const errors: string[] = [];
  room.subscribe(state => {
    if (state.error) errors.push(state.error);
  });
  await room.enter();
  expect(errors.join()).toContain('credential expired');
  expect(client.dispose).toHaveBeenCalled();
});
test('student credential is receive-only and leaving never ends school session', async () => {
  jest
    .mocked(liveLessonService.getJoinToken)
    .mockResolvedValue(response('participant'));
  const { room, client } = make(true);
  await room.enter();
  expect(client.connect).toHaveBeenCalledWith(
    expect.objectContaining({ role: 'participant', roomId: 'opaque-room' }),
  );
  expect(await room.end()).toBe(false);
  await room.close();
  expect(liveLessonService.endLesson).not.toHaveBeenCalled();
});
test('student enrollment denial never calls provider', async () => {
  jest
    .mocked(liveLessonService.getJoinToken)
    .mockRejectedValue(new ApiError(403, 'denied'));
  const { room, client } = make(true);
  await room.enter();
  expect(client.connect).not.toHaveBeenCalled();
});
test('end calls backend before cleanup, and backend failure keeps session available for retry', async () => {
  jest.mocked(liveLessonService.startLesson).mockResolvedValue(response());
  const { room, client } = make();
  await room.enter();
  jest
    .mocked(liveLessonService.endLesson)
    .mockRejectedValueOnce(new ApiError(503, 'down'));
  expect(await room.end()).toBe(false);
  expect(client.dispose).not.toHaveBeenCalled();
  jest
    .mocked(liveLessonService.endLesson)
    .mockResolvedValue({ ...response().session, status: 'ended' });
  expect(await room.end()).toBe(true);
  expect(client.dispose).toHaveBeenCalled();
  expect(
    jest.mocked(liveLessonService.endLesson).mock.invocationCallOrder[1],
  ).toBeLessThan(client.dispose.mock.invocationCallOrder[0]);
});
test('late authorization response after unmount/close cannot login or publish', async () => {
  let resolve!: (value: AuthorizedRoom) => void;
  jest.mocked(liveLessonService.startLesson).mockReturnValue(
    new Promise(r => {
      resolve = r;
    }),
  );
  const { room, client } = make();
  const entering = room.enter();
  await room.close();
  resolve(response());
  await entering;
  expect(client.connect).not.toHaveBeenCalled();
});
test('SDK renewal warning reauthorizes, and revocation stops local room', async () => {
  jest.useFakeTimers();
  jest
    .mocked(liveLessonService.getJoinToken)
    .mockResolvedValueOnce(response('participant'))
    .mockRejectedValueOnce(new ApiError(404, 'withdrawn'));
  const { room, client } = make(true);
  await room.enter();
  jest.setSystemTime(Date.now() + 240000);
  client.onTokenExpiring.mock.calls[0][0]();
  await Promise.resolve();
  await Promise.resolve();
  expect(liveLessonService.getJoinToken).toHaveBeenCalledTimes(2);
  expect(client.dispose).toHaveBeenCalled();
});
test('timer renews through backend and final credential expires without a renewal loop', async () => {
  jest.useFakeTimers();
  jest.mocked(liveLessonService.startLesson).mockResolvedValue(response());
  const { room, client } = make();
  await room.enter();
  await jest.advanceTimersByTimeAsync(240000);
  expect(client.renew).toHaveBeenCalledTimes(1);
  const final = response();
  final.connection.expiresAt = new Date(Date.now() + 20000).toISOString();
  final.session.scheduledEnd = final.connection.expiresAt;
  await room.close();
  const next = make();
  jest.mocked(liveLessonService.startLesson).mockResolvedValue(final);
  await next.room.enter();
  await jest.advanceTimersByTimeAsync(20000);
  expect(next.client.dispose).toHaveBeenCalled();
});
test('30-second credentials renew safely without an immediate SDK-warning loop', async () => {
  jest.useFakeTimers();
  jest.mocked(liveLessonService.getJoinToken).mockImplementation(async () => {
    const value = response('participant');
    value.connection.expiresAt = new Date(Date.now() + 30000).toISOString();
    return value;
  });
  const { room, client } = make(true);
  await room.enter();
  client.onTokenExpiring.mock.calls[0][0]();
  await Promise.resolve();
  expect(liveLessonService.getJoinToken).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(24000);
  expect(client.renew).toHaveBeenCalledTimes(1);
  expect(client.dispose).not.toHaveBeenCalled();
});
