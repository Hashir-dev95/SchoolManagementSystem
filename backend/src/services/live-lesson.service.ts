import mongoose, { type ClientSession } from 'mongoose';
import User from '../models/user';
import Session from '../models/session';
import Student from '../models/student';
import { AcademicPeriod } from '../models/academicPeriod';
import { ClassSubject } from '../models/classSubject';
import { TimetablePeriod } from '../models/timetable';
import {
  StudentEnrollment,
  activeEnrollmentFilter,
} from '../models/studentEnrollment';
import { LiveLessonSession } from '../models/liveLessonSession';
import { PERMISSIONS, type Permission } from '../constants/permissions';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import {
  objectIdField,
  RequestContractError,
} from '../utils/request-validation';
import { currentAcademicActor } from './teacher-scope.service';
import {
  mutateOccurrence,
  type TeacherPeriodDTO,
} from './teacher-timetable.service';
import { requireClassSubject } from './class-subject-context.service';
import { withAcademicCatalogLock } from './academic-catalog-lock.service';
import { schoolDateTime, schoolTimezone } from './school-date.service';
import type { JwtPayload } from './jwt.service';
import { verifyAccessToken } from './jwt.service';
import type { RtcProvider, RtcRole } from './rtc/rtc-provider';
import { rtcProvider } from './rtc/provider-factory';

const missing = () =>
  new RequestContractError(404, 'Live lesson is unavailable');
const conflict = () =>
  new RequestContractError(
    409,
    'Live lesson state or window does not allow this action',
  );
