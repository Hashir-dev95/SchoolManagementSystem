import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import type { Server } from 'node:http';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import { promisify } from 'node:util';
import mongoose from 'mongoose';
import app from '../src/app';
import ApprovalRequest, {
  PARENT_LEAVE_APPROVAL_ENTITY,
} from '../src/models/approvalRequest';
import {
  ParentLeaveApplication,
  ensureParentLeaveApplicationIndexes,
} from '../src/models/parentLeaveApplication';
import { ParentLeaveOperation } from '../src/models/parentLeaveOperation';
import { ParentStudentLink } from '../src/models/parentStudentLink';
import { StudentEnrollment } from '../src/models/studentEnrollment';
import User from '../src/models/user';
import Session from '../src/models/session';
import {
  AttendanceSession,
  PeriodAttendanceRecord,
} from '../src/models/periodAttendance';
import {
  AttendanceCorrection,
  StudentLeave,
} from '../src/models/attendanceAmendment';
import { Notification } from '../src/models/notification';
import { generateAccessToken } from '../src/services/jwt.service';
import { registerSession } from '../src/services/session.service';
import { seedOccurrence } from './helpers/parent-domain.fixture';
import { oid, parentState, state } from './helpers/parent-workspace.fixture';

let server: Server;
let base: string;
let principal: string;
const envKeys = [
  'PARENT_LEAVE_ROUTING_POLICY',
  'PRINCIPAL_APPROVAL_AUTHORITY',
] as const;
const original = envKeys.map(key => process.env[key]);
before(async () => {
  await ensureParentLeaveApplicationIndexes();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});
beforeEach(async () => {
  process.env.PARENT_LEAVE_ROUTING_POLICY = routing();
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = grant();
  principal = generateAccessToken(
    String(parentState.verifier._id),
    'principal',
  );
  await registerSession(
    String(parentState.verifier._id),
    principal,
    'principal',
  );
});
afterEach(() => {
  mock.restoreAll();
  envKeys.forEach((key, i) => {
    if (original[i] === undefined) delete process.env[key];
    else process.env[key] = original[i];
  });
});
after(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
});

const routing = (patch = {}) =>
  JSON.stringify({
    policy: 'shared_branch_principal',
    version: 7,
    enabled: true,
    branchIds: [String(state.branch._id)],
    ...patch,
  });
const grant = (branch = state.branch._id) =>
  JSON.stringify({
    [String(parentState.verifier._id)]: {
      branchId: String(branch),
      types: ['leave'],
    },
  });
const path = (student = state.student._id) =>
  `/parent/me/children/${student}/leave-applications`;
const fields = {
  leaveType: 'Family leave',
  startDate: '2026-11-04',
  endDate: '2026-11-06',
  reason: 'Private owner note',
};
async function http(
  method: string,
  url: string,
  body?: unknown,
  token = parentState.token,
  headers: Record<string, string> = {},
) {
  const res = await fetch(base + url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: await res.json() };
}
async function draft(token = parentState.token, patch = {}) {
  const result = await http(
    'POST',
    path(),
    { ...fields, clientOperationId: 'draft', ...patch },
    token,
  );
  assert.equal(result.status, 200);
  return result.json.data.applicationId as string;
}
const action = (
  id: string,
  kind = 'submit',
  revision = 0,
  op = kind,
  token = parentState.token,
  root = path(),
) =>
  http(
    'POST',
    `${root}/${id}/${kind}`,
    { revision, clientOperationId: op },
    token,
  );
const stored = (id: string) =>
  ParentLeaveApplication.findById(id).select('+reason +submission').lean();
const approvalOf = (id: string) =>
  ApprovalRequest.findOne({
    entityType: PARENT_LEAVE_APPROVAL_ENTITY,
    entityId: id,
  }).lean();

