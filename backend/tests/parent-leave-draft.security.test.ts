import assert from 'node:assert/strict';
import { before, after, afterEach, mock, test } from 'node:test';
import type { Server } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import mongoose from 'mongoose';
import { state, parentState, oid } from './helpers/parent-workspace.fixture';
import app from '../src/app';
import {
  ensureParentLeaveApplicationIndexes,
  ParentLeaveApplication,
  ParentLeaveEditOperation,
} from '../src/models/parentLeaveApplication';
import { ParentStudentLink } from '../src/models/parentStudentLink';
import { StudentEnrollment } from '../src/models/studentEnrollment';
import Branch from '../src/models/branch';
import User from '../src/models/user';
import Session from '../src/models/session';
import ApprovalRequest from '../src/models/approvalRequest';
import {
  AttendanceCorrection,
  StudentLeave,
} from '../src/models/attendanceAmendment';
import {
  AttendanceSession,
  PeriodAttendanceRecord,
} from '../src/models/periodAttendance';
import { Notification } from '../src/models/notification';
import { seedOccurrence } from './helpers/parent-domain.fixture';

let server: Server, base: string;
before(async () => {
  await ensureParentLeaveApplicationIndexes();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${
    (server.address() as { port: number }).port
  }/api/parent/me/children/`;
});
afterEach(() => mock.restoreAll());
after(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
});
const body = (patch = {}) => ({
  leaveType: 'Family leave',
  startDate: '2026-11-04',
  endDate: '2026-11-05',
  reason: 'Private medical detail',
  clientOperationId: 'create-operation-1',
  ...patch,
});
const editBody = (patch = {}) =>
  body({
    revision: 0,
    clientOperationId: 'edit-operation-1',
    reason: 'Updated private detail',
    ...patch,
  });
async function http(
  method = 'GET',
  suffix = '',
  value?: unknown,
  token = parentState.token,
  studentId = String(state.student._id),
) {
  const response = await fetch(
    `${base}${studentId}/leave-applications${suffix}`,
    {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
      },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    },
  );
  return {
    status: response.status,
    json: (await response.json()) as { data: any; message?: string },
    cache: response.headers.get('cache-control'),
  };
}
const create = () => http('POST', '', body());
async function draftId() {
  const response = await create();
  assert.equal(response.status, 200);
  return response.json.data.applicationId as string;
}

test('required unique indexes exist in real MongoDB', async () => {
  const application = await ParentLeaveApplication.collection.indexes();
  assert.equal(
    application.find(index => index.name === 'parent_leave_owner_operation')
      ?.unique,
    true,
  );
  assert.equal(
    application.find(index => index.name === 'parent_leave_one_linked_approval')
      ?.unique,
    true,
  );
  const edits = await ParentLeaveEditOperation.collection.indexes();
  assert.equal(
    edits.find(index => index.name === 'parent_leave_edit_owner_operation')
      ?.unique,
    true,
  );
});
test('create/list/detail/edit use owned draft DTOs, history and no-store', async () => {
  const id = await draftId();
  const list = await http();
  assert.equal(list.cache, 'no-store');
  assert.equal(list.json.data.total, 1);
  assert.equal(list.json.data.items[0].state, 'draft');
  assert.equal(
    JSON.stringify(list.json).includes('Private medical detail'),
    false,
  );
  const detail = await http('GET', '/' + id);
  assert.equal(detail.json.data.reason, 'Private medical detail');
  assert.deepEqual(
    Object.keys(detail.json.data).sort(),
    [
      'applicationId',
      'studentId',
      'state',
      'leaveType',
      'startDate',
      'endDate',
      'revision',
      'createdAt',
      'updatedAt',
      'reason',
      'history',
    ].sort(),
  );
  assert.deepEqual(Object.keys(detail.json.data.history[0]).sort(), [
    'action',
    'at',
    'revision',
  ]);
  const updated = await http('PATCH', '/' + id, editBody());
  assert.equal(updated.status, 200);
  assert.equal(updated.json.data.application.state, 'draft');
  assert.equal(updated.json.data.application.revision, 1);
  assert.equal(updated.json.data.application.reason, 'Updated private detail');
  assert.deepEqual(
    updated.json.data.application.history.map(
      (event: { revision: number }) => event.revision,
    ),
    [0, 1],
  );
});
test('original creation receipt survives edits; edit retries acknowledge original revision and read current data', async () => {
  const id = await draftId();
  const original = await ParentLeaveApplication.collection.findOne({});
  await http('PATCH', '/' + id, editBody());
  await http(
    'PATCH',
    '/' + id,
    editBody({
      revision: 1,
      clientOperationId: 'edit-operation-2',
      reason: 'Third version',
    }),
  );
  const replay = await http('PATCH', '/' + id, editBody());
  assert.equal(replay.status, 200);
  assert.equal(replay.json.data.replayed, true);
  assert.equal(replay.json.data.operationRevision, 1);
  assert.equal(replay.json.data.application.revision, 2);
  const createReplay = await create();
  assert.equal(createReplay.json.data.replayed, true);
  assert.equal(createReplay.json.data.applicationId, id);
  const row = await ParentLeaveApplication.collection.findOne({});
  assert.equal(row!.fingerprint, original!.fingerprint);
  assert.equal(row!.clientOperationId, original!.clientOperationId);
  assert.equal(row!.history.length, 3);
  assert.equal(await ParentLeaveEditOperation.countDocuments(), 2);
});
test('duplicate creates and edits converge; changed receipt payload conflicts', async () => {
  const results = await Promise.all([create(), create()]);
  assert.deepEqual(
    results.map(result => result.status),
    [200, 200],
  );
  const id = results[0].json.data.applicationId;
  assert.equal(results[1].json.data.applicationId, id);
  const edits = await Promise.all([
    http('PATCH', '/' + id, editBody()),
    http('PATCH', '/' + id, editBody()),
  ]);
  assert.deepEqual(
    edits.map(result => result.status),
    [200, 200],
  );
  assert.equal(await ParentLeaveEditOperation.countDocuments(), 1);
  assert.equal(
    (
      await http(
        'PATCH',
        '/' + id,
        editBody({ reason: 'Conflict private detail' }),
      )
    ).status,
    409,
  );
  assert.equal(
    (await http('POST', '', body({ reason: 'Different create payload' })))
      .status,
    409,
  );
});
test('concurrent different edits at the same revision have exactly one winner', async () => {
  const id = await draftId();
  const results = await Promise.all([
    http('PATCH', '/' + id, editBody()),
    http(
      'PATCH',
      '/' + id,
      editBody({ clientOperationId: 'another-edit', reason: 'Competing edit' }),
    ),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(await ParentLeaveEditOperation.countDocuments(), 1);
  const row = await ParentLeaveApplication.findById(id);
  assert.equal(row!.revision, 1);
  assert.equal(row!.history.length, 2);
});
test('durable edit receipt index rejects duplicate insertion', async () => {
  const id = await draftId();
  await http('PATCH', '/' + id, editBody());
  const row = await ParentLeaveEditOperation.collection.findOne({});
  await assert.rejects(
    ParentLeaveEditOperation.collection.insertOne({ ...row!, _id: oid() }),
    (error: unknown) => (error as { code: number }).code === 11000,
  );
});
test('receipt persistence failure rolls back draft content, revision and history', async () => {
  const id = await draftId();
  const original = await ParentLeaveApplication.collection.findOne({});
  mock.method(ParentLeaveEditOperation, 'create', async () => {
    throw new Error('Private database failure');
  });
  const result = await http('PATCH', '/' + id, editBody());
  assert.equal(result.status, 500);
  assert.equal(JSON.stringify(result.json).includes('Private database'), false);
  assert.deepEqual(
    await ParentLeaveApplication.collection.findOne({}),
    original,
  );
  mock.restoreAll();
  assert.equal((await http('PATCH', '/' + id, editBody())).status, 200);
});
test(
  'two Node processes serialize independent competing edits',
  { timeout: 30000 },
  async () => {
    const id = await draftId();
    const client = mongoose.connection.getClient();
    const script = `const mongoose = require('mongoose'); const { editParentLeaveDraft } = require('./src/services/parent-leave-draft.service.ts');
    (async () => { const d = JSON.parse(process.env.G2A_WORKER_INPUT); await mongoose.connect(d.uri, {dbName:d.dbName,autoIndex:false});
      try { const r = await editParentLeaveDraft(d.identity,d.token,d.studentId,d.id,d.body); console.log(JSON.stringify({revision:r.operationRevision})); }
      catch(e) { if(e.status !== 409) throw e; console.log(JSON.stringify({status:409})); }
      finally { await mongoose.disconnect(); } })().catch(() => {console.error('Edit worker failed');process.exitCode=1;});`;
    const run = (operation: string) =>
      promisify(execFile)(
        process.execPath,
        ['--import', 'tsx', '--eval', script],
        {
          cwd: process.cwd(),
          timeout: 25000,
          env: {
            ...process.env,
            G2A_WORKER_INPUT: JSON.stringify({
              uri:
                'mongodb://' +
                client.options.hosts.map(host => String(host)).join(',') +
                '/?replicaSet=' +
                client.options.replicaSet,
              dbName: mongoose.connection.name,
              identity: {
                userId: String(parentState.parent._id),
                role: 'parent',
              },
              token: parentState.token,
              studentId: String(state.student._id),
              id,
              body: editBody({ clientOperationId: operation }),
            }),
          },
        },
      );
    const results = (
      await Promise.all([run('worker-edit-1'), run('worker-edit-2')])
    ).map(result => JSON.parse(result.stdout.trim()));
    assert.equal(results.filter(result => result.revision === 1).length, 1);
    assert.equal(results.filter(result => result.status === 409).length, 1);
  },
);

test('authentication, role and valid foreign identifiers never expose private detail', async () => {
  const id = await draftId();
  assert.equal((await http('GET', '', undefined, '')).status, 401);
  assert.equal((await http('GET', '', undefined, state.token)).status, 403);
  for (const result of [
    await http('GET', '/' + id, undefined, parentState.otherToken),
    await http('GET', '/' + oid()),
    await http(
      'GET',
      '',
      undefined,
      parentState.token,
      String(state.otherStudent._id),
    ),
    await http('PATCH', '/' + id, editBody(), parentState.otherToken),
  ]) {
    assert.equal(result.status, 404);
    assert.equal(
      JSON.stringify(result.json).includes('Private medical detail'),
      false,
    );
  }
});
for (const change of [
  { status: 'revoked' },
  { status: 'pending' },
  { isActive: false },
]) {
  test(`relationship ${JSON.stringify(
    change,
  )} denies read/create/edit/replay`, async () => {
    const id = await draftId();
    await http('PATCH', '/' + id, editBody());
    await ParentStudentLink.collection.updateOne(
      { _id: parentState.link._id },
      { $set: change },
    );
    for (const response of [
      await http(),
      await http('GET', '/' + id),
      await create(),
      await http('PATCH', '/' + id, editBody()),
    ])
      assert.equal(response.status, 404);
    assert.equal(await ParentLeaveApplication.countDocuments(), 1);
  });
}
for (const kind of ['branch', 'enrollment', 'role', 'session'] as const) {
  test(`current ${kind} change denies old draft endpoints`, async () => {
    const id = await draftId();
    if (kind === 'branch')
      await User.updateOne(
        { _id: parentState.parent._id },
        { $set: { branchId: state.foreign._id } },
      );
    if (kind === 'enrollment')
      await StudentEnrollment.updateOne(
        { _id: state.enrollment._id },
        { $set: { status: 'transferred', effectiveTo: new Date() } },
      );
    if (kind === 'role')
      await User.updateOne(
        { _id: parentState.parent._id },
        { $set: { role: 'teacher' } },
      );
    if (kind === 'session')
      await Session.updateOne(
        { token: parentState.token },
        { $set: { isRevoked: true } },
      );
    for (const result of [
      await http(),
      await http('GET', '/' + id),
      await http('PATCH', '/' + id, editBody()),
    ])
      assert.equal(
        result.status,
        kind === 'role' || kind === 'session' ? 401 : 404,
      );
  });
}
test('relationship revoked during a slow detail read conceals the response', async () => {
  const id = await draftId();
  const original = ParentLeaveApplication.collection.findOne.bind(
    ParentLeaveApplication.collection,
  );
  let calls = 0;
  mock.method(
    ParentLeaveApplication.collection,
    'findOne',
    async (...args: Parameters<typeof original>) => {
      const row = await original(...args);
      if (++calls === 2)
        await ParentStudentLink.updateOne(
          { _id: parentState.link._id },
          { $set: { status: 'revoked' } },
        );
      return row;
    },
  );
  const result = await http('GET', '/' + id);
  assert.equal(result.status, 404);
  assert.equal(
    JSON.stringify(result.json).includes('Private medical detail'),
    false,
  );
});
test(
  'committed revocation after initial edit authority prevents content and receipt writes',
  { timeout: 15000 },
  async () => {
    const id = await draftId();
    const reached = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    const original = Branch.collection.updateOne.bind(Branch.collection);
    let paused = false;
    mock.method(
      Branch.collection,
      'updateOne',
      async (...args: Parameters<typeof original>) => {
        if (!paused) {
          paused = true;
          reached.resolve();
          await release.promise;
        }
        return original(...args);
      },
    );
    const editing = http('PATCH', '/' + id, editBody());
    await reached.promise;
    try {
      await ParentStudentLink.updateOne(
        { _id: parentState.link._id },
        { $set: { status: 'revoked' } },
      );
    } finally {
      release.resolve();
    }
    assert.equal((await editing).status, 404);
    assert.equal((await ParentLeaveApplication.findById(id))!.revision, 0);
    assert.equal(await ParentLeaveEditOperation.countDocuments(), 0);
  },
);
for (const patch of [
  { state: 'approved' },
  { requesterId: 'forged' },
  { branchId: 'forged' },
  { enrollmentId: 'forged' },
  { approvalRequestId: oid() },
  { protectedAttachmentIds: [oid()] },
  { startDate: '2026-02-30' },
  { endDate: '2026-01-01' },
  { reason: '' },
  { revision: -1 },
]) {
  test(`invalid edit input fails without mutation ${
    Object.keys(patch)[0]
  } ${String(Object.values(patch)[0])}`, async () => {
    const id = await draftId();
    assert.equal((await http('PATCH', '/' + id, editBody(patch))).status, 400);
    assert.equal((await ParentLeaveApplication.findById(id))!.revision, 0);
  });
}
test('pagination is bounded and scope cannot be supplied in queries', async () => {
  await draftId();
  assert.equal(
    (await http('GET', '?limit=1&offset=0')).json.data.items.length,
    1,
  );
  for (const query of [
    '?branchId=forged',
    '?limit=0',
    '?limit=51',
    '?offset=-1',
  ])
    assert.equal((await http('GET', query)).status, 400);
});
test('no approval/attendance/notification mutation or lifecycle endpoints', async () => {
  await seedOccurrence();
  const records = await PeriodAttendanceRecord.find({}).lean(),
    sessions = await AttendanceSession.find({}).lean();
  const id = await draftId();
  await http('PATCH', '/' + id, editBody());
  for (const action of ['submit', 'withdraw', 'approve'])
    assert.equal((await http('POST', '/' + id + '/' + action, {})).status, 403);
  assert.equal(await ApprovalRequest.countDocuments(), 0);
  assert.equal(await AttendanceCorrection.countDocuments(), 0);
  assert.equal(await StudentLeave.countDocuments(), 0);
  assert.equal(await Notification.countDocuments(), 0);
  assert.deepEqual(await PeriodAttendanceRecord.find({}).lean(), records);
  assert.deepEqual(await AttendanceSession.find({}).lean(), sessions);
  assert.equal((await ParentLeaveApplication.findById(id))!.state, 'draft');
});
