import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { resolve } from 'node:path';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import type { Server } from 'node:http';
import mongoose from 'mongoose';
import app from '../src/app';
import User, { type UserRole } from '../src/models/user';
import Session from '../src/models/session';
import { StudentEnrollment } from '../src/models/studentEnrollment';
import { ParentLeaveApplication } from '../src/models/parentLeaveApplication';
import {
  AttendanceSession,
  PeriodAttendanceRecord,
} from '../src/models/periodAttendance';
import {
  Gate,
  GateStaffAssignment,
  StudentCustodyState,
  GateAdminOperation,
  ensureGateFoundationIndexes,
} from '../src/models/gateFoundation';
import { ROLE_PERMISSIONS } from '../src/constants/rolePermissions';
import { PERMISSIONS } from '../src/constants/permissions';
import { registerSession } from '../src/services/session.service';
import { generateAccessToken } from '../src/services/jwt.service';
import {
  requireAutomatedReleaseAuthority,
  requireGateDuty,
} from '../src/services/gate-authority.service';
import { comparePassword } from '../src/utils/password';
import {
  state,
  parentState,
  oid,
  put,
} from './helpers/parent-workspace.fixture';
import type { GateWorkerInput } from './helpers/gate-foundation-worker';

let server: Server, base: string;
let admin: { id: string; token: string },
  operator: { id: string; token: string };
const oldPolicy = process.env.GATE_ADMIN_BRANCH_IDS;
const reason = 'School administration fixture action';
const commands = (id: string, body: Record<string, unknown> = {}) => ({
  clientOperationId: id,
  reason,
  ...body,
});
const path = () => `/gate-admin/branches/${state.branch._id}`;
const identity = (account: { id: string }, role: UserRole) => ({
  userId: account.id,
  role,
});
async function actor(role: UserRole, branchId = state.branch._id) {
  const row = await User.create({
    fullName: 'Gate fixture actor',
    email: `${oid()}@fixture.invalid`,
    password: 'fixture-only',
    role,
    ...(role === 'super_admin' ? {} : { branchId }),
  });
  const token = generateAccessToken(String(row._id), role);
  await registerSession(String(row._id), token, role);
  return { id: String(row._id), token };
}
async function http(route: string, token = admin.token, body?: unknown) {
  const response = await fetch(base + '/api' + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    data: response.headers.get('content-type')?.includes('application/json')
      ? ((await response.json()) as any)
      : null,
  };
}
async function gate(code = 'NORTH') {
  const result = await http(
    path() + '/gates',
    admin.token,
    commands(`gate-${code}`, { code, name: 'North gate' }),
  );
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data.data as { id: string; revision: number };
}
const assignmentBody = (id = 'assign') =>
  commands(id, {
    operatorId: operator.id,
    duties: ['tasks_view', 'exit_confirm'],
    validFrom: new Date(Date.now() - 60000).toISOString(),
    validUntil: new Date(Date.now() + 3600000).toISOString(),
  });
async function assigned() {
  const target = await gate();
  const result = await http(
    `${path()}/gates/${target.id}/assignments`,
    admin.token,
    assignmentBody(),
  );
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return { gateId: target.id, id: result.data.data.id as string };
}
const contextPath = (record: { gateId: string; id: string }) =>
  `/gate/me/gates/${record.gateId}/assignments/${record.id}`;
