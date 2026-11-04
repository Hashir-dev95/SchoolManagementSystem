const { execFileSync } = jest.requireActual('node:child_process') as {
  execFileSync(
    file: string,
    args: string[],
    options: {
      cwd: string;
      env: Record<string, string | undefined>;
      encoding: 'utf8';
    },
  ): string;
};
const hostProcess = jest.requireActual('node:process') as {
  execPath: string;
  cwd(): string;
  env: Record<string, string | undefined>;
};

// Real build-tool modules in Node, outside Jest's mocked React Native environment.
const bootstrap = `
const assert = require('node:assert/strict');
const path = require('node:path');
const babel = require('@babel/core');
const filename = path.resolve('src/services/api/apiConfig.ts');
const compile = () => babel.transformFileSync(filename, {plugins: ['@babel/plugin-transform-modules-commonjs']}).code;
const metro = () => { delete require.cache[require.resolve('./metro.config')]; return require('./metro.config'); };
const options = dev => [[], {dev, hot: false, platform: 'android'}, async () => []];
`;
const run = (
  script: string,
  overrides: Record<string, string | undefined> = {},
) =>
  execFileSync(hostProcess.execPath, ['-e', bootstrap + script], {
    cwd: hostProcess.cwd(),
    env: {
      ...hostProcess.env,
      SCHOOL_APP_DEV_API_ORIGIN: 'http://192.168.137.1:5000',
      SCHOOL_APP_RELEASE_API_ORIGIN: '',
      ...overrides,
    },
    encoding: 'utf8',
  }).trim();

test('Babel injects only the dedicated module and two allowlisted values, preserving RN transforms', () => {
  expect(
    run(
      `
const code = compile();
assert(code.includes('http://192.168.137.1:5000'));
assert(!code.includes('__SCHOOL_APP_DEV_API_ORIGIN__'));
assert(!code.includes('host-secret-must-not-leak'));
const other = babel.transformSync('const marker = "__SCHOOL_APP_DEV_API_ORIGIN__"; const view = <View />;', {filename: path.resolve('__tests__/unrelated.tsx')}).code;
assert(other.includes('__SCHOOL_APP_DEV_API_ORIGIN__'));
assert(!other.includes('http://192.168.137.1:5000'));
assert(!other.includes('<View />'));
console.log('scoped');
`,
      { SCHOOL_APP_OTHER_SECRET: 'host-secret-must-not-leak' },
    ),
  ).toBe('scoped');
});

test('Babel warm configuration cache observes A to B to missing without stale literals', () => {
  expect(
    run(`
process.env.SCHOOL_APP_RELEASE_API_ORIGIN = 'https://api-a.example.com';
assert(compile().includes('https://api-a.example.com'));
process.env.SCHOOL_APP_RELEASE_API_ORIGIN = 'https://api-b.example.com';
const b = compile(); assert(b.includes('https://api-b.example.com')); assert(!b.includes('https://api-a.example.com'));
delete process.env.SCHOOL_APP_RELEASE_API_ORIGIN;
const missing = compile(); assert(!missing.includes('https://api-b.example.com'));
process.env.SCHOOL_APP_DEV_API_ORIGIN = 'http://10.0.2.2:6000';
const dev = compile(); assert(dev.includes('http://10.0.2.2:6000')); assert(!dev.includes('192.168.137.1'));
console.log('fresh');
`),
  ).toBe('fresh');
});

test('Babel never embeds credentials from an invalid unselected origin', () => {
  expect(
    run(
      `
const code = compile();
assert(!code.includes('private-build-password'));
assert(code.includes('http://192.168.137.1:5000'));
console.log('sanitized');
`,
      {
        SCHOOL_APP_RELEASE_API_ORIGIN:
          'https://user:private-build-password@api.example.com',
      },
    ),
  ).toBe('sanitized');
});

test.each(['', 'http://api.example.com', 'https://192.168.1.1'])(
  'actual Metro release hook rejects %s despite misleading NODE_ENV/BABEL_ENV',
  origin => {
    expect(
      run(
        `
(async () => {
const config = metro();
await assert.rejects(config.transformer.getTransformOptions(...options(false)), /SCHOOL_APP_RELEASE_API_ORIGIN/);
console.log('denied');
})().catch(error => {console.error(error);process.exitCode=1});
`,
        {
          SCHOOL_APP_RELEASE_API_ORIGIN: origin,
          NODE_ENV: 'development',
          BABEL_ENV: 'development',
        },
      ),
    ).toBe('denied');
  },
);

test('Metro preserves default transform options and distinguishes dev/release using dev flag', () => {
  expect(
    run(
      `
(async () => {
const config = metro();
const expected = await require('@react-native/metro-config').getDefaultConfig(process.cwd()).transformer.getTransformOptions(...options(false));
assert.deepEqual(await config.transformer.getTransformOptions(...options(false)), expected);
assert.equal(expected.transform.inlineRequires, true);
await config.transformer.getTransformOptions(...options(true));
console.log('defaults preserved');
})().catch(error => {console.error(error);process.exitCode=1});
`,
      { SCHOOL_APP_RELEASE_API_ORIGIN: 'https://api-a.example.com' },
    ),
  ).toBe('defaults preserved');
});

test('Metro cache identity changes for either origin; warm valid to missing is denied', () => {
  expect(
    run(`
(async () => {
process.env.SCHOOL_APP_RELEASE_API_ORIGIN = 'https://api-a.example.com';
const a = metro(); await a.transformer.getTransformOptions(...options(false));
process.env.SCHOOL_APP_RELEASE_API_ORIGIN = 'https://api-b.example.com';
const b = metro(); assert.notEqual(a.cacheVersion,b.cacheVersion);
process.env.SCHOOL_APP_DEV_API_ORIGIN = 'http://10.0.2.2:6000';
const dev = metro(); assert.notEqual(b.cacheVersion,dev.cacheVersion);
delete process.env.SCHOOL_APP_RELEASE_API_ORIGIN;
const missing = metro(); assert.notEqual(dev.cacheVersion,missing.cacheVersion);
await assert.rejects(missing.transformer.getTransformOptions(...options(false)), /SCHOOL_APP_RELEASE_API_ORIGIN/);
console.log('invalidated');
})().catch(error => {console.error(error);process.exitCode=1});
`),
  ).toBe('invalidated');
});
