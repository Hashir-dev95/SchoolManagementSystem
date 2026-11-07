import mongoose, { Types, type ClientSession } from 'mongoose';
import { createHash } from 'node:crypto';
import { PERMISSIONS } from '../constants/permissions';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import ApprovalRequest, {
  PARENT_LEAVE_APPROVAL_ENTITY,
  type IApprovalRequest,
} from '../models/approvalRequest';
import { ParentLeaveApplication } from '../models/parentLeaveApplication';
import Session from '../models/session';
import Student from '../models/student';
import User from '../models/user';
import SchoolClass from '../models/schoolClass';
import Section from '../models/section';
import { AcademicPeriod } from '../models/academicPeriod';
import { StudentEnrollment } from '../models/studentEnrollment';
import { ParentStudentLink } from '../models/parentStudentLink';
import { ParentLeaveDecisionOperation } from '../models/parentLeaveDecisionOperation';
import {
  enumField,
  objectBody,
  RequestContractError,
  textField,
} from '../utils/request-validation';
import {
  ApprovalAccessError,
  assertApprovalAuthority,
} from './approval-authority.policy';
import { verifyAccessToken } from './jwt.service';
import {
  assertParentLeaveRevision,
  validateParentLeaveTransition,
} from './parent-leave-application.policy';
import {
  matchesParentLeaveReview,
  parentLeaveHistory,
  parentLeavePriorCycles,
} from './parent-leave-review-history';
import {
  assertCoverageRange,
  assertNoTeacherLeaveOverlap,
  createParentLeaveCoverage,
} from './attendance-parent-leave.service';
import { withAcademicCatalogLock } from './academic-catalog-lock.service';
import { communicationFence } from './teacher-communication-access.service';
import { readParentLeaveRouting } from './parent-leave-routing.policy';
import { resolveVerifiedParentChild } from './parent-scope.service';
import {
  currentAcademicActor,
  requireActiveAcademicBranch,
} from './teacher-scope.service';

type ReviewReader = { actorId: string; branchId: string; token: string };
type Routing = ReturnType<typeof readParentLeaveRouting>;

const unavailable = () =>
  new ApprovalAccessError(404, 'Parent leave review is unavailable');
const invalidSession = () =>
  new ApprovalAccessError(401, 'Session is unavailable');
const conflict = () =>
  new RequestContractError(
    409,
    'Leave request changed; refresh and review again',
  );
const decisionState = (action: 'approve' | 'reject' | 'request_changes') =>
  action === 'approve'
    ? 'approved'
    : action === 'reject'
    ? 'rejected'
    : 'changes_requested';
const canManage = () =>
  ROLE_PERMISSIONS.principal.includes(PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE);
const requireManage = () => {
  if (!canManage())
    throw new ApprovalAccessError(
      403,
      'Principal leave decisions are unavailable',
    );
};

function routingFor(reader: ReviewReader) {
  try {
    assertApprovalAuthority(reader.actorId, reader.branchId, {
      approvalType: 'leave',
    });
    return readParentLeaveRouting(reader.branchId);
  } catch (error) {
    if (
      error instanceof ApprovalAccessError ||
      error instanceof RequestContractError
    )
      return null;
    throw error;
  }
}

function principalIdentity(reader: ReviewReader) {
  let identity;
  try {
    identity = verifyAccessToken(reader.token);
  } catch {
    throw invalidSession();
  }
  if (identity.userId !== reader.actorId || identity.role !== 'principal')
    throw invalidSession();
  return identity;
}

async function assertReader(reader: ReviewReader, session?: ClientSession) {
  const identity = principalIdentity(reader);
  const login = await Session.findOne({ token: reader.token })
    .select('isRevoked userId role')
    .session(session ?? null)
    .read('primary')
    .lean();
  if (
    !login ||
    login.isRevoked ||
    String(login.userId) !== reader.actorId ||
    login.role !== 'principal'
  ) {
    throw invalidSession();
  }
  const actor = await currentAcademicActor(identity, session);
  if (
    String(actor.branchId) !== reader.branchId ||
    !ROLE_PERMISSIONS.principal.includes(PERMISSIONS.PRINCIPAL_APPROVALS_VIEW)
  ) {
    throw new ApprovalAccessError(
      403,
      'Principal approval visibility is unavailable',
    );
  }
  await requireActiveAcademicBranch(reader.branchId, session);
  return login._id;
}

