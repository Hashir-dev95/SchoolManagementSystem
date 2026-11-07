import mongoose, { type ClientSession } from 'mongoose';
import ApprovalRequest, {
  PICKUP_AUTHORIZATION_APPROVAL_ENTITY,
} from '../models/approvalRequest';
import {
  PickupAuthorization,
  PickupPerson,
  PickupSubmission,
  type PickupAuthorizationDocument,
} from '../models/pickupAuthorization';
import { authorizeParentApplication } from './parent-application-access.service';
import type { JwtPayload } from './jwt.service';
import {
  PICKUP_PROVENANCE_FIELDS,
  pickupSubject,
} from './pickup-authorization-access.service';
import {
  currentPickupPolicy,
  pickupConflict,
  pickupEligibility,
  pickupFingerprint,
  pickupUnavailable,
  verifyPickupQueue,
  type PickupPayload,
} from './pickup-authorization.policy';
import {
  enumField,
  objectBody,
  objectIdField,
  RequestContractError,
} from '../utils/request-validation';
import { PICKUP_STATES } from '../models/pickupAuthorization';

export const PICKUP_PRIVATE_FIELDS = '+history +notes';
export async function readPickupGraph(
  row: PickupAuthorizationDocument,
  session: ClientSession,
) {
  const source = Object.fromEntries(
    PICKUP_PROVENANCE_FIELDS.map(key => [key, row.get(key)]),
  );
  const person = await PickupPerson.findOne({
    _id: row.pickupPersonId,
    ...source,
  })
    .select('+phone +history')
    .session(session);
  if (!person) throw pickupConflict();
  try {
    await row.validate();
    await person.validate();
  } catch (error) {
    if (error instanceof mongoose.Error.ValidationError) throw pickupConflict();
    throw error;
  }
  const payload: PickupPayload = {
    fullName: person.fullName,
    relationship: person.relationship,
    phone: person.phone,
    validFromDate: row.validFromDate,
    validUntilDate: row.validUntilDate,
    notes: row.notes,
  };
  const fingerprint = pickupFingerprint(row.studentId, payload);
  if (row.history.at(-1)?.fingerprint !== fingerprint) throw pickupConflict();
  const snapshots = await PickupSubmission.find({ authorizationId: row._id })
    .select('+payload +fingerprint')
    .sort({ cycle: 1 })
    .session(session)
    .lean();
  if (snapshots.length !== row.cycle) throw pickupConflict();
  for (const [index, snapshot] of snapshots.entries()) {
    const event = row.history[snapshot.applicationRevision];
    if (
      snapshot.cycle !== index + 1 ||
      String(snapshot.pickupPersonId) !== String(person._id) ||
      String(snapshot.branchId) !== String(row.branchId) ||
      String(snapshot.requesterId) !== String(row.requesterId) ||
      String(snapshot.studentId) !== String(row.studentId) ||
      String(snapshot.policyId) !== String(row.policyId) ||
      snapshot.policyRevision !== row.policyRevision ||
      snapshot.fingerprint !==
        pickupFingerprint(row.studentId, snapshot.payload) ||
      !event ||
      event.action !== (index === 0 ? 'submitted' : 'resubmitted') ||
      event.at.getTime() !== snapshot.submittedAt.getTime() ||
      event.fingerprint !== snapshot.fingerprint
    )
      throw pickupConflict();
  }
  const latest = snapshots.at(-1);
  if (
    latest &&
    (String(latest._id) !== String(row.submissionId) ||
      latest.fingerprint !== fingerprint ||
      latest.personRevision !== person.revision)
  )
    throw pickupConflict();
  const approval = row.approvalRequestId
    ? await ApprovalRequest.findById(row.approvalRequestId)
        .session(session)
        .lean()
    : null;
  if (row.cycle) {
    if (
      !approval ||
      !latest ||
      approval.entityType !== PICKUP_AUTHORIZATION_APPROVAL_ENTITY ||
      approval.approvalType !== 'pickup_authorization' ||
      String(approval.entityId) !== String(row._id) ||
      String(approval.requesterId) !== String(row.requesterId) ||
      String(approval.branchId) !== String(row.branchId) ||
      approval.status !== row.state ||
      approval.pickupRevision !== latest.applicationRevision ||
      !Number.isSafeInteger(approval.__v) ||
      approval.amount != null ||
      approval.delegatedTo ||
      approval.delegatedBy ||
      approval.delegationExpiresAt ||
      approval.supportingFileUrl ||
      approval.beforeData ||
      approval.afterData
    )
      throw pickupConflict();
    const mirrored = row.history.filter(
      event => !['created', 'edited'].includes(event.action),
    );
    if (
      approval.history.length !== mirrored.length ||
      mirrored.some((event, index) => {
        const other = approval.history[index];
        return (
          !other ||
          other.action !== event.action ||
          String(other.performedBy) !== String(event.actorId) ||
          other.reason !== event.reason ||
          other.createdAt?.getTime() !== event.at.getTime()
        );
      })
    )
      throw pickupConflict();
    const last = row.history.at(-1)!;
    if (
      row.state === 'pending'
        ? approval.reviewedBy ||
          approval.reviewedAt ||
          approval.withdrawnBy ||
          approval.withdrawnAt
        : row.state === 'withdrawn'
        ? String(approval.withdrawnBy) !== String(last.actorId) ||
          approval.withdrawnAt?.getTime() !== last.at.getTime() ||
          approval.reviewedBy ||
          approval.reviewedAt
        : String(approval.reviewedBy) !== String(last.actorId) ||
          approval.reviewedAt?.getTime() !== last.at.getTime() ||
          approval.withdrawnBy ||
          approval.withdrawnAt
    )
      throw pickupConflict();
  } else if (approval) throw pickupConflict();
  return { row, person, payload, snapshots, approval, latest };
}
export type PickupGraph = Awaited<ReturnType<typeof readPickupGraph>>;

