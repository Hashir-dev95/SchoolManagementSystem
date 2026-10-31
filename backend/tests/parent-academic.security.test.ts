import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  state,
  parentState,
  parentHttp,
  oid,
} from './helpers/parent-workspace.fixture';
import { seedWork, seedResult } from './helpers/parent-domain.fixture';
import { AcademicWorkAudience } from '../src/models/academicWorkAudience';
import { Homework } from '../src/models/homework';
import { AcademicResult } from '../src/models/academicResult';
import { ParentStudentLink } from '../src/models/parentStudentLink';
import Session from '../src/models/session';

test('verified Parent reads published child homework and quiz metadata without answers', async () => {
  await seedWork();
  await seedWork('quiz');
  for (const pane of ['homework', 'quizzes']) {
    const r = await parentHttp(`/children/${state.student._id}/${pane}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.data.items.length, 1);
    assert.equal(r.json.data.readOnly, true);
    assert.equal(JSON.stringify(r.json).includes('correctBoolean'), false);
  }
});
test('unauthorized audience and draft homework are excluded', async () => {
  const { row, audience } = await seedWork();
  await AcademicWorkAudience.collection.updateOne(
    { _id: audience._id },
    { $set: { studentId: state.otherStudent._id } },
  );
  assert.equal(
    (await parentHttp(`/children/${state.student._id}/homework`)).json.data
      .items.length,
    0,
  );
  await AcademicWorkAudience.collection.updateOne(
    { _id: audience._id },
    { $set: { studentId: state.student._id } },
  );
  await Homework.updateOne({ _id: row._id }, { $set: { status: 'draft' } });
  assert.equal(
    (await parentHttp(`/children/${state.student._id}/homework`)).json.data
      .items.length,
    0,
  );
});
test('audience revision mismatch excludes work and cannot select another child', async () => {
  const { audience } = await seedWork();
  await AcademicWorkAudience.collection.updateOne(
    { _id: audience._id },
    { $set: { publishedRevision: 2 } },
  );
  assert.equal(
    (await parentHttp(`/children/${state.student._id}/homework`)).json.data
      .items.length,
    0,
  );
  assert.equal(
    (await parentHttp(`/children/${state.otherStudent._id}/homework`)).status,
    403,
  );
});
test('Parent result reads preserve the real Parent session and expose only safe published fields', async () => {
  await seedResult();
  await Session.deleteMany({ userId: state.user._id });
  const r = await parentHttp(`/children/${state.student._id}/results`);
  assert.equal(r.status, 200);
  assert.equal(r.json.data.total, 1);
  assert.equal(r.json.data.items[0].awardedMarks, 8);
  const body = JSON.stringify(r.json);
  assert.equal(body.includes('Teacher private note'), false);
  assert.equal(body.includes('Private moderation'), false);
  assert.equal(
    (await Session.findOne({ token: parentState.token }))!.role,
    'parent',
  );
});
for (const status of [
  'draft',
  'submitted_for_moderation',
  'moderated_approved',
  'resubmitted_for_moderation',
]) {
  test(`${status} result is never Parent-visible`, async () => {
    const row = await seedResult(status);
    assert.equal(
      (await parentHttp(`/children/${state.student._id}/results`)).json.data
        .total,
      0,
    );
    assert.equal(
      (await parentHttp(`/children/${state.student._id}/results/${row._id}`))
        .status,
      403,
    );
  });
}
test('published revision mismatch or missing metadata never exposes a Parent result', async () => {
  const row = await seedResult();
  await AcademicResult.collection.updateOne(
    { _id: row._id },
    { $set: { publishedRevision: 2 } },
  );
  assert.equal(
    (await parentHttp(`/children/${state.student._id}/results`)).json.data
      .total,
    0,
  );
  await AcademicResult.collection.updateOne(
    { _id: row._id },
    { $set: { publishedRevision: null } },
  );
  assert.equal(
    (await parentHttp(`/children/${state.student._id}/results`)).json.data
      .total,
    0,
  );
});
test('another Student published result cannot leak through own child route', async () => {
  const row = await seedResult();
  await AcademicResult.collection.updateOne(
    { _id: row._id },
    {
      $set: {
        studentId: state.otherStudent._id,
        recipientUserId: state.other._id,
      },
    },
  );
  assert.equal(
    (await parentHttp(`/children/${state.student._id}/results`)).json.data
      .total,
    0,
  );
  assert.equal(
    (await parentHttp(`/children/${state.otherStudent._id}/results`)).status,
    403,
  );
});
test('all academic panes revalidate revoked relationships', async () => {
  await seedWork();
  await seedResult();
  await ParentStudentLink.updateOne(
    { _id: parentState.link._id },
    { $set: { isActive: false } },
  );
  for (const pane of ['homework', 'quizzes', 'results']) {
    assert.equal(
      (await parentHttp(`/children/${state.student._id}/${pane}`)).status,
      403,
    );
  }
});
test('Parent cannot self-link, submit work, attempt quizzes or select scope with a body', async () => {
  assert.equal(
    (
      await parentHttp('/children', parentState.token, {
        studentId: String(oid()),
        status: 'verified',
      })
    ).status,
    403,
  );
  for (const pane of ['homework', 'quizzes']) {
    assert.equal(
      (
        await parentHttp(
          `/children/${state.student._id}/${pane}`,
          parentState.token,
          { answers: [] },
        )
      ).status,
      403,
    );
  }
});
