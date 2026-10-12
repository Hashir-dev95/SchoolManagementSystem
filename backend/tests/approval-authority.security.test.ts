import assert from 'node:assert/strict';
import {after, before, beforeEach, mock, test} from 'node:test';
import type {Server} from 'node:http';
import mongoose from 'mongoose';
import {MongoMemoryServer} from 'mongodb-memory-server';
import app from '../src/app';
import User, {UserRole} from '../src/models/user';
import Branch from '../src/models/branch';
import Student from '../src/models/student';
import Fee from '../src/models/fee';
import Session from '../src/models/session';
import ApprovalRequest from '../src/models/approvalRequest';
import PrivilegedRequest from '../src/models/privilegedRequest';
import {generateAccessToken} from '../src/services/jwt.service';
import {registerSession} from '../src/services/session.service';
import {ROLE_PERMISSIONS} from '../src/constants/rolePermissions';
import {PERMISSIONS} from '../src/constants/permissions';

/* eslint-disable no-script-url -- Deliberate malicious URL fixtures verify response filtering. */

// No dotenv or configured database URI: only this suite's ephemeral DB is used.
const originalPolicy = process.env.PRINCIPAL_APPROVAL_AUTHORITY;
const originalJwt = process.env.JWT_SECRET;
let db: MongoMemoryServer;
let server: Server;
let base: string;
let branchA: mongoose.Types.ObjectId;
let branchB: mongoose.Types.ObjectId;
type Actor = {id: mongoose.Types.ObjectId; token: string};
let principal: Actor;
let peer: Actor;
let foreign: Actor;
let teacher: Actor;
let admin: Actor;
let studentA: mongoose.Types.ObjectId;
let studentB: mongoose.Types.ObjectId;
let fee: mongoose.Types.ObjectId;

