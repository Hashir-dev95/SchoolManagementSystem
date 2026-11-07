import { createHmac } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import User from '../models/user';
import Student from '../models/student';
import { StudentEnrollment } from '../models/studentEnrollment';
import { AcademicPeriod } from '../models/academicPeriod';
import SchoolClass from '../models/schoolClass';
import Section from '../models/section';
import {
  Gate,
  GateStaffAssignment,
  StudentCustodyState,
  GateAdminOperation,
  GATE_DUTIES,
  GATE_SNAPSHOT_FIELDS,
  ASSIGNMENT_SNAPSHOT_FIELDS,
  CUSTODY_SNAPSHOT_FIELDS,
} from '../models/gateFoundation';
import { PERMISSIONS, type Permission } from '../constants/permissions';
import { teacherAccountBody } from './teacher-provisioning.service';
import { createUser } from './auth.service';
import type { JwtPayload } from './jwt.service';
import { communicationFence } from './teacher-communication-access.service';
import { resolveStudentReadScope } from './student-self-scope.service';
import {
  gateConflict,
  gateUnavailable,
  withGateAdministration,
} from './gate-authority.service';
import {
  dateField,
  enumField,
  objectBody,
  objectIdField,
  RequestContractError,
  textField,
} from '../utils/request-validation';

const revisionField = (value: unknown) => {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) >= Number.MAX_SAFE_INTEGER
  )
    throw new RequestContractError(400, 'Invalid revision');
  return value as number;
};
const booleanField = (value: unknown) => {
  if (typeof value !== 'boolean')
    throw new RequestContractError(400, 'Invalid active state');
  return value;
};
function command(raw: unknown, fields: readonly string[]) {
  const body = objectBody(raw, [...fields, 'clientOperationId', 'reason']);
  return {
    body,
    operation: textField(body.clientOperationId, 'operation ID', 100, 1),
    reason: textField(body.reason, 'audit reason', 500, 10),
  };
}
type AuditAction = 'created' | 'updated' | 'revoked' | 'held' | 'reset';
function event(
  actorId: string,
  reason: string,
  revision: number,
  action: AuditAction,
  values: Record<string, unknown>,
) {
  return { actorId, reason, revision, action, snapshot: values, at: new Date() };
}
function snapshot(
  row: { get: (field: string) => unknown },
  fields: readonly string[],
) {
  return Object.fromEntries(fields.map(field => [field, row.get(field)]));
}
const gateDTO = (row: {
  _id: unknown;
  code: string;
  name: string;
  isActive: boolean;
  revision: number;
}) => ({
  id: String(row._id),
  code: row.code,
  name: row.name,
  isActive: row.isActive,
  revision: row.revision,
});
const assignmentDTO = (row: {
  _id: unknown;
  gateId: unknown;
  operatorId: unknown;
  status: string;
  revision: number;
  duties: string[];
  validFrom: Date;
  validUntil: Date;
}) => ({
  id: String(row._id),
  gateId: String(row.gateId),
  operatorId: String(row.operatorId),
  status: row.status,
  revision: row.revision,
  duties: row.duties,
  validFrom: row.validFrom,
  validUntil: row.validUntil,
});

async function operation<T>(
  identity: JwtPayload | undefined,
  token: string,
  branch: unknown,
  permission: Permission,
  operationId: string,
  payload: unknown,
  write: (
    session: ClientSession,
    branchId: string,
    actorId: string,
  ) => Promise<T>,
) {
  try {
    return await withGateAdministration(
      identity,
      token,
      branch,
      permission,
      async (session, branchId, actorId) => {
        const fingerprint = createHmac('sha256', process.env.JWT_SECRET!)
          .update(JSON.stringify(['gate_admin_v1', branchId, payload]))
          .digest('hex');
        const key = { actorId, clientOperationId: operationId };
        const prior = await GateAdminOperation.findOne(key)
          .select('+fingerprint +result')
          .session(session)
          .lean();
        if (prior) {
          if (
            String(prior.branchId) !== branchId ||
            prior.fingerprint !== fingerprint
          )
            throw gateConflict();
          return prior.result as T;
        }
        const result = await write(session, branchId, actorId);
        await GateAdminOperation.create(
          [{ ...key, branchId, fingerprint, result }],
          { session },
        );
        return result;
      },
    );
  } catch (error) {
    if (
      (error as { code?: number }).code === 11000 ||
      (error instanceof Error &&
        (error.name === 'VersionError' ||
          error.message === 'User with this email already exists'))
    )
      throw gateConflict();
    throw error;
  }
}