test('submission freezes content and records one neutral, reciprocal approval and owner event', async () => {
  const id = await draft();
  const result = await action(id);
  assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.equal(result.json.data.application.state, 'pending');
  const application = await stored(id);
  const approval = await approvalOf(id);
  assert.equal(application!.submission!.policy, 'shared_branch_principal');
  assert.equal(application!.submission!.version, 7);
  assert.equal(application!.submission!.revision, 1);
  assert.equal(String(application!.approvalRequestId), String(approval!._id));
  assert.equal(String(approval!.requesterId), String(parentState.parent._id));
  assert.equal(String(approval!.branchId), String(state.branch._id));
  assert.equal(approval!.approvalType, 'leave');
  assert.equal(approval!.parentLeaveRevision, 1);
  assert.equal(approval!.status, 'pending');
  assert.equal(approval!.reason, 'Parent leave application');
  assert.equal(approval!.reviewedBy, undefined);
  assert.equal(approval!.delegatedTo, undefined);
  assert.equal(approval!.history[0].action, 'submitted');
  assert.deepEqual(
    application!.history.map(item => item.action),
    ['draft_created', 'submitted'],
  );
  assert.equal(await ParentLeaveOperation.countDocuments(), 1);
  const edit = await http('PATCH', path() + '/' + id, {
    ...fields,
    revision: 1,
    clientOperationId: 'edit',
    reason: 'tampered',
  });
  assert.equal(edit.status, 409);
  assert.equal((await stored(id))!.reason, fields.reason);
  const document = await ParentLeaveApplication.findById(id).select(
    '+reason +submission',
  );
  document!.reason = 'tampered';
  await assert.rejects(document!.validate(), /frozen/);
  const linkChange = await ParentLeaveApplication.findById(id).select(
    '+reason +submission',
  );
  linkChange!.approvalRequestId = oid();
  await assert.rejects(linkChange!.validate(), /immutable/);
});

for (const policy of [undefined, '{', '[]', 'disabled', 'foreign'] as const) {
  test(`routing fails closed with ${String(
    policy,
  )} configuration`, async () => {
    const id = await draft();
    if (policy === undefined) delete process.env.PARENT_LEAVE_ROUTING_POLICY;
    else if (policy === 'disabled')
      process.env.PARENT_LEAVE_ROUTING_POLICY = routing({ enabled: false });
    else if (policy === 'foreign')
      process.env.PARENT_LEAVE_ROUTING_POLICY = routing({
        branchIds: [String(state.foreign._id)],
      });
    else process.env.PARENT_LEAVE_ROUTING_POLICY = policy;
    assert.equal((await action(id)).status, 503);
    assert.equal((await stored(id))!.state, 'draft');
    assert.equal(await ApprovalRequest.countDocuments(), 0);
    assert.equal(await ParentLeaveOperation.countDocuments(), 0);
  });
}

test('wrong-Branch category grant rolls back submission', async () => {
  const id = await draft();
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = grant(state.foreign._id);
  assert.equal((await action(id)).status, 503);
  assert.equal((await stored(id))!.revision, 0);
  assert.equal(await ApprovalRequest.countDocuments(), 0);
  assert.equal(await ParentLeaveOperation.countDocuments(), 0);
});

test('rejects foreign application owner, Student and Branch context', async () => {
  const id = await draft();
  assert.equal(
    (await action(id, 'submit', 0, 'submit', parentState.otherToken)).status,
    404,
  );
  assert.equal(
    (
      await action(
        id,
        'submit',
        0,
        'submit',
        parentState.token,
        path(state.otherStudent._id),
      )
    ).status,
    404,
  );
  await ParentLeaveApplication.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(id) },
    { $set: { branchId: state.foreign._id } },
  );
  assert.equal((await action(id)).status, 404);
  assert.equal(await ParentLeaveOperation.countDocuments(), 0);
});

for (const change of [
  'revoked',
  'unverified',
  'role',
  'session',
  'branch',
  'enrollment',
] as const) {
  test(`current ${change} denies both a fresh submission and a committed receipt replay`, async () => {
    const id = await draft();
    const another = await draft(parentState.token, {
      clientOperationId: 'draft-two',
    });
    assert.equal((await action(id)).status, 200);
    if (change === 'revoked' || change === 'unverified')
      await ParentStudentLink.updateOne(
        { _id: parentState.link._id },
        { $set: { status: change === 'revoked' ? 'revoked' : 'pending' } },
      );
    else if (change === 'role')
      await User.updateOne(
        { _id: parentState.parent._id },
        { $set: { role: 'teacher' } },
      );
    else if (change === 'session')
      await Session.updateOne(
        { token: parentState.token },
        { $set: { isRevoked: true } },
      );
    else if (change === 'branch')
      await User.updateOne(
        { _id: parentState.parent._id },
        { $set: { branchId: state.foreign._id } },
      );
    else
      await StudentEnrollment.updateOne(
        { _id: state.enrollment._id },
        { $set: { status: 'transferred', effectiveTo: new Date() } },
      );
    const expected = change === 'role' || change === 'session' ? 401 : 404;
    assert.equal((await action(id)).status, expected);
    assert.equal(
      (await action(another, 'submit', 0, 'fresh')).status,
      expected,
    );
    assert.equal((await action(id, 'withdraw', 1)).status, expected);
    assert.equal(await ParentLeaveOperation.countDocuments(), 1);
  });
}