const START_EARLY_MS = 15 * 60 * 1000;
type Lesson = InstanceType<typeof LiveLessonSession>;
const same = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '');
const dto = (row: Lesson) => ({
  id: String(row._id),
  periodId: String(row.periodId),
  date: row.date,
  academicPeriodId: String(row.academicPeriodId),
  classId: String(row.classId),
  sectionId: String(row.sectionId),
  subjectId: String(row.subjectId),
  scheduledStart: row.scheduledStart.toISOString(),
  scheduledEnd: row.scheduledEnd.toISOString(),
  status: row.status,
  revision: row.revision,
  startedAt: row.startedAt?.toISOString() ?? null,
  endedAt: row.endedAt?.toISOString() ?? null,
});
async function actorFor(
  identity: JwtPayload | undefined,
  permission: Permission,
  session?: ClientSession,
) {
  const actor = await currentAcademicActor(identity, session);
  if (
    !['teacher', 'student'].includes(actor.role) ||
    !ROLE_PERMISSIONS[actor.role].includes(permission)
  )
    throw new RequestContractError(403, 'Live lesson permission is required');
  return actor;
}
async function fence(session: ClientSession, collection: string, id: unknown) {
  const result = await mongoose.connection
    .collection(collection)
    .updateOne(
      { _id: new mongoose.Types.ObjectId(String(id)) },
      { $inc: { __v: 1 } },
      { session },
    );
  if (!result.matchedCount) throw missing();
}
async function loginFence(
  session: ClientSession,
  identity: JwtPayload | undefined,
  token: string,
  permission: Permission,
) {
  const actor = await actorFor(identity, permission);
  await fence(session, User.collection.name, actor._id);
  const login = await Session.collection.updateOne(
    { token, userId: actor._id, role: actor.role, isRevoked: false },
    { $inc: { __v: 1 } },
    { session },
  );
  if (!login.matchedCount)
    throw new RequestContractError(401, 'Session is unavailable');
  try {
    const verified = verifyAccessToken(token);
    if (
      verified.userId !== identity?.userId ||
      verified.role !== identity?.role
    )
      throw missing();
  } catch {
    throw new RequestContractError(401, 'Session is unavailable');
  }
  return actorFor(identity, permission, session);
}
// Resolve a civil school time without relying on the host's local timezone.
// Round-trip validation fails closed for non-existent DST instants.
export function lessonInstant(date: string, time: string): Date {
  const target = Date.parse(date + 'T' + time + ':00Z');
  let result = target;
  for (let i = 0; i < 4; i++) {
    const local = schoolDateTime(new Date(result));
    result += target - Date.parse(local.date + 'T' + local.time + ':00Z');
  }
  const local = schoolDateTime(new Date(result));
  if (local.date !== date || local.time !== time) throw conflict();
  return new Date(result);
}
function windowFor(start: Date, end: Date) {
  if (
    end <= start ||
    Date.now() < start.getTime() - START_EARLY_MS ||
    Date.now() >= end.getTime()
  )
    throw conflict();
}
async function catalog(
  session: ClientSession,
  period: TeacherPeriodDTO,
  branchId: string,
) {
  const context = await requireClassSubject(
    branchId,
    period.classId,
    period.subjectId,
    session,
  );
  await fence(session, AcademicPeriod.collection.name, context.period._id);
  await fence(session, ClassSubject.collection.name, context.mapping._id);
  if (
    period.date < context.period.startDate ||
    period.date >= context.period.endDate
  )
    throw missing();
  return context.period;
}
async function studentAccess(
  identity: JwtPayload | undefined,
  row: Lesson,
  session?: ClientSession,
  historical = false,
) {
  const actor = await actorFor(
    identity,
    historical ? PERMISSIONS.LIVE_LESSON_VIEW : PERMISSIONS.LIVE_LESSON_JOIN,
    session,
  );
  if (actor.role !== 'student' || !same(actor.branchId, row.branchId))
    throw missing();
  const student = await Student.findOne({ isActive: true })
    .where('userId')
    .equals(String(actor._id))
    .where('branchId')
    .equals(String(row.branchId))
    .session(session ?? null);
  if (!student) throw missing();
  if (session) await fence(session, Student.collection.name, student._id);
  const enrollment = await StudentEnrollment.findOne({
    studentId: student._id,
    branchId: row.branchId,
    academicPeriodId: row.academicPeriodId,
    classId: row.classId,
    sectionId: row.sectionId,
    ...(historical
      ? {
          effectiveFrom: { $lte: row.scheduledStart },
          $or: [
            { status: 'active', effectiveTo: null },
            {
              status: { $in: ['transferred', 'promoted', 'withdrawn'] },
              effectiveTo: { $gt: row.scheduledStart },
            },
          ],
        }
      : { ...activeEnrollmentFilter(), effectiveTo: null }),
  }).session(session ?? null);
  // No legacy compatibility path: explicit enrollment migration is required.
  if (!enrollment) throw missing();
  if (session)
    await fence(session, StudentEnrollment.collection.name, enrollment._id);
  return actor;
}
async function load(id: unknown, session?: ClientSession) {
  const row = await LiveLessonSession.findById(
    objectIdField(id, 'live lesson ID'),
  ).session(session ?? null);
  if (!row) throw missing();
  return row;
}
function matches(
  row: Lesson,
  period: TeacherPeriodDTO,
  branchId: string,
  academicPeriodId: unknown,
  hostId: string,
) {
  if (
    !same(row.branchId, branchId) ||
    !same(row.academicPeriodId, academicPeriodId) ||
    !same(row.timetableVersionId, period.approvedVersion.versionId) ||
    !same(row.classId, period.classId) ||
    !same(row.sectionId, period.sectionId) ||
    !same(row.subjectId, period.subjectId) ||
    !same(row.hostTeacherId, hostId) ||
    !same(row.substituteId, period.substituteId) ||
    row.scheduledStart.getTime() !==
      lessonInstant(period.date, period.startTime).getTime() ||
    row.scheduledEnd.getTime() !==
      lessonInstant(period.date, period.endTime).getTime()
  )
    throw missing();
}
async function transition(
  row: Lesson,
  status: 'starting' | 'live' | 'ended',
  actorId: string,
  session: ClientSession,
) {
  const allowed =
    status === 'starting'
      ? row.status === 'scheduled'
      : status === 'live'
      ? row.status === 'starting'
      : row.status === 'live';
  if (!allowed) throw conflict();
  row.status = status;
  row.revision += 1;
  const at = new Date();
  if (status === 'live') row.startedAt = at;
  if (status === 'ended') row.endedAt = at;
  row.history.push({
    status,
    at,
    actorId: new mongoose.Types.ObjectId(actorId),
  });
  await row.save({ session });
}