const parentApprovals = (reader: ReviewReader) => ({
  branchId: reader.branchId,
  entityType: PARENT_LEAVE_APPROVAL_ENTITY,
  approvalType: 'leave' as const,
  requesterId: { $ne: reader.actorId },
});

// The inbox and count are pending-only. Detail also uses the same proof for
// decided records. Configuration must match the submitted version exactly.
async function readPendingReviews(
  reader: ReviewReader,
  approvalId?: Types.ObjectId,
) {
  const session = await mongoose.startSession();
  try {
    const result = await session.withTransaction(
      async () => {
        await assertReader(reader, session);
        const routing = routingFor(reader);
        const visible = [];
        if (routing) {
          const approvals = await ApprovalRequest.find({
            ...parentApprovals(reader),
            ...(approvalId
              ? {
                  _id: approvalId,
                  status: {
                    $in: [
                      'pending',
                      'approved',
                      'rejected',
                      'changes_requested',
                    ],
                  },
                }
              : { status: 'pending' }),
          })
            .sort({ createdAt: -1, _id: -1 })
            .session(session)
            .lean();
          for (const approval of approvals) {
            const proof = await linkedReview(
              reader.branchId,
              routing,
              approval,
              session,
            );
            if (!proof) continue;
            const { application, subject, submittedAt } = proof;
            const summary = {
              approvalId: String(approval._id),
              source: PARENT_LEAVE_APPROVAL_ENTITY,
              studentName: subject.scope.user.fullName,
              startDate: application.startDate,
              endDate: application.endDate,
              status: application.state,
              submittedAt,
            };
            const detail = approvalId
              ? {
                  ...summary,
                  leaveType: application.leaveType,
                  reason: application.reason,
                  decisionVersion:
                    application.state === 'pending' &&
                    canManage() &&
                    Number.isSafeInteger(approval.__v)
                      ? {
                          applicationRevision: application.revision,
                          approvalVersion: approval.__v!,
                        }
                      : null,
                  history: parentLeaveHistory(application),
                  ...(application.priorSubmissions?.length
                    ? { priorCycles: parentLeavePriorCycles(application) }
                    : {}),
                }
              : undefined;
            visible.push({ summary, detail });
          }
        }
        return { visible, routing };
      },
      { readPreference: 'primary', readConcern: { level: 'snapshot' } },
    );

    // Recheck the reader after the snapshot so a concurrent session or reviewer
    // revocation during a queue scan cannot release its result.
    await assertReader(reader);
    const current = routingFor(reader);
    if (!canManage()) {
      for (const item of result.visible)
        if (item.detail) item.detail.decisionVersion = null;
    }
    return current &&
      result.routing &&
      current.version === result.routing.version
      ? result.visible
      : [];
  } finally {
    await session.endSession();
  }
}

