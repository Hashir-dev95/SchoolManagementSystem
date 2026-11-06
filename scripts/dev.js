const { spawn } = require('node:child_process');
const { resolve } = require('node:path');

const root = resolve(__dirname, '..');
const backend = resolve(root, 'backend');
const children = [];
let stopping = false;

function stop(exitCode) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
  }
}

function start(label, cwd, args) {
  // Launch Node directly so Windows does not leave an npm/CMD wrapper to stop.
  const child = spawn(process.execPath, args, {
    cwd,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  children.push(child);
  child.once('error', error => {
    console.error(`[dev] ${label} could not start: ${error.code || error.name}`);
    stop(1);
  });
  child.once('exit', (code, signal) => {
    if (stopping) return;
    console.error(`[dev] ${label} stopped (${signal || `exit ${code}`}).`);
    stop(code || 1);
  });
}

const metro = require.resolve('react-native/cli.js');
if (!process.env.SCHOOL_APP_DEV_API_ORIGIN) {
  console.warn('[dev] Set SCHOOL_APP_DEV_API_ORIGIN before loading the mobile app. See README.md.');
}
process.once('SIGINT', () => stop(130));
process.once('SIGTERM', () => stop(143));
start('Backend', backend, ['--import', 'tsx', 'src/server.ts']);
// Keep Ctrl+C with the supervisor instead of Metro's raw keyboard handler.
start('Metro', root, [metro, 'start', '--no-interactive']);