export const pickupOperationDTO = (result: {
  authorizationId: string;
  pickupPersonId: string;
  approvalId: string | null;
  operationRevision: number;
  operationPersonRevision: number;
  operationState: string;
  operationCycle: number;
}) => ({
  authorizationId: result.authorizationId,
  pickupPersonId: result.pickupPersonId,
  approvalId: result.approvalId,
  operationRevision: result.operationRevision,
  operationPersonRevision: result.operationPersonRevision,
  operationState: result.operationState,
  operationCycle: result.operationCycle,
});

export async function pickupDTO(
  graph: PickupGraph,
  session: ClientSession,
  detail: boolean,
  routingVersion?: number,
) {
  const { row, person, payload, approval, latest, snapshots } = graph;
  const policy = await currentPickupPolicy(String(row.branchId), session);
  const policyCurrent =
    String(policy._id) === String(row.policyId) &&
    policy.revision === row.policyRevision;
  const routeCurrent =
    !!routingVersion && (!latest || routingVersion === latest.routingVersion);
  return {
    authorizationId: String(row._id),
    pickupPersonId: String(person._id),
    studentId: String(row.studentId),
    state: row.state,
    revision: row.revision,
    personRevision: person.revision,
    person: {
      fullName: person.fullName,
      relationship: person.relationship,
      ...(detail ? { phone: person.phone } : {}),
    },
    validFromDate: row.validFromDate,
    validUntilDate: row.validUntilDate,
    ...(detail ? { notes: payload.notes } : {}),
    eligibility: await pickupEligibility(
      String(row.branchId),
      String(row.studentId),
      String(row.enrollmentId),
      session,
    ),
    capabilities: {
      canEditDraft: policyCurrent && row.state === 'draft',
      canSubmit: policyCurrent && routeCurrent && row.state === 'draft',
      canWithdraw: policyCurrent && row.state === 'pending',
      canResubmit:
        policyCurrent && routeCurrent && row.state === 'changes_requested',
    },
    policyBindingCurrent: policyCurrent,
    reviewRoutingState: routeCurrent
      ? 'configured'
      : routingVersion
      ? 'revision_mismatch'
      : 'unconfigured',
    ...(detail
      ? {
          approvalId: approval ? String(approval._id) : null,
          reviewVersion:
            approval && policyCurrent
              ? {
                  applicationRevision: row.revision,
                  personRevision: person.revision,
                  approvalVersion: approval.__v!,
                }
              : null,
          history: row.history.map(({ action, revision, at, reason }) => ({
            action,
            revision,
            at,
            ...(reason ? { reason } : {}),
          })),
          submissions: snapshots.map(snapshot => ({
            cycle: snapshot.cycle,
            applicationRevision: snapshot.applicationRevision,
            submittedAt: snapshot.submittedAt,
            fullName: snapshot.payload.fullName,
            relationship: snapshot.payload.relationship,
            phone: snapshot.payload.phone,
            validFromDate: snapshot.payload.validFromDate,
            validUntilDate: snapshot.payload.validUntilDate,
            notes: snapshot.payload.notes,
          })),
        }
      : {}),
  };
}

export async function readParentPickups(
  identity: JwtPayload | undefined,
  token: string,
  studentId: string,
  authorizationId?: string,
  rawQuery: unknown = {},
) {
  const query = objectBody(rawQuery, ['offset', 'state']);
  if (authorizationId && Object.keys(query).length)
    throw new RequestContractError(400, 'Unsupported detail query');
  const offset = query.offset === undefined ? 0 : Number(query.offset);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
    throw new RequestContractError(400, 'Invalid offset');
  const state =
    query.state === undefined
      ? undefined
      : enumField(query.state, 'state', PICKUP_STATES);
  const initial = await authorizeParentApplication(identity, token, studentId);
  const session = await mongoose.startSession();
  try {
    const result = await session.withTransaction(
      async () => {
        let routingVersion: number | undefined;
        try {
          routingVersion = (
            await verifyPickupQueue(initial.provenance.branchId, session, false)
          ).version;
        } catch (error) {
          if (!(error instanceof RequestContractError && error.status === 503))
            throw error;
        }
        const rows = await PickupAuthorization.find({
          ...initial.provenance,
          ...(authorizationId
            ? { _id: objectIdField(authorizationId, 'authorization ID') }
            : {}),
          ...(state ? { state } : {}),
        })
          .select(PICKUP_PRIVATE_FIELDS)
          .sort({ createdAt: -1, _id: -1 })
          .skip(offset)
          .limit(authorizationId ? 1 : 21)
          .session(session);
        const items = [];
        for (const row of rows.slice(0, 20)) {
          await pickupSubject(row, session);
          items.push(
            await pickupDTO(
              await readPickupGraph(row, session),
              session,
              !!authorizationId,
              routingVersion,
            ),
          );
        }
        if (authorizationId && !items.length) throw pickupUnavailable();
        return authorizationId
          ? items[0]
          : { items, nextOffset: rows.length > 20 ? offset + 20 : null };
      },
      { readPreference: 'primary', readConcern: { level: 'snapshot' } },
    );
    const final = await authorizeParentApplication(identity, token, studentId);
    if (
      JSON.stringify(initial.provenance) !== JSON.stringify(final.provenance) ||
      initial.loginId !== final.loginId ||
      String(initial.link.verifiedBy) !== String(final.link.verifiedBy)
    )
      throw pickupUnavailable();
    return result;
  } finally {
    await session.endSession();
  }
}