export async function provisionGateOperator(
  identity: JwtPayload | undefined,
  token: string,
  branch: unknown,
  raw: unknown,
) {
  const {
    body,
    operation: id,
    reason,
  } = command(raw, ['fullName', 'email', 'password']);
  const payload = teacherAccountBody({
    fullName: body.fullName,
    email: body.email,
    password: body.password,
    branchId: branch,
  });
  return operation(
    identity,
    token,
    branch,
    PERMISSIONS.GATE_OPERATORS_PROVISION,
    id,
    ['operator', payload, reason],
    async (session, branchId, actorId) => {
      const user = await createUser(
        { ...payload, branchId, role: 'gate_staff' },
        { session },
      );
      return {
        id: String(user._id),
        fullName: user.fullName,
        email: user.email,
        role: 'gate_staff',
        branchId,
        createdBy: actorId,
      };
    },
  );
}

export async function createGate(
  identity: JwtPayload | undefined,
  token: string,
  branch: unknown,
  raw: unknown,
) {
  const { body, operation: id, reason } = command(raw, ['code', 'name']);
  const code = textField(body.code, 'gate code', 40, 1).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(code))
    throw new RequestContractError(400, 'Invalid gate code');
  const name = textField(body.name, 'gate name', 100, 2);
  return operation(
    identity,
    token,
    branch,
    PERMISSIONS.GATE_REGISTRY_MANAGE,
    id,
    ['gate', code, name, reason],
    async (session, branchId, actorId) => {
      const values = { code, name, isActive: true };
      const [row] = await Gate.create(
        [
          {
            branchId,
            ...values,
            revision: 1,
            createdBy: actorId,
            updatedBy: actorId,
            history: [event(actorId, reason, 1, 'created', values)],
          },
        ],
        { session },
      );
      return gateDTO(row);
    },
  );
}

export async function updateGate(
  identity: JwtPayload | undefined,
  token: string,
  branch: unknown,
  gateId: unknown,
  raw: unknown,
) {
  const {
    body,
    operation: id,
    reason,
  } = command(raw, ['name', 'isActive', 'revision']);
  const gate = objectIdField(gateId, 'Gate ID');
  const revision = revisionField(body.revision);
  const name = textField(body.name, 'gate name', 100, 2),
    isActive = booleanField(body.isActive);
  return operation(
    identity,
    token,
    branch,
    PERMISSIONS.GATE_REGISTRY_MANAGE,
    id,
    ['update_gate', gate, revision, name, isActive, reason],
    async (session, branchId, actorId) => {
      const row = await Gate.findOne({ _id: gate, branchId })
        .select('+history')
        .session(session);
      if (!row) throw gateUnavailable();
      if (row.revision !== revision) throw gateConflict();
      row.$where = { revision };
      row.set({ name, isActive, revision: revision + 1, updatedBy: actorId });
      row.history.push(
        event(
          actorId,
          reason,
          row.revision,
          'updated',
          snapshot(row, GATE_SNAPSHOT_FIELDS),
        ),
      );
      await row.save({ session });
      return gateDTO(row);
    },
  );
}

