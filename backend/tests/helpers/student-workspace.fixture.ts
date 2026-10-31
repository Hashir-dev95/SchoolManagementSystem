import { before, beforeEach, after } from 'node:test';
import type { Server } from 'node:http';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import app from '../../src/app';
import User from '../../src/models/user';
import Branch from '../../src/models/branch';
import Student from '../../src/models/student';
import SchoolClass from '../../src/models/schoolClass';
import Section from '../../src/models/section';
import { AcademicPeriod } from '../../src/models/academicPeriod';
import { StudentEnrollment } from '../../src/models/studentEnrollment';
import { generateAccessToken } from '../../src/services/jwt.service';
import { registerSession } from '../../src/services/session.service';
import { schoolToday } from '../../src/services/school-date.service';

export const oid = () => new mongoose.Types.ObjectId();
export let state: any;
let db: MongoMemoryReplSet, server: Server, base: string;
const oldSecret = process.env.JWT_SECRET;
export async function put(
  model: { collection: { name: string } },
  value: Record<string, unknown>,
) {
  const record = { _id: oid(), ...value };
  await mongoose.connection
    .db!.collection(model.collection.name)
    .insertOne(record);
  return record as any;
}
export async function http(path: string, token = state.token, body?: unknown) {
  return apiHttp('/student/me' + path, token, body);
}
export async function apiHttp(path: string, token: string, body?: unknown) {
  const response = await fetch(base + '/api' + path, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined
      ? {}
      : { method: 'POST', body: JSON.stringify(body) }),
  });
  return { status: response.status, json: (await response.json()) as any };
}
before(async () => {
  process.env.JWT_SECRET = 'student-workspace-isolated-test-secret';
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri(), {
    dbName: 'student_workspace',
    autoIndex: false,
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
beforeEach(async () => {
  for (const collection of await mongoose.connection.db!.collections()) {
    await collection.deleteMany({});
  }
  const branch = await put(Branch, { name: 'Own Branch', isActive: true });
  const foreign = await put(Branch, { name: 'Foreign Branch', isActive: true });
  const user = await User.create({
    fullName: 'Student One',
    email: 'one@test.invalid',
    password: 'private-test',
    role: 'student',
    branchId: branch._id,
  });
  const other = await User.create({
    fullName: 'Student Two',
    email: 'two@test.invalid',
    password: 'private-test',
    role: 'student',
    branchId: branch._id,
  });
  const token = generateAccessToken(String(user._id), 'student');
  await registerSession(String(user._id), token, 'student');
  const period = await put(AcademicPeriod, {
    branchId: branch._id,
    name: 'Current term',
    status: 'active',
  });
  const cls = await put(SchoolClass, {
    branchId: branch._id,
    academicPeriodId: period._id,
    name: 'Grade 8',
    academicYear: '2026-27',
    isActive: true,
  });
  const section = await put(Section, {
    branchId: branch._id,
    classId: cls._id,
    name: 'A',
    isActive: true,
  });
  const student = await put(Student, {
    userId: user._id,
    branchId: branch._id,
    classId: oid(),
    sectionId: oid(),
    admissionNumber: 'SELF-1',
    isActive: true,
  });
  const otherStudent = await put(Student, {
    userId: other._id,
    branchId: branch._id,
    classId: cls._id,
    sectionId: section._id,
    admissionNumber: 'OTHER-2',
    isActive: true,
  });
  const enrollment = await put(StudentEnrollment, {
    studentId: student._id,
    branchId: branch._id,
    academicPeriodId: period._id,
    classId: cls._id,
    sectionId: section._id,
    status: 'active',
    effectiveFrom: new Date(Date.now() - 86400000),
  });
  state = {
    branch,
    foreign,
    user,
    other,
    token,
    period,
    cls,
    section,
    student,
    otherStudent,
    enrollment,
    today: schoolToday(),
  };
});
after(async () => {
  if (server) {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  await mongoose.disconnect();
  if (db) {
    await db.stop();
  }
  if (oldSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = oldSecret;
  }
});
