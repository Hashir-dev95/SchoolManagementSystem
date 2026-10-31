import { Types } from 'mongoose';
import Subject from '../models/subject';
import User from '../models/user';
import { ClassSubject } from '../models/classSubject';
import { TimetablePeriod, SubstituteAssignment } from '../models/timetable';
import {
  AttendanceSession,
  PeriodAttendanceRecord,
} from '../models/periodAttendance';
import {
  resolveStudentSelf,
  studentSelfForbidden,
} from './student-self-scope.service';
import {
  operationalTimetableVersions,
  effectiveTimetableOccurrence,
} from './timetable-occurrence.service';
import { effectiveAttendanceStages } from './attendance-effective.service';
import {
  scheduleDate,
  scheduleWeekday,
  schoolToday,
  schoolDateTime,
} from './school-date.service';
import type { JwtPayload } from './jwt.service';
import { RequestContractError } from '../utils/request-validation';

async function occurrences(
  identity: JwtPayload | undefined,
  dateValue: unknown,
) {
  const ctx = await resolveStudentSelf(identity);
  const date =
    dateValue === undefined ? schoolToday() : scheduleDate(dateValue);
  if (date < schoolDateTime(ctx.enrollment.effectiveFrom).date) {
    throw studentSelfForbidden();
  }
  const version = (
    await operationalTimetableVersions(ctx.branchId, [date])
  ).get(date);
  const periods = version
    ? await TimetablePeriod.find({
        branchId: ctx.branchId,
        timetableVersionId: version._id,
        classId: ctx.enrollment.classId,
        sectionId: ctx.enrollment.sectionId,
        dayOfWeek: scheduleWeekday(date),
      })
        .limit(201)
        .read('primary')
        .lean()
    : [];
  if (periods.length > 200) {
    throw new RequestContractError(
      409,
      'Timetable requires administrator review',
    );
  }
  const items = [];
  for (const period of periods) {
    const replacements = await SubstituteAssignment.find({
      branchId: ctx.branchId,
      periodId: period._id,
      originalTeacherId: period.teacherId,
      date,
      status: 'approved',
    })
      .limit(2)
      .read('primary')
      .lean();
    if (replacements.length > 1) {
      throw studentSelfForbidden();
    }
    const effective = effectiveTimetableOccurrence(period, replacements[0]);
    const [subject, teacher, classSubject] = await Promise.all([
      Subject.findOne({ isActive: true })
        .where('_id')
        .equals(period.subjectId)
        .where('branchId')
        .equals(ctx.branchId)
        .select('name')
        .read('primary')
        .lean(),
      User.findOne({ role: 'teacher', isActive: true })
        .where('_id')
        .equals(effective.teacherId)
        .where('branchId')
        .equals(ctx.branchId)
        .select('fullName')
        .read('primary')
        .lean(),
      ClassSubject.exists({
        branchId: ctx.branchId,
        classId: ctx.enrollment.classId,
        academicPeriodId: ctx.enrollment.academicPeriodId,
        subjectId: period.subjectId,
        isActive: true,
      }).read('primary'),
    ]);
    if (!subject || !teacher || !classSubject) {
      throw studentSelfForbidden();
    }
    items.push({
      periodId: String(period._id),
      timetableVersionId: String(version!._id),
      date,
      startTime: effective.startTime,
      endTime: effective.endTime,
      room: effective.room,
      subject: subject.name,
      teacher: teacher.fullName,
      isSubstitute: replacements.length === 1,
    });
  }
  items.sort(
    (a, b) =>
      a.startTime.localeCompare(b.startTime) ||
      a.periodId.localeCompare(b.periodId),
  );
  return { ctx, date, items };
}

export async function getStudentTimetable(
  identity: JwtPayload | undefined,
  dateValue?: unknown,
) {
  const { date, items } = await occurrences(identity, dateValue);
  return { date, items };
}
export async function getStudentPhysicalAttendance(
  identity: JwtPayload | undefined,
  dateValue?: unknown,
) {
  const { ctx, date, items } = await occurrences(identity, dateValue);
  const records = [];
  for (const item of items) {
    const session = await AttendanceSession.findOne({
      branchId: ctx.branchId,
      periodId: item.periodId,
      timetableVersionId: item.timetableVersionId,
      date,
      classId: ctx.enrollment.classId,
      sectionId: ctx.enrollment.sectionId,
      rosterStudentIds: ctx.student._id,
    })
      .read('primary')
      .lean();
    let status: string | null = null;
    if (session?.state === 'submitted') {
      const [own] = await PeriodAttendanceRecord.aggregate([
        {
          $match: {
            branchId: new Types.ObjectId(ctx.branchId),
            attendanceSessionId: session._id,
            studentId: ctx.student._id,
            revision: session.revision,
          },
        },
        ...effectiveAttendanceStages(ctx.branchId),
        { $project: { status: 1 } },
      ]).read('primary');
      status = own?.status ?? null;
    }
    records.push({
      ...item,
      status,
      state: status
        ? 'submitted'
        : session && session.state !== 'submitted'
        ? 'in_progress'
        : 'unmarked',
    });
  }
  return { date, kind: 'physical' as const, items: records };
}
