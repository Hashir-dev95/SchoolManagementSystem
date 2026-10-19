import {
  TimetableVersion,
  TimetablePeriod,
  SubstituteAssignment,
} from '../models/timetable';
import User from '../models/user';
import type {ClientSession} from 'mongoose';
import {requireClassSubject} from './class-subject-context.service';
import {withAcademicCatalogLock} from './academic-catalog-lock.service';
import { withTimetablePublication } from './teacher-timetable.service';
import {
  currentAcademicActor,
  requireActiveAcademicBranch,
  getTeacherScope,
} from './teacher-scope.service';
import type { JwtPayload } from './jwt.service';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import { PERMISSIONS } from '../constants/permissions';
import {
  objectBody,
  objectIdField,
  RequestContractError,
  textField,
} from '../utils/request-validation';
import {
  scheduleDate,
  scheduleWeekday,
  addScheduleDays,
} from './school-date.service';
const missing = () =>
  new RequestContractError(404, 'Timetable reference not found');
const actorFor = async (identity: JwtPayload | undefined) => {
  const actor = await currentAcademicActor(identity);
  if (
    !['principal', 'super_admin'].includes(actor.role) ||
    !ROLE_PERMISSIONS[actor.role].includes(PERMISSIONS.TIMETABLE_MANAGE)
  )
    throw new RequestContractError(
      403,
      'Timetable management is not permitted',
    );
  if (actor.role === 'principal')
    await requireActiveAcademicBranch(actor.branchId?.toString());
  return actor;
};
const branchFor = async (
  actor: Awaited<ReturnType<typeof actorFor>>,
  requested: unknown,
) => {
  const branchId = objectIdField(
    requested ?? actor.branchId?.toString(),
    'branch ID',
  );
  if (actor.role === 'principal' && String(actor.branchId) !== branchId)
    throw missing();
  return requireActiveAcademicBranch(branchId);
};
const integer = (value: unknown, min: number, max: number) => {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    throw new RequestContractError(400, 'Invalid schedule number');
  return value;
};
const times = (start: unknown, end: unknown) => {
  const startTime = textField(start, 'start time', 5, 5),
    endTime = textField(end, 'end time', 5, 5);
  if (
    ![startTime, endTime].every(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)) ||
    startTime >= endTime
  )
    throw new RequestContractError(400, 'Invalid period time window');
  return { startTime, endTime };
};
const duplicate = (error: unknown): never => {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 11000
  )
    throw new RequestContractError(
      409,
      'Schedule revision or approved substitute already exists',
    );
  throw error;
};
type Slot = {
  teacherId: string;
  classId: string;
  sectionId: string;
  subjectId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  room: string;
};
const validateResponsibilities = async (branchId: string, slots: Slot[], session?: ClientSession) => {
  const teachers = [...new Set(slots.map(p => p.teacherId))];
  const scopes = new Map(
    await Promise.all(
      teachers.map(
        async teacherId =>
          [
            teacherId,
            await getTeacherScope({ userId: teacherId, role: 'teacher' }),
          ] as const,
      ),
    ),
  );
  for (const slot of slots) {
    await requireClassSubject(branchId, slot.classId, slot.subjectId, session);
    const scope = scopes.get(slot.teacherId)!;
    if (
      scope.branchId !== branchId ||
      !scope.tuples.some(
        t =>
          t.classId === slot.classId &&
          t.sectionId === slot.sectionId &&
          t.subjectId === slot.subjectId,
      )
    )
      throw missing();
  }
  for (let i = 0; i < slots.length; i++)
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i],
        b = slots[j];
      if (
        a.dayOfWeek === b.dayOfWeek &&
        a.startTime < b.endTime &&
        b.startTime < a.endTime &&
        (a.teacherId === b.teacherId ||
          a.sectionId === b.sectionId ||
          a.room === b.room)
      )
        throw new RequestContractError(
          409,
          'Conflicting periods in this version',
        );
    }
};
export const createTimetableVersion = async (
  identity: JwtPayload | undefined,
  body: unknown,
) => {
  const actor = await actorFor(identity);
  const input = objectBody(body, [
    'branchId',
    'versionNumber',
    'effectiveFrom',
    'effectiveUntil',
    'periods',
  ]);
  const branchId = await branchFor(actor, input.branchId);
  const versionNumber = integer(input.versionNumber, 1, 1000000);
  const effectiveFrom = scheduleDate(input.effectiveFrom),
    effectiveUntil = scheduleDate(input.effectiveUntil);
  if (
    effectiveUntil <= effectiveFrom ||
    effectiveUntil > addScheduleDays(effectiveFrom, 366)
  )
    throw new RequestContractError(
      400,
      'Version window must be positive and at most 366 days',
    );
  if (
    !Array.isArray(input.periods) ||
    !input.periods.length ||
    input.periods.length > 500
  )
    throw new RequestContractError(400, 'Expected 1 to 500 periods');
  const slots: Slot[] = input.periods.map(value => {
    const p = objectBody(value, [
      'teacherId',
      'classId',
      'sectionId',
      'subjectId',
      'dayOfWeek',
      'startTime',
      'endTime',
      'room',
    ]);
    return {
      teacherId: objectIdField(p.teacherId, 'teacher ID'),
      classId: objectIdField(p.classId, 'class ID'),
      sectionId: objectIdField(p.sectionId, 'section ID'),
      subjectId: objectIdField(p.subjectId, 'subject ID'),
      dayOfWeek: integer(p.dayOfWeek, 0, 6),
      ...times(p.startTime, p.endTime),
      room: textField(p.room, 'room', 120, 1),
    };
  });
  await validateResponsibilities(branchId, slots);
  await TimetableVersion.collection.createIndex(
    { branchId: 1, versionNumber: 1 },
    { unique: true },
  );
  try {
    return await withAcademicCatalogLock(branchId, async session => {
    await actorFor(identity);
    await validateResponsibilities(branchId, slots, session);
    const [version] = await TimetableVersion.create([{
      branchId,
      versionNumber,
      effectiveFrom,
      effectiveUntil,
      periodCount: slots.length,
      createdBy: actor._id,
    }], {session});
    await TimetablePeriod.insertMany(
      slots.map(p => ({ ...p, branchId, timetableVersionId: version._id })),
      {session},
    );
    return { versionId: String(version._id), status: version.status };
    });
  } catch (error) {
    return duplicate(error);
  }
};
export const approveTimetableVersion = async (
  identity: JwtPayload | undefined,
  id: unknown,
) => {
  const actor = await actorFor(identity),
    versionId = objectIdField(id, 'version ID');
  const version = await TimetableVersion.findById(versionId).lean();
  if (!version) throw missing();
  await branchFor(actor, String(version.branchId));
  if (version.status !== 'draft')
    throw new RequestContractError(409, 'Only a draft may be approved');
  const periods = await TimetablePeriod.find({
    timetableVersionId: version._id,
    branchId: version.branchId,
  })
    .select(
      'teacherId classId sectionId subjectId dayOfWeek startTime endTime room',
    )
    .lean();
  if (periods.length !== version.periodCount)
    throw new RequestContractError(409, 'Incomplete draft cannot be approved');
  await validateResponsibilities(
    String(version.branchId),
    periods.map(p => ({
      ...p,
      teacherId: String(p.teacherId),
      classId: String(p.classId),
      sectionId: String(p.sectionId),
      subjectId: String(p.subjectId),
    })),
  );
  const updated = await withTimetablePublication(
    String(version.branchId),
    undefined,
    async session => {
      await actorFor(identity);
      await validateResponsibilities(String(version.branchId), periods.map(p => ({...p, teacherId: String(p.teacherId), classId: String(p.classId), sectionId: String(p.sectionId), subjectId: String(p.subjectId)})), session);
      return TimetableVersion.findOneAndUpdate(
        { _id: version._id, status: 'draft' },
        {
          $set: {
            status: 'approved',
            approvedBy: actor._id,
            approvedAt: new Date(),
          },
        },
        { returnDocument: 'after', session },
      );
    },
  );
  if (!updated) throw new RequestContractError(409, 'Version state changed');
  return { versionId: String(updated._id), status: updated.status };
};
export const createSubstitute = async (
  identity: JwtPayload | undefined,
  body: unknown,
) => {
  const actor = await actorFor(identity),
    input = objectBody(body, [
      'periodId',
      'substituteTeacherId',
      'date',
      'startTime',
      'endTime',
      'room',
    ]);
  const periodId = objectIdField(input.periodId, 'period ID'),
    substituteTeacherId = objectIdField(
      input.substituteTeacherId,
      'substitute Teacher ID',
    );
  const period = await TimetablePeriod.findById(periodId).lean();
  if (!period) throw missing();
  const branchId = await branchFor(actor, String(period.branchId));
  const date = scheduleDate(input.date),
    clock = times(input.startTime, input.endTime);
  const version = await TimetableVersion.findOne({
    _id: period.timetableVersionId,
    branchId,
    status: 'approved',
    effectiveFrom: { $lte: date },
    effectiveUntil: { $gt: date },
  }).lean();
  if (!version || period.dayOfWeek !== scheduleWeekday(date)) throw missing();
  const teacher = await User.findOne({ role: 'teacher', isActive: true })
    .where('_id')
    .equals(substituteTeacherId)
    .where('branchId')
    .equals(branchId)
    .select('_id')
    .lean();
  if (!teacher) throw missing();
  await validateResponsibilities(branchId, [
    {
      ...period,
      teacherId: String(period.teacherId),
      classId: String(period.classId),
      sectionId: String(period.sectionId),
      subjectId: String(period.subjectId),
    },
  ]);
  return withAcademicCatalogLock(branchId, async session => {
  await requireClassSubject(branchId, String(period.classId), String(period.subjectId), session);
  const [substitute] = await SubstituteAssignment.create([{
    branchId,
    periodId,
    originalTeacherId: period.teacherId,
    substituteTeacherId,
    date,
    ...clock,
    room: textField(input.room, 'room', 120, 1),
    createdBy: actor._id,
  }], {session});
  return { substituteId: String(substitute._id), status: substitute.status };
  });
};
export const approveSubstitute = async (
  identity: JwtPayload | undefined,
  id: unknown,
) => {
  const actor = await actorFor(identity),
    substituteId = objectIdField(id, 'substitute ID');
  const substitute = await SubstituteAssignment.findById(substituteId).lean();
  if (!substitute) throw missing();
  const branchId = await branchFor(actor, String(substitute.branchId));
  if (substitute.status !== 'draft')
    throw new RequestContractError(409, 'Only a draft may be approved');
  const period = await TimetablePeriod.findOne({
    _id: substitute.periodId,
    branchId,
  }).lean();
  const version =
    period &&
    (await TimetableVersion.findOne({
      _id: period.timetableVersionId,
      branchId,
      status: 'approved',
      effectiveFrom: { $lte: substitute.date },
      effectiveUntil: { $gt: substitute.date },
    }).lean());
  const winner = await TimetableVersion.findOne({
    branchId,
    status: 'approved',
    effectiveFrom: { $lte: substitute.date },
    effectiveUntil: { $gt: substitute.date },
  })
    .sort({ versionNumber: -1 })
    .select('_id')
    .lean();
  if (
    !period ||
    !version ||
    String(winner?._id) !== String(version._id) ||
    period.dayOfWeek !== scheduleWeekday(substitute.date) ||
    !(await User.exists({ role: 'teacher', isActive: true })
      .where('_id')
      .equals(substitute.substituteTeacherId)
      .where('branchId')
      .equals(branchId))
  )
    throw missing();
  await validateResponsibilities(branchId, [
    {
      ...period,
      teacherId: String(period.teacherId),
      classId: String(period.classId),
      sectionId: String(period.sectionId),
      subjectId: String(period.subjectId),
    },
  ]);
  await SubstituteAssignment.collection.createIndex(
    { periodId: 1, date: 1 },
    {
      unique: true,
      partialFilterExpression: { status: 'approved' },
      name: 'one_approved_substitute',
    },
  );
  try {
    const updated = await withTimetablePublication(
      branchId,
      String(period._id),
      async session => {
        await requireClassSubject(branchId, String(period.classId), String(period.subjectId), session);
        return SubstituteAssignment.findOneAndUpdate(
          { _id: substitute._id, status: 'draft' },
          {
            $set: {
              status: 'approved',
              approvedBy: actor._id,
              approvedAt: new Date(),
            },
          },
          { returnDocument: 'after', session },
        );
      },
    );
    if (!updated)
      throw new RequestContractError(409, 'Substitute state changed');
    return { substituteId: String(updated._id), status: updated.status };
  } catch (error) {
    return duplicate(error);
  }
};
export const retireSchedule = async (
  identity: JwtPayload | undefined,
  id: unknown,
  substitute: boolean,
) => {
  const actor = await actorFor(identity),
    objectId = objectIdField(id, 'schedule ID');
  const record = substitute
    ? await SubstituteAssignment.findById(objectId)
        .select('_id branchId status')
        .lean()
    : await TimetableVersion.findById(objectId)
        .select('_id branchId status')
        .lean();
  if (!record) throw missing();
  await branchFor(actor, String(record.branchId));
  const update = {
    $set: { status: 'retired', retiredBy: actor._id, retiredAt: new Date() },
  };
  const result = substitute
    ? await SubstituteAssignment.updateOne(
        { _id: record._id, status: 'approved' },
        update,
      )
    : await TimetableVersion.updateOne(
        { _id: record._id, status: 'approved' },
        update,
      );
  if (!result.modifiedCount)
    throw new RequestContractError(
      409,
      'Only an approved schedule may be retired',
    );
  return { status: 'retired' };
};