async function linkedReview(
  branchId: string,
  routing: Routing,
  approval: IApprovalRequest & { _id: Types.ObjectId },
  session: ClientSession,
) {
  const submittedRevision = approval.parentLeaveRevision;
  const { status } = approval;
  const pending = status === 'pending';
  if (
    !approval.entityId ||
    !submittedRevision ||
    !Number.isSafeInteger(submittedRevision) ||
    submittedRevision < 1
  )
    return null;

  const application = await ParentLeaveApplication.findOne({
    _id: approval.entityId,
    approvalRequestId: approval._id,
    requesterId: approval.requesterId,
    branchId,
    state: status,
    revision: pending ? submittedRevision : submittedRevision + 1,
    'submission.revision': submittedRevision,
    'submission.policy': routing.policy,
    'submission.version': routing.version,
  })
    .select('+submission +reason +priorSubmissions')
    .session(session);
  if (!application || !(await matchesParentLeaveReview(application, approval)))
    return null;
  const submitted = application.history[submittedRevision];

  const actor = await User.findOne({
    _id: application.requesterId,
    role: 'parent',
    isActive: true,
  })
    .where('branchId')
    .equals(branchId)
    .select('_id role branchId isActive')
    .session(session)
    .lean();
  if (!actor) return null;
  try {
    const subject = await resolveVerifiedParentChild(
      { actor, branchId },
      String(application.studentId),
      session,
    );
    const { link, scope } = subject;
    const { enrollment } = scope;
    if (
      String(link._id) !== String(application.parentStudentLinkId) ||
      String(enrollment._id) !== String(application.enrollmentId) ||
      String(enrollment.academicPeriodId) !==
        String(application.academicPeriodId) ||
      String(enrollment.classId) !== String(application.classId) ||
      String(enrollment.sectionId) !== String(application.sectionId)
    )
      return null;

    return {
      application,
      subject,
      submittedAt: submitted.at.toISOString(),
      submittedRevision,
    };
  } catch (error) {
    if (error instanceof RequestContractError && error.status === 403)
      return null;
    throw error;
  }
}

export async function listParentLeaveReviews(reader: ReviewReader) {
  return (await readPendingReviews(reader)).map(review => review.summary);
}

export async function getParentLeaveReview(
  reader: ReviewReader,
  approvalId: string,
) {
  if (!Types.ObjectId.isValid(approvalId)) throw unavailable();
  const [review] = await readPendingReviews(
    reader,
    new Types.ObjectId(approvalId),
  );
  if (!review?.detail) throw unavailable();
  return review.detail;
}

