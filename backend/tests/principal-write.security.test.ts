import assert from 'node:assert/strict';
import {after, before, beforeEach, mock, test} from 'node:test';
import type {Server} from 'node:http';
import mongoose from 'mongoose';
import {MongoMemoryServer} from 'mongodb-memory-server';
import app from '../src/app';
import User, {UserRole} from '../src/models/user';
import Branch from '../src/models/branch';
import Session from '../src/models/session';
import PrincipalTask from '../src/models/principalTask';
import SafetyAlert from '../src/models/safetyAlert';
import ApprovalRequest from '../src/models/approvalRequest';
import {generateAccessToken} from '../src/services/jwt.service';
import {registerSession} from '../src/services/session.service';
import {ROLE_PERMISSIONS} from '../src/constants/rolePermissions';
import {PERMISSIONS} from '../src/constants/permissions';
import {dateField, objectBody} from '../src/utils/request-validation';
import {createPrincipalTask, processPrincipalTaskAction} from '../src/services/principal-task.service';
import {processSafetyAlertAction} from '../src/services/safety-alert.service';

// This suite never imports dotenv/config or reads MONGODB_URI.
let database: MongoMemoryServer;
let server: Server;
let base: string;
const originalJwt = process.env.JWT_SECRET;
const originalAuthority = process.env.PRINCIPAL_APPROVAL_AUTHORITY;
type Actor = {id: mongoose.Types.ObjectId; token: string};
let principal: Actor, peer: Actor, teacher: Actor, student: Actor, foreign: Actor, admin: Actor;
let branch: mongoose.Types.ObjectId, otherBranch: mongoose.Types.ObjectId;
const future = () => new Date(Date.now() + 86400000).toISOString();

