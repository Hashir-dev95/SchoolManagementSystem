import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import ApprovalRequest, {
  PARENT_LEAVE_APPROVAL_ENTITY,
  type IApprovalRequest,
} from '../models/approvalRequest';
import { ParentLeaveApplication } from '../models/parentLeaveApplication';
import { ParentLeaveOperation } from '../models/parentLeaveOperation';
import {
  objectBody,
  objectIdField,
  RequestContractError,
} from '../utils/request-validation';
import {
  assertCoverageRange,
  assertNoParentLeaveOverlap,
  assertNoTeacherLeaveOverlap,
} from './attendance-parent-leave.service';
import type { JwtPayload } from './jwt.service';
import { withParentApplicationWriteAuthority } from './parent-application-access.service';
import {
  assertParentLeaveRevision,
  normalizeParentLeaveDraft,
  parentLeaveFingerprint,
  validateParentLeaveTransition,
} from './parent-leave-application.policy';
import { readParentLeaveDraft } from './parent-leave-draft.service';
import {
  archiveCurrentLeave,
  readLinkedParentLeaveApproval,
} from './parent-leave-review-history';
import {
  readParentLeaveRouting,
  verifyParentLeaveQueue,
} from './parent-leave-routing.policy';

const unavailable = () =>
  new RequestContractError(404, 'Application or child access is unavailable');
const conflict = () =>
  new RequestContractError(409, 'Application changed; refresh and retry');

export async function resubmitParentLeave(
  identity: JwtPayload | undefined,
  token: string,
  studentId: string,
  applicationId: string,
  raw: unknown,
) {
  const { applicationRevision, approvalVersion, ...fields } = objectBody(raw, [
    'leaveType',
    'startDate',
    'endDate',
    'reason',
    'clientOperationId',
    'applicationRevision',
    'approvalVersion',
  ]);
  assertParentLeaveRevision(applicationRevision, applicationRevision);
  assertParentLeaveRevision(approvalVersion, approvalVersion);
  const { payload, clientOperationId } = normalizeParentLeaveDraft(fields);
  const id = objectIdField(applicationId, 'application ID');

  const acknowledgement = await withParentApplicationWriteAuthority(
    identity,
    token,
    studentId,
    async (session, access) => {
      const { requesterId, branchId, studentId: child } = access.provenance;
      const row = await ParentLeaveApplication.findOne({
        _id: id,
        ...access.provenance,
      })
        .select('+reason +submission +priorSubmissions +protectedAttachmentIds')
        .session(session);
      if (!row) throw unavailable();
      const approval = await readLinkedParentLeaveApproval(row, session);
      if (!approval || !row.submission) throw conflict();
      const routing = readParentLeaveRouting(branchId);
      if (
        routing.policy !== row.submission.policy ||
        routing.version !== row.submission.version
      )
        throw conflict();

      const submittedFingerprint = parentLeaveFingerprint(child, payload);
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify([
            'parent_leave_resubmit_v1',
            id,
            String(approval._id),
            applicationRevision,
            approvalVersion,
            submittedFingerprint,
          ]),
        )
        .digest('hex');
      const owner = { requesterId, clientOperationId };
      const prior = await ParentLeaveOperation.findOne(owner)
        .select('+fingerprint')
        .session(session)
        .lean();
      if (prior) {
        if (
          prior.kind !== 'resubmit' ||
          prior.fingerprint !== fingerprint ||
          String(prior.applicationId) !== id ||
          String(prior.approvalRequestId) !== String(approval._id) ||
          String(prior.studentId) !== child ||
          String(prior.branchId) !== branchId ||
          prior.resultRevision > row.revision ||
          !prior.resultCycle
        )
          throw conflict();
        return {
          applicationId: id,
          operationRevision: prior.resultRevision,
          operationCycle: prior.resultCycle,
          replayed: true,
        };
      }

      if (
        row.state !== 'changes_requested' ||
        approval.__v !== approvalVersion ||
        !Number.isSafeInteger(approval.__v) ||
        approval.__v! >= Number.MAX_SAFE_INTEGER ||
        row.protectedAttachmentIds.length
      )
        throw conflict();
      const { revision } = validateParentLeaveTransition({
        from: row.state,
        to: 'pending',
        revision: row.revision,
        expectedRevision: applicationRevision,
        capability: 'current_requester',
      });
      const range = { ...payload, branchId, studentId: child };
      await assertCoverageRange(
        range,
        access.scope.enrollment,
        access.scope.period,
        session,
      );
      await assertNoParentLeaveOverlap(range, session, row._id);
      await assertNoTeacherLeaveOverlap(range, session);

      const now = new Date();
      const priorSubmissionRevision = row.submission.revision;
      row.$where = {
        state: 'changes_requested',
        revision: row.revision,
        approvalRequestId: approval._id,
        'submission.revision': priorSubmissionRevision,
      };
      archiveCurrentLeave(row);
      row.set({
        ...payload,
        state: 'pending',
        revision,
        submission: { ...routing, revision, fingerprint: submittedFingerprint },
      });
      row.history.push({
        action: 'resubmitted',
        actorId: row.requesterId,
        at: now,
        revision,
      });
      await row.save({ session });

      const linked = await ApprovalRequest.db
        .collection<IApprovalRequest>(ApprovalRequest.collection.name)
        .updateOne(
          {
            _id: approval._id,
            entityId: row._id,
            entityType: PARENT_LEAVE_APPROVAL_ENTITY,
            approvalType: 'leave',
            branchId: row.branchId,
            requesterId: row.requesterId,
            status: 'changes_requested',
            parentLeaveRevision: priorSubmissionRevision,
            __v: approval.__v,
          },
          {
            $set: {
              status: 'pending',
              parentLeaveRevision: revision,
              updatedAt: now,
            },
            $unset: { reviewedBy: 1, reviewedAt: 1 },
            $inc: { __v: 1 },
            $push: {
              history: {
                _id: new Types.ObjectId(),
                action: 'resubmitted',
                performedBy: row.requesterId,
                createdAt: now,
              },
            },
          },
          { session },
        );
      if (linked.modifiedCount !== 1) throw conflict();

      const operationCycle = (row.priorSubmissions?.length ?? 0) + 1;
      await ParentLeaveOperation.create(
        [
          {
            ...owner,
            branchId,
            studentId: child,
            applicationId: id,
            approvalRequestId: approval._id,
            kind: 'resubmit',
            fingerprint,
            applicationRevision: revision - 1,
            approvalVersion: approval.__v,
            resultRevision: revision,
            resultCycle: operationCycle,
          },
        ],
        { session },
      );
      const finalRouting = await verifyParentLeaveQueue(branchId, session);
      if (
        finalRouting.policy !== routing.policy ||
        finalRouting.version !== routing.version
      )
        throw conflict();
      return {
        applicationId: id,
        operationRevision: revision,
        operationCycle,
        replayed: false,
      };
    },
    id,
  );
  return {
    ...acknowledgement,
    operationState: 'pending' as const,
    application: await readParentLeaveDraft(identity, token, studentId, id),
  };
}