before(async () => {
  await ensureGateFoundationIndexes();
  await ensureGateFoundationIndexes();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(done => server.once('listening', done));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
beforeEach(async () => {
  process.env.GATE_ADMIN_BRANCH_IDS = JSON.stringify([
    String(state.branch._id),
  ]);
  admin = await actor('super_admin');
  operator = await actor('gate_staff');
});
afterEach(() => mock.restoreAll());
after(async () => {
  if (oldPolicy === undefined) delete process.env.GATE_ADMIN_BRANCH_IDS;
  else process.env.GATE_ADMIN_BRANCH_IDS = oldPolicy;
  await new Promise<void>(done => server.close(() => done()));
});

test('public registration ignores Gate Staff role and provisioning uses canonical hashed login', async () => {
  const registered = await http('/auth/register', '', {
    fullName: 'Public registrant',
    email: 'public@fixture.invalid',
    password: 'PasswordForFixture123',
    branchId: String(state.branch._id),
    role: 'gate_staff',
  });
  assert.equal(registered.status, 201);
  assert.equal(registered.data.user.role, 'student');
  const body = commands('provision', {
    fullName: 'Provisioned operator',
    email: ' NEW@FIXTURE.INVALID ',
    password: 'PasswordForFixture123',
  });
  const provisioned = await http(path() + '/operators', admin.token, body);
  assert.equal(provisioned.status, 201, JSON.stringify(provisioned.data));
  assert.equal(provisioned.data.data.role, 'gate_staff');
  const user = await User.findById(provisioned.data.data.id).orFail();
  assert.equal(await comparePassword(body.password, user.password), true);
  assert.ok(!JSON.stringify(provisioned.data).includes(body.password));
  assert.equal(
    (await http(path() + '/operators', admin.token, body)).data.data.id,
    String(user._id),
  );
  assert.equal(
    (
      await http(path() + '/operators', admin.token, {
        ...body,
        clientOperationId: 'other',
      })
    ).status,
    409,
  );
  const login = await http('/auth/login', '', {
    email: user.email,
    password: body.password,
  });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.role, 'gate_staff');
  assert.ok(
    await Session.exists({ token: login.data.accessToken, isRevoked: false }),
  );
  assert.equal(
    await GateStaffAssignment.countDocuments({ operatorId: user._id }),
    0,
  );
});

test('only allowlisted global administrators can provision or manage foundation records', async () => {
  for (const role of [
    'parent',
    'student',
    'teacher',
    'principal',
    'finance',
    'gate_staff',
  ] as const) {
    const account = await actor(role);
    assert.equal(
      (
        await http(
          path() + '/gates',
          account.token,
          commands(role, { code: 'X', name: 'Wrong role' }),
        )
      ).status,
      403,
    );
  }
  delete process.env.GATE_ADMIN_BRANCH_IDS;
  assert.equal(
    (
      await http(
        path() + '/gates',
        admin.token,
        commands('missing', { code: 'X', name: 'No policy' }),
      )
    ).status,
    403,
  );
  process.env.GATE_ADMIN_BRANCH_IDS = JSON.stringify([
    String(state.branch._id),
  ]);
  assert.equal(
    (
      await http(
        `/gate-admin/branches/${state.foreign._id}/gates`,
        admin.token,
        commands('foreign', { code: 'X', name: 'Foreign' }),
      )
    ).status,
    403,
  );
  assert.equal(await Gate.countDocuments(), 0);
});

test('administrator receipts reject conflicting payloads and cannot bypass revoked sessions', async () => {
  const payload = commands('same-operation', {
    code: 'REPLAY',
    name: 'Replay gate',
  });
  const first = await http(path() + '/gates', admin.token, payload);
  assert.equal(first.status, 201);
  assert.equal(
    (await http(path() + '/gates', admin.token, payload)).data.data.id,
    first.data.data.id,
  );
  assert.equal(
    (
      await http(path() + '/gates', admin.token, {
        ...payload,
        name: 'Different payload',
      })
    ).status,
    409,
  );
  await Session.updateOne(
    { token: admin.token },
    { $set: { isRevoked: true } },
  );
  assert.equal(
    (await http(path() + '/gates', admin.token, payload)).status,
    401,
  );
  assert.equal(await Gate.countDocuments(), 1);
});

test('a signed Gate Staff JWT without its registered session grants no authority', async () => {
  const record = await assigned();
  await Session.deleteMany({ token: operator.token });
  assert.equal((await http(contextPath(record), operator.token)).status, 401);
});

test('Gate Staff is isolated from all academic, family, approval and finance APIs', async () => {
  for (const route of [
    '/principal/dashboard',
    '/teacher/classes',
    '/student/me',
    '/parent/me/children',
    '/finance/me',
    '/approval-requests',
  ]) {
    const result = await http(route, operator.token);
    assert.ok(
      [401, 403, 404].includes(result.status),
      `${route}: ${result.status}`,
    );
  }
  assert.deepEqual(ROLE_PERMISSIONS.gate_staff, []);
  for (const role of Object.keys(ROLE_PERMISSIONS) as UserRole[])
    assert.equal(
      ROLE_PERMISSIONS[role].includes(PERMISSIONS.GATE_EXIT_CONFIRM),
      false,
    );
});

test('assignment metadata requires the exact current operator, Gate and Branch and grants no actions', async () => {
  const record = await assigned();
  const result = await http(contextPath(record), operator.token);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.deepEqual(result.data.data.operationalActions, []);
  for (const role of ['principal', 'super_admin'] as const)
    assert.equal(
      (await http(contextPath(record), (await actor(role)).token)).status,
      403,
    );
  assert.equal(
    (await http(contextPath(record), (await actor('gate_staff')).token)).status,
    404,
  );
  assert.equal(
    (
      await http(
        contextPath({ ...record, gateId: String(oid()) }),
        operator.token,
      )
    ).status,
    404,
  );
  await User.updateOne(
    { _id: operator.id },
    { $set: { branchId: state.foreign._id } },
  );
  assert.equal((await http(contextPath(record), operator.token)).status, 404);
});

test('real foreign Gate IDs remain concealed and custody provenance cannot retarget a replacement enrollment', async () => {
  const record = await assigned();
  process.env.GATE_ADMIN_BRANCH_IDS = JSON.stringify([
    String(state.branch._id),
    String(state.foreign._id),
  ]);
  const foreign = await http(
    `/gate-admin/branches/${state.foreign._id}/gates`,
    admin.token,
    commands('foreign-gate', { code: 'OTHER', name: 'Foreign gate' }),
  );
  assert.equal(foreign.status, 201);
  assert.equal(
    (
      await http(
        contextPath({ ...record, gateId: foreign.data.data.id }),
        operator.token,
      )
    ).status,
    404,
  );
  const route = `${path()}/students/${state.student._id}/custody`;
  assert.equal(
    (
      await http(
        route,
        admin.token,
        commands('hold', { state: 'hold', revision: 0 }),
      )
    ).status,
    200,
  );
  await StudentEnrollment.updateOne(
    { _id: state.enrollment._id },
    { $set: { status: 'transferred', effectiveTo: new Date() } },
  );
  await put(StudentEnrollment, {
    ...state.enrollment,
    _id: oid(),
    status: 'active',
    effectiveTo: null,
  });
  assert.deepEqual((await http(route)).data.data, {
    state: 'unknown',
    revision: 1,
    sourceCurrent: false,
    automatedReleaseAllowed: false,
  });
  assert.equal(
    (
      await http(
        route,
        admin.token,
        commands('retarget', { state: 'unknown', revision: 1 }),
      )
    ).status,
    409,
  );
  assert.equal(
    String((await StudentCustodyState.findOne().orFail()).enrollmentId),
    String(state.enrollment._id),
  );
});

for (const changed of [
  'expired',
  'future',
  'revoked',
  'gate_disabled',
  'account_disabled',
  'role_changed',
  'session_revoked',
  'session_missing',
] as const) {
  test(`current authority denies ${changed}`, async () => {
    const record = await assigned();
    if (changed === 'expired')
      await GateStaffAssignment.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(record.id) },
        { $set: { validUntil: new Date(Date.now() - 1) } },
      );
    if (changed === 'future')
      await GateStaffAssignment.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(record.id) },
        { $set: { validFrom: new Date(Date.now() + 100000) } },
      );
    if (changed === 'revoked')
      assert.equal(
        (
          await http(
            `${path()}/assignments/${record.id}/revoke`,
            admin.token,
            commands('revoke', { revision: 1 }),
          )
        ).status,
        200,
      );
    if (changed === 'gate_disabled')
      assert.equal(
        (
          await http(
            `${path()}/gates/${record.gateId}`,
            admin.token,
            commands('disable', {
              revision: 1,
              name: 'North gate',
              isActive: false,
            }),
          )
        ).status,
        200,
      );
    if (changed === 'account_disabled')
      await User.updateOne({ _id: operator.id }, { $set: { isActive: false } });
    if (changed === 'role_changed')
      await User.updateOne({ _id: operator.id }, { $set: { role: 'teacher' } });
    if (changed === 'session_revoked')
      await Session.updateOne(
        { token: operator.token },
        { $set: { isRevoked: true } },
      );
    if (changed === 'session_missing')
      await Session.deleteOne({ token: operator.token });
    assert.equal(
      (await http(contextPath(record), operator.token)).status,
      [
        'account_disabled',
        'role_changed',
        'session_revoked',
        'session_missing',
      ].includes(changed)
        ? 401
        : 404,
    );
  });
}

