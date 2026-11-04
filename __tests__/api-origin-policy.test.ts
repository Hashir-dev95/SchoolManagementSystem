import { readApiOrigins, validateApiOrigin } from '../config/api-origin-policy';

test.each([
  ['http://192.168.137.1:5000', 'http://192.168.137.1:5000'],
  ['https://dev.example.com/', 'https://dev.example.com'],
  ['http://localhost:8080', 'http://localhost:8080'],
  ['http://10.0.2.2:5000', 'http://10.0.2.2:5000'],
  ['http://[::1]:5000', 'http://[::1]:5000'],
  ['http://[::ffff:192.168.1.1]:5000', 'http://[::ffff:192.168.1.1]:5000'],
])(
  'explicit development origin %s resolves without a fallback',
  (input, output) => {
    expect(validateApiOrigin(input, true)).toBe(output);
  }
);

test.each([
  ['https://api-a.example.com', 'https://api-a.example.com'],
  ['HTTPS://API-B.EXAMPLE.COM:443/', 'https://api-b.example.com'],
  ['https://api.example.com:8443', 'https://api.example.com:8443'],
])('synthetic release origin %s normalizes', (input, output) => {
  expect(validateApiOrigin(input, false)).toBe(output);
});

test.each([
  undefined,
  null,
  '',
  ' ',
  '__SCHOOL_APP_RELEASE_API_ORIGIN__',
  'http://api.example.com',
  'https://127.0.0.1',
  'https://192.168.1.1',
  'https://10.0.0.1',
  'https://172.16.0.1',
  'https://169.254.1.1',
  'https://8.8.8.8',
  'https://[::1]',
  'https://[fc00::1]',
  'https://[::ffff:127.0.0.1]',
  'https://2130706433',
  'https://0x7f000001',
  'https://127.1',
  'https://0177.0.0.1',
  'https://localhost',
  'https://api.localhost',
  'https://api.local',
  'https://api.internal',
  'https://api.lan',
  'https://api.home.arpa',
  'https://intranet',
  'https://api.test',
  'https://api.invalid',
  'https://api.example',
  'https://user:secret@api.example.com',
  'https://api.example.com/api',
  'https://api.example.com//',
  'https://api.example.com?q=secret',
  'https://api.example.com#fragment',
  'https://api.example.com:',
  'https://api.example.com:0',
  'https://api.example.com:65536',
  'https://api.example.com.',
  'https://-api.example.com',
  'https://api..example.com',
  'https://api%2eexample.com',
  ' https://api.example.com',
  'https://api.example.com\n',
  'https:\\api.example.com',
  '//api.example.com',
])('release rejects invalid/local configuration %s', input => {
  expect(() => validateApiOrigin(input, false)).toThrow(
    'SCHOOL_APP_RELEASE_API_ORIGIN'
  );
});

test.each([
  undefined,
  '',
  'http://999.1.1.1',
  'http://[:::1]',
  'http://host/api',
])('development also fails closed for %s', input => {
  expect(() => validateApiOrigin(input, true)).toThrow(
    'SCHOOL_APP_DEV_API_ORIGIN'
  );
});

test('errors are sanitized and configuration reader allowlists only public origins', () => {
  const environment = {
    SCHOOL_APP_DEV_API_ORIGIN: 'http://localhost:5000',
    SCHOOL_APP_RELEASE_API_ORIGIN: 'https://api.example.com',
    JWT_SECRET: 'must-not-be-embedded',
  };
  expect(readApiOrigins(environment)).toEqual({
    development: environment.SCHOOL_APP_DEV_API_ORIGIN,
    release: environment.SCHOOL_APP_RELEASE_API_ORIGIN,
  });
  expect(readApiOrigins({})).toEqual({ development: '', release: '' });
  expect(() =>
    validateApiOrigin('https://user:private-password@host', false)
  ).toThrow(/^Invalid or missing SCHOOL_APP_RELEASE_API_ORIGIN:/);
  try {
    validateApiOrigin('https://user:private-password@host', false);
  } catch (error) {
    expect(String(error)).not.toContain('private-password');
  }
});
