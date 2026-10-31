import assert from 'node:assert/strict';
import { test } from 'node:test';
import { state, http, oid, put } from './helpers/student-workspace.fixture';
import { Homework } from '../src/models/homework';
import { Quiz } from '../src/models/quiz';
import { AcademicWorkAudience } from '../src/models/academicWorkAudience';
import { AcademicResult } from '../src/models/academicResult';
import { StudentEnrollment } from '../src/models/studentEnrollment';
import Subject from '../src/models/subject';

async function assigned(type: 'homework' | 'quiz' = 'homework') {
  const row = await put(type === 'homework' ? Homework : Quiz, {
    branchId: state.branch._id,
    classId: state.cls._id,
    sectionId: state.section._id,
    subjectId: oid(),
    academicYear: state.cls.academicYear,
    lessonPlanId: oid(),
    topicIds: [],
    title: 'Published assignment',
    instructions: 'Read these instructions',
    status: 'published',
    revision: 1,
    publishedRevision: 1,
    dueAt: state.today,
    availableFrom: state.today,
    availableUntil: state.today,
    questions: [
      {
        questionId: 'q1',
        type: 'true_false',
        text: 'Safe prompt',
        options: [],
        correctBoolean: true,
      },
    ],
  });
  const entitlement = await put(AcademicWorkAudience, {
    branchId: state.branch._id,
    workType: type,
    workId: row._id,
    studentId: state.student._id,
    recipientUserId: state.user._id,
    state: 'assigned',
    publishedRevision: 1,
  });
  return { row, entitlement };
}
async function result(status = 'published') {
  const subject = await put(Subject, {
    branchId: state.branch._id,
    name: 'Mathematics',
  });
  return put(AcademicResult, {
    branchId: state.branch._id,
    classId: state.cls._id,
    sectionId: state.section._id,
    subjectId: subject._id,
    studentId: state.student._id,
    recipientUserId: state.user._id,
    status,
    publishedAt: new Date(),
    publishedRevision: 1,
    currentRevision: 1,
    assessmentTitle: 'Published assessment',
    assessmentSourceType: 'homework_submission',
    sourcePublishedRevision: 1,
    revisions: [
      {
        revision: 1,
        awardedMarks: 8,
        maxMarks: 10,
        teacherPrivateNote: 'DO NOT LEAK',
      },
    ],
  });
}
test('own assigned published homework is read-only and another assignment is denied', async () => {
  const { row } = await assigned();
  const r = await http('/homework');
  assert.equal(r.status, 200);
  assert.equal(r.json.data.readOnly, true);
  assert.equal(r.json.data.items[0].id, String(row._id));
  assert.equal((await http('/homework/' + oid())).status, 403);
});
test('own current published quiz metadata does not expose answers or write capabilities', async () => {
  await assigned('quiz');
  const r = await http('/quizzes');
  assert.equal(r.status, 200);
  assert.equal(r.json.data.items.length, 1);
  assert.equal(JSON.stringify(r.json).includes('correctBoolean'), false);
});
test('foreign Student audience, scope and revision corruption are excluded', async () => {
  const { row, entitlement } = await assigned();
  await AcademicWorkAudience.collection.updateOne(
    { _id: entitlement._id },
    { $set: { studentId: state.otherStudent._id } },
  );
  assert.equal((await http('/homework/' + row._id)).status, 403);
  await AcademicWorkAudience.collection.updateOne(
    { _id: entitlement._id },
    { $set: { studentId: state.student._id, publishedRevision: 2 } },
  );
  assert.equal((await http('/homework')).json.data.items.length, 0);
  await AcademicWorkAudience.collection.updateOne(
    { _id: entitlement._id },
    { $set: { publishedRevision: 1 } },
  );
  await Homework.collection.updateOne(
    { _id: row._id },
    { $set: { sectionId: oid() } },
  );
  assert.equal((await http('/homework')).json.data.items.length, 0);
});
test('draft homework is not visible even with a forged audience entitlement', async () => {
  const { row } = await assigned();
  await Homework.updateOne({ _id: row._id }, { $set: { status: 'draft' } });
  assert.equal((await http('/homework/' + row._id)).status, 403);
});
test('own published results use the canonical safe DTO and conceal private review data', async () => {
  const row = await result();
  const r = await http('/results');
  assert.equal(r.status, 200);
  assert.equal(r.json.data.items[0].awardedMarks, 8);
  assert.equal(JSON.stringify(r.json).includes('DO NOT LEAK'), false);
  assert.equal((await http('/results/' + row._id)).status, 200);
});
for (const status of [
  'draft',
  'submitted_for_moderation',
  'moderated_approved',
]) {
  test(`${status} results cannot be listed or read by guessed ID`, async () => {
    const row = await result(status);
    assert.equal((await http('/results')).json.data.total, 0);
    assert.equal((await http('/results/' + row._id)).status, 403);
  });
}
test('another Student published result and mismatched published revision are denied', async () => {
  const row = await result();
  await AcademicResult.collection.updateOne(
    { _id: row._id },
    {
      $set: {
        studentId: state.otherStudent._id,
        recipientUserId: state.other._id,
      },
    },
  );
  assert.equal((await http('/results/' + row._id)).status, 403);
  await AcademicResult.collection.updateOne(
    { _id: row._id },
    {
      $set: {
        studentId: state.student._id,
        recipientUserId: state.user._id,
        publishedRevision: 2,
      },
    },
  );
  assert.equal((await http('/results/' + row._id)).status, 403);
});
test('missing enrollment closes all workspace academic reads', async () => {
  await assigned();
  await result();
  await StudentEnrollment.deleteMany({});
  for (const path of ['/homework', '/quizzes', '/results']) {
    assert.equal((await http(path)).status, 403);
  }
});
test('Student and foreign school/branch selectors are denied on academic reads', async () => {
  for (const key of ['studentId', 'schoolId', 'branchId']) {
    assert.equal(
      (await http('/results?' + key + '=' + state.otherStudent._id)).status,
      403,
    );
  }
});
