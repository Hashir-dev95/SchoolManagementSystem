import assert from 'node:assert/strict';
import { test } from 'node:test';
import { state, http, oid, put } from './helpers/student-workspace.fixture';
import User from '../src/models/user';
import Branch from '../src/models/branch';
import { StudentEnrollment } from '../src/models/studentEnrollment';
import Section from '../src/models/section';
import { getStudentSelf } from '../src/services/student-self-scope.service';

test('ID-based aliases and body-selected identities are forbidden', async () => {
  assert.equal((await http(`/${state.otherStudent._id}`)).status, 403);
  assert.equal(
    (await http('', state.token, { studentId: String(state.otherStudent._id) }))
      .status,
    403,
  );
});

test('Student reads only own identity with no credential leakage', async () => {
  const r = await http('');
  assert.equal(r.status, 200);
  assert.equal(r.json.data.studentId, String(state.student._id));
  assert.equal(r.json.data.fullName, 'Student One');
  assert.equal(JSON.stringify(r.json).includes('password'), false);
});
test('enrollment authority ignores stale profile placement', async () => {
  const r = await http('/enrollment');
  assert.equal(r.status, 200);
  assert.equal(r.json.data.schoolClass.id, String(state.cls._id));
  assert.equal(r.json.data.section.id, String(state.section._id));
  assert.equal(r.json.data.academicPeriod.name, 'Current term');
});
for (const field of [
  'studentId',
  'userId',
  'branchId',
  'classId',
  'sectionId',
  'schoolId',
]) {
  test(`${field} selection cannot grant access to another Student or scope`, async () => {
    assert.equal(
      (await http(`?${field}=${state.otherStudent._id}`)).status,
      403,
    );
  });
}
test('unauthenticated request is denied', async () => {
  assert.equal((await http('', '')).status, 401);
});
test('inactive persisted account is denied even with a valid token', async () => {
  await User.updateOne({ _id: state.user._id }, { $set: { isActive: false } });
  assert.equal((await http('')).status, 401);
});
test('changed persisted role cannot retain Student authority', async () => {
  await User.updateOne({ _id: state.user._id }, { $set: { role: 'teacher' } });
  assert.equal((await http('')).status, 401);
});
test('missing enrollment fails closed without profile fallback', async () => {
  await StudentEnrollment.deleteMany({});
  assert.equal((await http('')).status, 403);
});
test('foreign branch enrollment is forbidden', async () => {
  await StudentEnrollment.collection.updateOne(
    { _id: state.enrollment._id },
    { $set: { branchId: state.foreign._id } },
  );
  assert.equal((await http('/enrollment')).status, 403);
});
test('inactive branch and mismatched Section are forbidden', async () => {
  await Branch.updateOne(
    { _id: state.branch._id },
    { $set: { isActive: false } },
  );
  assert.equal((await http('')).status, 403);
  await Branch.updateOne(
    { _id: state.branch._id },
    { $set: { isActive: true } },
  );
  await Section.updateOne(
    { _id: state.section._id },
    { $set: { classId: oid() } },
  );
  assert.equal((await http('')).status, 403);
});
test('ambiguous or future memberships fail closed', async () => {
  await put(StudentEnrollment, { ...state.enrollment, _id: oid() });
  assert.equal((await http('')).status, 403);
  await StudentEnrollment.deleteMany({ _id: { $ne: state.enrollment._id } });
  await StudentEnrollment.collection.updateOne(
    { _id: state.enrollment._id },
    { $set: { effectiveFrom: new Date(Date.now() + 86400000) } },
  );
  assert.equal((await http('')).status, 403);
});
test('direct service role tampering is rejected against persisted User', async () => {
  await assert.rejects(
    getStudentSelf({ userId: String(state.user._id), role: 'teacher' }),
    { status: 401 },
  );
});
