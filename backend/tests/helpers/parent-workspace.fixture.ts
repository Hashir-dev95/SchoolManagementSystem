import { beforeEach } from 'node:test';
import { state, put, oid, apiHttp } from './student-workspace.fixture';
import User from '../../src/models/user';
import { ParentStudentLink } from '../../src/models/parentStudentLink';
import { StudentEnrollment } from '../../src/models/studentEnrollment';
import { generateAccessToken } from '../../src/services/jwt.service';
import { registerSession } from '../../src/services/session.service';

export { state, put, oid };
export let parentState: any;
export const parentHttp = (
  path: string,
  token = parentState.token,
  body?: unknown,
) => apiHttp('/parent/me' + path, token, body);
beforeEach(async () => {
  const parent = await User.create({
    fullName: 'Parent One',
    email: 'parent@test.invalid',
    password: 'test-private',
    role: 'parent',
    branchId: state.branch._id,
  });
  const otherParent = await User.create({
    fullName: 'Parent Two',
    email: 'other-parent@test.invalid',
    password: 'test-private',
    role: 'parent',
    branchId: state.branch._id,
  });
  const verifier = await put(User, {
    fullName: 'Principal',
    role: 'principal',
    branchId: state.branch._id,
    isActive: true,
  });
  const token = generateAccessToken(String(parent._id), 'parent');
  await registerSession(String(parent._id), token, 'parent');
  const link = await ParentStudentLink.create({
    parentUserId: parent._id,
    studentId: state.student._id,
    branchId: state.branch._id,
    relationship: 'guardian',
    status: 'verified',
    isActive: true,
    createdBy: verifier._id,
    verifiedBy: verifier._id,
    verifiedAt: new Date(),
  });
  await put(StudentEnrollment, {
    studentId: state.otherStudent._id,
    branchId: state.branch._id,
    academicPeriodId: state.period._id,
    classId: state.cls._id,
    sectionId: state.section._id,
    status: 'active',
    effectiveFrom: new Date(Date.now() - 86400000),
  });
  parentState = { parent, otherParent, verifier, token, link };
});
