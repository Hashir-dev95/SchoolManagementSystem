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
    endLesson: jest.fn(),
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
    dispose: jest.fn().mockResolvedValue(undefined),
  };
}
let controllers: LiveRoomController[] = [];
beforeEach(() => {
  jest.clearAllMocks();
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