export function createLiveLessonService(
  providerFactory: () => RtcProvider = rtcProvider,
) {
  const credential = (
    provider: RtcProvider,
    row: Lesson,
    actorId: string,
    role: RtcRole,
  ) => {
    if (provider.name !== row.provider)
      throw new RequestContractError(
        503,
        'Live lesson provider is unavailable',
      );
    windowFor(row.scheduledStart, row.scheduledEnd);
    try {
      return provider.issueCredential({
        sessionId: String(row._id),
        roomId: row.providerRoomId,
        actorId,
        role,
        expiresAt: row.scheduledEnd,
      });
    } catch (error) {
      if (error instanceof RequestContractError) throw error;
      throw new RequestContractError(
        503,
        'Live lesson credential issuance failed',
      );
    }
  };
  return {
    async start(
      identity: JwtPayload | undefined,
      token: string,
      periodId: unknown,
      date: unknown,
    ) {
      const actor = await actorFor(identity, PERMISSIONS.LIVE_LESSON_START);
      if (actor.role !== 'teacher') throw missing();
      return mutateOccurrence(
        identity,
        periodId,
        date,
        PERMISSIONS.LIVE_LESSON_START,
        async (session, period, branchId) => {
          const current = await loginFence(
            session,
            identity,
            token,
            PERMISSIONS.LIVE_LESSON_START,
          );
          const academic = await catalog(session, period, branchId);
          const start = lessonInstant(period.date, period.startTime),
            end = lessonInstant(period.date, period.endTime);
          windowFor(start, end);
          const provider = providerFactory();
          let row = await LiveLessonSession.findOne({
            periodId: period.periodId,
            date: period.date,
          }).session(session);
          if (!row) {
            const scheduled = await TimetablePeriod.findById(
              period.periodId,
            ).session(session);
            if (!scheduled) throw missing();
            const id = new mongoose.Types.ObjectId();
            [row] = await LiveLessonSession.create(
              [
                {
                  _id: id,
                  branchId,
                  academicPeriodId: academic._id,
                  timetableVersionId: period.approvedVersion.versionId,
                  periodId: period.periodId,
                  date: period.date,
                  classId: period.classId,
                  sectionId: period.sectionId,
                  subjectId: period.subjectId,
                  scheduledTeacherId: scheduled.teacherId,
                  hostTeacherId: current._id,
                  substituteId: period.substituteId ?? undefined,
                  scheduledStart: start,
                  scheduledEnd: end,
                  provider: provider.name,
                  providerRoomId: provider.roomId(String(id)),
                  status: 'scheduled',
                  history: [
                    {
                      status: 'scheduled',
                      at: new Date(),
                      actorId: current._id,
                    },
                  ],
                },
              ],
              { session },
            );
          }
          matches(row, period, branchId, academic._id, String(current._id));
          if (!['scheduled', 'live'].includes(row.status)) throw conflict();
          const connection = credential(
            provider,
            row,
            String(current._id),
            'host',
          );
          if (row.status === 'scheduled') {
            await transition(row, 'starting', String(current._id), session);
            await transition(row, 'live', String(current._id), session);
          }
          return { session: dto(row), connection };
        },
      );
    },
    async join(identity: JwtPayload | undefined, token: string, id: unknown) {
      const initial = await load(id);
      // Resolve participant first: unauthorized requests never reach provider code.
      await studentAccess(identity, initial);
      const host: JwtPayload = {
        userId: String(initial.hostTeacherId),
        role: 'teacher',
      };
      return mutateOccurrence(
        host,
        String(initial.periodId),
        initial.date,
        PERMISSIONS.LIVE_LESSON_START,
        async (session, period, branchId) => {
          await loginFence(
            session,
            identity,
            token,
            PERMISSIONS.LIVE_LESSON_JOIN,
          );
          const academic = await catalog(session, period, branchId);
          const row = await load(id, session);
          await fence(session, LiveLessonSession.collection.name, row._id);
          matches(row, period, branchId, academic._id, host.userId);
          if (row.status !== 'live') throw conflict();
          const actor = await studentAccess(identity, row, session);
          return {
            session: dto(row),
            connection: credential(
              providerFactory(),
              row,
              String(actor._id),
              'participant',
            ),
          };
        },
      );
    },
    async end(identity: JwtPayload | undefined, token: string, id: unknown) {
      const initial = await load(id);
      return withAcademicCatalogLock(
        String(initial.branchId),
        async session => {
          const actor = await loginFence(
            session,
            identity,
            token,
            PERMISSIONS.LIVE_LESSON_END,
          );
          const row = await load(id, session);
          if (
            actor.role !== 'teacher' ||
            !same(actor.branchId, row.branchId) ||
            !same(actor._id, row.hostTeacherId)
          )
            throw missing();
          if (row.status !== 'ended')
            await transition(row, 'ended', String(actor._id), session);
          return dto(row);
        },
      );
    },
    async read(identity: JwtPayload | undefined, id: unknown) {
      const actor = await actorFor(identity, PERMISSIONS.LIVE_LESSON_VIEW);
      const row = await load(id);
      if (!same(actor.branchId, row.branchId)) throw missing();
      if (actor.role === 'teacher') {
        if (
          !same(actor._id, row.hostTeacherId) &&
          !same(actor._id, row.scheduledTeacherId)
        )
          throw missing();
      } else await studentAccess(identity, row, undefined, true);
      return { ...dto(row), timezone: schoolTimezone() };
    },
  };
}
export const liveLessonService = createLiveLessonService();
