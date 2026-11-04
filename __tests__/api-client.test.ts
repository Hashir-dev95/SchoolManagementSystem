const path = jest.requireActual('node:path') as {
  resolve(...parts: string[]): string;
};

const babel = jest.requireActual('@babel/core');
const policy = jest.requireActual('../config/api-origin-policy');
const vm = jest.requireActual('node:vm') as {
  runInNewContext(code: string, context: Record<string, unknown>): void;
};
type Options = {
  method?: string;
  body?: unknown;
  token?: string;
  timeoutMs?: number;
};
interface Client {
  apiClient: {
    request<T = unknown>(endpoint: string, options?: Options): Promise<T>;
  };
  ApiError: new (status: number, message: string) => Error & { status: number };
}

// Compile the actual client and actual resolver with the actual plugin. No mocked resolver.
function loadClient(
  development: boolean,
  origins = { development: '', release: '' },
  inject = true,
) {
  const fetch = jest.fn();
  const compile = (file: string) =>
    babel.transformFileSync(path.resolve(file), {
      configFile: false,
      babelrc: false,
      presets: ['module:@react-native/babel-preset'],
      plugins: [
        ...(inject
          ? [[path.resolve('scripts/babel-plugin-api-origins.js'), origins]]
          : []),
        '@babel/plugin-transform-modules-commonjs',
      ],
    }).code;
  const execute = (code: string, resolve: (id: string) => unknown) => {
    const module = { exports: {} };
    vm.runInNewContext(code, {
      require: resolve,
      module,
      exports: module.exports,
      __DEV__: development,
      fetch,
      AbortController,
      setTimeout,
      clearTimeout,
      Error,
    });
    return module.exports;
  };
  const config = execute(compile('src/services/api/apiConfig.ts'), id =>
    id === '../../../config/api-origin-policy'
      ? policy
      : jest.requireActual(id),
  );
  const client = execute(compile('src/services/api/apiClient.ts'), id =>
    id === './apiConfig' ? config : jest.requireActual(id),
  ) as Client;
  return { ...client, fetch, execute, compile };
}

afterEach(() => jest.useRealTimers());

test('an unconfigured transformation leaves markers that fail before fetch', async () => {
  const { apiClient, fetch } = loadClient(
    false,
    { development: '', release: '' },
    false,
  );
  await expect(apiClient.request('/auth/login')).rejects.toMatchObject({
    name: 'ApiConfigurationError',
  });
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  [true, '', ''],
  [false, 'http://192.168.137.1:5000', ''],
  [false, 'http://localhost:5000', 'http://api.example.com'],
  [false, '', 'https://[::1]'],
  [false, '', '__SCHOOL_APP_RELEASE_API_ORIGIN__'],
] as const)(
  'invalid configuration dev=%s fails before fetch',
  async (development, dev, release) => {
    const { apiClient, fetch } = loadClient(development, {
      development: dev,
      release,
    });
    await expect(
      apiClient.request('/auth/login', {
        token: 'private-token',
        body: { password: 'private-password' },
      }),
    ).rejects.toMatchObject({ name: 'ApiConfigurationError' });
    expect(fetch).not.toHaveBeenCalled();
  },
);

test.each([
  [true, 'http://192.168.137.1:5000/', '', 'http://192.168.137.1:5000/api'],
  [
    false,
    'http://192.168.137.1:5000',
    'https://api-a.example.com/',
    'https://api-a.example.com/api',
  ],
] as const)(
  'valid configuration dev=%s preserves auth, chat and notification requests',
  async (development, dev, release, base) => {
    const { apiClient, fetch, execute, compile } = loadClient(development, {
      development: dev,
      release,
    });
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { ok: true } }),
    });
    const { authService } = execute(
      compile('src/services/auth/authService.ts'),
      id =>
        id === '../api/apiClient' ? { apiClient } : jest.requireActual(id),
    ) as {
      authService: {
        login(email: string, password: string): Promise<unknown>;
        logout(token: string): Promise<void>;
      };
    };
    await authService.login('own@test.invalid', 'private-password');
    await authService.logout('private-token');
    await apiClient.request('/chat/conversations/id/messages', {
      method: 'POST',
      token: 'private-token',
      body: { body: 'Hello', clientOperationId: 'operation_12345678' },
    });
    await apiClient.request('/notifications/me', { token: 'private-token' });
    expect(fetch.mock.calls.map(call => call[0])).toEqual([
      `${base}/auth/login`,
      `${base}/auth/logout`,
      `${base}/chat/conversations/id/messages`,
      `${base}/notifications/me`,
    ]);
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'own@test.invalid',
        password: 'private-password',
      }),
    });
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe(
      'Bearer private-token',
    );
    expect(fetch.mock.calls[2][1].body).toBe(
      JSON.stringify({
        body: 'Hello',
        clientOperationId: 'operation_12345678',
      }),
    );
    expect(fetch.mock.calls[3][1]).toMatchObject({
      method: 'GET',
      headers: { Authorization: 'Bearer private-token' },
    });
    expect(fetch.mock.calls[3][1]).not.toHaveProperty('body');
  },
);

test.each([401, 403, 404, 409, 500])(
  'HTTP %s retains ApiError status and message',
  async status => {
    const { apiClient, fetch, ApiError } = loadClient(false, {
      development: '',
      release: 'https://api-a.example.com',
    });
    fetch.mockResolvedValue({
      ok: false,
      status,
      json: async () => ({ message: 'Canonical failure' }),
    });
    const pending = apiClient.request('/notifications/me');
    await expect(pending).rejects.toBeInstanceOf(ApiError);
    await expect(pending).rejects.toMatchObject({
      status,
      message: 'Canonical failure',
    });
  },
);

test('network errors and timeout/abort behavior remain unchanged', async () => {
  jest.useFakeTimers();
  const { apiClient, fetch } = loadClient(false, {
    development: '',
    release: 'https://api-a.example.com',
  });
  fetch.mockRejectedValueOnce(new Error('Offline'));
  await expect(apiClient.request('/notifications/me')).rejects.toThrow(
    'Offline',
  );
  fetch.mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
  );
  const result = apiClient.request('/chat/conversations', { timeoutMs: 20 });
  jest.advanceTimersByTime(20);
  await expect(result).rejects.toThrow(
    'Network request timed out. Please check server connection.',
  );
  expect(jest.getTimerCount()).toBe(0);
});
