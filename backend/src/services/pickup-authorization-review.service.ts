import mongoose, { type ClientSession } from 'mongoose';
import ApprovalRequest, {
  PICKUP_AUTHORIZATION_APPROVAL_ENTITY,
} from '../models/approvalRequest';
import {
  PickupAuthorization,
  PickupPerson,
  PickupOperation,
  pickupDigest,
  type PickupAuthorizationDocument,
} from '../models/pickupAuthorization';
import User from '../models/user';
import Session from '../models/session';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import { PERMISSIONS } from '../constants/permissions';
import type { JwtPayload } from './jwt.service';
import {
  pickupReviewer,
  pickupSubject,
  fencePickupSubject,
} from './pickup-authorization-access.service';
import {
  PICKUP_PRIVATE_FIELDS,
  pickupDTO,
  readPickupGraph,
  pickupOperationDTO,
} from './pickup-authorization-read.service';
import {
  pickupConflict,
  pickupUnavailable,
  pickupRevision,
  currentPickupPolicy,
} from './pickup-authorization.policy';
import {
  advancePickupApproval,
  lockPickupPolicy,
  pickupReceipt,
} from './pickup-authorization-write.service';
import { withAcademicCatalogLock } from './academic-catalog-lock.service';
import { communicationFence } from './teacher-communication-access.service';
import { requireAutomatedReleaseAuthority } from './gate-authority.service';
import {
  enumField,
  objectBody,
  objectIdField,
  RequestContractError,
  textField,
} from '../utils/request-validation';

async function reviewRecord(
  branchId: string,
  routingVersion: number,
  approvalId: string,
  session: ClientSession,
) {
  const approval = await ApprovalRequest.findOne({
    _id: approvalId,
    branchId,
    entityType: PICKUP_AUTHORIZATION_APPROVAL_ENTITY,
    approvalType: 'pickup_authorization',
  })
    .session(session)
    .lean();
  const row =
    approval &&
    (await PickupAuthorization.findOne({
      _id: approval.entityId,
      branchId,
      approvalRequestId: approval._id,
    })
      .select(PICKUP_PRIVATE_FIELDS)
      .session(session));
  if (!row) throw pickupUnavailable();
  const graph = await readPickupGraph(row, session);
  if (!graph.latest || graph.latest.routingVersion !== routingVersion)
    throw pickupConflict();
  const subject = await pickupSubject(row, session);
  return { graph, subject };
}

export async function readPrincipalPickups(
  identity: JwtPayload | undefined,
  token: string,
  rawId?: string,
  rawQuery: unknown = {},
) {
  const initial = await pickupReviewer(identity, token);
  const query = objectBody(rawQuery, ['offset']);
  const offset = query.offset === undefined ? 0 : Number(query.offset);
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 100000 ||
    (rawId && Object.keys(query).length)
  )
    throw new RequestContractError(400, 'Invalid review query');
  const id = rawId ? objectIdField(rawId, 'approval ID') : undefined;
  const session = await mongoose.startSession();
  const checkedSubjects: PickupAuthorizationDocument[] = [];
  try {
    const result = await session.withTransaction(
      async () => {
        checkedSubjects.length = 0;
        const reader = await pickupReviewer(identity, token, session);
        const approvals = await ApprovalRequest.find({
          branchId: reader.branchId,
          entityType: PICKUP_AUTHORIZATION_APPROVAL_ENTITY,
          approvalType: 'pickup_authorization',
          requesterId: { $ne: reader.actor._id },
          ...(id ? { _id: id } : { status: 'pending' }),
        })
          .sort({ createdAt: -1, _id: -1 })
          .skip(offset)
          .limit(id ? 1 : 21)
          .session(session)
          .lean();
        const items = [];
        for (const approval of approvals.slice(0, 20)) {
          try {
            const { graph, subject } = await reviewRecord(
              reader.branchId,
              reader.routing.version,
              String(approval._id),
              session,
            );
            const policy = await currentPickupPolicy(reader.branchId, session);
            const manageable =
              graph.row.state === 'pending' &&
              policy.revision === graph.row.policyRevision &&
              String(policy._id) === String(graph.row.policyId) &&
              ROLE_PERMISSIONS.principal.includes(
                PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE,
              );
            const dto = await pickupDTO(
              graph,
              session,
              !!id,
              reader.routing.version,
            );
            checkedSubjects.push(graph.row);
            items.push({
              ...dto,
              student: {
                id: String(subject.scope.student._id),
                fullName: subject.scope.user.fullName,
                branchId: reader.branchId,
                className: subject.scope.schoolClass.name,
                sectionName: subject.scope.section.name,
              },
              requester: {
                id: String(subject.parent.actor._id),
                fullName: subject.parent.actor.fullName,
              },
              capabilities: {
                allowedActions: manageable ? ['reject', 'request_changes'] : [],
                canApprove: false,
              },
              ...(id
                ? {
                    decisionVersion: manageable
                      ? {
                          applicationRevision: graph.row.revision,
                          personRevision: graph.person.revision,
                          approvalVersion: graph.approval!.__v!,
                        }
                      : null,
                  }
                : {}),
            });
          } catch (error) {
            if (
              error instanceof RequestContractError &&
              [404, 409].includes(error.status)
            ) {
              if (id) throw pickupUnavailable();
              continue;
            }
            throw error;
          }
        }
        if (id && !items.length) throw pickupUnavailable();
        return id
          ? items[0]
          : { items, nextOffset: approvals.length > 20 ? offset + 20 : null };
      },
      { readConcern: { level: 'snapshot' }, readPreference: 'primary' },
    );
    const final = await pickupReviewer(identity, token);
    if (
      String(initial.actor._id) !== String(final.actor._id) ||
      initial.branchId !== final.branchId ||
      initial.routing.version !== final.routing.version ||
      String(initial.login._id) !== String(final.login._id)
    )
      throw pickupUnavailable();
    for (const row of checkedSubjects) await pickupSubject(row);
    return result;
  } finally {
    await session.endSession();
  }
}

