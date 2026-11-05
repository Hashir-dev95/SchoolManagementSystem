import Student from '../models/student';
import type { ClientSession } from 'mongoose';
import User from '../models/user';
import { ParentStudentLink } from '../models/parentStudentLink';
import {
  currentAcademicActor,
  requireActiveAcademicBranch,
} from './teacher-scope.service';
import {
  resolveStudentReadScope,
  studentEnrollmentDTO,
  studentProfileDTO,
} from './student-self-scope.service';
import type { JwtPayload } from './jwt.service';
import {
  RequestContractError,
  objectIdField,
} from '../utils/request-validation';

const denied = () =>
  new RequestContractError(403, 'Verified child access is unavailable');
export async function parentActor(identity: JwtPayload | undefined) {
  const actor = await currentAcademicActor(identity);
  if (actor.role !== 'parent') {
    throw denied();
  }
  const branchId = await requireActiveAcademicBranch(
    actor.branchId?.toString(),
  );
  return { actor, branchId };
}
const verified = () => ({
  status: 'verified' as const,
  isActive: true,
  verifiedAt: { $type: 'date' as const, $lte: new Date() },
  verifiedBy: { $type: 'objectId' as const },
  createdBy: { $type: 'objectId' as const },
});
export async function verifiedChild(
  identity: JwtPayload | undefined,
  childId: unknown,
) {
  const parent = await parentActor(identity);
  return resolveVerifiedParentChild(parent, childId);
}

/** Internal subject proof for callers that have independently authorized the reader. */
export async function resolveVerifiedParentChild(
  parent: Awaited<ReturnType<typeof parentActor>>,
  childId: unknown,
  session?: ClientSession,
) {
  let id: string;
  try {
    id = objectIdField(childId, 'child ID');
  } catch {
    throw denied();
  }
  const links = await ParentStudentLink.find({
    ...verified(),
    parentUserId: parent.actor._id,
    studentId: id,
    branchId: parent.branchId,
  })
    .limit(2)
    .session(session ?? null)
    .read('primary')
    .lean();
  if (
    links.length !== 1 ||
    String(links[0].verifiedBy) === String(parent.actor._id) ||
    links[0].revokedAt
  ) {
    throw denied();
  }
  const verifier = await User.findOne({
    role: { $in: ['principal', 'super_admin'] },
    isActive: true,
  })
    .where('_id')
    .equals(links[0].verifiedBy)
    .select('role branchId')
    .session(session ?? null)
    .read('primary')
    .lean();
  if (
    !verifier ||
    (verifier.role === 'principal'
      ? String(verifier.branchId) !== parent.branchId
      : !!verifier.branchId)
  ) {
    throw denied();
  }
  const student = await Student.findOne({ isActive: true })
    .where('_id')
    .equals(id)
    .where('branchId')
    .equals(parent.branchId)
    .select('userId')
    .session(session ?? null)
    .read('primary')
    .lean();
  if (!student) {
    throw denied();
  }
  const scope = await resolveStudentReadScope(
    String(student.userId),
    parent.branchId,
    session,
  );
  if (String(scope.student._id) !== id) {
    throw denied();
  }
  return { parent, link: links[0], scope };
}
export async function getParentChildren(identity: JwtPayload | undefined) {
  const parent = await parentActor(identity);
  const links = await ParentStudentLink.find({
    ...verified(),
    parentUserId: parent.actor._id,
    branchId: parent.branchId,
  })
    .sort({ studentId: 1 })
    .limit(101)
    .select('studentId')
    .read('primary')
    .lean();
  if (links.length > 100) {
    throw new RequestContractError(
      409,
      'Child list requires administrator review',
    );
  }
  const items = [];
  for (const link of links) {
    try {
      items.push(await getParentChild(identity, String(link.studentId)));
    } catch (error) {
      if (!(error instanceof RequestContractError && error.status === 403)) {
        throw error;
      }
    }
  }
  return { items };
}
export async function getParentChild(
  identity: JwtPayload | undefined,
  childId: unknown,
) {
  const { scope, link } = await verifiedChild(identity, childId);
  return {
    ...studentProfileDTO(scope),
    relationship: link.relationship,
    enrollment: studentEnrollmentDTO(scope),
  };
}
