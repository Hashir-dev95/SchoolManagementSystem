import { Types, type ClientSession } from 'mongoose';
import ApprovalRequest, {
  EARLY_EXIT_APPROVAL_ENTITY,
  type IApprovalRequest,
} from '../models/approvalRequest';
import {
  EarlyExitRequest,
  EarlyExitSubmission,
  EarlyExitOperation,
  EARLY_EXIT_PROVENANCE,
  earlyExitDigest,
} from '../models/earlyExitRequest';
import User from '../models/user';
import Session from '../models/session';
import Student from '../models/student';
import { StudentEnrollment } from '../models/studentEnrollment';
import { ParentStudentLink } from '../models/parentStudentLink';
import { AcademicPeriod } from '../models/academicPeriod';
import SchoolClass from '../models/schoolClass';
import Section from '../models/section';
import type { JwtPayload } from './jwt.service';
import { withParentApplicationWriteAuthority } from './parent-application-access.service';
import { withAcademicCatalogLock } from './academic-catalog-lock.service';
import { communicationFence } from './teacher-communication-access.service';
import {
  objectBody,
  objectIdField,
  textField,
  enumField,
  RequestContractError,
} from '../utils/request-validation';
import {
  exitConflict,
  exitUnavailable,
  exitPayload,
  exitRevision,
  assertExitDate,
  verifyExitQueue,
  exitReviewer,
  exitSubject,
  requireEarlyExitApprovalPolicy,
} from './early-exit-authority.service';
import {
  EXIT_PRIVATE_FIELDS,
  readExitGraph,
  type ExitGraph,
  exitReceiptDTO,
  readParentExits,
  readPrincipalExits,
  exitReviewRecord,
} from './early-exit-read.service';