before(async () => {
  database = await MongoMemoryServer.create();
  await mongoose.connect(database.getUri(), {dbName: 'principal_write_contract_tests', autoIndex: false});
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}/api`;
});

const actor = async (name: string, role: UserRole, branchId?: mongoose.Types.ObjectId): Promise<Actor> => {
  const user = await new User({fullName: name, email: `${name}@test.invalid`, password: 'fixture-only', role, branchId}).save();
  const token = generateAccessToken(String(user._id), role);
  await registerSession(String(user._id), token, role);
  return {id: user._id, token};
};

beforeEach(async () => {
  mock.restoreAll();
  process.env.JWT_SECRET = 'isolated-principal-write-test-secret';
  for (const model of [PrincipalTask, SafetyAlert, ApprovalRequest, Session, User, Branch]) await model.collection.deleteMany({});
  branch = (await Branch.create({name: 'Branch A', code: 'AA', address: 'test', city: 'test'}))._id;
  otherBranch = (await Branch.create({name: 'Branch B', code: 'BB', address: 'test', city: 'test'}))._id;
  principal = await actor('principal', 'principal', branch);
  peer = await actor('peer', 'principal', branch);
  teacher = await actor('teacher', 'teacher', branch);
  student = await actor('student', 'student', branch);
  foreign = await actor('foreign', 'principal', otherBranch);
  admin = await actor('admin', 'super_admin');
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify({
    [String(principal.id)]: {branchId: String(branch), types: ['leave']},
    [String(peer.id)]: {branchId: String(branch), types: ['leave']},
  });
});

after(async () => {
  mock.restoreAll();
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await mongoose.disconnect();
  if (database) await database.stop();
  if (originalJwt === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwt;
  if (originalAuthority === undefined) delete process.env.PRINCIPAL_APPROVAL_AUTHORITY;
  else process.env.PRINCIPAL_APPROVAL_AUTHORITY = originalAuthority;
});

const http = async (path: string, method: string, body: unknown, person: Actor | undefined = principal) => {
  const response = await fetch(`${base}${path}`, {
    method, headers: {'Content-Type': 'application/json', ...(person ? {Authorization: `Bearer ${person.token}`} : {})},
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  assert.equal(raw.includes('private-database-internals'), false);
  return {status: response.status, data: JSON.parse(raw), raw};
};
const create = (body: unknown = {title: 'Valid task', assignedTo: String(teacher.id)}) => http('/principal/tasks', 'POST', body);
const task = (extra: Record<string, unknown> = {}) => new PrincipalTask({branchId: branch, title: 'Test task', createdBy: principal.id, assignedTo: principal.id, ...extra}).save();
const alert = (extra: Record<string, unknown> = {}) => new SafetyAlert({branchId: branch, type: 'incident', title: 'Test alert', ...extra}).save();
const taskAction = (id: unknown, body: unknown = {action: 'complete'}, person = principal) => http(`/principal/tasks/${String(id)}`, 'PATCH', body, person);
const safetyAction = (id: unknown, body: unknown = {action: 'resolve'}, person = principal) => http(`/principal/safety-alerts/${String(id)}`, 'PATCH', body, person);

test('task titles are required, typed, trimmed, and enforce schema lengths', async () => {
  for (const title of [undefined, '', '   ', 'x', 123, {}, 'x'.repeat(151)]) {
    assert.equal((await create({title, assignedTo: String(teacher.id)})).status, 400);
  }
  for (const description of [123, null, [], 'x'.repeat(2001)]) {
    assert.equal((await create({title: 'valid', assignedTo: String(teacher.id), description})).status, 400);
  }
  assert.equal(await PrincipalTask.countDocuments(), 0);
});

test('task priority and assigned user ID cannot be coerced', async () => {
  for (const priority of ['', 'URGENT', 'unknown', false, 1, null]) {
    assert.equal((await create({title: 'valid', assignedTo: String(teacher.id), priority})).status, 400);
  }
  for (const assignedTo of [undefined, '', 'invalid', 1, {}, [String(teacher.id)]]) {
    assert.equal((await create({title: 'valid', assignedTo})).status, 400);
  }
});

test('assignment conceals missing/foreign users and denies students/inactive users', async () => {
  for (const person of [foreign, {id: new mongoose.Types.ObjectId()}]) {
    assert.equal((await create({title: 'valid', assignedTo: String(person.id)})).status, 404);
  }
  assert.equal((await create({title: 'valid', assignedTo: String(student.id)})).status, 403);
  await User.updateOne({_id: teacher.id}, {$set: {isActive: false}});
  assert.equal((await create({title: 'valid', assignedTo: String(teacher.id)})).status, 403);
});

const invalidDates = ['', 'invalid', '2099-02-30', '2099-02-29T12:00:00Z', '2099-13-01T00:00:00Z',
  '2099-01-01T24:00:00Z', '2099-01-01T00:00:60Z', '2099-01-01T00:00:00',
  '2099-01-01T00:00:00+99:00', 0, false, null, {}, []];

test('task due dates reject invalid/impossible/ambiguous dates and typed values', async () => {
  for (const dueDate of invalidDates) {
    assert.equal((await create({title: 'valid', assignedTo: String(teacher.id), dueDate})).status, 400);
  }
  assert.equal(await PrincipalTask.countDocuments(), 0);
});

test('today date-only task due dates are accepted at UTC midnight', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const result = await create({title: 'Due today', assignedTo: String(teacher.id), dueDate: today});
  assert.equal(result.status, 201);
  assert.equal(result.data.data.dueDate, `${today}T00:00:00.000Z`);
  const stored = await PrincipalTask.findById(result.data.data._id);
  assert.equal(stored?.dueDate?.toISOString(), `${today}T00:00:00.000Z`);
});

test('past date-only and timestamp task due dates retain UTC parsing and persist', async () => {
  for (const dueDate of ['2000-01-01', '2000-01-01T05:00:00+05:00']) {
    const result = await create({title: 'Past due', assignedTo: String(teacher.id), dueDate});
    assert.equal(result.status, 201);
    assert.equal(result.data.data.dueDate, '2000-01-01T00:00:00.000Z');
    const stored = await PrincipalTask.findById(result.data.data._id);
    assert.equal(stored?.dueDate?.toISOString(), '2000-01-01T00:00:00.000Z');
  }
});

test('task creation rejects all internal/server fields and non-object bodies', async () => {
  for (const field of ['branchId', 'createdBy', 'actorId', 'status', 'history', 'createdAt', 'updatedAt', 'completedAt', '_id', '__v', 'isActive']) {
    assert.equal((await create({title: 'valid', assignedTo: String(teacher.id), [field]: 'forged'})).status, 400);
  }
  for (const body of [null, [], 'text', 123, true]) assert.equal((await create(body)).status, 400);
});

test('valid creation persists trimmed strings and model/server defaults and dates', async () => {
  mock.method(PrincipalTask.collection, 'insertOne', (...args: Parameters<typeof originalInsert>) => {
    // The model's save itself uses insertOne. Check the document received there
    // contains model defaults, proving this is no longer the raw service path.
    const document = args[0] as Record<string, unknown>;
    assert.equal(document.priority, 'normal');
    assert.equal(document.status, 'pending');
    assert.ok(Array.isArray(document.history));
    return originalInsert(...args);
  });
  const date = future();
  const result = await create({title: '  Valid task  ', description: '  Details  ', assignedTo: String(teacher.id), dueDate: date});
  assert.equal(result.status, 201);
  const stored = await PrincipalTask.findById(result.data.data._id);
  assert.ok(stored);
  assert.equal(stored.title, 'Valid task');
  assert.equal(stored.description, 'Details');
  assert.equal(String(stored.branchId), String(branch));
  assert.equal(String(stored.createdBy), String(principal.id));
  assert.equal(stored.dueDate?.toISOString(), date);
  assert.ok(stored.createdAt instanceof Date);
  assert.ok(stored.updatedAt instanceof Date);
  assert.equal(stored.__v, 0);
});

// Capture after module import; reset mocks before every fixture setup.
const originalInsert = PrincipalTask.collection.insertOne.bind(PrincipalTask.collection);

test('future date-only and explicit-offset dates normalize to UTC', async () => {
  const first = await create({title: 'valid', assignedTo: String(peer.id), dueDate: '2099-01-02'});
  assert.equal(first.status, 201);
  assert.equal(first.data.data.dueDate, '2099-01-02T00:00:00.000Z');
  const second = await create({title: 'valid', assignedTo: String(peer.id), dueDate: '2099-01-02T05:00:00+05:00'});
  assert.equal(second.data.data.dueDate, '2099-01-02T00:00:00.000Z');
});

test('direct service calls also validate types and eligibility before writes', async () => {
  const baseInput = {branchId: String(branch), actorId: String(principal.id), title: 'valid', assignedTo: String(teacher.id)};
  await assert.rejects(createPrincipalTask({...baseInput, priority: 'invalid'}), {status: 400});
  await assert.rejects(createPrincipalTask({...baseInput, dueDate: new Date(NaN)}), {status: 400});
  await assert.rejects(createPrincipalTask({...baseInput, actorId: String(student.id)}), {status: 403});
  const item = await task();
  await assert.rejects(processPrincipalTaskAction({taskId: String(item._id), branchId: String(branch), actorId: String(teacher.id), action: 'complete'}), {status: 403});
});

test('task actions reject unsupported fields, invalid IDs/actions, and non-object bodies', async () => {
  const item = await task();
  for (const body of [[], {}, {action: 1}, {action: 'unknown'}, {action: 'complete', status: 'pending'},
    {action: 'complete', branchId: String(otherBranch)}, {action: 'complete', createdBy: String(peer.id)},
    {action: 'complete', history: []}, {action: 'complete', dueDate: future()}]) {
    assert.equal((await taskAction(item._id, body)).status, 400);
  }
  assert.equal((await taskAction('invalid')).status, 400);
});

test('task transitions preserve previous semantics but stale/final actions conflict', async () => {
  const item = await task();
  assert.equal((await taskAction(item._id, {action: 'start'})).status, 200);
  assert.equal((await taskAction(item._id, {action: 'start'})).status, 409);
  assert.equal((await taskAction(item._id)).status, 200);
  for (const action of ['start', 'complete', 'cancel']) assert.equal((await taskAction(item._id, {action})).status, 409);
  const stored = await PrincipalTask.findById(item._id);
  assert.equal(stored?.history.length, 2);
  assert.equal(String(stored?.history[1].performedBy), String(principal.id));
  assert.ok(stored?.completedAt instanceof Date);
  const cancelled = await task();
  assert.equal((await taskAction(cancelled._id, {action: 'cancel'})).status, 200);
  assert.equal((await taskAction(cancelled._id, {action: 'cancel'})).status, 409);
});

test('task action conceals cross-branch objects and enforces creator/assignee ownership', async () => {
  const outside = await task({branchId: otherBranch, createdBy: foreign.id, assignedTo: foreign.id});
  assert.equal((await taskAction(outside._id)).status, 404);
  const item = await task();
  assert.equal((await taskAction(item._id, {action: 'complete'}, peer)).status, 403);
});

test('completion replaces a stale completion timestamp with server time', async () => {
  const item = await task({completedAt: new Date('2000-01-01T00:00:00Z')});
  const beforeCompletion = Date.now();
  const result = await taskAction(item._id, {action: 'complete'});
  const afterCompletion = Date.now();
  assert.equal(result.status, 200);
  assert.equal(result.data.data.status, 'completed');
  const stored = await PrincipalTask.findById(item._id);
  assert.ok(stored?.completedAt instanceof Date);
  assert.ok(stored.completedAt.getTime() >= beforeCompletion && stored.completedAt.getTime() <= afterCompletion);
  assert.equal(result.data.data.completedAt, stored.completedAt.toISOString());
});

test('cancellation explicitly clears stale completion timestamps from both active states', async () => {
  for (const status of ['pending', 'in_progress']) {
    const item = await task({status, completedAt: new Date('2000-01-01T00:00:00Z')});
    const result = await taskAction(item._id, {action: 'cancel'});
    assert.equal(result.status, 200);
    assert.equal(result.data.data.status, 'cancelled');
    assert.equal(result.data.data.completedAt, null);
    const stored = await PrincipalTask.collection.findOne({_id: item._id});
    assert.equal(stored?.completedAt, null);
    const detail = await http(`/principal/tasks/${item._id}`, 'GET', undefined);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.data.completedAt, null);
    assert.equal((await taskAction(item._id, {action: 'cancel'})).status, 409);
  }
});

test('task list preserves its envelope, newest-first ordering and assigned branch scope', async () => {
  const older = await task({title: 'Older task', createdAt: new Date('2000-01-01T00:00:00Z')});
  const newer = await task({title: 'Newer task', createdAt: new Date('2000-01-02T00:00:00Z')});
  await task({title: 'Foreign private task', branchId: otherBranch, createdBy: foreign.id, assignedTo: foreign.id});
  const result = await http('/principal/tasks', 'GET', undefined);
  assert.equal(result.status, 200);
  assert.equal(result.data.success, true);
  assert.equal(result.data.message, 'Principal tasks fetched successfully');
  assert.deepEqual(result.data.data.map((entry: {_id: string}) => entry._id), [String(newer._id), String(older._id)]);
  assert.ok(result.data.data.every((entry: {branchId: string}) => entry.branchId === String(branch)));
  assert.equal(result.raw.includes('Foreign private task'), false);
});

test('task detail returns the scoped task and conceals foreign tasks like missing tasks', async () => {
  const item = await task({title: 'Scoped task', description: 'Scoped details'});
  const outside = await task({title: 'Foreign private task', branchId: otherBranch, createdBy: foreign.id, assignedTo: foreign.id});
  const result = await http(`/principal/tasks/${item._id}`, 'GET', undefined);
  assert.equal(result.status, 200);
  assert.equal(result.data.success, true);
  assert.equal(result.data.message, 'Principal task fetched successfully');
  assert.equal(result.data.data._id, String(item._id));
  assert.equal(result.data.data.branchId, String(branch));
  assert.equal(result.data.data.title, 'Scoped task');
  assert.equal(result.data.data.description, 'Scoped details');
  const foreignResult = await http(`/principal/tasks/${outside._id}`, 'GET', undefined);
  const missingResult = await http(`/principal/tasks/${new mongoose.Types.ObjectId()}`, 'GET', undefined);
  assert.equal(foreignResult.status, 404);
  assert.equal(missingResult.status, 404);
  assert.deepEqual(foreignResult.data, missingResult.data);
  assert.equal(foreignResult.raw.includes('Foreign private task'), false);
});

test('legacy task list and detail safely hydrate missing defaults without rewriting records', async () => {
  const legacy = {
    _id: new mongoose.Types.ObjectId(), branchId: branch, createdBy: principal.id, assignedTo: teacher.id,
    title: 'Legacy readable task', createdAt: new Date(), updatedAt: new Date(),
  };
  await PrincipalTask.collection.insertOne(legacy);
  const list = await http('/principal/tasks', 'GET', undefined);
  const detail = await http(`/principal/tasks/${legacy._id}`, 'GET', undefined);
  assert.equal(list.status, 200);
  assert.equal(detail.status, 200);
  assert.equal(list.data.data.length, 1);
  assert.deepEqual(list.data.data[0], detail.data.data);
  assert.equal(detail.data.data._id, String(legacy._id));
  assert.equal(detail.data.data.branchId, String(branch));
  assert.equal(detail.data.data.priority, 'normal');
  assert.equal(detail.data.data.status, 'pending');
  assert.deepEqual(detail.data.data.history, []);
  for (const field of ['description', 'dueDate', 'completedAt', '__v']) {
    assert.equal(Object.hasOwn(detail.data.data, field), false);
  }
  assert.deepEqual(await PrincipalTask.collection.findOne({_id: legacy._id}), legacy);
});

test('task create and action database failures are sanitized', async () => {
  const item = await task();
  mock.method(PrincipalTask.prototype, 'save', async () => {throw new Error('private-database-internals');});
  assert.equal((await create()).status, 500);
  mock.restoreAll();
  mock.method(PrincipalTask, 'findOneAndUpdate', () => {throw new Error('private-database-internals');});
  assert.equal((await taskAction(item._id)).status, 500);
});

test('safety bodies reject invalid actions, unknown fields, and unsupported reason/evidence', async () => {
  const item = await alert();
  for (const body of [[], {}, {action: 'unknown'}, {action: false}, {action: 'resolve', assignedTo: String(peer.id)},
    {action: 'resolve', reason: 'x'.repeat(501)}, {action: 'resolve', evidence: {}},
    {action: 'escalate', reason: 1}, {action: 'escalate', evidence: 'x'.repeat(2000)},
    {action: 'resolve', branchId: String(otherBranch)}, {action: 'resolve', type: 'incident'},
    {action: 'resolve', performedBy: String(peer.id)}, {action: 'resolve', history: []}]) {
    assert.equal((await safetyAction(item._id, body)).status, 400);
  }
  assert.equal((await safetyAction('invalid')).status, 400);
});

test('safety assignment validates IDs, branch, active state, and eligible role', async () => {
  const item = await alert();
  for (const assignedTo of [undefined, 'invalid', 123, {}]) {
    assert.equal((await safetyAction(item._id, {action: 'assign', assignedTo})).status, 400);
  }
  assert.equal((await safetyAction(item._id, {action: 'assign', assignedTo: String(foreign.id)})).status, 404);
  assert.equal((await safetyAction(item._id, {action: 'assign', assignedTo: String(student.id)})).status, 403);
  await User.updateOne({_id: teacher.id}, {$set: {isActive: false}});
  assert.equal((await safetyAction(item._id, {action: 'assign', assignedTo: String(teacher.id)})).status, 403);
});

test('safety actions persist validated state, timestamps and authenticated audit metadata', async () => {
  const item = await alert();
  assert.equal((await safetyAction(item._id, {action: 'assign', assignedTo: String(teacher.id)})).status, 200);
  assert.equal((await safetyAction(item._id, {action: 'assign', assignedTo: String(teacher.id)})).status, 409);
  assert.equal((await safetyAction(item._id, {action: 'escalate'})).status, 200);
  assert.equal((await safetyAction(item._id, {action: 'escalate'})).status, 409);
  assert.equal((await safetyAction(item._id)).status, 200);
  assert.equal((await safetyAction(item._id)).status, 409);
  const stored = await SafetyAlert.findById(item._id);
  assert.equal(stored?.status, 'resolved');
  assert.equal(stored?.severity, 'critical');
  assert.equal(stored?.history.length, 3);
  assert.equal(String(stored?.history[0].assignedTo), String(teacher.id));
  assert.ok(stored?.history.every(entry => String(entry.performedBy) === String(principal.id) && entry.createdAt instanceof Date));
  assert.ok(stored?.resolvedAt instanceof Date);
});

test('cross-branch safety mutations are concealed and direct calls require Principal actor', async () => {
  const outside = await alert({branchId: otherBranch});
  assert.equal((await safetyAction(outside._id)).status, 404);
  const item = await alert();
  await assert.rejects(processSafetyAlertAction({alertId: String(item._id), actorId: String(teacher.id), branchId: String(branch), action: 'resolve'}), {status: 403});
});

test('safety database failures are sanitized', async () => {
  const item = await alert();
  mock.method(SafetyAlert, 'findOneAndUpdate', () => {throw new Error('private-database-internals');});
  assert.equal((await safetyAction(item._id)).status, 500);
});

test('all Principal writes require authentication and existing role/permission', async () => {
  const item = await task(), incident = await alert();
  for (const person of [teacher, student, admin]) {
    assert.equal((await http('/principal/tasks', 'POST', {title: 'valid', assignedTo: String(peer.id)}, person)).status, 403);
    assert.equal((await taskAction(item._id, {action: 'complete'}, person)).status, 403);
    assert.equal((await safetyAction(incident._id, {action: 'resolve'}, person)).status, 403);
  }
  for (const [path, method, body] of [
    ['/principal/tasks', 'POST', {title: 'valid', assignedTo: String(peer.id)}],
    [`/principal/tasks/${item._id}`, 'PATCH', {action: 'complete'}],
    [`/principal/safety-alerts/${incident._id}`, 'PATCH', {action: 'resolve'}],
  ] as const) {
    // An omitted argument would select the helper's default Principal.
    const response = await fetch(`${base}${path}`, {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    assert.equal(response.status, 401);
  }
  const permissions = ROLE_PERMISSIONS.principal;
  try {
    ROLE_PERMISSIONS.principal = permissions.filter(permission => permission !== PERMISSIONS.PRINCIPAL_TASKS_MANAGE);
    assert.equal((await create()).status, 403);
    assert.equal((await taskAction(item._id)).status, 403);
    assert.equal((await safetyAction(incident._id)).status, 403);
  } finally {ROLE_PERMISSIONS.principal = permissions;}
});

test('concurrent task finalization and safety resolution each allow one atomic transition', async () => {
  const item = await task(), incident = await alert();
  const tasks = await Promise.all([taskAction(item._id), taskAction(item._id)]);
  const alerts = await Promise.all([safetyAction(incident._id), safetyAction(incident._id)]);
  assert.deepEqual(tasks.map(result => result.status).sort(), [200, 409]);
  assert.deepEqual(alerts.map(result => result.status).sort(), [200, 409]);
  assert.equal((await PrincipalTask.findById(item._id))?.history.length, 1);
  assert.equal((await SafetyAlert.findById(incident._id))?.history.length, 1);
});

test('approval dates reject normalization, local timestamps, wrong types and unknown fields', async () => {
  const item = await new ApprovalRequest({branchId: branch, requesterId: teacher.id, entityType: 'user', entityId: teacher.id, approvalType: 'leave', reason: 'test'}).save();
  for (const delegationExpiresAt of [...invalidDates, '2099-01-02', '2000-01-01T00:00:00Z']) {
    assert.equal((await http(`/approval-requests/${item._id}`, 'PATCH', {action: 'delegated', delegatedTo: String(peer.id), delegationExpiresAt})).status, 400);
  }
  assert.equal((await http(`/approval-requests/${item._id}`, 'PATCH', {action: 'approved', amount: 0})).status, 400);
  assert.equal((await http(`/approval-requests/${item._id}`, 'PATCH', {action: 'approved'})).status, 200);
});

test('malformed/primitive/oversized Principal JSON never echoes input or parser stacks', async () => {
  for (const path of ['/principal/tasks', '/principal/tasks/invalid', '/principal/safety-alerts/invalid', '/approval-requests/invalid']) {
    const response = await fetch(`${base}${path}`, {
      method: path === '/principal/tasks' ? 'POST' : 'PATCH',
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${principal.token}`},
      body: '{"private-payload-marker":',
    });
    assert.equal(response.status, 400);
    const raw = await response.text();
    assert.equal(raw.includes('private-payload-marker'), false);
    assert.deepEqual(JSON.parse(raw), {success: false, message: 'Invalid Principal request body'});
  }
  const large = await create({title: 'x'.repeat(110000)});
  assert.equal(large.status, 400);
});