before(async () => {
  db = await MongoMemoryServer.create();
  await mongoose.connect(db.getUri(), {dbName: 'approval_authority_tests', autoIndex: false});
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}/api`;
});

const actor = async (name: string, role: UserRole, branchId?: mongoose.Types.ObjectId): Promise<Actor> => {
  const user = await new User({fullName: name, email: `${name}@test.invalid`, password: 'fixture-hash', role, branchId}).save();
  const token = generateAccessToken(user._id.toString(), role);
  await registerSession(user._id.toString(), token, role);
  return {id: user._id, token};
};
const configure = () => {
  // 100 is solely a test fixture, never a production/business default.
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify(Object.fromEntries(
    [[principal, branchA], [peer, branchA], [foreign, branchB]].map(([person, branch]) => {
      const reviewer = person as Actor;
      return [reviewer.id.toString(), {branchId: String(branch), types: ['leave', 'refund', 'discount', 'payroll', 'certificate'], limits: {refund: 100, discount: 100, payroll: 100}}];
    }),
  ));
};

beforeEach(async () => {
  mock.restoreAll();
  process.env.JWT_SECRET = 'isolated-test-jwt-secret';
  for (const model of [ApprovalRequest, PrivilegedRequest, Session, Fee, Student, User, Branch]) await model.collection.deleteMany({});
  branchA = (await Branch.create({name: 'Branch A', code: 'AA', address: 'A', city: 'A'}))._id;
  branchB = (await Branch.create({name: 'Branch B', code: 'BB', address: 'B', city: 'B'}))._id;
  principal = await actor('principal', 'principal', branchA);
  peer = await actor('peer', 'principal', branchA);
  foreign = await actor('foreign-sensitive-name', 'principal', branchB);
  teacher = await actor('teacher', 'teacher', branchA);
  admin = await actor('admin', 'super_admin');
  const studentUserA = await actor('studentA', 'student', branchA);
  const studentUserB = await actor('studentB', 'student', branchB);
  studentA = (await new Student({userId: studentUserA.id, branchId: branchA, classId: new mongoose.Types.ObjectId(), sectionId: new mongoose.Types.ObjectId(), admissionNumber: 'A'}).save())._id;
  studentB = (await new Student({userId: studentUserB.id, branchId: branchB, classId: new mongoose.Types.ObjectId(), sectionId: new mongoose.Types.ObjectId(), admissionNumber: 'B'}).save())._id;
  fee = (await new Fee({branchId: branchA, studentId: studentA, academicYear: 'test', invoiceNumber: 'A', amount: 200, dueDate: new Date()}).save())._id;
  configure();
});

after(async () => {
  mock.restoreAll();
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await mongoose.disconnect();
  if (db) await db.stop();
  if (originalPolicy === undefined) delete process.env.PRINCIPAL_APPROVAL_AUTHORITY;
  else process.env.PRINCIPAL_APPROVAL_AUTHORITY = originalPolicy;
  if (originalJwt === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwt;
});

const request = (extra: Record<string, unknown> = {}) => new ApprovalRequest({
  branchId: branchA, requesterId: teacher.id, entityType: 'student', entityId: studentA,
  approvalType: 'leave', reason: 'Scoped test request', ...extra,
}).save();
const http = async (path: string, person?: Actor, body?: unknown) => {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'PATCH',
    headers: {'Content-Type': 'application/json', ...(person ? {Authorization: `Bearer ${person.token}`} : {})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  const raw = await response.text();
  return {status: response.status, raw, data: raw.startsWith('{') ? JSON.parse(raw) : undefined};
};
const detail = (id: unknown, person = principal) => http(`/approval-requests/${String(id)}`, person);
const decide = (id: unknown, person = principal, body: unknown = {action: 'approved'}) => http(`/approval-requests/${String(id)}`, person, body);
const delegate = (id: unknown, person = peer) => decide(id, principal, {
  action: 'delegated', delegatedTo: person.id.toString(), delegationExpiresAt: new Date(Date.now() + 60000).toISOString(),
});

const candidates = (id: unknown, person?: Actor) => http(`/approval-requests/${String(id)}/eligible-delegates`, person);

test('eligible candidates require authentication, role and manage permission', async () => {
  const item = await request();
  assert.equal((await candidates(item._id)).status, 401);
  const student = await actor('wrongRoleStudent', 'student', branchA);
  for (const person of [teacher, admin, student]) assert.equal((await candidates(item._id, person)).status, 403);
  const permissions = ROLE_PERMISSIONS.principal;
  const index = permissions.indexOf(PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE);
  permissions.splice(index, 1);
  try {
    assert.equal((await candidates(item._id, principal)).status, 403);
    assert.deepEqual((await detail(item._id)).data.data.capabilities, {canReview: false, canDelegate: false});
  } finally {
    permissions.splice(index, 0, PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE);
  }
});

test('eligible candidates contain only same-branch active authorized Principals with minimal fields', async () => {
  const inactive = await actor('inactive', 'principal', branchA);
  const unconfigured = await actor('unconfigured', 'principal', branchA);
  const wrongCategory = await actor('wrongCategory', 'principal', branchA);
  await User.updateOne({_id: inactive.id}, {$set: {isActive: false}});
  const policy = JSON.parse(process.env.PRINCIPAL_APPROVAL_AUTHORITY!);
  policy[String(inactive.id)] = policy[String(peer.id)];
  policy[String(wrongCategory.id)] = {branchId: String(branchA), types: ['certificate']};
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify(policy);
  const item = await request();
  const result = await candidates(item._id, principal);
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.data, [{_id: String(peer.id), fullName: 'peer'}]);
  assert.deepEqual(Object.keys(result.data.data[0]).sort(), ['_id', 'fullName']);
  for (const excluded of [inactive, unconfigured, wrongCategory, foreign, teacher, admin, principal]) {
    assert.ok(!result.raw.includes(String(excluded.id)));
    assert.equal((await delegate(item._id, excluded)).status, 403);
  }
});

test('eligible candidates exclude a Principal requester and direct forcing still fails', async () => {
  const item = await request({requesterId: peer.id});
  assert.deepEqual((await candidates(item._id, principal)).data.data, []);
  assert.equal((await delegate(item._id)).status, 403);
  assert.equal((await candidates(item._id, peer)).status, 403);
});

test('eligible candidates enforce financial ceilings and category grants', async () => {
  const item = await request({approvalType: 'refund', entityType: 'fee', entityId: fee, amount: 100});
  const policy = JSON.parse(process.env.PRINCIPAL_APPROVAL_AUTHORITY!);
  policy[String(peer.id)].limits.refund = 99;
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify(policy);
  assert.deepEqual((await candidates(item._id, principal)).data.data, []);
  assert.equal((await delegate(item._id)).status, 403);
  policy[String(peer.id)].limits.refund = 100;
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify(policy);
  assert.deepEqual((await candidates(item._id, principal)).data.data.map((user: {_id: string}) => user._id), [String(peer.id)]);
});

test('eligible candidates conceal foreign requests and reject missing authority and unsupported entities', async () => {
  const foreignItem = await request({branchId: branchB, requesterId: foreign.id, entityId: studentB});
  assert.equal((await candidates(foreignItem._id, principal)).status, 404);
  const unsupported = await request({entityType: 'arbitrary'});
  assert.equal((await candidates(unsupported._id, principal)).status, 403);
  const unsupportedCategory = await request({approvalType: 'paper'});
  assert.equal((await candidates(unsupportedCategory._id, principal)).status, 403);
  const item = await request();
  delete process.env.PRINCIPAL_APPROVAL_AUTHORITY;
  assert.equal((await candidates(item._id, principal)).status, 403);
});

test('eligible candidate successfully delegates and capabilities prohibit repeated delegation', async () => {
  const item = await request();
  assert.deepEqual((await detail(item._id)).data.data.capabilities, {canReview: true, canDelegate: true});
  const list = await candidates(item._id, principal);
  const result = await decide(item._id, principal, {action: 'delegated', delegatedTo: list.data.data[0]._id, delegationExpiresAt: new Date(Date.now() + 60000).toISOString()});
  assert.equal(result.status, 200);
  assert.equal(result.data.data.request.delegatedTo._id, String(peer.id));
  assert.equal(result.data.data.request.history[0].action, 'delegated');
  assert.equal((await candidates(item._id, principal)).status, 409);
  assert.equal((await candidates(item._id, peer)).status, 403);
  assert.deepEqual((await detail(item._id, peer)).data.data.capabilities, {canReview: true, canDelegate: false});
  await ApprovalRequest.updateOne({_id: item._id}, {$set: {delegationExpiresAt: new Date(Date.now() - 1000)}});
  assert.deepEqual((await detail(item._id, peer)).data.data.capabilities, {canReview: false, canDelegate: false});
});

test('eligible candidates reject finalized requests and revalidate a candidate that becomes inactive', async () => {
  const item = await request();
  assert.equal((await candidates(item._id, principal)).status, 200);
  await User.updateOne({_id: peer.id}, {$set: {isActive: false}});
  assert.equal((await delegate(item._id)).status, 403);
  assert.deepEqual((await candidates(item._id, principal)).data.data, []);
  await decide(item._id);
  assert.equal((await candidates(item._id, principal)).status, 409);
  assert.deepEqual((await detail(item._id)).data.data.capabilities, {canReview: false, canDelegate: false});
});

test('list, detail and mutation require authentication and Principal role', async () => {
  const item = await request();
  for (const person of [undefined, teacher, admin]) {
    const expected = person ? 403 : 401;
    assert.equal((await http('/approval-requests/pending', person)).status, expected);
    assert.equal((await http(`/approval-requests/${item._id}`, person)).status, expected);
    assert.equal((await http(`/approval-requests/${item._id}`, person, {action: 'approved'})).status, expected);
  }
});

test('own-branch permitted list/detail and direct decision work', async () => {
  const item = await request();
  const list = await http(`/approval-requests/pending?branchId=${branchB}`, principal);
  assert.equal(list.status, 200);
  assert.equal(list.data.data.total, 1);
  assert.equal((await detail(item._id)).status, 200);
  const result = await decide(item._id);
  assert.equal(result.status, 200);
  assert.equal(result.data.data.request.history[0].authority, 'direct');
});

test('cross-branch detail/mutation are concealed with 404 and query cannot widen scope', async () => {
  const item = await request({branchId: branchB, requesterId: foreign.id, entityId: studentB});
  assert.equal((await detail(item._id)).status, 404);
  assert.equal((await decide(item._id)).status, 404);
  assert.equal((await http(`/approval-requests/pending?branchId=${branchB}`, principal)).data.data.total, 0);
  assert.equal((await ApprovalRequest.findById(item._id))?.status, 'pending');
});

test('absent/malformed grants, wrong grant branch and unsupported categories fail closed', async () => {
  const item = await request();
  for (const policy of [undefined, '{bad', '{}', JSON.stringify({[principal.id.toString()]: {branchId: branchB.toString(), types: ['leave']}})]) {
    if (policy === undefined) delete process.env.PRINCIPAL_APPROVAL_AUTHORITY;
    else process.env.PRINCIPAL_APPROVAL_AUTHORITY = policy;
    assert.equal((await decide(item._id)).status, 403);
    assert.equal((await detail(item._id)).status, 403);
    assert.equal((await http('/approval-requests/pending', principal)).data.data.total, 0);
  }
  configure();
  const paper = await request({approvalType: 'paper'});
  assert.equal((await decide(paper._id)).status, 403);
});

test('financial ceiling is enforced and within-limit financial approval succeeds', async () => {
  const over = await request({approvalType: 'refund', entityType: 'fee', entityId: fee, amount: 101});
  assert.equal((await decide(over._id)).status, 403);
  const allowed = await request({approvalType: 'refund', entityType: 'fee', entityId: fee, amount: 100});
  assert.equal((await decide(allowed._id)).status, 200);
  assert.equal((await ApprovalRequest.findById(over._id))?.status, 'pending');
});

test('missing, invalid or unconfigured financial limits fail closed', async () => {
  const item = await request({approvalType: 'refund', entityType: 'fee', entityId: fee, amount: 1});
  for (const limits of [undefined, {}, {refund: -1}, {refund: '100'}, {refund: null}]) {
    process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify({[principal.id.toString()]: {branchId: branchA.toString(), types: ['refund'], limits}});
    assert.equal((await decide(item._id)).status, 403);
  }
});

test('invalid stored amounts and monetary amounts disguised as leave are rejected', async () => {
  const item = await request({approvalType: 'refund', entityType: 'fee', entityId: fee});
  assert.equal((await decide(item._id)).status, 400);
  for (const amount of [-1, Infinity, NaN]) {
    await ApprovalRequest.collection.updateOne({_id: item._id}, {$set: {amount}});
    assert.equal((await decide(item._id)).status, 400);
  }
  const disguised = await request({amount: 1});
  assert.equal((await decide(disguised._id)).status, 400);
  await assert.rejects(request({amount: Infinity}));
});

test('unknown body fields and invalid action/reason/IDs cannot bypass stored authority', async () => {
  const item = await request();
  for (const body of [[], {}, {action: 'unknown'}, {action: 'rejected'}, {action: 'approved', reason: 123},
    {action: 'approved', amount: 0}, {action: 'approved', branchId: String(branchB)},
    {action: 'approved', afterData: {amount: 0}}, {action: 'approved', permissions: ['*']},
    {action: 'approved', delegatedTo: String(peer.id)}]) {
    assert.equal((await decide(item._id, principal, body)).status, 400);
  }
  assert.equal((await detail('invalid-id')).status, 400);
  assert.equal((await decide('invalid-id')).status, 400);
  assert.equal((await ApprovalRequest.findById(item._id))?.history.length, 0);
});

test('requester cannot approve or delegate their own request', async () => {
  const item = await request({requesterId: principal.id});
  assert.equal((await decide(item._id)).status, 403);
  assert.equal((await delegate(item._id)).status, 403);
});

test('delegation rejects cross-branch, ineligible, self, requester and unconfigured delegates', async () => {
  const item = await request();
  for (const person of [foreign, teacher, principal]) assert.equal((await delegate(item._id, person)).status, 403);
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify({[principal.id.toString()]: {branchId: String(branchA), types: ['leave']}});
  assert.equal((await delegate(item._id)).status, 403);
  configure();
  const requester = await request({requesterId: peer.id});
  assert.equal((await delegate(requester._id)).status, 403);
  // ObjectId hex casing must not defeat self/requester comparisons.
  for (const id of [principal.id, peer.id]) {
    assert.equal((await decide(requester._id, principal, {action: 'delegated', delegatedTo: id.toString().toUpperCase(), delegationExpiresAt: new Date(Date.now() + 60000).toISOString()})).status, 403);
  }
});

test('valid delegated decision records distinct authority and delegator', async () => {
  const item = await request();
  assert.equal((await delegate(item._id)).status, 200);
  const result = await decide(item._id, peer);
  assert.equal(result.status, 200);
  const history = result.data.data.request.history;
  assert.equal(history[0].authority, 'direct');
  assert.equal(history[1].authority, 'delegated');
  assert.equal(history[1].delegatedBy._id, principal.id.toString());
});

test('expired and legacy delegation cannot process, and delegates cannot redelegate', async () => {
  const item = await request();
  assert.equal((await delegate(item._id)).status, 200);
  assert.equal((await decide(item._id, peer, {action: 'delegated', delegatedTo: String(principal.id), delegationExpiresAt: new Date(Date.now() + 60000).toISOString()})).status, 403);
  await ApprovalRequest.updateOne({_id: item._id}, {$set: {delegationExpiresAt: new Date(Date.now() - 1000)}});
  assert.equal((await decide(item._id, peer)).status, 403);
  await ApprovalRequest.updateOne({_id: item._id}, {$set: {delegationExpiresAt: new Date(Date.now() + 60000)}, $unset: {delegatedBy: ''}});
  assert.equal((await decide(item._id, peer)).status, 403);
});

test('delegate must retain authority and delegator must remain eligible with authority', async () => {
  const item = await request();
  await delegate(item._id);
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify({[peer.id.toString()]: {branchId: String(branchA), types: ['leave']}});
  assert.equal((await decide(item._id, peer)).status, 403);
  configure();
  await User.updateOne({_id: principal.id}, {$set: {isActive: false}});
  assert.equal((await decide(item._id, peer)).status, 403);
});

test('forged delegation cannot grant cross-branch or wrong-role processing', async () => {
  const item = await request({delegatedTo: foreign.id, delegatedBy: principal.id, delegationExpiresAt: new Date(Date.now() + 60000)});
  assert.equal((await decide(item._id, foreign)).status, 404);
  await ApprovalRequest.updateOne({_id: item._id}, {$set: {delegatedTo: teacher.id}});
  assert.equal((await decide(item._id, teacher)).status, 403);
});

test('invalid delegation expiry is rejected without history or state changes', async () => {
  const item = await request();
  for (const expiry of ['invalid', new Date(Date.now() - 1000).toISOString()]) {
    assert.equal((await decide(item._id, principal, {action: 'delegated', delegatedTo: String(peer.id), delegationExpiresAt: expiry})).status, 400);
  }
  assert.equal((await ApprovalRequest.findById(item._id))?.history.length, 0);
});

test('foreign requester/entity and nested fee student references cannot be read or processed', async () => {
  for (const extra of [{requesterId: foreign.id}, {entityId: studentB}]) {
    const item = await request(extra);
    assert.equal((await detail(item._id)).status, 404);
    assert.equal((await decide(item._id)).status, 404);
  }
  await Fee.updateOne({_id: fee}, {$set: {studentId: studentB}});
  const item = await request({approvalType: 'refund', amount: 1, entityType: 'fee', entityId: fee});
  assert.equal((await detail(item._id)).status, 404);
  assert.equal((await decide(item._id)).status, 404);
  assert.equal((await http('/approval-requests/pending', principal)).data.data.total, 0);
});

test('unknown model names and missing entities are denied instead of dynamically resolved', async () => {
  for (const extra of [{entityType: 'User'}, {entityType: 'session'}, {entityId: undefined}]) {
    const item = await request(extra);
    assert.equal((await detail(item._id)).status, 403);
    assert.equal((await decide(item._id)).status, 403);
  }
});

test('foreign historical reviewers and delegates are redacted rather than populated', async () => {
  const item = await request({reviewedBy: foreign.id, delegatedTo: foreign.id, delegatedBy: foreign.id,
    history: [{action: 'delegated', performedBy: foreign.id, delegatedBy: foreign.id}]});
  const result = await detail(item._id);
  assert.equal(result.status, 200);
  assert.equal(result.raw.includes('foreign-sensitive-name'), false);
  assert.equal(result.raw.includes(foreign.id.toString()), false);
  assert.equal(result.data.data.reviewedBy, 'Unavailable reviewer');
  assert.equal(result.data.data.history[0].performedBy, 'Unavailable reviewer');
});

test('raw attachments and untyped data are withheld from every approval response', async () => {
  const item = await request({supportingFileUrl: 'file:///private/other-branch', beforeData: {secret: 'cross-branch'}, afterData: {url: 'javascript:alert(1)'}});
  for (const result of [await http('/approval-requests/pending', principal), await detail(item._id), await decide(item._id)]) {
    assert.equal(result.status, 200);
    for (const text of ['supportingFileUrl', 'beforeData', 'afterData', 'file://', 'javascript:', 'cross-branch']) assert.equal(result.raw.includes(text), false);
  }
});

test('simultaneous final decisions allow exactly one final transition and history entry', {timeout: 10000}, async () => {
  const item = await request();
  // Both callers must reach the atomic write after authorizing the same pending
  // snapshot. This tests the database guard, not accidental HTTP serialization.
  const original = ApprovalRequest.findOneAndUpdate.bind(ApprovalRequest);
  let arrived = 0;
  let release: () => void = () => {};
  const barrier = new Promise<void>(resolve => {release = resolve;});
  mock.method(ApprovalRequest, 'findOneAndUpdate', (...args: Parameters<typeof original>) => {
    return (async () => {
      if (++arrived === 2) release();
      await barrier;
      return original(...args);
    })();
  });
  const results = await Promise.all([decide(item._id), decide(item._id, peer, {action: 'rejected', reason: 'test'})]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const stored = await ApprovalRequest.findById(item._id);
  assert.equal(stored?.history.length, 1);
  assert.ok(['approved', 'rejected'].includes(stored!.status));
  assert.equal((await decide(item._id)).status, 409);
});

test('intervening stored amount changes cannot use an earlier authority check', async () => {
  const item = await request({approvalType: 'refund', entityType: 'fee', entityId: fee, amount: 1});
  const original = ApprovalRequest.findOneAndUpdate.bind(ApprovalRequest);
  mock.method(ApprovalRequest, 'findOneAndUpdate', (...args: Parameters<typeof original>) => {
    return (async () => {
      await ApprovalRequest.collection.updateOne({_id: item._id}, {$set: {amount: 101}});
      return original(...args);
    })();
  });
  assert.equal((await decide(item._id)).status, 409);
  assert.equal((await ApprovalRequest.findById(item._id))?.status, 'pending');
});

test('delegation expiring while the write is queued cannot finalize at MongoDB', async () => {
  const item = await request({delegatedTo: peer.id, delegatedBy: principal.id, delegationExpiresAt: new Date(Date.now() + 2000)});
  const original = ApprovalRequest.findOneAndUpdate.bind(ApprovalRequest);
  mock.method(ApprovalRequest, 'findOneAndUpdate', (...args: Parameters<typeof original>) => {
    return (async () => {
      // Deliberately let the stored expiry pass after the service's precheck.
      await new Promise(resolve => setTimeout(resolve, 2100));
      return original(...args);
    })();
  });
  assert.equal((await decide(item._id, peer)).status, 409);
  assert.equal((await ApprovalRequest.findById(item._id))?.status, 'pending');
});

test('database failures have sanitized 500 responses', async () => {
  const item = await request();
  mock.method(ApprovalRequest, 'findOne', () => {throw new Error('private-database-details');});
  const result = await detail(item._id);
  assert.equal(result.status, 500);
  assert.equal(result.raw.includes('private-database-details'), false);
});

test('Principal dangerous permissions are removed, supporting reads and Super Admin permissions remain', () => {
  for (const permission of [PERMISSIONS.STUDENTS_DELETE, PERMISSIONS.TEACHERS_DELETE, PERMISSIONS.RESULTS_MANAGE, PERMISSIONS.FINANCE_MANAGE]) {
    assert.equal(ROLE_PERMISSIONS.principal.includes(permission), false);
    assert.equal(ROLE_PERMISSIONS.super_admin.includes(permission), true);
  }
  for (const permission of [PERMISSIONS.PRINCIPAL_DASHBOARD_VIEW, PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE, PERMISSIONS.PRINCIPAL_TASKS_MANAGE, PERMISSIONS.STUDENTS_VIEW, PERMISSIONS.FINANCE_VIEW, PERMISSIONS.RESULTS_VIEW]) {
    assert.equal(ROLE_PERMISSIONS.principal.includes(permission), true);
  }
  assert.deepEqual(ROLE_PERMISSIONS.super_admin, Object.values(PERMISSIONS));
});

test('approval routes enforce permission middleware in addition to role and grant', async () => {
  const item = await request();
  const original = ROLE_PERMISSIONS.principal;
  try {
    ROLE_PERMISSIONS.principal = original.filter(permission => ![
      PERMISSIONS.PRINCIPAL_APPROVALS_VIEW, PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE,
    ].includes(permission as typeof PERMISSIONS.PRINCIPAL_APPROVALS_VIEW));
    assert.equal((await detail(item._id)).status, 403);
    assert.equal((await decide(item._id)).status, 403);
    assert.equal((await http('/approval-requests/pending', principal)).status, 403);
  } finally {
    ROLE_PERMISSIONS.principal = original;
  }
});

test('existing Super Admin privileged review works and Principals cannot use it', async () => {
  const item = await new PrivilegedRequest({requesterId: teacher.id, branchId: branchA, requestType: 'test', reason: 'test'}).save();
  assert.equal((await http('/privileged-requests/pending', admin)).status, 200);
  assert.equal((await http('/privileged-requests/pending', principal)).status, 403);
  assert.equal((await http(`/privileged-requests/${item._id}/review`, principal, {status: 'approved'})).status, 403);
  assert.equal((await http(`/privileged-requests/${item._id}/review`, admin, {status: 'approved'})).status, 200);
  assert.equal((await PrivilegedRequest.findById(item._id))?.status, 'approved');
});
