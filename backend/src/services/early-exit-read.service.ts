import mongoose, { type ClientSession } from 'mongoose';
import ApprovalRequest, {
  EARLY_EXIT_APPROVAL_ENTITY,
} from '../models/approvalRequest';
import {
  EarlyExitRequest,
  EarlyExitSubmission,
  EARLY_EXIT_PROVENANCE,
  EARLY_EXIT_STATES,
  earlyExitDigest,
  type EarlyExitDocument,
} from '../models/earlyExitRequest';
import { StudentCustodyState } from '../models/gateFoundation';
import { authorizeParentApplication } from './parent-application-access.service';
import type { JwtPayload } from './jwt.service';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import { PERMISSIONS } from '../constants/permissions';
import {
  enumField,
  objectBody,
  objectIdField,
  RequestContractError,
} from '../utils/request-validation';
import {
  exitConflict,
  exitUnavailable,
  exitSubject,
  exitReviewer,
  verifyExitQueue,
  exitPayload,
} from './early-exit-authority.service';

export const EXIT_PRIVATE_FIELDS = '+reason +history';
export async function readExitGraph(
  row: EarlyExitDocument,
  session: ClientSession,
) {
  try {
    await row.validate();
    exitPayload({ exitDate: row.exitDate, reason: row.reason });
  } catch (error) {
    if (
      error instanceof mongoose.Error.ValidationError ||
      error instanceof RequestContractError
    )
      throw exitConflict();
    throw error;
  }
  const snapshots = await EarlyExitSubmission.find({ requestId: row._id })
    .select('+reason +fingerprint')
    .sort({ cycle: 1 })
    .session(session)
    .lean();
  const approval = row.approvalRequestId
    ? await ApprovalRequest.findById(row.approvalRequestId)
        .session(session)
        .lean()
    : null;
  const payload = { exitDate: row.exitDate, reason: row.reason };
  const fingerprint = earlyExitDigest([String(row.studentId), payload]);
  if (snapshots.length !== row.cycle) throw exitConflict();
  for (const [index, snapshot] of snapshots.entries()) {
    const event = row.history[snapshot.applicationRevision];
    if (
      snapshot.cycle !== index + 1 ||
      EARLY_EXIT_PROVENANCE.some(
        key => String(snapshot[key]) !== String(row.get(key)),
      ) ||
      String(snapshot.approvalRequestId) !== String(row.approvalRequestId) ||
      snapshot.fingerprint !==
        earlyExitDigest([
          String(row.studentId),
          { exitDate: snapshot.exitDate, reason: snapshot.reason },
        ]) ||
      !event ||
      event.action !== (index === 0 ? 'submitted' : 'resubmitted') ||
      event.at.getTime() !== snapshot.submittedAt.getTime() ||
      event.fingerprint !== snapshot.fingerprint
    )
      throw exitConflict();
  }
  const latest = snapshots.at(-1);
  if (row.cycle) {
    if (
      !approval ||
      !latest ||
      String(latest._id) !== String(row.submissionId) ||
      latest.fingerprint !== fingerprint ||
      String(approval.entityId) !== String(row._id) ||
      approval.entityType !== EARLY_EXIT_APPROVAL_ENTITY ||
      approval.approvalType !== 'early_exit_request' ||
      String(approval.branchId) !== String(row.branchId) ||
      String(approval.requesterId) !== String(row.requesterId) ||
      approval.earlyExitRevision !== latest.applicationRevision ||
      approval.status !== row.state ||
      !Number.isSafeInteger(approval.__v) ||
      approval.amount != null ||
      approval.delegatedTo ||
      approval.delegatedBy ||
      approval.delegationExpiresAt ||
      approval.supportingFileUrl ||
      approval.beforeData ||
      approval.afterData
    )
      throw exitConflict();
    const mirrored = row.history.filter(
      event => !['created', 'edited'].includes(event.action),
    );
    if (
      mirrored.length !== approval.history.length ||
      mirrored.some((event, index) => {
        const other = approval.history[index];
        return (
          !other ||
          event.action !== other.action ||
          String(event.actorId) !== String(other.performedBy) ||
          event.decisionReason !== other.reason ||
          event.at.getTime() !== other.createdAt?.getTime()
        );
      })
    )
      throw exitConflict();
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
      throw exitConflict();
  } else if (approval) throw exitConflict();
  return { row, snapshots, approval, latest, payload };
}
export type ExitGraph = Awaited<ReturnType<typeof readExitGraph>>;
export const exitReceiptDTO = (result: {
  requestId: string;
  approvalId: string | null;
  operationRevision: number;
  operationState: string;
  operationCycle: number;
}) => ({
  requestId: result.requestId,
  approvalId: result.approvalId,
  operationRevision: result.operationRevision,
  operationState: result.operationState,
  operationCycle: result.operationCycle,
});
export async function exitDTO(
  graph: ExitGraph,
  session: ClientSession,
  detail: boolean,
  routingVersion?: number,
) {
  const { row, approval, latest, snapshots } = graph;
  const custody = await StudentCustodyState.findOne({
    studentId: row.studentId,
    branchId: row.branchId,
    enrollmentId: row.enrollmentId,
  })
    .session(session)
    .lean();
  const routingCurrent =
    !!routingVersion && (!latest || routingVersion === latest.routingVersion);
  return {
    requestId: String(row._id),
    studentId: String(row.studentId),
    approvalId: approval ? String(approval._id) : null,
    exitDate: row.exitDate,
    state: row.state,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    eligibility: {
      operationallyEligible: false,
      physicalReleaseAllowed: false,
      schoolPolicyState: 'unconfigured',
      custodyState: custody?.state === 'hold' ? 'hold' : 'unknown',
    },
    reviewRoutingState: routingCurrent
      ? 'configured'
      : routingVersion
      ? 'revision_mismatch'
      : 'unconfigured',
    capabilities: {
      canEditDraft: row.state === 'draft',
      canSubmit: row.state === 'draft' && routingCurrent,
      canWithdraw: row.state === 'pending',
      canResubmit: row.state === 'changes_requested' && routingCurrent,
    },
    ...(detail
      ? {
          reason: row.reason,
          reviewVersion: approval
            ? {
                applicationRevision: row.revision,
                approvalVersion: approval.__v!,
              }
            : null,
          history: row.history.map(
            ({ action, revision, at, decisionReason }) => ({
              action,
              revision,
              at,
              ...(decisionReason ? { decisionReason } : {}),
            }),
          ),
          submissions: snapshots.map(snapshot => ({
            cycle: snapshot.cycle,
            applicationRevision: snapshot.applicationRevision,
            exitDate: snapshot.exitDate,
            reason: snapshot.reason,
            submittedAt: snapshot.submittedAt,
          })),
        }
      : {}),
  };
}
function queryPage(raw: unknown, id?: string, parent = false) {
  const query = objectBody(raw, parent ? ['offset', 'state'] : ['offset']);
  const offset = query.offset === undefined ? 0 : Number(query.offset);
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 100000 ||
    (id && Object.keys(query).length)
  )
    throw new RequestContractError(400, 'Invalid Early Exit query');
  return {
    offset,
    state:
      query.state === undefined
        ? undefined
        : enumField(query.state, 'state', EARLY_EXIT_STATES),
  };
}
export async function readParentExits(
  identity: JwtPayload | undefined,
  token: string,
  studentId: string,
  rawId?: string,
  rawQuery: unknown = {},
) {
  const { offset, state } = queryPage(rawQuery, rawId, true);
  const id = rawId ? objectIdField(rawId, 'request ID') : undefined;
  const initial = await authorizeParentApplication(identity, token, studentId);
  const session = await mongoose.startSession();
  try {
    const result = await session.withTransaction(
      async () => {
        let routingVersion: number | undefined;
        try {
          routingVersion = (
            await verifyExitQueue(initial.provenance.branchId, session, false)
          ).version;
        } catch (error) {
          if (!(error instanceof RequestContractError && error.status === 503))
            throw error;
        }
        const rows = await EarlyExitRequest.find({
          ...initial.provenance,
          ...(id ? { _id: id } : {}),
          ...(state ? { state } : {}),
        })
          .select(EXIT_PRIVATE_FIELDS)
          .sort({ createdAt: -1, _id: -1 })
          .skip(offset)
          .limit(id ? 1 : 21)
          .session(session);
        const items = [];
        for (const row of rows.slice(0, 20)) {
          await exitSubject(row, session);
          items.push(
            await exitDTO(
              await readExitGraph(row, session),
              session,
              !!id,
              routingVersion,
            ),
          );
        }
        if (id && !items.length) throw exitUnavailable();
        return id
          ? items[0]
          : { items, nextOffset: rows.length > 20 ? offset + 20 : null };
      },
      { readPreference: 'primary', readConcern: { level: 'snapshot' } },
    );
    const final = await authorizeParentApplication(identity, token, studentId);
    if (
      JSON.stringify(initial.provenance) !== JSON.stringify(final.provenance) ||
      initial.loginId !== final.loginId ||
      String(initial.link.verifiedBy) !== String(final.link.verifiedBy) ||
      initial.link.verifiedAt?.getTime() !== final.link.verifiedAt?.getTime()
    )
      throw exitUnavailable();
    return result;
  } finally {
    await session.endSession();
  }
}
export async function exitReviewRecord(
  branchId: string,
  version: number,
  id: string,
  session: ClientSession,
) {
  const approval = await ApprovalRequest.findOne({
    _id: id,
    branchId,
    entityType: EARLY_EXIT_APPROVAL_ENTITY,
    approvalType: 'early_exit_request',
  })
    .session(session)
    .lean();
  const row =
    approval &&
    (await EarlyExitRequest.findOne({
      _id: approval.entityId,
      branchId,
      approvalRequestId: approval._id,
    })
      .select(EXIT_PRIVATE_FIELDS)
      .session(session));
  if (!row) throw exitUnavailable();
  const graph = await readExitGraph(row, session);
  if (graph.latest?.routingVersion !== version) throw exitConflict();
  return { graph, subject: await exitSubject(row, session) };
}
export async function readPrincipalExits(
  identity: JwtPayload | undefined,
  token: string,
  rawId?: string,
  rawQuery: unknown = {},
) {
  const initial = await exitReviewer(identity, token),
    { offset } = queryPage(rawQuery, rawId);
  const id = rawId ? objectIdField(rawId, 'approval ID') : undefined;
  const session = await mongoose.startSession(),
    checked: EarlyExitDocument[] = [];
  try {
    const result = await session.withTransaction(
      async () => {
        checked.length = 0;
        const reader = await exitReviewer(identity, token, session);
        const approvals = await ApprovalRequest.find({
          branchId: reader.branchId,
          entityType: EARLY_EXIT_APPROVAL_ENTITY,
          approvalType: 'early_exit_request',
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
            const { graph, subject } = await exitReviewRecord(
              reader.branchId,
              reader.routing.version,
              String(approval._id),
              session,
            );
            const manageable =
              graph.row.state === 'pending' &&
              ROLE_PERMISSIONS.principal.includes(
                PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE,
              );
            const dto = await exitDTO(
              graph,
              session,
              !!id,
              reader.routing.version,
            );
            checked.push(graph.row);
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
              if (id) throw exitUnavailable();
              continue;
            }
            throw error;
          }
        }
        if (id && !items.length) throw exitUnavailable();
        return id
          ? items[0]
          : { items, nextOffset: approvals.length > 20 ? offset + 20 : null };
      },
      { readPreference: 'primary', readConcern: { level: 'snapshot' } },
    );
    const final = await exitReviewer(identity, token);
    if (
      String(initial.actor._id) !== String(final.actor._id) ||
      initial.branchId !== final.branchId ||
      initial.routing.version !== final.routing.version ||
      String(initial.login._id) !== String(final.login._id)
    )
      throw exitUnavailable();
    for (const row of checked) await exitSubject(row);
    return result;
  } finally {
    await session.endSession();
  }
}
