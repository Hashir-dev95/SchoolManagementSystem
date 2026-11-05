import { createHash } from 'node:crypto';
import type { InferSchemaType, Types } from 'mongoose';
import {
  ParentLeaveApplication,
  ParentLeaveEditOperation,
} from '../models/parentLeaveApplication';
import {
  authorizeParentApplication,
  createParentLeaveDraft,
  withParentApplicationWriteAuthority,
} from './parent-application-access.service';
import {
  assertParentLeaveRevision,
  normalizeParentLeaveDraft,
  parentLeaveFingerprint,
} from './parent-leave-application.policy';
import type { JwtPayload } from './jwt.service';
import {
  objectBody,
  objectIdField,
  RequestContractError,
} from '../utils/request-validation';

type Identity = JwtPayload | undefined;
type Access = Awaited<ReturnType<typeof authorizeParentApplication>>;
type Draft = InferSchemaType<typeof ParentLeaveApplication.schema> & {
  _id: Types.ObjectId;
};
const unavailable = () =>
  new RequestContractError(404, 'Application or child access is unavailable');
const same = (a: Access, b: Access) =>
  JSON.stringify([
    a.provenance,
    a.loginId,
    a.link.verifiedBy,
    a.link.verifiedAt,
  ]) ===
  JSON.stringify([
    b.provenance,
    b.loginId,
    b.link.verifiedBy,
    b.link.verifiedAt,
  ]);
const summary = (row: Draft) => ({
  applicationId: String(row._id),
  studentId: String(row.studentId),
  state: row.state,
  leaveType: row.leaveType,
  startDate: row.startDate,
  endDate: row.endDate,
  revision: row.revision,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
const detail = (row: Draft) => ({
  ...summary(row),
  reason: row.reason,
  history: row.history.map(event => ({
    action: event.action,
    revision: event.revision,
    at: event.at,
  })),
});
export async function listParentLeaveDrafts(
  identity: Identity,
  token: string,
  studentId: string,
  query: unknown,
) {
  const body = objectBody(query, ['offset', 'limit']);
  const number = (value: unknown, fallback: number, max: number) => {
    if (value === undefined) return fallback;
    if (
      typeof value !== 'string' ||
      !/^\d+$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) > max
    )
      throw new RequestContractError(400, 'Invalid page');
    return Number(value);
  };
  const offset = number(body.offset, 0, 100000),
    limit = number(body.limit, 25, 50);
  if (!limit) throw new RequestContractError(400, 'Invalid page');
  const initial = await authorizeParentApplication(identity, token, studentId);
  const scope = initial.provenance;
  const [rows, total] = await Promise.all([
    ParentLeaveApplication.find(scope)
      .sort({ createdAt: -1, _id: -1 })
      .skip(offset)
      .limit(limit)
      .read('primary')
      .lean(),
    ParentLeaveApplication.countDocuments(scope).read('primary'),
  ]);
  if (
    !same(initial, await authorizeParentApplication(identity, token, studentId))
  )
    throw unavailable();
  return { items: rows.map(summary), total, offset, limit };
}
export async function readParentLeaveDraft(
  identity: Identity,
  token: string,
  studentId: string,
  applicationId: string,
) {
  const initial = await authorizeParentApplication(
    identity,
    token,
    studentId,
    applicationId,
  );
  const row = await ParentLeaveApplication.findOne({
    _id: applicationId,
    ...initial.provenance,
  })
    .select('+reason')
    .read('primary')
    .lean();
  if (
    !row ||
    !same(
      initial,
      await authorizeParentApplication(
        identity,
        token,
        studentId,
        applicationId,
      ),
    )
  )
    throw unavailable();
  return detail(row);
}
export async function saveNewParentLeaveDraft(
  identity: Identity,
  token: string,
  studentId: string,
  raw: unknown,
) {
  const acknowledgement = await createParentLeaveDraft(
    identity,
    token,
    studentId,
    raw,
  );
  return {
    ...acknowledgement,
    application: await readParentLeaveDraft(
      identity,
      token,
      studentId,
      acknowledgement.applicationId,
    ),
  };
}
export async function editParentLeaveDraft(
  identity: Identity,
  token: string,
  studentId: string,
  applicationId: string,
  raw: unknown,
) {
  const body = objectBody(raw, [
    'leaveType',
    'startDate',
    'endDate',
    'reason',
    'clientOperationId',
    'revision',
  ]);
  assertParentLeaveRevision(body.revision, body.revision);
  if (body.revision === Number.MAX_SAFE_INTEGER)
    throw new RequestContractError(409, 'Application revision is exhausted');
  const { revision, ...draftBody } = body;
  const { payload, clientOperationId } = normalizeParentLeaveDraft(draftBody);
  const id = objectIdField(applicationId, 'application ID');
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        'parent_leave_edit_v1',
        id,
        revision,
        parentLeaveFingerprint(studentId, payload),
      ]),
    )
    .digest('hex');
  const acknowledgement = await withParentApplicationWriteAuthority(
    identity,
    token,
    studentId,
    async (session, access) => {
      const owner = {
        requesterId: access.provenance.requesterId,
        clientOperationId,
      };
      const previous = await ParentLeaveEditOperation.findOne(owner)
        .select('+fingerprint')
        .session(session)
        .lean();
      if (previous) {
        if (
          String(previous.applicationId) !== id ||
          String(previous.branchId) !== access.provenance.branchId ||
          String(previous.studentId) !== access.provenance.studentId ||
          previous.fingerprint !== fingerprint
        )
          throw new RequestContractError(409, 'Operation was used differently');
        return {
          applicationId: id,
          operationRevision: previous.resultRevision,
          replayed: true,
        };
      }
      const row = await ParentLeaveApplication.findOne({
        _id: id,
        ...access.provenance,
      }).session(session);
      if (!row) throw unavailable();
      assertParentLeaveRevision(row.revision, revision);
      if (row.state !== 'draft' || row.approvalRequestId)
        throw new RequestContractError(
          409,
          'Only an unsubmitted draft can be edited',
        );
      // save() validates the entire history and the draft-only invariant. Both the
      // explicit revision and Mongoose __v CAS protect this trusted mutation.
      row.set(payload);
      row.revision += 1;
      row.history.push({
        action: 'draft_edited',
        actorId: access.parent.actor._id,
        revision: row.revision,
        at: new Date(),
      });
      await row.save({ session });
      await ParentLeaveEditOperation.create(
        [
          {
            ...owner,
            branchId: access.provenance.branchId,
            studentId: access.provenance.studentId,
            applicationId: id,
            fingerprint,
            resultRevision: row.revision,
          },
        ],
        { session },
      );
      return {
        applicationId: id,
        operationRevision: row.revision,
        replayed: false,
      };
    },
    id,
  );
  // A failed/denied response read does not undo an already committed draft edit.
  // Retrying the same receipt safely acknowledges it before reading current data.
  return {
    ...acknowledgement,
    application: await readParentLeaveDraft(identity, token, studentId, id),
  };
}