test('identical replay acknowledges original revision after withdrawal and rejects conflicting operation reuse', async () => {
  const id = await draft();
  assert.equal((await action(id)).status, 200);
  const repeat = await action(id);
  assert.equal(repeat.json.data.replayed, true);
  assert.equal((await action(id, 'submit', 1)).status, 409);
  assert.equal((await action(id, 'withdraw', 1, 'submit')).status, 409);
  assert.equal((await action(id, 'withdraw', 1)).status, 200);
  const replay = await action(id);
  assert.equal(replay.json.data.operationRevision, 1);
  assert.equal(replay.json.data.operationState, 'pending');
  assert.equal(replay.json.data.application.state, 'withdrawn');
  assert.equal(await ApprovalRequest.countDocuments(), 1);
  assert.equal(await ParentLeaveOperation.countDocuments(), 2);
});

test(
  'independent Node processes submit the same draft with a shared receipt',
  { timeout: 30000 },
  async () => {
    const id = await draft();
    const client = mongoose.connection.getClient();
    const script = `const mongoose = require('mongoose');
    const { changeParentLeaveLifecycle } = require('./src/services/parent-leave-lifecycle.service.ts');
    (async () => {
      const d = JSON.parse(process.env.G2B_WORKER_INPUT);
      await mongoose.connect(d.uri, {dbName:d.dbName,autoIndex:false});
      try {
        const result = await changeParentLeaveLifecycle('submit', d.identity, d.token, d.student, d.id, {revision:0,clientOperationId:'worker'});
        console.log(JSON.stringify({replayed:result.replayed, revision:result.operationRevision}));
      } finally {await mongoose.disconnect();}
    })().catch(error => {console.error(error.message);process.exitCode=1;});`;
    const worker = () =>
      promisify(execFile)(
        process.execPath,
        ['--import', 'tsx', '--eval', script],
        {
          cwd: process.cwd(),
          timeout: 25000,
          env: {
            ...process.env,
            G2B_WORKER_INPUT: JSON.stringify({
              uri:
                'mongodb://' +
                client.options.hosts.map(host => String(host)).join(',') +
                '/?replicaSet=' +
                client.options.replicaSet,
              dbName: mongoose.connection.name,
              id,
              student: String(state.student._id),
              token: parentState.token,
              identity: {
                userId: String(parentState.parent._id),
                role: 'parent',
              },
            }),
          },
        },
      );
    const results = (await Promise.all([worker(), worker()])).map(result =>
      JSON.parse(result.stdout.trim()),
    );
    assert.deepEqual(results.map(result => result.replayed).sort(), [
      false,
      true,
    ]);
    assert.deepEqual(
      results.map(result => result.revision),
      [1, 1],
    );
    assert.equal(await ApprovalRequest.countDocuments(), 1);
    assert.equal(await ParentLeaveOperation.countDocuments(), 1);
  },
);

