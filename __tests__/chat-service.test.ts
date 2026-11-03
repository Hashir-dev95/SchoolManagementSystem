import { apiClient } from '../src/services/api/apiClient';
import { chatOperationId, chatService } from '../src/services/chat/chatService';

jest.mock('../src/services/api/apiClient', () => ({
  apiClient: { request: jest.fn() },
}));
const request = jest.mocked(apiClient.request);
const runtime = globalThis as typeof globalThis & {
  RN$Bridgeless?: boolean;
  nativeCallSyncHook?: unknown;
  crypto?: { getRandomValues: (bytes: Uint8Array) => Uint8Array };
};
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const originalBridgeless = runtime.RN$Bridgeless;
const originalHook = runtime.nativeCallSyncHook;
beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue({ success: true, data: { marker: 'canonical' } });
});
afterEach(() => {
  if (originalCrypto)
    Object.defineProperty(globalThis, 'crypto', originalCrypto);
  else Reflect.deleteProperty(globalThis, 'crypto');
  runtime.RN$Bridgeless = originalBridgeless;
  runtime.nativeCallSyncHook = originalHook;
});

test('native CSPRNG fills exactly 16 bytes and produces fixed safe lowercase hex IDs', () => {
  runtime.RN$Bridgeless = true;
  let seed = 0;
  const fill = jest.fn((bytes: Uint8Array) => {
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBe(16);
    bytes.forEach((_, index) => {
      bytes[index] = seed + index;
    });
    seed += 16;
    return bytes;
  });
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { getRandomValues: fill },
  });
  const first = chatOperationId(),
    second = chatOperationId();
  expect(first).toBe('chat_000102030405060708090a0b0c0d0e0f');
  expect(second).toBe('chat_101112131415161718191a1b1c1d1e1f');
  expect(first).toMatch(/^chat_[0-9a-f]{32}$/);
  expect(first).toHaveLength(37);
  expect(second).not.toBe(first);
  expect(fill).toHaveBeenCalledTimes(2);
});
test('missing native randomness fails closed without a fallback', () => {
  runtime.RN$Bridgeless = true;
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {},
  });
  expect(chatOperationId).toThrow('Secure message IDs are unavailable.');
});
test('legacy remote-debug mode cannot enter the package insecure fallback', () => {
  runtime.RN$Bridgeless = false;
  runtime.nativeCallSyncHook = undefined;
  const fill = jest.fn();
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { getRandomValues: fill },
  });
  expect(chatOperationId).toThrow(
    'Secure message IDs require the native runtime.',
  );
  expect(fill).not.toHaveBeenCalled();
});
test('native randomness failures propagate without manufacturing an ID', () => {
  runtime.RN$Bridgeless = true;
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      getRandomValues: () => {
        throw new Error('native unavailable');
      },
    },
  });
  expect(chatOperationId).toThrow('native unavailable');
});
test('all methods consume canonical endpoints, bounded pages and envelopes with no client authority fields', async () => {
  const token = 'session';
  expect(await chatService.recipients(token, 25)).toEqual({
    marker: 'canonical',
  });
  await chatService.list(token, 50);
  await chatService.create(token, 'returned-recipient');
  await chatService.detail(token, 'a/b');
  await chatService.history(token, 'a/b');
  await chatService.history(token, 'a/b', 51);
  await chatService.send(
    token,
    'a/b',
    'message',
    'chat_000102030405060708090a0b0c0d0e0f',
  );
  await chatService.read(token, 'a/b', 'm/n');
  expect(request.mock.calls).toEqual([
    ['/chat/me/recipients?offset=25&limit=25', { token, method: 'GET' }],
    ['/chat/conversations?offset=50&limit=25', { token, method: 'GET' }],
    [
      '/chat/conversations',
      {
        token,
        method: 'POST',
        body: { recipientUserId: 'returned-recipient' },
      },
    ],
    ['/chat/conversations/a%2Fb', { token, method: 'GET' }],
    ['/chat/conversations/a%2Fb/messages?limit=50', { token, method: 'GET' }],
    [
      '/chat/conversations/a%2Fb/messages?limit=50&beforeSequence=51',
      { token, method: 'GET' },
    ],
    [
      '/chat/conversations/a%2Fb/messages',
      {
        token,
        method: 'POST',
        body: {
          body: 'message',
          clientOperationId: 'chat_000102030405060708090a0b0c0d0e0f',
        },
      },
    ],
    [
      '/chat/conversations/a%2Fb/messages/m%2Fn/read',
      { token, method: 'POST', body: {} },
    ],
  ]);
});
test('HTTP errors preserve canonical status for workspace authorization handling', async () => {
  const failure = Object.assign(new Error('Forbidden'), { status: 403 });
  request.mockRejectedValue(failure);
  await expect(chatService.detail('token', 'id')).rejects.toBe(failure);
});