export async function assignGateOperator(
  identity: JwtPayload | undefined,
  token: string,
  branch: unknown,
  gateId: unknown,
  raw: unknown,
) {
  const {
    body,
    operation: id,
    reason,
  } = command(raw, ['operatorId', 'duties', 'validFrom', 'validUntil']);
  const gate = objectIdField(gateId, 'Gate ID'),
    operatorId = objectIdField(body.operatorId, 'operator ID');
  if (
    !Array.isArray(body.duties) ||
    !body.duties.length ||
    new Set(body.duties).size !== body.duties.length
  )
    throw new RequestContractError(400, 'Invalid duties');
  const duties = body.duties.map(d => enumField(d, 'duty', GATE_DUTIES)).sort();
  const validFrom = dateField(body.validFrom, 'valid from'),
    validUntil = dateField(body.validUntil, 'valid until');
  if (validUntil <= validFrom || validUntil.getTime() <= Date.now())
    throw new RequestContractError(400, 'Invalid assignment interval');
  return operation(
    identity,
    token,
    branch,
    PERMISSIONS.GATE_ASSIGNMENTS_MANAGE,
    id,
    ['assign', gate, operatorId, duties, validFrom, validUntil, reason],
    async (session, branchId, actorId) => {
      if (actorId === operatorId)
        throw new RequestContractError(403, 'Self assignment is unavailable');
      await communicationFence(session, User.collection.name, operatorId);
      if (
        !(await User.exists({ role: 'gate_staff', isActive: true })
          .where('_id')
          .equals(operatorId)
          .where('branchId')
          .equals(branchId)
          .session(session)) ||
        !(await Gate.exists({ _id: gate, branchId, isActive: true }).session(
          session,
        ))
      )
        throw gateUnavailable();
      if (validUntil.getTime() <= Date.now()) throw gateConflict();
      if (
        await GateStaffAssignment.exists({
          operatorId,
          status: 'active',
          $or: [
            { gateId: gate },
            { validFrom: { $lt: validUntil }, validUntil: { $gt: validFrom } },
          ],
        }).session(session)
      )
        throw gateConflict();
      const values = {
        duties,
        validFrom,
        validUntil,
        status: 'active' as const,
      };
      const [row] = await GateStaffAssignment.create(
        [
          {
            branchId,
            gateId: gate,
            operatorId,
            ...values,
            revision: 1,
            createdBy: actorId,
            updatedBy: actorId,
            history: [event(actorId, reason, 1, 'created', values)],
          },
        ],
        { session },
      );
      return assignmentDTO(row);
    },
  );
}

export async function revokeGateAssignment(
  identity: JwtPayload | undefined,
  token: string,
  branch: unknown,
  assignmentId: unknown,
  raw: unknown,
) {
  const { body, operation: id, reason } = command(raw, ['revision']);
  const assignment = objectIdField(assignmentId, 'assignment ID'),
    revision = revisionField(body.revision);
  return operation(
    identity,
    token,
    branch,
    PERMISSIONS.GATE_ASSIGNMENTS_MANAGE,
    id,
    ['revoke', assignment, revision, reason],
    async (session, branchId, actorId) => {
      const row = await GateStaffAssignment.findOne({
        _id: assignment,
        branchId,
      })
        .select('+history')
        .session(session);
      if (!row) throw gateUnavailable();
      if (row.status !== 'active' || row.revision !== revision)
        throw gateConflict();
      row.$where = { revision, status: 'active' };
      row.set({
        status: 'revoked',
        revokedAt: new Date(),
        revokedBy: actorId,
        updatedBy: actorId,
        revision: revision + 1,
      });
      row.history.push(
        event(
          actorId,
          reason,
          row.revision,
          'revoked',
          snapshot(row, ASSIGNMENT_SNAPSHOT_FIELDS),
        ),
      );
      await row.save({ session });
      return assignmentDTO(row);
    },
  );
}

