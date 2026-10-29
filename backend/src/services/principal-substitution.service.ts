import { createHash } from 'node:crypto';
import { Types, type ClientSession } from 'mongoose';
import { TimetablePeriod, SubstituteAssignment } from '../models/timetable';
import {
  operationalTimetableVersions,
  effectiveTimetableOccurrence,
} from './timetable-occurrence.service';
import User from '../models/user';
import SchoolClass from '../models/schoolClass';
import Section from '../models/section';
import Subject from '../models/subject';
import TeacherAssignment from '../models/teacherAssignment';
import {
  currentAcademicActor,
  requireActiveAcademicBranch,
} from './teacher-scope.service';
import {
  validateReplacement,
  validateSubstituteRoom,
  withSubstitutionWrite,
  requireRoom,
} from './timetable-admin.service';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import { PERMISSIONS } from '../constants/permissions';
import type { JwtPayload } from './jwt.service';
import {
  objectBody,
  objectIdField,
  RequestContractError,
  textField,
} from '../utils/request-validation';
import {
  scheduleDate,
  scheduleWeekday,
  schoolToday,
  schoolDateTime,
  schoolTimezone,
} from './school-date.service';

const missing = () =>
  new RequestContractError(404, 'Scheduled lesson is unavailable');
const stale = () =>
  new RequestContractError(409, 'Schedule updated. Reload the latest lesson.');
const reasons = [
  'Teacher absent',
  'Approved leave',
  'Emergency',
  'Official duty',
  'Schedule adjustment',
  'Other',
];
const authority = async (identity: JwtPayload | undefined) => {
  const actor = await currentAcademicActor(identity);
  if (
    actor.role !== 'principal' ||
    !ROLE_PERMISSIONS.principal.includes(PERMISSIONS.TIMETABLE_MANAGE)
  )
    throw new RequestContractError(
      403,
      'Substitution management is not permitted',
    );
  return {
    actor,
    branchId: await requireActiveAcademicBranch(actor.branchId?.toString()),
  };
};
const offsetFor = (value: unknown) => {
  const offset = value === undefined ? 0 : Number(value);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
    throw new RequestContractError(400, 'Invalid page');
  return offset;
};
// Bounded by the immutable version's 500-period contract. One batch of overrides
// is used for all candidate availability decisions, never one query per Teacher.
async function dayContext(
  branchId: string,
  date: string,
  session?: ClientSession,
) {
  const version = (
    await operationalTimetableVersions(branchId, [date], session)
  ).get(date);
  const periods = version
    ? await TimetablePeriod.find({
        branchId,
        timetableVersionId: version._id,
        dayOfWeek: scheduleWeekday(date),
      })
        .sort({ startTime: 1, _id: 1 })
        .session(session ?? null)
        .lean()
    : [];
  const history = await SubstituteAssignment.find({
    branchId,
    periodId: { $in: periods.map(p => p._id) },
    date,
  })
    .sort({ _id: 1 })
    .session(session ?? null)
    .lean();
  const assignments = await TeacherAssignment.find({
    branchId,
    isActive: true,
    teacherId: { $in: periods.map(p => p.teacherId) },
    validFrom: { $lte: new Date() },
    $or: [
      { validUntil: { $exists: false } },
      { validUntil: { $gt: new Date() } },
    ],
  })
    .session(session ?? null)
    .lean();
  return { date, version, periods, history, assignments };
}
type Context = Awaited<ReturnType<typeof dayContext>>;
type Period = Context['periods'][number];
function revision(context: Context, period: Period) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        context.date,
        String(context.version?._id),
        String(period._id),
        context.history
          .filter(h => String(h.periodId) === String(period._id))
          .map(h => [String(h._id), h.status]),
        context.assignments
          .filter(
            a =>
              String(a.teacherId) === String(period.teacherId) &&
              String(a.classId) === String(period.classId) &&
              String(a.sectionId) === String(period.sectionId) &&
              String(a.subjectId) === String(period.subjectId),
          )
          .map(a => [String(a._id), a.validFrom, a.validUntil]),
      ]),
    )
    .digest('hex');
}
const active = (context: Context, period: Period) =>
  context.history.find(
    h => h.status === 'approved' && String(h.periodId) === String(period._id),
  );