test('gate uniqueness, CAS, immutable history and conflicting assignments are enforced', async () => {
  const record = await assigned();
  assert.equal(
    (
      await http(
        path() + '/gates',
        admin.token,
        commands('duplicate', { code: 'north', name: 'Duplicate' }),
      )
    ).status,
    409,
  );
  const other = await gate('SOUTH');
  assert.equal(
    (
      await http(
        `${path()}/gates/${other.id}/assignments`,
        admin.token,
        assignmentBody('overlap'),
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await http(
        `${path()}/assignments/${record.id}/revoke`,
        admin.token,
        commands('stale', { revision: 0 }),
      )
    ).status,
    409,
  );
  const revoked = await http(
    `${path()}/assignments/${record.id}/revoke`,
    admin.token,
    commands('revoke', { revision: 1 }),
  );
  assert.equal(revoked.status, 200, JSON.stringify(revoked.data));
  const row = await GateStaffAssignment.findById(record.id)
    .select('+history')
    .orFail();
  assert.equal(row.history.length, 2);
  assert.equal(String(row.revokedBy), admin.id);
  row.history[0].reason = 'Tampered historic reason';
  await assert.rejects(row.save(), /immutable audit/);
  assert.equal(
    (
      await http(
        `${path()}/gates/${other.id}/assignments`,
        admin.token,
        assignmentBody('replacement'),
      )
    ).status,
    201,
  );
});

test('wrong roles, foreign operators, disabled Gates, unknown fields and malformed IDs are denied', async () => {
  const target = await gate();
  for (const account of [
    await actor('teacher'),
    await actor('principal'),
    await actor('gate_staff', state.foreign._id),
    admin,
  ])
    assert.ok(
      [403, 404].includes(
        (
          await http(`${path()}/gates/${target.id}/assignments`, admin.token, {
            ...assignmentBody(account.id),
            operatorId: account.id,
          })
        ).status,
      ),
    );
  assert.equal(
    (
      await http(
        `${path()}/gates/${target.id}`,
        admin.token,
        commands('disable', { revision: 1, name: 'Disabled', isActive: false }),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await http(
        `${path()}/gates/${target.id}/assignments`,
        admin.token,
        assignmentBody(),
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await http(
        `${path()}/gates/no-id/assignments`,
        admin.token,
        assignmentBody(),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await http(
        path() + '/gates',
        admin.token,
        commands('extra', {
          code: 'X',
          name: 'Injected',
          branchId: String(state.foreign._id),
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await http(
        path() + '/operators',
        admin.token,
        commands('role', {
          fullName: 'Injected',
          email: 'x@fixture.invalid',
          password: 'PasswordForFixture123',
          role: 'super_admin',
        }),
      )
    ).status,
    400,
  );
});

test('school custody is unknown by default, Hold is revisioned, and verified release stays blocked', async () => {
  const route = `${path()}/students/${state.student._id}/custody`;
  assert.deepEqual((await http(route)).data.data, {
    state: 'unknown',
    revision: 0,
    sourceCurrent: false,
    automatedReleaseAllowed: false,
  });
  assert.equal(
    (
      await http(
        route,
        parentState.token,
        commands('claim', { state: 'verified', revision: 0 }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await http(
        route,
        admin.token,
        commands('verified', { state: 'verified', revision: 0 }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await http(
        route,
        admin.token,
        commands('hold', { state: 'hold', revision: 0 }),
      )
    ).status,
    200,
  );
  assert.equal((await http(route)).data.data.state, 'hold');
  assert.equal(
    (
      await http(
        route,
        admin.token,
        commands('stale', { state: 'unknown', revision: 0 }),
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await http(
        route,
        admin.token,
        commands('reset', { state: 'unknown', revision: 1 }),
      )
    ).status,
    200,
  );
  const row = await StudentCustodyState.findOne({
    studentId: state.student._id,
  })
    .select('+history')
    .orFail();
  assert.equal(row.authorityRevision, 2);
  assert.equal(row.history.length, 2);
  assert.equal(String(row.enrollmentId), String(state.enrollment._id));
  assert.throws(requireAutomatedReleaseAuthority, /unavailable/);
  assert.throws(
    () =>
      requireGateDuty(
        { assignment: { duties: ['exit_confirm'] } },
        'exit_confirm',
      ),
    /unavailable/,
  );
});

test('relationship alone never grants pickup authority, and enrollment transfer keeps old custody history', async () => {
  assert.ok(parentState.link.isActive);
  assert.throws(requireAutomatedReleaseAuthority);
  const route = `${path()}/students/${state.student._id}/custody`;
  assert.equal(
    (
      await http(
        route,
        admin.token,
        commands('hold', { state: 'hold', revision: 0 }),
      )
    ).status,
    200,
  );
  await StudentEnrollment.updateOne(
    { _id: state.enrollment._id },
    { $set: { status: 'transferred', effectiveTo: new Date() } },
  );
  assert.equal((await http(route)).status, 404);
  assert.equal(await StudentCustodyState.countDocuments(), 1);
});

test('foundation exposes no checkout or OTP endpoint and preserves attendance and Parent Leave records', async () => {
  await put(ParentLeaveApplication, {
    requesterId: parentState.parent._id,
    studentId: state.student._id,
    state: 'draft',
    revision: 0,
    reason: 'Existing private leave draft',
  });
  await put(AttendanceSession, {
    branchId: state.branch._id,
    state: 'submitted',
    rosterStudentIds: [state.student._id],
  });
  await put(PeriodAttendanceRecord, {
    branchId: state.branch._id,
    studentId: state.student._id,
    status: 'present',
  });
  const models = [
    ParentLeaveApplication,
    AttendanceSession,
    PeriodAttendanceRecord,
  ];
  const beforeRecords = await Promise.all(
    models.map(model =>
      mongoose.connection.collection(model.collection.name).find().toArray(),
    ),
  );
  const record = await assigned();
  for (const route of [
    '/gate/exits',
    '/gate/entries',
    '/gate/pickup-verifications',
    '/gate/challenges',
  ])
    assert.equal((await http(route, operator.token, {})).status, 404, route);
  const parentDenied = await http(
    '/parent/me/pickup-challenges',
    parentState.token,
    {},
  );
  assert.equal(parentDenied.status, 403);
  assert.equal(parentDenied.data.message, 'Parent operation is not permitted');
  assert.equal((await http(contextPath(record), operator.token)).status, 200);
  assert.deepEqual(
    await Promise.all(
      models.map(model =>
        mongoose.connection.collection(model.collection.name).find().toArray(),
      ),
    ),
    beforeRecords,
  );
});

test('required indexes exist with autoIndex disabled and duplicate native identities fail', async () => {
  for (const [model, name] of [
    [Gate, 'gate_branch_code_unique'],
    [GateStaffAssignment, 'gate_operator_active_unique'],
    [StudentCustodyState, 'custody_student_branch_unique'],
    [GateAdminOperation, 'gate_admin_operation_unique'],
  ] as const)
    assert.ok(
      (await model.collection.indexes()).some(
        index => index.name === name && index.unique,
      ),
    );
  await gate();
  const stored = await Gate.collection.findOne({});
  assert.ok(stored);
  await assert.rejects(
    Gate.collection.insertOne({ ...stored, _id: oid() }),
    (error: unknown) => (error as { code: number }).code === 11000,
  );
});

test('receipt failure rolls back the gate and audit and retry succeeds', async () => {
  const original = GateAdminOperation.create;
  mock.method(GateAdminOperation, 'create', async () => {
    throw new Error('Injected receipt failure');
  });
  const body = commands('rollback', {
    code: 'ROLLBACK',
    name: 'Rollback gate',
  });
  const result = await http(path() + '/gates', admin.token, body);
  assert.equal(result.status, 500);
  assert.ok(!JSON.stringify(result.data).includes('Injected'));
  assert.equal(await Gate.countDocuments(), 0);
  mock.restoreAll();
  assert.equal(GateAdminOperation.create, original);
  assert.equal((await http(path() + '/gates', admin.token, body)).status, 201);
});

function worker(
  input: Partial<GateWorkerInput> & Pick<GateWorkerInput, 'action'>,
) {
  const child = fork(resolve(__dirname, 'helpers/gate-foundation-worker.ts'), {
    execArgv: ['--import', 'tsx'],
    silent: true,
  });
  let output = '';
  child.stderr?.on('data', part => {
    output += String(part);
  });
  const events: {
    event: string;
    status?: number;
    result?: unknown;
    message?: string;
  }[] = [];
  const pending: (() => void)[] = [];
  child.on('message', message => {
    events.push(message as (typeof events)[number]);
    pending.splice(0).forEach(done => done());
  });
  async function until(event: string) {
    const deadline = Date.now() + 20000;
    while (!events.some(message => message.event === event)) {
      assert.equal(child.exitCode, null, output);
      assert.ok(Date.now() < deadline, `Worker timed out ${event} ${output}`);
      await new Promise<void>(done => {
        const timer = setTimeout(done, 100);
        pending.push(() => {
          clearTimeout(timer);
          done();
        });
      });
    }
    return events.find(message => message.event === event)!;
  }
  child.send({
    uri: `mongodb://${mongoose.connection.host}:${
      mongoose.connection.port
    }/?replicaSet=${mongoose.connection.getClient().options.replicaSet}`,
    dbName: mongoose.connection.name,
    identity: identity(admin, 'super_admin'),
    token: admin.token,
    branchId: String(state.branch._id),
    gateId: '',
    assignmentId: '',
    studentId: String(state.student._id),
    hold: false,
    payload: {},
    ...input,
  });
  return {
    until,
    release: () => child.send({ release: true }),
    stop: () => child.kill(),
  };
}

test(
  'independent duplicate assignments serialize to one active record',
  { timeout: 45000 },
  async () => {
    const target = await gate(),
      payload = assignmentBody('first');
    const first = worker({
      action: 'assign',
      gateId: target.id,
      payload,
      hold: true,
    });
    let second: ReturnType<typeof worker> | undefined;
    try {
      await first.until('locked');
      second = worker({
        action: 'assign',
        gateId: target.id,
        payload: { ...payload, clientOperationId: 'second' },
      });
      await second.until('attempting');
      first.release();
      assert.equal((await first.until('result')).status, 200);
      assert.equal((await second.until('result')).status, 409);
      assert.equal(
        await GateStaffAssignment.countDocuments({ status: 'active' }),
        1,
      );
    } finally {
      first.stop();
      second?.stop();
    }
  },
);

for (const kind of ['role', 'session', 'assignment'] as const) {
  test(
    `independent context attempt observes committed ${kind} revocation`,
    { timeout: 45000 },
    async () => {
      const record = await assigned();
      if (kind === 'assignment') {
        const revoke = worker({
          action: 'revoke',
          assignmentId: record.id,
          payload: commands('revoke', { revision: 1 }),
          hold: true,
        });
        let read: ReturnType<typeof worker> | undefined;
        try {
          await revoke.until('locked');
          read = worker({
            action: 'context',
            identity: identity(operator, 'gate_staff'),
            token: operator.token,
            gateId: record.gateId,
            assignmentId: record.id,
          });
          await read.until('attempting');
          revoke.release();
          assert.equal((await revoke.until('result')).status, 200);
          assert.equal((await read.until('result')).status, 404);
        } finally {
          revoke.stop();
          read?.stop();
        }
      } else {
        const read = worker({
          action: 'context',
          identity: identity(operator, 'gate_staff'),
          token: operator.token,
          gateId: record.gateId,
          assignmentId: record.id,
          hold: true,
        });
        try {
          await read.until('locked');
          if (kind === 'role')
            await User.updateOne(
              { _id: operator.id },
              { $set: { role: 'teacher' } },
            );
          else
            await Session.updateOne(
              { token: operator.token },
              { $set: { isRevoked: true } },
            );
          read.release();
          assert.equal((await read.until('result')).status, 401);
        } finally {
          read.stop();
        }
      }
    },
  );
}

test(
  'independent custody updates preserve one current state, immutable history and one winning revision',
  { timeout: 45000 },
  async () => {
    const first = worker({
      action: 'custody',
      hold: true,
      payload: commands('hold', { state: 'hold', revision: 0 }),
    });
    let second: ReturnType<typeof worker> | undefined;
    try {
      await first.until('locked');
      second = worker({
        action: 'custody',
        payload: commands('reset', { state: 'unknown', revision: 0 }),
      });
      await second.until('attempting');
      first.release();
      assert.equal((await first.until('result')).status, 200);
      assert.equal((await second.until('result')).status, 409);
      const row = await StudentCustodyState.findOne()
        .select('+history')
        .orFail();
      assert.equal(row.state, 'hold');
      assert.equal(row.revision, 1);
      assert.equal(row.history.length, 1);
    } finally {
      first.stop();
      second?.stop();
    }
  },
);
