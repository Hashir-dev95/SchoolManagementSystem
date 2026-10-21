import { ZegoLiveLessonClient } from '../src/services/liveLessons/rtc/ZegoLiveLessonClient';
import type { LiveCredential } from '../src/services/liveLessons/liveLessonService';
import type { RtcState } from '../src/services/liveLessons/rtc/types';
const credential = (role: 'host' | 'participant' = 'host'): LiveCredential => ({
  provider: 'zegocloud',
  appId: 123,
  roomId: 'opaque-room',
  userId: 'opaque-user',
  token: 'synthetic',
  expiresAt: new Date(Date.now() + 300000).toISOString(),
  role,
});
function fixture() {
  const events: Record<string, (...args: unknown[]) => void> = {};
  const engine = {
    on: jest.fn((name: string, callback: (...args: unknown[]) => void) => {
      events[name] = callback;
    }),
    off: jest.fn(),
    enableCamera: jest.fn().mockResolvedValue(undefined),
    muteMicrophone: jest.fn().mockResolvedValue(undefined),
    startPreview: jest.fn().mockResolvedValue(undefined),
    stopPreview: jest.fn().mockResolvedValue(undefined),
    loginRoom: jest.fn().mockResolvedValue({ errorCode: 0 }),
    logoutRoom: jest.fn().mockResolvedValue({ errorCode: 0 }),
    startPublishingStream: jest.fn().mockResolvedValue(undefined),
    stopPublishingStream: jest.fn().mockResolvedValue(undefined),
    startPlayingStream: jest.fn().mockResolvedValue(undefined),
    stopPlayingStream: jest.fn().mockResolvedValue(undefined),
    renewToken: jest.fn().mockResolvedValue(undefined),
  };
  const sdk = {
    default: {
      setEngineConfig: jest.fn().mockResolvedValue(undefined),
      createEngineWithProfile: jest.fn().mockResolvedValue(engine),
      destroyEngine: jest.fn().mockResolvedValue(undefined),
    },
    ZegoScenario: { Broadcast: 8 },
    ZegoViewMode: { AspectFit: 0 },
    ZegoRoomStateChangedReason: {
      LoginFailed: 2,
      Reconnecting: 3,
      Reconnected: 4,
      ReconnectFailed: 5,
      KickOut: 6,
    },
    ZegoUpdateType: { Add: 0, Delete: 1 },
    ZegoPublisherState: { Publishing: 2 },
    ZegoPlayerState: { Playing: 2 },
    ZegoRemoteDeviceState: { Open: 0 },
  };
  const client = new ZegoLiveLessonClient(
    async () =>
      sdk as unknown as typeof import('zego-express-engine-reactnative'),
  );
  return { client, engine, sdk, events };
}
const clients: ZegoLiveLessonClient[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map(c => c.dispose()));
});
const make = () => {
  const f = fixture();
  clients.push(f.client);
  return f;
};
test('engine/login/publishing are single-owned and backend identifiers are used verbatim', async () => {
  const { client, sdk, engine } = make();
  await Promise.all([client.prepare(123), client.prepare(123)]);
  await client.preview(5);
  await Promise.all([
    client.connect(credential()),
    client.connect(credential()),
  ]);
  expect(sdk.default.createEngineWithProfile).toHaveBeenCalledTimes(1);
  expect(engine.loginRoom).toHaveBeenCalledTimes(1);
  expect(engine.startPublishingStream).toHaveBeenCalledTimes(1);
  expect(engine.loginRoom).toHaveBeenCalledWith(
    'opaque-room',
    expect.objectContaining({ userID: 'opaque-user' }),
    expect.objectContaining({ token: 'synthetic' }),
  );
  expect(sdk.default.createEngineWithProfile).toHaveBeenCalledWith(
    expect.objectContaining({ appID: 123, appSign: '' }),
  );
  expect(sdk.default.setEngineConfig).toHaveBeenCalledWith(
    expect.objectContaining({
      logConfig: expect.objectContaining({ logSize: 0 }),
    }),
  );
});
test('student does not preview/publish and cannot enable camera or microphone', async () => {
  const { client, engine } = make();
  await client.prepare(123);
  await client.connect(credential('participant'));
  expect(engine.startPublishingStream).not.toHaveBeenCalled();
  expect(engine.startPreview).not.toHaveBeenCalled();
  await expect(client.preview(4)).rejects.toThrow();
  await expect(client.enableCamera(true)).rejects.toThrow();
  await expect(client.muteMicrophone(false)).rejects.toThrow();
});
test('remote streams normalize media state, attach a surface, and disappear on removal', async () => {
  const { client, events, engine } = make();
  const states: RtcState[] = [];
  client.subscribe(s => states.push(s));
  await client.prepare(123);
  await client.connect(credential('participant'));
  const stream = {
    streamID: 'opaque-stream',
    user: { userID: 'remote-private', userName: 'untrusted display' },
  };
  events.roomStreamUpdate('opaque-room', 0, [stream]);
  await client.attachRemote('opaque-stream', 7);
  events.playerStateUpdate('opaque-stream', 2, 0);
  expect(states.at(-1)?.participants[0]).toMatchObject({
    participantKey: 'opaque-stream',
    displayName: 'Lesson presenter',
    mediaState: 'playing',
  });
  expect(JSON.stringify(states)).not.toContain('remote-private');
  expect(JSON.stringify(states)).not.toContain('synthetic');
  events.remoteCameraStateUpdate('opaque-stream', 1);
  expect(states.at(-1)?.participants[0].videoActive).toBe(false);
  events.roomStreamUpdate('opaque-room', 1, [stream]);
  await client.attachRemote('removed', 7);
  await client.dispose();
  expect(engine.stopPlayingStream).toHaveBeenCalledWith('opaque-stream');
  expect(states.at(-1)?.participants).toEqual([]);
});
test('cleanup is idempotent and continues after a logout failure', async () => {
  const { client, engine, sdk } = make();
  await client.prepare(123);
  await client.preview(5);
  await client.connect(credential());
  engine.logoutRoom.mockRejectedValue(new Error('private'));
  await Promise.all([client.dispose(), client.dispose()]);
  expect(engine.stopPublishingStream).toHaveBeenCalledTimes(1);
  expect(engine.off).toHaveBeenCalled();
  expect(sdk.default.destroyEngine).toHaveBeenCalledTimes(1);
});
test('expired credential and changed identity cannot login or renew', async () => {
  const { client, engine } = make();
  await client.prepare(123);
  await expect(
    client.connect({ ...credential(), expiresAt: new Date(0).toISOString() }),
  ).rejects.toThrow('expired');
  expect(engine.loginRoom).not.toHaveBeenCalled();
  await client.connect(credential());
  await expect(
    client.renew({ ...credential(), userId: 'spoofed' }),
  ).rejects.toThrow();
});
test('mic/camera state changes only after successful SDK completion and relayout respects camera off', async () => {
  const { client, engine } = make();
  const states: RtcState[] = [];
  client.subscribe(s => states.push(s));
  await client.prepare(123);
  await client.preview(5);
  engine.muteMicrophone.mockRejectedValueOnce(new Error('private'));
  await expect(client.muteMicrophone(false)).rejects.toThrow();
  expect(states.at(-1)?.microphoneMuted).toBe(true);
  await client.enableCamera(false);
  await client.preview(6);
  expect(states.at(-1)?.cameraEnabled).toBe(false);
});