async function studentScope(
  branchId: string,
  rawId: unknown,
  session: ClientSession,
) {
  const student = await Student.findOne({ isActive: true })
    .where('_id')
    .equals(objectIdField(rawId, 'Student ID'))
    .where('branchId')
    .equals(branchId)
    .session(session)
    .lean();
  if (!student) throw gateUnavailable();
  try {
    return await resolveStudentReadScope(
      String(student.userId),
      branchId,
      session,
    );
  } catch (error) {
    if (error instanceof RequestContractError && error.status === 403)
      throw gateUnavailable();
    throw error;
  }
}

export async function readStudentCustody(
  identity: JwtPayload | undefined,
  token: string,
  branch: unknown,
  studentId: unknown,
) {
  return withGateAdministration(
    identity,
    token,
    branch,
    PERMISSIONS.GATE_CUSTODY_MANAGE,
    async (session, branchId) => {
      const scope = await studentScope(branchId, studentId, session);
      const row = await StudentCustodyState.findOne({
        studentId: scope.student._id,
        branchId,
      })
        .session(session)
        .lean();
      const sourceCurrent =
        !!row && String(row.enrollmentId) === String(scope.enrollment._id);
      return {
        state: sourceCurrent && row.state === 'hold' ? 'hold' : 'unknown',
        revision: row?.revision ?? 0,
        sourceCurrent,
        automatedReleaseAllowed: false,
      };
    },
  );
}

export async function updateStudentCustody(
  identity: JwtPayload | undefined,
  token: string,
  branch: unknown,
  studentId: unknown,
  raw: unknown,
) {
  const { body, operation: id, reason } = command(raw, ['state', 'revision']);
  const state = enumField(body.state, 'custody state', [
      'unknown',
      'hold',
    ] as const),
    revision = revisionField(body.revision);
  const student = objectIdField(studentId, 'Student ID');
  return operation(
    identity,
    token,
    branch,
    PERMISSIONS.GATE_CUSTODY_MANAGE,
    id,
    ['custody', student, state, revision, reason],
    async (session, branchId, actorId) => {
      const scope = await studentScope(branchId, student, session);
      for (const [collection, key] of [
        [Student.collection.name, scope.student._id],
        [User.collection.name, scope.actor._id],
        [StudentEnrollment.collection.name, scope.enrollment._id],
        [AcademicPeriod.collection.name, scope.enrollment.academicPeriodId],
        [SchoolClass.collection.name, scope.enrollment.classId],
        [Section.collection.name, scope.enrollment.sectionId],
      ])
        await communicationFence(session, collection as string, String(key));
      const current = await studentScope(branchId, student, session);
      if (String(current.enrollment._id) !== String(scope.enrollment._id))
        throw gateConflict();
      let row = await StudentCustodyState.findOne({
        studentId: student,
        branchId,
      })
        .select('+history')
        .session(session);
      if (
        (row?.revision ?? 0) !== revision ||
        (row && String(row.enrollmentId) !== String(scope.enrollment._id))
      )
        throw gateConflict();
      const next = revision + 1,
        values = { state, authorityRevision: next };
      if (!row)
        row = new StudentCustodyState({
          studentId: student,
          branchId,
          enrollmentId: scope.enrollment._id,
          academicPeriodId: scope.enrollment.academicPeriodId,
          classId: scope.enrollment.classId,
          sectionId: scope.enrollment.sectionId,
          createdBy: actorId,
          updatedBy: actorId,
          revision: next,
          ...values,
          history: [
            event(
              actorId,
              reason,
              next,
              state === 'hold' ? 'held' : 'reset',
              values,
            ),
          ],
        });
      else {
        row.$where = { revision };
        row.set({ ...values, revision: next, updatedBy: actorId });
        row.history.push(
          event(
            actorId,
            reason,
            next,
            state === 'hold' ? 'held' : 'reset',
            snapshot(row, CUSTODY_SNAPSHOT_FIELDS),
          ),
        );
      }
      await row.save({ session });
      return { state, revision: next, automatedReleaseAllowed: false };
    },
  );
}