test('different guardians cannot concurrently reserve overlapping dates for the same Student', async () => {
  await ParentStudentLink.create({
    parentUserId: parentState.otherParent._id,
    studentId: state.student._id,
    branchId: state.branch._id,
    relationship: 'guardian',
    status: 'verified',
    isActive: true,
    createdBy: parentState.verifier._id,
    verifiedBy: parentState.verifier._id,
    verifiedAt: new Date(),
  });
  const one = await draft();
  const two = await draft(parentState.otherToken, {
    startDate: fields.endDate,
    endDate: '2026-11-09',
  });
  const results = await Promise.all([
    action(one),
    action(two, 'submit', 0, 'submit', parentState.otherToken),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(await ApprovalRequest.countDocuments(), 1);
  assert.equal(await ParentLeaveOperation.countDocuments(), 1);
});

test('edit and submit race preserves the winning revision and payload', async () => {
  const id = await draft();
  const [submit, edit] = await Promise.all([
    action(id),
    http('PATCH', path() + '/' + id, {
      ...fields,
      reason: 'Edited value',
      revision: 0,
      clientOperationId: 'edit',
    }),
  ]);
  assert.deepEqual([submit.status, edit.status].sort(), [200, 409]);
  const row = await stored(id);
  assert.equal(row!.revision, 1);
  assert.equal(
    row!.reason,
    submit.status === 200 ? fields.reason : 'Edited value',
  );
  assert.equal(
    await ApprovalRequest.countDocuments(),
    submit.status === 200 ? 1 : 0,
  );
});

test('submit and withdraw with the same draft revision cannot both succeed', async () => {
  const id = await draft();
  const [submit, withdraw] = await Promise.all([
    action(id),
    action(id, 'withdraw'),
  ]);
  assert.equal(submit.status, 200);
  assert.equal(withdraw.status, 409);
  assert.equal((await stored(id))!.state, 'pending');
});

test('receipt failure rolls back both sides of submission and withdrawal', async () => {
  const id = await draft();
  const inject = () =>
    mock.method(ParentLeaveOperation, 'create', async () => {
      throw new Error('sensitive injected error');
    });
  inject();
  const failed = await action(id);
  assert.equal(failed.status, 500);
  assert.doesNotMatch(JSON.stringify(failed.json), /sensitive/);
  assert.equal((await stored(id))!.state, 'draft');
  assert.equal(await ApprovalRequest.countDocuments(), 0);
  assert.equal(await ParentLeaveOperation.countDocuments(), 0);
  mock.restoreAll();
  assert.equal((await action(id)).status, 200);
  inject();
  assert.equal((await action(id, 'withdraw', 1)).status, 500);
  assert.equal((await stored(id))!.state, 'pending');
  assert.equal((await approvalOf(id))!.status, 'pending');
  assert.equal(await ParentLeaveOperation.countDocuments(), 1);
  mock.restoreAll();
  assert.equal((await action(id, 'withdraw', 1)).status, 200);
});

test('reciprocal database uniqueness rejects duplicate Parent approval', async () => {
  const id = await draft();
  assert.equal((await action(id)).status, 200);
  await assert.rejects(
    ApprovalRequest.collection.insertOne({
      ...(await approvalOf(id)),
      _id: oid(),
      branchId: state.foreign._id,
    }),
    { code: 11000 },
  );
});

test('withdrawal is atomic and retryable, preserves history, and records no reviewer or domain effect', async () => {
  await seedOccurrence();
  const sessions = await AttendanceSession.find().lean();
  const records = await PeriodAttendanceRecord.find().lean();
  const id = await draft();
  assert.equal((await action(id)).status, 200);
  const pendingList = await http('GET', path());
  assert.equal(pendingList.json.data.items[0].state, 'pending');
  assert.equal(pendingList.json.data.items[0].reason, undefined);
  delete process.env.PARENT_LEAVE_ROUTING_POLICY;
  const results = await Promise.all([
    action(id, 'withdraw', 1),
    action(id, 'withdraw', 1),
  ]);
  assert.deepEqual(
    results.map(result => result.status),
    [200, 200],
  );
  assert.deepEqual(results.map(result => result.json.data.replayed).sort(), [
    false,
    true,
  ]);
  const detail = await http('GET', path() + '/' + id);
  assert.equal(detail.json.data.state, 'withdrawn');
  assert.deepEqual(
    detail.json.data.history.map((event: { action: string }) => event.action),
    ['draft_created', 'submitted', 'withdrawn'],
  );
  assert.equal(
    (await http('GET', path())).json.data.items[0].state,
    'withdrawn',
  );
  const approval = await approvalOf(id);
  assert.equal(approval!.status, 'withdrawn');
  assert.equal(String(approval!.withdrawnBy), String(parentState.parent._id));
  assert.ok(approval!.withdrawnAt);
  assert.equal(approval!.reviewedBy, undefined);
  assert.deepEqual(
    approval!.history.map(event => event.action),
    ['submitted', 'withdrawn'],
  );
  assert.equal(await ParentLeaveOperation.countDocuments(), 2);
  assert.equal(await Notification.countDocuments(), 0);
  assert.equal(await AttendanceCorrection.countDocuments(), 0);
  assert.equal(await StudentLeave.countDocuments(), 0);
  assert.deepEqual(await AttendanceSession.find().lean(), sessions);
  assert.deepEqual(await PeriodAttendanceRecord.find().lean(), records);
});

test('a terminal approval or a broken backlink prevents withdrawal', async () => {
  const id = await draft();
  assert.equal((await action(id)).status, 200);
  const approval = await approvalOf(id);
  await ApprovalRequest.updateOne(
    { _id: approval!._id },
    { $set: { status: 'approved' } },
  );
  assert.equal((await action(id, 'withdraw', 1)).status, 409);
  assert.equal((await approvalOf(id))!.status, 'approved');
  await ApprovalRequest.updateOne(
    { _id: approval!._id },
    { $set: { status: 'pending', parentLeaveRevision: 2 } },
  );
  assert.equal((await action(id, 'withdraw', 1)).status, 409);
  assert.equal((await stored(id))!.state, 'pending');
  assert.equal(await ParentLeaveOperation.countDocuments(), 1);
});

test('generic Principal queue, details, decisions and delegation stay closed during pending and withdrawal', async () => {
  const id = await draft();
  assert.equal((await action(id)).status, 200);
  const approval = await approvalOf(id);
  const route = '/approval-requests/' + approval!._id;
  const list = await http(
    'GET',
    '/approval-requests/pending',
    undefined,
    principal,
  );
  assert.equal(list.status, 200);
  assert.doesNotMatch(
    JSON.stringify(list.json),
    new RegExp(String(approval!._id)),
  );
  for (const suffix of ['', '/eligible-delegates']) {
    const result = await http('GET', route + suffix, undefined, principal);
    assert.equal(result.status, 403);
    assert.doesNotMatch(JSON.stringify(result.json), /Private owner note/);
  }
  for (const verb of [
    'approved',
    'rejected',
    'changes_requested',
    'delegated',
  ]) {
    const body =
      verb === 'delegated'
        ? {
            action: verb,
            delegatedTo: String(oid()),
            delegationExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          }
        : { action: verb, reason: 'test decision' };
    assert.equal((await http('PATCH', route, body, principal)).status, 403);
  }
  assert.equal(
    (await http('PATCH', route + '/resubmit', { revision: 0, reason: 'test' }))
      .status,
    403,
  );
  const [withdraw, approve] = await Promise.all([
    action(id, 'withdraw', 1),
    http('PATCH', route, { action: 'approved' }, principal),
  ]);
  assert.equal(withdraw.status, 200);
  assert.equal(approve.status, 403);
  assert.equal((await approvalOf(id))!.status, 'withdrawn');
});

test('generic resubmission also denies a former Parent with a registered Principal session', async () => {
  const id = await draft();
  assert.equal((await action(id)).status, 200);
  const approval = await approvalOf(id);
  await ApprovalRequest.updateOne(
    { _id: approval!._id },
    { $set: { status: 'changes_requested' } },
  );
  await User.updateOne(
    { _id: parentState.parent._id },
    { $set: { role: 'principal' } },
  );
  const token = generateAccessToken(
    String(parentState.parent._id),
    'principal',
  );
  await registerSession(String(parentState.parent._id), token, 'principal');
  const result = await http(
    'PATCH',
    `/approval-requests/${approval!._id}/resubmit`,
    { reason: 'Attempted generic resubmission' },
    token,
    { 'If-Match': '"0"' },
  );
  assert.equal(result.status, 403);
  assert.equal((await approvalOf(id))!.status, 'changes_requested');
  assert.equal(await ParentLeaveOperation.countDocuments(), 1);
});

test('forged authority, private file fields and stale revisions produce no writes', async () => {
  const id = await draft();
  for (const forbidden of [
    'attachmentIds',
    'reason',
    'approverId',
    'branchId',
    'approvalType',
  ]) {
    const result = await http('POST', `${path()}/${id}/submit`, {
      revision: 0,
      clientOperationId: 'test',
      [forbidden]: 'private rejected value',
    });
    assert.equal(result.status, 400);
    assert.doesNotMatch(JSON.stringify(result.json), /private rejected value/);
  }
  assert.equal((await action(id, 'submit', 3)).status, 409);
  assert.equal(await ApprovalRequest.countDocuments(), 0);
  assert.equal(await ParentLeaveOperation.countDocuments(), 0);
});