test('network quality, reconnect recovery and server removal are normalized with bounded cleanup', async () => {
  jest.useFakeTimers();
  const { client, events, engine, sdk } = make();
  const states: RtcState[] = [];
  const reauthorize = jest.fn();
  client.subscribe(s => states.push(s));
  client.onReconnect(reauthorize);
  await client.prepare(123);
  await client.connect(credential('participant'));
  events.networkQuality('', 3, 3);
  expect(states.at(-1)).toMatchObject({
    connection: 'degraded',
    quality: 'poor',
  });
  events.roomStateChanged('opaque-room', 3, 0);
  expect(states.at(-1)?.connection).toBe('reconnecting');
  events.roomStateChanged('opaque-room', 4, 0);
  expect(states.at(-1)?.connection).toBe('recovered');
  expect(reauthorize).toHaveBeenCalledTimes(2);
  events.roomStateChanged('opaque-room', 6, 1002055);
  await client.dispose();
  expect(states.at(-1)?.connection).toBe('removed');
  expect(sdk.default.destroyEngine).toHaveBeenCalledTimes(1);
  expect(engine.startPublishingStream).not.toHaveBeenCalled();
  jest.useRealTimers();
});

test('reconnect deadline tears down capture without creating a second engine/login', async () => {
  jest.useFakeTimers();
  const { client, events, engine, sdk } = make();
  await client.prepare(123);
  await client.connect(credential());
  events.roomStateChanged('opaque-room', 3, 0);
  await jest.advanceTimersByTimeAsync(30000);
  await client.dispose();
  expect(engine.loginRoom).toHaveBeenCalledTimes(1);
  expect(engine.stopPublishingStream).toHaveBeenCalledTimes(1);
  expect(sdk.default.destroyEngine).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});