export type ExitAction = 'create' | 'edit' | 'submit' | 'withdraw' | 'resubmit';
async function receipt(
  actorId: string,
  nonce: string,
  fingerprint: string,
  branchId: string,
  studentId: string,
  session: ClientSession,
) {
  const prior = await EarlyExitOperation.findOne({
    actorId,
    clientOperationId: nonce,
  })
    .select('+result +fingerprint')
    .session(session)
    .lean();
  if (
    prior &&
    (prior.fingerprint !== fingerprint ||
      String(prior.branchId) !== branchId ||
      String(prior.studentId) !== studentId)
  )
    throw exitConflict();
  return prior;
}
async function advance(
  graph: ExitGraph,
  state: 'pending' | 'withdrawn' | 'rejected' | 'changes_requested',
  actorId: string,
  at: Date,
  action: 'resubmitted' | 'withdrawn' | 'rejected' | 'changes_requested',
  submittedRevision: number,
  session: ClientSession,
  reason?: string,
) {
  const { approval, row, latest } = graph;
  if (!approval || !latest) throw exitConflict();
  const reviewed = state === 'rejected' || state === 'changes_requested';
  const result = await ApprovalRequest.db
    .collection<IApprovalRequest>(ApprovalRequest.collection.name)
    .updateOne(
      {
        _id: approval._id,
        entityId: row._id,
        entityType: EARLY_EXIT_APPROVAL_ENTITY,
        approvalType: 'early_exit_request',
        branchId: row.branchId,
        requesterId: row.requesterId,
        status: approval.status,
        earlyExitRevision: latest.applicationRevision,
        __v: approval.__v,
      },
      {
        $set: {
          status: state,
          earlyExitRevision: submittedRevision,
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
  if (result.modifiedCount !== 1) throw exitConflict();
}
export async function writeParentExit(
  kind: ExitAction,
  identity: JwtPayload | undefined,
  token: string,
  studentId: string,
  rawId: string | undefined,
  raw: unknown,
) {
  const hasPayload = ['create', 'edit', 'resubmit'].includes(kind),
    linked = ['withdraw', 'resubmit'].includes(kind);
  const body = objectBody(raw, [
    'clientOperationId',
    ...(hasPayload ? ['exitDate', 'reason'] : []),
    ...(kind !== 'create' ? ['applicationRevision'] : []),
    ...(linked ? ['approvalVersion'] : []),
  ]);
  const nonce = textField(body.clientOperationId, 'operation ID', 120, 1),
    payload = hasPayload ? exitPayload(body) : undefined;
  const revision =
      kind === 'create' ? undefined : exitRevision(body.applicationRevision),
    approvalVersion = linked ? exitRevision(body.approvalVersion) : undefined;
  const id = rawId ? objectIdField(rawId, 'request ID') : undefined;
  const acknowledged = await withParentApplicationWriteAuthority(
    identity,
    token,
    studentId,
    async (session, access) => {
      const {
        requesterId: actorId,
        branchId,
        studentId: child,
      } = access.provenance;
      const fingerprint = earlyExitDigest([
        'early_exit_operation_v1',
        kind,
        child,
        id ?? null,
        revision,
        approvalVersion,
        payload,
      ]);
      let row = id
        ? await EarlyExitRequest.findOne({ _id: id, ...access.provenance })
            .select(EXIT_PRIVATE_FIELDS)
            .session(session)
        : null;
      if (kind !== 'create' && !row) throw exitUnavailable();
      const prior = await receipt(
        actorId,
        nonce,
        fingerprint,
        branchId,
        child,
        session,
      );
      if (prior) {
        const current =
          row ??
          (await EarlyExitRequest.findOne({
            _id: prior.requestId,
            ...access.provenance,
          })
            .select(EXIT_PRIVATE_FIELDS)
            .session(session));
        if (
          !current ||
          String(current._id) !== String(prior.requestId) ||
          prior.kind !== kind
        )
          throw exitUnavailable();
        const graph = await readExitGraph(current, session);
        if (
          graph.latest &&
          kind !== 'withdraw' &&
          (await verifyExitQueue(branchId, session)).version !==
            graph.latest.routingVersion
        )
          throw exitConflict();
        return { ...exitReceiptDTO(prior.result), replayed: true };
      }
      let graph: ExitGraph;
      if (kind === 'create') {
        assertExitDate(payload!, access.scope);
        const at = new Date();
        row = new EarlyExitRequest({
          ...access.provenance,
          ...payload,
          history: [
            {
              action: 'created',
              revision: 0,
              actorId,
              at,
              fingerprint: earlyExitDigest([child, payload]),
            },
          ],
        });
        await row.save({ session });
        graph = await readExitGraph(row, session);
      } else {
        graph = await readExitGraph(row!, session);
        if (
          row!.revision !== revision ||
          (linked && graph.approval?.__v !== approvalVersion)
        )
          throw exitConflict();
        const expected =
          kind === 'edit' || kind === 'submit'
            ? 'draft'
            : kind === 'resubmit'
            ? 'changes_requested'
            : 'pending';
        if (row!.state !== expected) throw exitConflict();
        if (payload) assertExitDate(payload, access.scope);
        row!.$where = {
          revision,
          state: expected,
          approvalRequestId: row!.approvalRequestId ?? null,
        };
        if (payload) row!.set(payload);
        row!.revision++;
        const action =
          kind === 'edit'
            ? 'edited'
            : kind === 'submit'
            ? 'submitted'
            : kind === 'resubmit'
            ? 'resubmitted'
            : 'withdrawn';
        const nextPayload = payload ?? graph.payload,
          at = new Date();
        if (kind === 'submit' || kind === 'resubmit') {
          assertExitDate(nextPayload, access.scope);
          const routing = await verifyExitQueue(branchId, session);
          if (graph.latest && graph.latest.routingVersion !== routing.version)
            throw exitConflict();
          if (kind === 'submit') {
            const [approval] = await ApprovalRequest.create(
              [
                {
                  entityType: EARLY_EXIT_APPROVAL_ENTITY,
                  entityId: row!._id,
                  approvalType: 'early_exit_request',
                  requesterId: actorId,
                  branchId,
                  reason: 'Early Exit proposal',
                  status: 'pending',
                  earlyExitRevision: row!.revision,
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
            await advance(
              graph,
              'pending',
              actorId,
              at,
              'resubmitted',
              row!.revision,
              session,
            );
          const linkedApproval = row!.approvalRequestId;
          if (!linkedApproval) throw exitConflict();
          const [snapshot] = await EarlyExitSubmission.create(
            [
              {
                ...access.provenance,
                requestId: row!._id,
                approvalRequestId: linkedApproval,
                applicationRevision: row!.revision,
                cycle: row!.cycle + 1,
                ...nextPayload,
                fingerprint: earlyExitDigest([child, nextPayload]),
                routingVersion: routing.version,
                submittedAt: at,
              },
            ],
            { session },
          );
          row!.submissionId = snapshot._id;
          row!.cycle++;
          row!.state = 'pending';
        } else if (kind === 'withdraw') {
          await advance(
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
          fingerprint: earlyExitDigest([child, nextPayload]),
        });
        await row!.save({ session });
        graph = await readExitGraph(row!, session);
      }
      const result = {
        requestId: String(graph.row._id),
        approvalId: graph.approval ? String(graph.approval._id) : null,
        operationRevision: graph.row.revision,
        operationState: graph.row.state,
        operationCycle: graph.row.cycle,
      };
      await EarlyExitOperation.create(
        [
          {
            actorId,
            requestId: graph.row._id,
            branchId,
            studentId: child,
            clientOperationId: nonce,
            kind,
            fingerprint,
            result,
          },
        ],
        { session },
      );
      if (kind === 'submit' || kind === 'resubmit') {
        if (
          (await verifyExitQueue(branchId, session)).version !==
          graph.latest?.routingVersion
        )
          throw exitConflict();
      }
      return { ...result, replayed: false };
    },
  );
  return {
    ...acknowledged,
    request: await readParentExits(
      identity,
      token,
      studentId,
      acknowledged.requestId,
    ),
  };
}
export async function decideEarlyExit(
  identity: JwtPayload | undefined,
  token: string,
  rawId: string,
  raw: unknown,
) {
  const initial = await exitReviewer(identity, token, undefined, true),
    id = objectIdField(rawId, 'approval ID');
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
  const revision = exitRevision(body.applicationRevision),
    approvalVersion = exitRevision(body.approvalVersion),
    nonce = textField(body.clientOperationId, 'operation ID', 120, 1);
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
  const acknowledged = await withAcademicCatalogLock(
    initial.branchId,
    async session => {
      const reader = await exitReviewer(identity, token, session, true);
      if (
        reader.branchId !== initial.branchId ||
        reader.routing.version !== initial.routing.version
      )
        throw exitConflict();
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
      const { graph, subject } = await exitReviewRecord(
        reader.branchId,
        reader.routing.version,
        id,
        session,
      );
      if (String(graph.row.requesterId) === String(reader.actor._id))
        throw new RequestContractError(
          403,
          'Requester cannot review their own request',
        );
      const collections = {
        requesterId: User,
        studentId: Student,
        branchId: null,
        parentStudentLinkId: ParentStudentLink,
        enrollmentId: StudentEnrollment,
        academicPeriodId: AcademicPeriod,
        classId: SchoolClass,
        sectionId: Section,
      };
      const dependencies = EARLY_EXIT_PROVENANCE.filter(
        key => key !== 'branchId',
      ).map(key => [
        collections[key]!.collection.name,
        String(graph.row.get(key)),
      ]);
      dependencies.push(
        [User.collection.name, String(subject.scope.actor._id)],
        [User.collection.name, String(subject.link.verifiedBy)],
      );
      for (const [collection, sourceId] of [
        ...new Map(dependencies.map(pair => [pair.join(':'), pair])).values(),
      ].sort(([a, x], [b, y]) => (a + x).localeCompare(b + y)))
        await communicationFence(session, collection, sourceId);
      const child = String(graph.row.studentId),
        actorId = String(reader.actor._id),
        fingerprint = earlyExitDigest([
          'early_exit_decision_v1',
          id,
          String(graph.row._id),
          action,
          revision,
          approvalVersion,
          reason,
        ]);
      const prior = await receipt(
        actorId,
        nonce,
        fingerprint,
        reader.branchId,
        child,
        session,
      );
      if (prior) {
        if (
          prior.kind !== action ||
          String(prior.requestId) !== String(graph.row._id)
        )
          throw exitConflict();
        await exitReviewer(identity, token, session, true);
        return { ...exitReceiptDTO(prior.result), replayed: true };
      }
      if (
        graph.row.state !== 'pending' ||
        graph.row.revision !== revision ||
        graph.approval?.__v !== approvalVersion
      )
        throw exitConflict();
      if (action === 'approve') requireEarlyExitApprovalPolicy();
      const state = action === 'reject' ? 'rejected' : 'changes_requested',
        at = new Date();
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
        revision: graph.row.revision,
        at,
        decisionReason: reason,
        fingerprint: graph.latest!.fingerprint,
      });
      await graph.row.save({ session });
      await advance(
        graph,
        state,
        actorId,
        at,
        state,
        graph.latest!.applicationRevision,
        session,
        reason,
      );
      const result = {
        requestId: String(graph.row._id),
        approvalId: id,
        operationRevision: graph.row.revision,
        operationState: state,
        operationCycle: graph.row.cycle,
      };
      await EarlyExitOperation.create(
        [
          {
            actorId,
            requestId: graph.row._id,
            branchId: reader.branchId,
            studentId: child,
            clientOperationId: nonce,
            kind: action,
            fingerprint,
            result,
          },
        ],
        { session },
      );
      const final = await exitReviewer(identity, token, session, true);
      if (
        final.branchId !== reader.branchId ||
        final.routing.version !== reader.routing.version ||
        String(final.login._id) !== String(reader.login._id)
      )
        throw exitConflict();
      await exitSubject(graph.row, session);
      return { ...result, replayed: false };
    },
  );
  return {
    ...acknowledged,
    request: await readPrincipalExits(identity, token, id),
  };
}
