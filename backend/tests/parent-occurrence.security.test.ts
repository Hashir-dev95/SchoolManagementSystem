import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  state,
  parentState,
  parentHttp,
} from './helpers/parent-workspace.fixture';
import { seedOccurrence } from './helpers/parent-domain.fixture';
import { AttendanceSession } from '../src/models/periodAttendance';
import { ParentStudentLink } from '../src/models/parentStudentLink';
import { TimetableVersion } from '../src/models/timetable';
import { StudentEnrollment } from '../src/models/studentEnrollment';
test('verified child timetable applies canonical exact occurrence substitution', async () => {
  await seedOccurrence();
  const r = await parentHttp(`/children/${state.student._id}/timetable`);
  assert.equal(r.status, 200);
  assert.equal(r.json.data.items[0].teacher, 'Effective Teacher');
  assert.equal(r.json.data.items[0].startTime, '09:00');
});
test('Parent sees only own verified child submitted physical mark', async () => {
  await seedOccurrence();
  const r = await parentHttp(`/children/${state.student._id}/attendance`);
  assert.equal(r.status, 200);
  assert.equal(r.json.data.kind, 'physical');
  assert.equal(r.json.data.items[0].status, 'present');
  assert.equal(JSON.stringify(r.json).includes('absent'), false);
});
test('draft attendance and missing marks are never final absence', async () => {
  const { session } = await seedOccurrence();
  await AttendanceSession.updateOne(
    { _id: session._id },
    { $set: { state: 'draft' } },
  );
  let r = await parentHttp(`/children/${state.student._id}/attendance`);
  assert.equal(r.json.data.items[0].status, null);
  assert.equal(r.json.data.items[0].state, 'in_progress');
  await AttendanceSession.deleteMany({});
  r = await parentHttp(`/children/${state.student._id}/attendance`);
  assert.equal(r.json.data.items[0].state, 'unmarked');
});
for (const path of ['timetable', 'attendance']) {
  test(`${path} revalidates link on every request and rejects another child`, async () => {
    await seedOccurrence();
    assert.equal(
      (await parentHttp(`/children/${state.otherStudent._id}/${path}`)).status,
      403,
    );
    await ParentStudentLink.updateOne(
      { _id: parentState.link._id },
      { $set: { status: 'revoked' } },
    );
    assert.equal(
      (await parentHttp(`/children/${state.student._id}/${path}`)).status,
      403,
    );
  });
}
test('foreign enrollment and draft schedules fail closed', async () => {
  await seedOccurrence();
  await TimetableVersion.updateMany({}, { $set: { status: 'draft' } });
  assert.equal(
    (await parentHttp(`/children/${state.student._id}/timetable`)).json.data
      .items.length,
    0,
  );
  await StudentEnrollment.collection.updateOne(
    { _id: state.enrollment._id },
    { $set: { branchId: state.foreign._id } },
  );
  assert.equal(
    (await parentHttp(`/children/${state.student._id}/attendance`)).status,
    403,
  );
});
