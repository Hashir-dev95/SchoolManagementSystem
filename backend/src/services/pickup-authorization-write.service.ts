import { Types, type ClientSession } from 'mongoose';
import ApprovalRequest, {
  PICKUP_AUTHORIZATION_APPROVAL_ENTITY,
  type IApprovalRequest,
} from '../models/approvalRequest';
import {
  PickupAuthorization,
  PickupPerson,
  PickupSubmission,
  PickupOperation,
  PickupCustodyPolicy,
  pickupDigest,
  type PickupAuthorizationDocument,
} from '../models/pickupAuthorization';
import type { JwtPayload } from './jwt.service';
import { withParentApplicationWriteAuthority } from './parent-application-access.service';
import { communicationFence } from './teacher-communication-access.service';
import {
  PICKUP_PAYLOAD_FIELDS,
  pickupPayload,
  pickupRevision,
  pickupFingerprint,
  pickupConflict,
  pickupUnavailable,
  currentPickupPolicy,
  assertPickupRange,
  verifyPickupQueue,
} from './pickup-authorization.policy';
import {
  PICKUP_PRIVATE_FIELDS,
  readPickupGraph,
  readParentPickups,
  pickupOperationDTO,
  type PickupGraph,
} from './pickup-authorization-read.service';
import {
  objectBody,
  objectIdField,
  textField,
} from '../utils/request-validation';

export async function lockPickupPolicy(
  row: PickupAuthorizationDocument,
  session: ClientSession,
) {
  const policy = await currentPickupPolicy(String(row.branchId), session);
  if (
    String(policy._id) !== String(row.policyId) ||
    policy.revision !== row.policyRevision
  )
    throw pickupConflict();
  await communicationFence(
    session,
    PickupCustodyPolicy.collection.name,
    String(policy._id),
  );
}

export async function pickupReceipt(
  actorId: string,
  operationId: string,
  fingerprint: string,
  branchId: string,
  studentId: string,
  session: ClientSession,
) {
  const prior = await PickupOperation.findOne({
    actorId,
    clientOperationId: operationId,
  })
    .select('+fingerprint +result')
    .session(session)
    .lean();
  if (
    prior &&
    (prior.fingerprint !== fingerprint ||
      String(prior.branchId) !== branchId ||
      String(prior.studentId) !== studentId)
  )
    throw pickupConflict();
  return prior;
}

export async function advancePickupApproval(
  graph: PickupGraph,
  state: 'pending' | 'withdrawn' | 'rejected' | 'changes_requested',
  actorId: string,
  at: Date,
  action: 'resubmitted' | 'withdrawn' | 'rejected' | 'changes_requested',
  submittedRevision: number,
  session: ClientSession,
  reason?: string,
) {
  const { approval, row, latest } = graph;
  if (!approval || !latest) throw pickupConflict();
  const reviewed = state === 'rejected' || state === 'changes_requested';
  const result = await ApprovalRequest.db
    .collection<IApprovalRequest>(ApprovalRequest.collection.name)
    .updateOne(
      {
        _id: approval._id,
        entityId: row._id,
        entityType: PICKUP_AUTHORIZATION_APPROVAL_ENTITY,
        approvalType: 'pickup_authorization',
        branchId: row.branchId,
        requesterId: row.requesterId,
        status: approval.status,
        pickupRevision: latest.applicationRevision,
        __v: approval.__v,
      },
      {
        $set: {
          status: state,
          pickupRevision: submittedRevision,
          updatedAt: at,
          ...(reviewed
            ? { reviewedBy: new Types.ObjectId(actorId), reviewedAt: at }
            : {}),
          ...(state === 'withdrawn'
            ? { withdrawnBy: new Types.ObjectId(actorId), withdrawnAt: at }
            : {}),
        },
        ...(!reviewed ? { $unset: { reviewedBy: 1, reviewedAt: 1 } } : {}),
        $inc: { __v: 1 },
        $push: {
          history: {
            _id: new Types.ObjectId(),
            action,
            performedBy: new Types.ObjectId(actorId),
            createdAt: at,
            ...(reason ? { reason, authority: 'direct' } : {}),
          },
        },
      },
      { session },
    );
  if (result.modifiedCount !== 1) throw pickupConflict();
}

export type ParentPickupAction =
  | 'create'
  | 'edit'
  | 'submit'
  | 'withdraw'
  | 'resubmit';