export async function decidePickup(
  identity: JwtPayload | undefined,
  token: string,
  rawId: string,
  raw: unknown,
) {
  const initial = await pickupReviewer(identity, token, undefined, true);
  const id = objectIdField(rawId, 'approval ID');
  const body = objectBody(raw, [
    'action',
    'applicationRevision',
    'personRevision',
    'approvalVersion',
    'clientOperationId',
    'decisionReason',
  ]);
  const action = enumField(body.action, 'decision', [
    'approve',
    'reject',
    'request_changes',
  ] as const);
  const revision = pickupRevision(body.applicationRevision),
    personRevision = pickupRevision(body.personRevision),
    approvalVersion = pickupRevision(body.approvalVersion);
  const operationId = textField(body.clientOperationId, 'operation ID', 120, 1);
  const reason =
    action === 'approve'
      ? undefined
      : textField(
          typeof body.decisionReason === 'string'
            ? body.decisionReason.normalize('NFC')
            : body.decisionReason,
          'decision reason',
          500,
          10,
        );
  if (action === 'approve' && body.decisionReason !== undefined)
    throw new RequestContractError(400, 'Unsupported approval fields');
  const result = await withAcademicCatalogLock(
    initial.branchId,
    async session => {
      const reader = await pickupReviewer(identity, token, session, true);
      if (
        reader.branchId !== initial.branchId ||
        reader.routing.version !== initial.routing.version
      )
        throw pickupConflict();
      await communicationFence(
        session,
        Session.collection.name,
        String(reader.login._id),
      );
      await communicationFence(
        session,
        User.collection.name,
        String(reader.actor._id),
      );
      const { graph, subject } = await reviewRecord(
        reader.branchId,
        reader.routing.version,
        id,
        session,
      );
      if (String(graph.row.requesterId) === String(reader.actor._id))
        throw new RequestContractError(
          403,
          'Requester cannot review their own proposal',
        );
      await fencePickupSubject(graph.row, subject, session);
      await communicationFence(
        session,
        PickupPerson.collection.name,
        String(graph.person._id),
      );
      await lockPickupPolicy(graph.row, session);
      const fingerprint = pickupDigest([
        'pickup_decision_v1',
        id,
        String(graph.row._id),
        action,
        revision,
        personRevision,
        approvalVersion,
        reason,
      ]);
      const actorId = String(reader.actor._id),
        child = String(graph.row.studentId);
      const prior = await pickupReceipt(
        actorId,
        operationId,
        fingerprint,
        reader.branchId,
        child,
        session,
      );
      if (prior) {
        if (
          prior.kind !== action ||
          String(prior.authorizationId) !== String(graph.row._id) ||
          String(prior.approvalRequestId) !== id ||
          String(prior.pickupPersonId) !== String(graph.person._id) ||
          prior.expectedRevision !== revision ||
          prior.expectedPersonRevision !== personRevision ||
          prior.expectedApprovalVersion !== approvalVersion
        )
          throw pickupConflict();
        await pickupReviewer(identity, token, session, true);
        return { ...pickupOperationDTO(prior.result), replayed: true };
      }
      if (
        graph.row.state !== 'pending' ||
        graph.row.revision !== revision ||
        graph.person.revision !== personRevision ||
        graph.approval?.__v !== approvalVersion
      )
        throw pickupConflict();
      if (action === 'approve') requireAutomatedReleaseAuthority();
      const state = action === 'reject' ? 'rejected' : 'changes_requested';
      const at = new Date();
      graph.row.$where = {
        revision,
        state: 'pending',
        approvalRequestId: graph.approval!._id,
      };
      graph.row.state = state;
      graph.row.revision++;
      graph.row.history.push({
        action: state,
        actorId: reader.actor._id,
        at,
        revision: graph.row.revision,
        reason,
        fingerprint: graph.latest!.fingerprint,
      });
      await graph.row.save({ session });
      await advancePickupApproval(
        graph,
        state,
        actorId,
        at,
        state,
        graph.latest!.applicationRevision,
        session,
        reason,
      );
      const acknowledgement = {
        authorizationId: String(graph.row._id),
        pickupPersonId: String(graph.person._id),
        approvalId: id,
        operationState: state,
        operationRevision: graph.row.revision,
        operationPersonRevision: graph.person.revision,
        operationCycle: graph.row.cycle,
      };
      await PickupOperation.create(
        [
          {
            actorId,
            branchId: reader.branchId,
            studentId: child,
            authorizationId: graph.row._id,
            pickupPersonId: graph.person._id,
            approvalRequestId: id,
            clientOperationId: operationId,
            kind: action,
            expectedRevision: revision,
            expectedPersonRevision: personRevision,
            expectedApprovalVersion: approvalVersion,
            fingerprint,
            result: acknowledgement,
          },
        ],
        { session },
      );
      const final = await pickupReviewer(identity, token, session, true);
      if (
        final.branchId !== reader.branchId ||
        final.routing.version !== reader.routing.version ||
        String(final.login._id) !== String(reader.login._id)
      )
        throw pickupConflict();
      await pickupSubject(graph.row, session);
      return { ...acknowledgement, replayed: false };
    },
  );
  return {
    ...result,
    authorization: await readPrincipalPickups(identity, token, id),
  };
}