const future = (date: string, startTime: string) => {
  const now = schoolDateTime();
  return date > now.date || (date === now.date && startTime > now.time);
};
async function target(
  branchId: string,
  periodId: unknown,
  date: string,
  session?: ClientSession,
) {
  const id = objectIdField(periodId, 'period ID'),
    context = await dayContext(branchId, date, session);
  const period = context.periods.find(p => String(p._id) === id);
  if (!period) throw missing();
  return { context, period };
}
export async function substitutionOverview(
  identity: JwtPayload | undefined,
  query: Record<string, unknown>,
) {
  const { branchId } = await authority(identity);
  const date =
      query.date === undefined ? schoolToday() : scheduleDate(query.date),
    offset = offsetFor(query.offset);
  const context = await dayContext(branchId, date),
    page = context.periods.slice(offset, offset + 30);
  const [teachers, classes, sections, subjects] = await Promise.all([
    User.find()
      .where('branchId')
      .equals(branchId)
      .where('_id')
      .in([
        ...page.map(p => p.teacherId),
        ...context.history.map(h => h.substituteTeacherId),
      ])
      .select('_id fullName')
      .lean(),
    SchoolClass.find()
      .where('branchId')
      .equals(branchId)
      .where('_id')
      .in(page.map(p => p.classId))
      .select('_id name')
      .lean(),
    Section.find()
      .where('branchId')
      .equals(branchId)
      .where('_id')
      .in(page.map(p => p.sectionId))
      .select('_id name')
      .lean(),
    Subject.find({ branchId, _id: { $in: page.map(p => p.subjectId) } })
      .select('_id name')
      .lean(),
  ]);
  const name = (rows: { _id: unknown; name: string }[], id: unknown) =>
    rows.find(r => String(r._id) === String(id))?.name ?? 'Unavailable';
  const teacher = (id: unknown) => ({
    id: String(id),
    name:
      teachers.find(t => String(t._id) === String(id))?.fullName ??
      'Unavailable Teacher',
  });
  return {
    date,
    today: schoolToday(),
    timezone: schoolTimezone(),
    nextOffset:
      offset + page.length < context.periods.length
        ? offset + page.length
        : null,
    items: page.map(p => {
      const replacement = active(context, p);
      return {
        periodId: String(p._id),
        versionId: String(p.timetableVersionId),
        date,
        revision: revision(context, p),
        className: name(classes, p.classId),
        sectionName: name(sections, p.sectionId),
        subjectName: name(subjects, p.subjectId),
        startTime: replacement?.startTime ?? p.startTime,
        endTime: replacement?.endTime ?? p.endTime,
        room: replacement?.room ?? p.room,
        originalWindow: {
          startTime: p.startTime,
          endTime: p.endTime,
          room: p.room,
        },
        originalTeacher: teacher(p.teacherId),
        substituteTeacher: replacement
          ? teacher(replacement.substituteTeacherId)
          : null,
        substituteId: replacement ? String(replacement._id) : null,
        reason: replacement?.reason ?? null,
        canManage:
          future(date, p.startTime) &&
          (!replacement || future(date, replacement.startTime)),
        history: context.history
          .filter(h => String(h.periodId) === String(p._id))
          .map(h => ({
            id: String(h._id),
            status: h.status,
            teacher: teacher(h.substituteTeacherId),
            reason: h.reason ?? null,
            createdAt: h.createdAt.toISOString(),
            retiredAt: h.retiredAt?.toISOString() ?? null,
          })),
      };
    }),
  };
}
export async function substitutionCandidates(
  identity: JwtPayload | undefined,
  id: unknown,
  query: Record<string, unknown>,
) {
  const { branchId } = await authority(identity),
    date = scheduleDate(query.date),
    offset = offsetFor(query.offset);
  const { context, period } = await target(branchId, id, date);
  const replacement = active(context, period),
    window = effectiveTimetableOccurrence(period, replacement);
  if (!future(date, period.startTime) || !future(date, window.startTime))
    throw new RequestContractError(409, 'This lesson has already started');
  // Validate the original exact academic responsibility, not an invented
  // permanent assignment for the temporary replacement (T-PR3 contract).
  await validateReplacement(branchId, period, String(period.teacherId), date, undefined, true);
  const occupied = context.periods
    .filter(p => String(p._id) !== String(period._id))
    .flatMap(p => {
      const effective = effectiveTimetableOccurrence(p, active(context, p));
      return window.startTime < effective.endTime &&
        effective.startTime < window.endTime
        ? [effective.teacherId]
        : [];
    });
  const search =
    query.search === undefined ? '' : textField(query.search, 'search', 80);
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const candidates = await User.find({
    role: 'teacher',
    isActive: true,
    ...(search ? { fullName: { $regex: escaped, $options: 'i' } } : {}),
  })
    .where('branchId')
    .equals(branchId)
    .where('_id')
    .nin([
      period.teacherId,
      ...occupied,
      ...(replacement ? [replacement.substituteTeacherId] : []),
    ])
    .select('_id fullName')
    .sort({ fullName: 1, _id: 1 })
    .skip(offset)
    .limit(31)
    .lean();
  return {
    revision: revision(context, period),
    policy: 'Temporary duty; permanent Subject assignment is not required',
    items: candidates.slice(0, 30).map(t => ({
      id: String(t._id),
      name: t.fullName,
      eligibility: 'Available for temporary duty',
    })),
    nextOffset: candidates.length > 30 ? offset + 30 : null,
  };
}
export async function mutateSubstitution(
  identity: JwtPayload | undefined,
  token: string | undefined,
  id: unknown,
  body: unknown,
  cancel = false,
) {
  const { actor, branchId } = await authority(identity);
  const input = objectBody(
    body,
    cancel ? ['date', 'revision'] : ['date', 'revision', 'teacherId', 'reason'],
  );
  const date = scheduleDate(input.date),
    expected = textField(input.revision, 'revision', 64, 64);
  const teacherId = cancel
    ? undefined
    : objectIdField(input.teacherId, 'replacement Teacher ID');
  if (!cancel && !reasons.includes(String(input.reason)))
    throw new RequestContractError(400, 'Select a substitution reason');
  return withSubstitutionWrite(identity, branchId, token, async session => {
    const { context, period } = await target(branchId, id, date, session),
      current = active(context, period);
    if (revision(context, period) !== expected) throw stale();
    if (
      !future(date, period.startTime) ||
      (current && !future(date, current.startTime))
    )
      throw new RequestContractError(409, 'This lesson has already started');
    if (cancel && !current) throw stale();
    if (current && String(current.substituteTeacherId) === teacherId)
      throw new RequestContractError(409, 'This Teacher is already assigned');
    // Cancellation also revalidates the base academic context and restoring the
    // original Teacher's availability. The replacement helper excludes original.
    await validateReplacement(
      branchId,
      period,
      teacherId ?? String(period.teacherId),
      date,
      session,
      cancel,
    );
    const window = effectiveTimetableOccurrence(
      period,
      cancel ? undefined : current,
    );
    await requireRoom(branchId, window.roomId, session);
    await validateSubstituteRoom(
      branchId,
      period,
      { ...window, date, substituteTeacherId: teacherId ?? period.teacherId },
      session,
    );
    if (current)
      await SubstituteAssignment.updateOne(
        { _id: current._id, status: 'approved' },
        {
          $set: {
            status: 'retired',
            retiredBy: actor._id,
            retiredAt: new Date(),
          },
        },
        { session },
      );
    if (cancel) return { status: 'retired' };
    const created = await new SubstituteAssignment({
      branchId,
      periodId: period._id,
      originalTeacherId: period.teacherId,
      substituteTeacherId: teacherId!,
      date,
      startTime: window.startTime,
      endTime: window.endTime,
      room: window.room,
      roomId: window.roomId,
      status: 'approved',
      reason: String(input.reason),
      createdBy: new Types.ObjectId(String(actor._id)),
      approvedBy: new Types.ObjectId(String(actor._id)),
      approvedAt: new Date(),
    }).save({ session });
    return { status: 'approved', substituteId: String(created._id) };
  });
}
