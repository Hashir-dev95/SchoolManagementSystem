import { createHash } from 'node:crypto';
import {
  Types,
  type ClientSession,
  type HydratedDocument,
  type InferSchemaType,
} from 'mongoose';
import ApprovalRequest, {
  PARENT_LEAVE_APPROVAL_ENTITY,
} from '../models/approvalRequest';
import { ParentLeaveApplication } from '../models/parentLeaveApplication';
import { ParentLeaveOperation } from '../models/parentLeaveOperation';
import {
  objectBody,
  objectIdField,
  RequestContractError,
  textField,
} from '../utils/request-validation';
import type { JwtPayload } from './jwt.service';
import { withParentApplicationWriteAuthority } from './parent-application-access.service';
import {
  assertNoActiveParentLeaveOverlap,
  assertParentLeaveRevision,
  parentLeaveFingerprint,
  validateParentLeaveTransition,
} from './parent-leave-application.policy';
import { readParentLeaveDraft } from './parent-leave-draft.service';
import { assertNoTeacherLeaveOverlap } from './attendance-parent-leave.service';
import {
  readParentLeaveRouting,
  verifyParentLeaveQueue,
} from './parent-leave-routing.policy';

type Kind = 'submit' | 'withdraw';
type Application = HydratedDocument<
  InferSchemaType<typeof ParentLeaveApplication.schema>
>;
const conflict = () =>
  new RequestContractError(409, 'Application changed; refresh and retry');

async function linkedApproval(row: Application, session: ClientSession) {
  if (!row.approvalRequestId || !row.submission) throw conflict();
  const approval = await ApprovalRequest.findOne({
    _id: row.approvalRequestId,
    entityId: row._id,
    entityType: PARENT_LEAVE_APPROVAL_ENTITY,
    approvalType: 'leave',
    requesterId: row.requesterId,
    branchId: row.branchId,
    parentLeaveRevision: row.submission.revision,
  }).session(session);
  if (!approval || approval.status !== row.state) throw conflict();
  return approval;
}

export async function changeParentLeaveLifecycle(
  kind: Kind,
  identity: JwtPayload | undefined,
  token: string,
  studentId: string,
  applicationId: string,
  raw: unknown,
) {
  const body = objectBody(raw, ['revision', 'clientOperationId']);
  assertParentLeaveRevision(body.revision, body.revision);
  const clientOperationId = textField(
    body.clientOperationId,
    'operation ID',
    120,
    1,
  );
  const id = objectIdField(applicationId, 'application ID');
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify(['parent_leave_lifecycle_v1', kind, id, body.revision]),
    )
    .digest('hex');
  const operationState =
    kind === 'submit' ? ('pending' as const) : ('withdrawn' as const);
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
        .select('+reason +submission +protectedAttachmentIds')
        .session(session);
      if (!row)
        throw new RequestContractError(
          404,
          'Application or child access is unavailable',
        );
      const owner = { requesterId, clientOperationId };
      const previous = await ParentLeaveOperation.findOne(owner)
        .select('+fingerprint')
        .session(session)
        .lean();
      if (previous) {
        if (
          previous.fingerprint !== fingerprint ||
          previous.kind !== kind ||
          String(previous.applicationId) !== id ||
          String(previous.branchId) !== branchId ||
          String(previous.studentId) !== child
        )
          throw new RequestContractError(409, 'Operation was used differently');
        const approval = await linkedApproval(row, session);
        if (
          String(previous.approvalRequestId) !== String(approval._id) ||
          previous.resultRevision > row.revision
        )
          throw conflict();
        return {
          applicationId: id,
          operationRevision: previous.resultRevision,
          operationState,
          replayed: true,
        };
      }

      const from = kind === 'submit' ? 'draft' : 'pending';
      if (row.state !== from) throw conflict();
      const { revision } = validateParentLeaveTransition({
        from,
        to: operationState,
        revision: row.revision,
        expectedRevision: body.revision,
        capability: 'current_requester',
      });
      row.$where = {
        state: from,
        revision: row.revision,
        approvalRequestId: row.approvalRequestId ?? null,
      };
      const now = new Date();
      let routing: ReturnType<typeof readParentLeaveRouting> | undefined;
      if (kind === 'submit') {
        if (
          row.approvalRequestId ||
          row.submission ||
          row.protectedAttachmentIds.length
        )
          throw conflict();
        routing = readParentLeaveRouting(branchId);
        await assertNoTeacherLeaveOverlap(row, session);
        const overlaps = await ParentLeaveApplication.find({
          branchId,
          studentId: child,
          state: { $in: ['pending', 'approved', 'changes_requested'] },
          startDate: { $lte: row.endDate },
          endDate: { $gte: row.startDate },
        })
          .select('branchId studentId state startDate endDate')
          .limit(1)
          .session(session)
          .lean();
        assertNoActiveParentLeaveOverlap(
          {
            branchId,
            studentId: child,
            startDate: row.startDate,
            endDate: row.endDate,
          },
          overlaps.map(item => ({
            ...item,
            branchId: String(item.branchId),
            studentId: String(item.studentId),
          })),
        );
        const approvalId = new Types.ObjectId();
        await ApprovalRequest.create(
          [
            {
              _id: approvalId,
              entityType: PARENT_LEAVE_APPROVAL_ENTITY,
              entityId: row._id,
              requesterId,
              branchId,
              approvalType: 'leave',
              status: 'pending',
              parentLeaveRevision: revision,
              reason: 'Parent leave application',
              history: [
                {
                  action: 'submitted',
                  performedBy: requesterId,
                  createdAt: now,
                },
              ],
            },
          ],
          { session },
        );
        row.approvalRequestId = approvalId;
        row.submission = {
          ...routing,
          revision,
          fingerprint: parentLeaveFingerprint(child, row),
        };
      } else {
        const approval = await linkedApproval(row, session);
        const version: unknown = approval.get('__v');
        const result = await ApprovalRequest.updateOne(
          {
            _id: approval._id,
            status: 'pending',
            __v: version ?? { $exists: false },
          },
          {
            $set: {
              status: 'withdrawn',
              withdrawnBy: requesterId,
              withdrawnAt: now,
            },
            $unset: { delegatedTo: 1, delegatedBy: 1, delegationExpiresAt: 1 },
            $push: {
              history: {
                action: 'withdrawn',
                performedBy: requesterId,
                createdAt: now,
              },
            },
            $inc: { __v: 1 },
          },
          { session, runValidators: true },
        );
        if (result.modifiedCount !== 1) throw conflict();
      }
      row.state = operationState;
      row.revision = revision;
      row.history.push({
        action: kind === 'submit' ? 'submitted' : 'withdrawn',
        actorId: row.requesterId,
        revision,
        at: now,
      });
      await row.save({ session });
      if (!row.approvalRequestId) throw conflict();
      await ParentLeaveOperation.create(
        [
          {
            ...owner,
            branchId,
            studentId: child,
            applicationId: id,
            approvalRequestId: row.approvalRequestId,
            kind,
            fingerprint,
            resultRevision: revision,
          },
        ],
        { session },
      );
      if (routing) {
        const current = await verifyParentLeaveQueue(branchId, session);
        if (current.version !== routing.version)
          throw new RequestContractError(
            503,
            'Leave submission is unavailable for this school.',
          );
      }
      return {
        applicationId: id,
        operationRevision: revision,
        operationState,
        replayed: false,
      };
    },
    id,
  );
  return {
    ...acknowledgement,
    application: await readParentLeaveDraft(identity, token, studentId, id),
  };
}
