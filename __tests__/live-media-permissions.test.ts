import {
  mediaPermissions,
  canCapture,
} from '../src/services/liveLessons/mediaPermissions';
import { check, request, RESULTS } from 'react-native-permissions';
jest.mock('react-native-permissions', () => ({
  check: jest.fn(),
  request: jest.fn(),
  RESULTS: {
    GRANTED: 'granted',
    DENIED: 'denied',
    BLOCKED: 'blocked',
    UNAVAILABLE: 'unavailable',
  },
  PERMISSIONS: {
    ANDROID: { CAMERA: 'android.camera', RECORD_AUDIO: 'android.audio' },
    IOS: { CAMERA: 'ios.camera', MICROPHONE: 'ios.audio' },
  },
}));
beforeEach(() => {
  jest.clearAllMocks();
});
test('permission request only prompts denied access, not blocked/unavailable access', async () => {
  jest
    .mocked(check)
    .mockResolvedValueOnce(RESULTS.BLOCKED)
    .mockResolvedValueOnce(RESULTS.UNAVAILABLE);
  const state = await mediaPermissions.request();
  expect(request).not.toHaveBeenCalled();
  expect(canCapture(state)).toBe(false);
});
test('granted access does not reprompt and denied access can be retried', async () => {
  jest
    .mocked(check)
    .mockResolvedValueOnce(RESULTS.GRANTED)
    .mockResolvedValueOnce(RESULTS.DENIED);
  jest.mocked(request).mockResolvedValue(RESULTS.GRANTED);
  expect(canCapture(await mediaPermissions.request())).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
});