test('shared validation rejects non-plain objects and impossible calendar dates', () => {
  assert.throws(() => objectBody(new Date(), []), {status: 400});
  assert.throws(() => objectBody(Object.create({action: 'complete'}), ['action']), {status: 400});
  assert.throws(() => dateField('2100-02-29T00:00:00Z', 'date'), {status: 400});
  assert.equal(dateField('2096-02-29T00:00:00Z', 'date').toISOString(), '2096-02-29T00:00:00.000Z');
});

test('legacy raw tasks get missing priority defaults and a first guarded versioned update', async () => {
  const id = new mongoose.Types.ObjectId();
  await PrincipalTask.collection.insertOne({
    _id: id, branchId: branch, createdBy: principal.id, assignedTo: principal.id,
    title: 'Legacy task', status: 'pending', createdAt: new Date(), updatedAt: new Date(),
  });
  assert.equal((await taskAction(id)).status, 200);
  const stored = await PrincipalTask.findById(id);
  assert.equal(stored?.history.length, 1);
  assert.equal(stored?.__v, 1);
  assert.equal(stored?.priority, 'normal');
});

test('intervening task reassignment and safety state changes produce stale-write conflicts', async () => {
  const item = await task(), incident = await alert();
  const originalTask = PrincipalTask.findOneAndUpdate.bind(PrincipalTask);
  mock.method(PrincipalTask, 'findOneAndUpdate', (...args: Parameters<typeof originalTask>) => (async () => {
    await PrincipalTask.collection.updateOne({_id: item._id}, {$set: {assignedTo: peer.id}});
    return originalTask(...args);
  })());
  assert.equal((await taskAction(item._id)).status, 409);
  assert.equal((await PrincipalTask.findById(item._id))?.history.length, 0);
  const originalAlert = SafetyAlert.findOneAndUpdate.bind(SafetyAlert);
  mock.method(SafetyAlert, 'findOneAndUpdate', (...args: Parameters<typeof originalAlert>) => (async () => {
    await SafetyAlert.collection.updateOne({_id: incident._id}, {$set: {severity: 'high'}});
    return originalAlert(...args);
  })());
  assert.equal((await safetyAction(incident._id)).status, 409);
  assert.equal((await SafetyAlert.findById(incident._id))?.history.length, 0);
});

test('task creation retries still create duplicates without an idempotency identity', async () => {
  assert.equal((await create()).status, 201);
  assert.equal((await create()).status, 201);
  assert.equal(await PrincipalTask.countDocuments(), 2);
});