export async function decideParentLeave(
  reader: ReviewReader,
  approvalId: string,
  raw: unknown,
) {
  if (!Types.ObjectId.isValid(approvalId)) throw unavailable();
  const body = objectBody(raw, [
    'action',
    'applicationRevision',
    'approvalVersion',
    'clientOperationId',
    'decisionReason',
  ]);
  const action = enumField(body.action, 'decision', [
    'approve',
    'reject',
    'request_changes',
  ] as const);
  const decisionReason =
    action !== 'approve'
      ? textField(
          typeof body.decisionReason === 'string'
            ? body.decisionReason.normalize('NFC')
            : body.decisionReason,
          action === 'reject' ? 'rejection reason' : 'requested changes',
          500,
          10,
        )
      : undefined;
  if (action === 'approve' && body.decisionReason !== undefined)
    throw new RequestContractError(
      400,
      'A reason is supported for rejection or requested changes only',
    );
  assertParentLeaveRevision(body.applicationRevision, body.applicationRevision);
  assertParentLeaveRevision(body.approvalVersion, body.approvalVersion);
  const clientOperationId = textField(
    body.clientOperationId,
    'operation ID',
    120,
    1,
  );
  const id = new Types.ObjectId(approvalId);

  return withAcademicCatalogLock(reader.branchId, async session => {
    const loginId = await assertReader(reader, session);
    requireManage();
    const routing = routingFor(reader);
    if (!routing) throw unavailable();
    const approval = await ApprovalRequest.findOne({
      ...parentApprovals(reader),
      _id: id,
    })
      .session(session)
      .lean();
    const proof =
      approval &&
      (await linkedReview(reader.branchId, routing, approval, session));
    if (!approval || !proof) throw unavailable();
    const { application, subject, submittedRevision } = proof;
    const { link, scope } = subject;

    await communicationFence(session, Session.collection.name, String(loginId));
    const users = new Set([
      reader.actorId,
      String(application.requesterId),
      String(link.verifiedBy),
      String(scope.actor._id),
    ]);
    for (const userId of [...users].sort())
      await communicationFence(session, User.collection.name, userId);
    for (const [collection, objectId] of [
      [Student.collection.name, application.studentId],
      [ParentStudentLink.collection.name, application.parentStudentLinkId],
      [StudentEnrollment.collection.name, application.enrollmentId],
      [AcademicPeriod.collection.name, application.academicPeriodId],
      [SchoolClass.collection.name, application.classId],
      [Section.collection.name, application.sectionId],
    ] as const)
      await communicationFence(session, collection, String(objectId));

    const finish = async () => {
      if (String(await assertReader(reader, session)) !== String(loginId))
        throw invalidSession();
      requireManage();
      const current = routingFor(reader);
      if (
        !current ||
        current.policy !== routing.policy ||
        current.version !== routing.version
      )
        throw unavailable();
    };
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          'parent_leave_decision_v1',
          String(id),
          String(application._id),
          action,
          body.applicationRevision,
          body.approvalVersion,
          decisionReason,
        ]),
      )
      .digest('hex');
    const key = { reviewerId: reader.actorId, clientOperationId };
    const existing = await ParentLeaveDecisionOperation.findOne(key)
      .select('+fingerprint')
      .session(session)
      .lean();
    if (existing) {
      if (
        existing.fingerprint !== fingerprint ||
        String(existing.branchId) !== reader.branchId
      )
        throw conflict();
      await finish();
      return {
        approvalId: String(existing.approvalId),
        state: decisionState(existing.action),
        revision: existing.applicationRevision + 1,
        decidedAt: existing.decidedAt,
        replayed: true,
      } as const;
    }

    if (
      approval.status !== 'pending' ||
      application.state !== 'pending' ||
      approval.__v !== body.approvalVersion ||
      !Number.isSafeInteger(approval.__v) ||
      approval.__v! >= Number.MAX_SAFE_INTEGER
    )
      throw conflict();
    const state = decisionState(action);
    const { revision } = validateParentLeaveTransition({
      from: 'pending',
      to: state,
      capability: 'current_domain_reviewer',
      revision: application.revision,
      expectedRevision: body.applicationRevision,
      decisionReason,
    });
    if (action !== 'request_changes') {
      await assertCoverageRange(
        application,
        scope.enrollment,
        scope.period,
        session,
      );
      await assertNoTeacherLeaveOverlap(application, session);
    }

    const now = new Date();
    const reviewer = new Types.ObjectId(reader.actorId);
    application.$where = {
      state: 'pending',
      revision: application.revision,
      approvalRequestId: id,
      'submission.revision': submittedRevision,
    };
    application.state = state;
    application.revision = revision;
    application.history.push({
      action: state,
      actorId: reviewer,
      at: now,
      revision,
      decisionReason,
    });
    await application.save({ session });
    // A native CAS preserves the shared decision instant. Mongoose's nested
    // timestamp middleware overwrites createdAt on pushed history entries.
    const linked = await ApprovalRequest.db
      .collection<IApprovalRequest>(ApprovalRequest.collection.name)
      .updateOne(
        {
          _id: id,
          entityId: application._id,
          entityType: PARENT_LEAVE_APPROVAL_ENTITY,
          approvalType: 'leave',
          branchId: application.branchId,
          requesterId: application.requesterId,
          status: 'pending',
          __v: approval.__v,
          parentLeaveRevision: submittedRevision,
        },
        {
          $set: {
            status: state,
            reviewedBy: reviewer,
            reviewedAt: now,
            updatedAt: now,
          },
          $inc: { __v: 1 },
          $push: {
            history: {
              _id: new Types.ObjectId(),
              action: state,
              performedBy: reviewer,
              authority: 'direct',
              ...(decisionReason ? { reason: decisionReason } : {}),
              createdAt: now,
            },
          },
        },
        { session },
      );
    if (linked.modifiedCount !== 1) throw conflict();

    const coverageId =
      action === 'approve'
        ? await createParentLeaveCoverage(
            application,
            id,
            submittedRevision,
            reader.actorId,
            now,
            fingerprint,
            session,
          )
        : undefined;
    await ParentLeaveDecisionOperation.create(
      [
        {
          ...key,
          branchId: reader.branchId,
          approvalId: id,
          applicationId: application._id,
          fingerprint,
          action,
          applicationRevision: revision - 1,
          approvalVersion: body.approvalVersion,
          decidedAt: now,
          coverageId,
        },
      ],
      { session },
    );
    await finish();
    return {
      approvalId: String(id),
      state,
      revision,
      decidedAt: now,
      replayed: false,
    } as const;
  });
}
