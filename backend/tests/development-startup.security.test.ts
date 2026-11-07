import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import Branch from '../src/models/branch';
import { StudentLeave } from '../src/models/attendanceAmendment';
import { ParentLeaveDecisionOperation } from '../src/models/parentLeaveDecisionOperation';
import Session from '../src/models/session';
import { createUser } from '../src/services/auth.service';
import {Gate, GateStaffAssignment, StudentCustodyState, GateAdminOperation} from '../src/models/gateFoundation';

const databaseName = 'startup_security_tests';
const jwtSecret = 'startup-test-fixture-only-secret';
let database: MongoMemoryReplSet;

before(async () => {
  database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(database.getUri(), { dbName: databaseName });
});

after(async () => {
  await mongoose.disconnect();
  await database?.stop();
});

async function reservePort() {
  const listener = createServer().listen(0, '0.0.0.0');
  await once(listener, 'listening');
  return {
    port: (listener.address() as AddressInfo).port,
    release: () => new Promise<void>((done, fail) => listener.close(error => error ? fail(error) : done())),
  };
}

function backend(port: number, overrides: Record<string, string> = {}) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: resolve(__dirname, '..'),
    env: {
      ...process.env,
      DOTENV_CONFIG_PATH: join(tmpdir(), `hira-startup-${randomUUID()}.env`),
      MONGODB_URI: database.getUri(),
      MONGODB_DB: databaseName,
      JWT_SECRET: jwtSecret,
      PORT: String(port),
      ...overrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const record = (chunk: Buffer) => { output += chunk.toString(); };
  child.stdout.on('data', record);
  child.stderr.on('data', record);
  const closed = once(child, 'close').then(([code]) => code as number | null);
  return {
    output: () => output,
    async ready() {
      const readyLine = `Backend server listening on port ${port}`;
      const deadline = Date.now() + 25_000;
      while (!output.includes(readyLine)) {
        assert.equal(child.exitCode, null, output);
        assert.ok(Date.now() < deadline, output || 'Backend did not become ready');
        await new Promise(done => setTimeout(done, 50));
      }
    },
    closed,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await closed;
    },
  };
}

test('the real server waits for required indexes and accepts canonical login on the configured port', async () => {
  const own = await Branch.create({ name: 'Own branch', code: 'OWN', address: 'Test address', city: 'Test city' });
  const foreign = await Branch.create({ name: 'Foreign branch', code: 'OTHER', address: 'Test address', city: 'Test city' });
  const password = randomUUID();
  const email = 'startup-principal@fixture.invalid';
  const user = await createUser({ fullName: 'Startup Principal', email, password, role: 'principal', branchId: String(own._id) });
  const slot = await reservePort();
  await slot.release();
  const running = backend(slot.port);
  const url = `http://127.0.0.1:${slot.port}`;
  const postLogin = (body: unknown) => fetch(`${url}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    await running.ready();
    assert.match(running.output(), /MongoDB connected successfully[\s\S]*Required database indexes initialized[\s\S]*Backend server listening/);
    assert.ok((await StudentLeave.collection.indexes()).some(index => index.name === 'one_parent_leave_coverage'));
    assert.ok((await ParentLeaveDecisionOperation.collection.indexes()).some(index => index.name === 'parent_leave_principal_operation'));
    for (const [model, name] of [[Gate, 'gate_branch_code_unique'], [GateStaffAssignment, 'gate_operator_active_unique'], [StudentCustodyState, 'custody_student_branch_unique'], [GateAdminOperation, 'gate_admin_operation_unique']] as const) {
      assert.ok((await model.collection.indexes()).some(index => index.name === name && index.unique));
    }
    assert.equal((await fetch(url)).status, 200);
    assert.equal((await postLogin({})).status, 400);
    assert.equal((await postLogin({ email, password: 'wrong password' })).status, 401);
    const login = await postLogin({ email, password });
    assert.equal(login.status, 200);
    const result = await login.json();
    assert.equal(result.user.role, 'principal');
    assert.equal(result.user.branchId, String(own._id));
    assert.ok(await Session.exists({ userId: user._id, token: result.accessToken, isRevoked: false }));
    const headers = { Authorization: `Bearer ${result.accessToken}` };
    assert.equal((await fetch(`${url}/api/auth/me`, { headers })).status, 200);
    const dashboard = await fetch(`${url}/api/principal/dashboard?branchId=${foreign._id}`, { headers });
    assert.equal(dashboard.status, 200);
    assert.equal((await dashboard.json()).data.branch.id, String(own._id));
    assert.equal((await fetch(`${url}/api/health`, { headers })).status, 403);
    const expired = jwt.sign({ userId: String(user._id), role: 'principal' }, jwtSecret, { expiresIn: -1 });
    assert.equal((await fetch(`${url}/api/auth/me`, { headers: { Authorization: `Bearer ${expired}` } })).status, 401);
    assert.equal((await fetch(`${url}/api/auth/logout`, { method: 'POST', headers })).status, 200);
    assert.equal((await fetch(`${url}/api/auth/me`, { headers })).status, 401);
  } finally {
    await running.stop();
  }
});

test('invalid MongoDB settings fail without printing the connection string or readiness', async () => {
  const syntheticUri = 'invalid://fixture-user:fixture-private-marker@example.invalid';
  const running = backend(5000, { MONGODB_URI: syntheticUri });
  try {
    assert.equal(await running.closed, 1);
    assert.match(running.output(), /Failed while connecting to MongoDB/);
    assert.doesNotMatch(running.output(), /fixture-private-marker|MongoDB connected successfully|Backend server listening/);
  } finally {
    await running.stop();
  }
});

test('an occupied port gives EADDRINUSE and exits without claiming readiness', async () => {
  const slot = await reservePort();
  const running = backend(slot.port);
  try {
    assert.equal(await running.closed, 1);
    assert.ok(running.output().includes(`Port ${slot.port} is already in use (EADDRINUSE)`));
    assert.doesNotMatch(running.output(), /Backend server listening/);
  } finally {
    await running.stop();
    await slot.release();
  }
});