export async function writeParentPickup(
  kind: ParentPickupAction,
  identity: JwtPayload | undefined,
  token: string,
  studentId: string,
  rawId: string | undefined,
  raw: unknown,
) {
  const hasPayload =
    kind === 'create' || kind === 'edit' || kind === 'resubmit';
  const linkedVersion = kind === 'resubmit' || kind === 'withdraw';
  const fields = [
    'clientOperationId',
    ...(hasPayload ? PICKUP_PAYLOAD_FIELDS : []),
    ...(kind !== 'create' ? ['applicationRevision', 'personRevision'] : []),
    ...(linkedVersion ? ['approvalVersion'] : []),
  ];
  const body = objectBody(raw, fields);
  const operationId = textField(body.clientOperationId, 'operation ID', 120, 1);
  const payload = hasPayload ? pickupPayload(body) : undefined;
  const revision =
    kind === 'create' ? undefined : pickupRevision(body.applicationRevision);
  const personRevision =
    kind === 'create' ? undefined : pickupRevision(body.personRevision);
  const approvalVersion = linkedVersion
    ? pickupRevision(body.approvalVersion)
    : undefined;
  const id =
    rawId === undefined ? undefined : objectIdField(rawId, 'authorization ID');
  const acknowledgement = await withParentApplicationWriteAuthority(
    identity,
    token,
    studentId,
    async (session, access) => {
      const {
        requesterId: actorId,
        branchId,
        studentId: child,
      } = access.provenance;
      const fingerprint = pickupDigest([
        'pickup_operation_v1',
        kind,
        child,
        id ?? null,
        revision,
        personRevision,
        approvalVersion,
        payload,
      ]);
      let row = id
        ? await PickupAuthorization.findOne({ _id: id, ...access.provenance })
            .select(PICKUP_PRIVATE_FIELDS)
            .session(session)
        : null;
      if (kind !== 'create' && !row) throw pickupUnavailable();
      if (row) await lockPickupPolicy(row, session);
      const prior = await pickupReceipt(
        actorId,
        operationId,
        fingerprint,
        branchId,
        child,
        session,
      );
      if (prior) {
        if (
          prior.kind !== kind ||
          prior.expectedRevision !== revision ||
          prior.expectedPersonRevision !== personRevision ||
          prior.expectedApprovalVersion !== approvalVersion
        )
          throw pickupConflict();
        const current =
          row ??
          (await PickupAuthorization.findOne({
            _id: prior.authorizationId,
            ...access.provenance,
          })
            .select(PICKUP_PRIVATE_FIELDS)
            .session(session));
        if (
          !current ||
          String(current._id) !== String(prior.authorizationId) ||
          String(current.pickupPersonId) !== String(prior.pickupPersonId)
        )
          throw pickupUnavailable();
        await lockPickupPolicy(current, session);
        const graph = await readPickupGraph(current, session);
        if (
          graph.latest &&
          kind !== 'withdraw' &&
          (await verifyPickupQueue(branchId, session)).version !==
            graph.latest.routingVersion
        )
          throw pickupConflict();
        return { ...pickupOperationDTO(prior.result), replayed: true };
      }
      let graph: PickupGraph;
      if (kind === 'create') {
        const policy = await currentPickupPolicy(branchId, session, true);
        assertPickupRange(payload!, access.scope);
        const at = new Date();
        const [person] = await PickupPerson.create(
          [
            {
              ...access.provenance,
              fullName: payload!.fullName,
              relationship: payload!.relationship,
              phone: payload!.phone,
              history: [
                {
                  action: 'created',
                  revision: 0,
                  actorId,
                  at,
                  fingerprint: pickupDigest([
                    payload!.fullName,
                    payload!.relationship,
                    payload!.phone,
                  ]),
                },
              ],
            },
          ],
          { session },
        );
        row = new PickupAuthorization({
          ...access.provenance,
          pickupPersonId: person._id,
          policyId: policy._id,
          policyRevision: policy.revision,
          validFromDate: payload!.validFromDate,
          validUntilDate: payload!.validUntilDate,
          notes: payload!.notes,
          history: [
            {
              action: 'created',
              revision: 0,
              actorId,
              at,
              fingerprint: pickupFingerprint(child, payload!),
            },
          ],
        });
        await row.save({ session });
        graph = await readPickupGraph(row, session);
      } else {
        graph = await readPickupGraph(row!, session);
        if (
          graph.row.revision !== revision ||
          graph.person.revision !== personRevision ||
          (linkedVersion && graph.approval?.__v !== approvalVersion)
        )
          throw pickupConflict();
        if (
          kind === 'edit'
            ? row!.state !== 'draft'
            : kind === 'resubmit'
            ? row!.state !== 'changes_requested'
            : kind === 'submit'
            ? row!.state !== 'draft'
            : row!.state !== 'pending'
        )
          throw pickupConflict();
        if (hasPayload) assertPickupRange(payload!, access.scope);
        row!.$where = {
          revision,
          state: row!.state,
          approvalRequestId: row!.approvalRequestId ?? null,
        };
        if (kind === 'edit' || kind === 'resubmit') {
          graph.person.$where = { revision: personRevision };
          graph.person.set({
            fullName: payload!.fullName,
            relationship: payload!.relationship,
            phone: payload!.phone,
            revision: graph.person.revision + 1,
          });
          graph.person.history.push({
            action: 'edited',
            actorId: graph.person.requesterId,
            revision: graph.person.revision,
            at: new Date(),
            fingerprint: pickupDigest([
              payload!.fullName,
              payload!.relationship,
              payload!.phone,
            ]),
          });
          await graph.person.save({ session });
          row!.set({
            validFromDate: payload!.validFromDate,
            validUntilDate: payload!.validUntilDate,
            notes: payload!.notes,
          });
        }
        row!.revision++;
        const action =
          kind === 'edit'
            ? 'edited'
            : kind === 'submit'
            ? 'submitted'
            : kind === 'resubmit'
            ? 'resubmitted'
            : 'withdrawn';
        const nextPayload = payload ?? graph.payload;
        const at = new Date();
        if (kind === 'submit' || kind === 'resubmit') {
          assertPickupRange(nextPayload, access.scope);
          const routing = await verifyPickupQueue(branchId, session);
          if (graph.latest && graph.latest.routingVersion !== routing.version)
            throw pickupConflict();
          if (kind === 'submit') {
            const [approval] = await ApprovalRequest.create(
              [
                {
                  entityType: PICKUP_AUTHORIZATION_APPROVAL_ENTITY,
                  entityId: row!._id,
                  approvalType: 'pickup_authorization',
                  requesterId: actorId,
                  branchId,
                  reason: 'Pickup authorization proposal',
                  status: 'pending',
                  pickupRevision: row!.revision,
                  history: [
                    {
                      action: 'submitted',
                      performedBy: actorId,
                      createdAt: at,
                    },
                  ],
                },
              ],
              { session },
            );
            row!.approvalRequestId = approval._id;
          } else
            await advancePickupApproval(
              graph,
              'pending',
              actorId,
              at,
              'resubmitted',
              row!.revision,
              session,
            );
          const [submitted] = await PickupSubmission.create(
            [
              {
                authorizationId: row!._id,
                pickupPersonId: graph.person._id,
                branchId,
                studentId: child,
                requesterId: actorId,
                applicationRevision: row!.revision,
                personRevision: graph.person.revision,
                cycle: row!.cycle + 1,
                payload: nextPayload,
                fingerprint: pickupFingerprint(child, nextPayload),
                submittedAt: at,
                routingVersion: routing.version,
                policyId: row!.policyId,
                policyRevision: row!.policyRevision,
              },
            ],
            { session },
          );
          row!.submissionId = submitted._id;
          row!.cycle++;
          row!.state = 'pending';
        } else if (kind === 'withdraw') {
          await advancePickupApproval(
            graph,
            'withdrawn',
            actorId,
            at,
            'withdrawn',
            graph.latest!.applicationRevision,
            session,
          );
          row!.state = 'withdrawn';
        }
        row!.history.push({
          action,
          actorId: row!.requesterId,
          revision: row!.revision,
          at,
          fingerprint: pickupFingerprint(child, nextPayload),
        });
        await row!.save({ session });
        graph = await readPickupGraph(row!, session);
      }
      const result = {
        authorizationId: String(graph.row._id),
        pickupPersonId: String(graph.person._id),
        approvalId: graph.approval ? String(graph.approval._id) : null,
        operationRevision: graph.row.revision,
        operationPersonRevision: graph.person.revision,
        operationState: graph.row.state,
        operationCycle: graph.row.cycle,
      };
      await PickupOperation.create(
        [
          {
            actorId,
            branchId,
            studentId: child,
            authorizationId: graph.row._id,
            pickupPersonId: graph.person._id,
            approvalRequestId: graph.approval?._id,
            clientOperationId: operationId,
            kind,
            expectedRevision: revision,
            expectedPersonRevision: personRevision,
            expectedApprovalVersion: approvalVersion,
            fingerprint,
            result,
          },
        ],
        { session },
      );
      if (kind === 'submit' || kind === 'resubmit') {
        const finalRouting = await verifyPickupQueue(branchId, session);
        if (finalRouting.version !== graph.latest?.routingVersion)
          throw pickupConflict();
      }
      await lockPickupPolicy(graph.row, session);
      return { ...result, replayed: false };
    },
  );
  return {
    ...acknowledgement,
    authorization: await readParentPickups(
      identity,
      token,
      studentId,
      acknowledgement.authorizationId,
    ),
  };
}
