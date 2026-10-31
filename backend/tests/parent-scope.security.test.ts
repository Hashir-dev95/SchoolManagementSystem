import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  state,
  parentState,
  parentHttp,
  oid,
} from './helpers/parent-workspace.fixture';
import { ParentStudentLink } from '../src/models/parentStudentLink';
import { StudentEnrollment } from '../src/models/studentEnrollment';
import User from '../src/models/user';
import Student from '../src/models/student';
import Section from '../src/models/section';

test('Parent self identity and verified child summary preserve enrollment Branch context', async () => {
  assert.equal((await parentHttp('')).json.data.fullName, 'Parent One');
  const r = await parentHttp('/children');
  assert.equal(r.status, 200);
  assert.equal(r.json.data.items.length, 1);
  const child = r.json.data.items[0];
  assert.equal(child.studentId, String(state.student._id));
  assert.equal(child.enrollment.branch.id, String(state.branch._id));
  assert.equal(child.enrollment.schoolClass.name, 'Grade 8');
  assert.equal(child.relationship, 'guardian');
  assert.equal(JSON.stringify(child).includes('password'), false);
});
test('Parent can select each independently verified child', async () => {
  await ParentStudentLink.create({
    parentUserId: parentState.parent._id,
    studentId: state.otherStudent._id,
    branchId: state.branch._id,
    relationship: 'mother',
    status: 'verified',
    isActive: true,
    createdBy: parentState.verifier._id,
    verifiedBy: parentState.verifier._id,
    verifiedAt: new Date(),
  });
  assert.equal((await parentHttp('/children')).json.data.items.length, 2);
  assert.equal(
    (await parentHttp(`/children/${state.otherStudent._id}`)).json.data
      .fullName,
    'Student Two',
  );
  assert.equal(
    (await parentHttp(`/children/${state.student._id}/enrollment`)).json.data
      .section.name,
    'A',
  );
});
test('another Parent child and valid foreign ObjectId are forbidden', async () => {
  assert.equal(
    (await parentHttp(`/children/${state.otherStudent._id}`)).status,
    403,
  );
  assert.equal((await parentHttp(`/children/${oid()}`)).status, 403);
});
for (const change of [
  { status: 'pending' },
  { status: 'revoked' },
  { isActive: false },
  { verifiedBy: null },
  { verifiedAt: null },
  { createdBy: null },
]) {
  test(`unverified/inactive/revoked relationship fails closed ${JSON.stringify(
    change,
  )}`, async () => {
    await ParentStudentLink.collection.updateOne(
      { _id: parentState.link._id },
      { $set: change },
    );
    assert.equal(
      (await parentHttp(`/children/${state.student._id}`)).status,
      403,
    );
    assert.equal((await parentHttp('/children')).json.data.items.length, 0);
  });
}
test('Parent cannot self-verify or rely on a non-administrative verifier', async () => {
  await ParentStudentLink.collection.updateOne(
    { _id: parentState.link._id },
    { $set: { verifiedBy: parentState.parent._id } },
  );
  assert.equal(
    (await parentHttp(`/children/${state.student._id}`)).status,
    403,
  );
  await ParentStudentLink.collection.updateOne(
    { _id: parentState.link._id },
    { $set: { verifiedBy: state.other._id } },
  );
  assert.equal(
    (await parentHttp(`/children/${state.student._id}`)).status,
    403,
  );
});
test('inactive Parent retains canonical 401 semantics; Student cannot use Parent routes', async () => {
  assert.equal((await parentHttp('/children', state.token)).status, 403);
  await User.updateOne(
    { _id: parentState.parent._id },
    { $set: { isActive: false } },
  );
  assert.equal((await parentHttp('/children')).status, 401);
});
test('link and child Branch mismatches are denied', async () => {
  await ParentStudentLink.collection.updateOne(
    { _id: parentState.link._id },
    { $set: { branchId: state.foreign._id } },
  );
  assert.equal(
    (await parentHttp(`/children/${state.student._id}`)).status,
    403,
  );
  await ParentStudentLink.collection.updateOne(
    { _id: parentState.link._id },
    { $set: { branchId: state.branch._id } },
  );
  await Student.collection.updateOne(
    { _id: state.student._id },
    { $set: { branchId: state.foreign._id } },
  );
  assert.equal(
    (await parentHttp(`/children/${state.student._id}`)).status,
    403,
  );
});
test('missing enrollment and inconsistent Section never fall back to child profile', async () => {
  await Section.updateOne(
    { _id: state.section._id },
    { $set: { classId: oid() } },
  );
  assert.equal(
    (await parentHttp(`/children/${state.student._id}/enrollment`)).status,
    403,
  );
  await Section.updateOne(
    { _id: state.section._id },
    { $set: { classId: state.cls._id } },
  );
  await StudentEnrollment.deleteMany({ studentId: state.student._id });
  assert.equal(
    (await parentHttp(`/children/${state.student._id}`)).status,
    403,
  );
});
test('query-selected child or verification metadata grants no relationship', async () => {
  assert.equal(
    (
      await parentHttp(
        `/children/${state.student._id}?studentId=${state.otherStudent._id}`,
      )
    ).status,
    403,
  );
});
