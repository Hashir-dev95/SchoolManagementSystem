import { Types, type ClientSession, type PipelineStage } from 'mongoose';
import { StudentLeave } from '../models/attendanceAmendment';
import { ParentLeaveApplication } from '../models/parentLeaveApplication';
import { StudentEnrollment } from '../models/studentEnrollment';
import SchoolClass from '../models/schoolClass';
import { RequestContractError } from '../utils/request-validation';
import {
  schoolDateTime,
  schoolTimezone,
  schoolToday,
} from './school-date.service';
import { validateLeaveDates } from './parent-leave-application.policy';

export const PARENT_LEAVE_ORIGIN = 'parent_application';
export const teacherLeaveOrigin = { $ne: PARENT_LEAVE_ORIGIN } as const;
const conflict = () =>
  new RequestContractError(409, 'A leave request already reserves these dates');

type LeaveRange = {
  branchId: string | Types.ObjectId;
  studentId: string | Types.ObjectId;
  startDate: string;
  endDate: string;
};

// Call only under the shared persisted Branch lock. Legacy occurrence-owned
// reservations still use their recorded inclusive range for the same student.
export async function assertNoTeacherLeaveOverlap(
  range: LeaveRange,
  session: ClientSession,
) {
  if (
    await StudentLeave.exists({
      branchId: range.branchId,
      studentId: range.studentId,
      origin: teacherLeaveOrigin,
      state: { $in: ['pending', 'approved'] },
      fromDate: { $lte: range.endDate },
      untilDate: { $gte: range.startDate },
    }).session(session)
  )
    throw conflict();
}

export async function assertNoParentLeaveOverlap(
  range: LeaveRange,
  session: ClientSession,
) {
  if (
    await ParentLeaveApplication.exists({
      branchId: range.branchId,
      studentId: range.studentId,
      state: { $in: ['pending', 'approved', 'changes_requested'] },
      startDate: { $lte: range.endDate },
      endDate: { $gte: range.startDate },
    }).session(session)
  )
    throw conflict();
}

export async function assertCoverageRange(
  range: LeaveRange,
  enrollment: {
    _id: Types.ObjectId;
    effectiveFrom: Date;
    effectiveTo?: Date | null;
  },
  period: { startDate: string; endDate: string },
  session: ClientSession,
) {
  const unavailable = () =>
    new RequestContractError(
      409,
      'Leave dates are outside the exact enrollment or academic period',
    );
  validateLeaveDates(range.startDate, range.endDate);
  try {
    validateLeaveDates(period.startDate, period.endDate);
  } catch {
    throw unavailable();
  }
  const civil = (date: Date) => schoolDateTime(date).date;
  if (
    range.startDate < period.startDate ||
    range.endDate > period.endDate ||
    range.startDate < civil(enrollment.effectiveFrom) ||
    (enrollment.effectiveTo && range.endDate >= civil(enrollment.effectiveTo))
  )
    throw unavailable();

  const otherIntervals = await StudentEnrollment.find({
    studentId: range.studentId,
    _id: { $ne: enrollment._id },
  })
    .select('effectiveFrom effectiveTo status')
    .session(session)
    .lean();
  if (
    otherIntervals.some(
      other =>
        other.effectiveFrom &&
        civil(other.effectiveFrom) <= range.endDate &&
        (other.effectiveTo ? civil(other.effectiveTo) > range.startDate : true),
    )
  )
    throw unavailable();
}

type OccurrenceScope = {
  classId: string | Types.ObjectId;
  sectionId: string | Types.ObjectId;
  date: string;
};

// The caller has already authorized the actual occurrence and its roster.
// Parent coverage has no legacy profile fallback or synthetic attendance row.
// The variable form is shared by Principal aggregation and Teacher reads/writes.
export function parentCoverageMembership(
  date: string,
  classId: string | Types.ObjectId,
  sectionId: string | Types.ObjectId,
): PipelineStage.Lookup[] {
  const civil = (field: string) => ({
    $dateToString: {
      date: {
        $convert: { input: field, to: 'date', onError: null, onNull: null },
      },
      format: '%Y-%m-%d',
      timezone: schoolTimezone(),
    },
  });
  return [
    {
      $lookup: {
        from: SchoolClass.collection.name,
        localField: 'classId',
        foreignField: '_id',
        pipeline: [{ $project: { branchId: 1, academicPeriodId: 1 } }],
        as: '_coverageClass',
      },
    },
    {
      $lookup: {
        from: StudentEnrollment.collection.name,
        let: {
          enrollment: '$enrollmentId',
          student: '$studentId',
          branch: '$branchId',
          period: '$academicPeriodId',
          cls: '$classId',
          sec: '$sectionId',
          date,
          classBranch: { $arrayElemAt: ['$_coverageClass.branchId', 0] },
          classPeriod: {
            $arrayElemAt: ['$_coverageClass.academicPeriodId', 0],
          },
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$_id', '$$enrollment'] },
                  { $eq: ['$studentId', '$$student'] },
                  { $eq: ['$branchId', '$$branch'] },
                  { $eq: ['$classId', '$$cls'] },
                  { $eq: ['$sectionId', '$$sec'] },
                  { $eq: ['$academicPeriodId', '$$period'] },
                  { $eq: ['$branchId', '$$classBranch'] },
                  { $eq: ['$academicPeriodId', '$$classPeriod'] },
                  { $eq: ['$classId', classId] },
                  { $eq: ['$sectionId', sectionId] },
                  { $eq: [{ $type: '$effectiveFrom' }, 'date'] },
                  { $lte: [civil('$effectiveFrom'), '$$date'] },
                  {
                    $or: [
                      {
                        $and: [
                          { $eq: ['$status', 'active'] },
                          { $lte: ['$effectiveFrom', new Date()] },
                          { $eq: [{ $ifNull: ['$effectiveTo', null] }, null] },
                        ],
                      },
                      {
                        $and: [
                          { $lt: ['$$date', schoolToday()] },
                          {
                            $in: [
                              '$status',
                              ['transferred', 'promoted', 'withdrawn'],
                            ],
                          },
                          { $eq: [{ $type: '$effectiveTo' }, 'date'] },
                          { $gt: [civil('$effectiveTo'), '$$date'] },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
          { $project: { _id: 1 } },
        ],
        as: '_parentLeaveEnrollment',
      },
    },
  ];
}

export const leaveCoverageOriginMatch = {
  $or: [
    { origin: teacherLeaveOrigin },
    {
      origin: PARENT_LEAVE_ORIGIN,
      '_parentLeaveEnrollment.0': { $exists: true },
    },
  ],
};

export async function approvedLeaveForOccurrence(
  branchId: string,
  studentId: string,
  occurrence: OccurrenceScope,
  session?: ClientSession,
  leaveId?: unknown,
) {
  const objectId = (value: unknown) => new Types.ObjectId(String(value));
  const [row] = await StudentLeave.aggregate<{ _id: Types.ObjectId }>([
    {
      $match: {
        branchId: objectId(branchId),
        studentId: objectId(studentId),
        state: 'approved',
        fromDate: { $lte: occurrence.date },
        untilDate: { $gte: occurrence.date },
        ...(leaveId ? { _id: objectId(leaveId) } : {}),
      },
    },
    ...parentCoverageMembership(
      occurrence.date,
      objectId(occurrence.classId),
      objectId(occurrence.sectionId),
    ),
    { $match: leaveCoverageOriginMatch },
    { $sort: { createdAt: -1, _id: -1 } },
    { $limit: 1 },
    { $project: { _id: 1 } },
  ]).session(session ?? null);
  return row ?? null;
}

export async function createParentLeaveCoverage(
  application: LeaveRange & {
    _id: Types.ObjectId;
    requesterId: Types.ObjectId;
    enrollmentId: Types.ObjectId;
    academicPeriodId: Types.ObjectId;
    classId: Types.ObjectId;
    sectionId: Types.ObjectId;
  },
  approvalId: Types.ObjectId,
  submittedRevision: number,
  reviewerId: string,
  reviewedAt: Date,
  fingerprint: string,
  session: ClientSession,
) {
  const [row] = await StudentLeave.create(
    [
      {
        origin: PARENT_LEAVE_ORIGIN,
        state: 'approved',
        branchId: application.branchId,
        studentId: application.studentId,
        requestedBy: application.requesterId,
        reviewedBy: reviewerId,
        reviewedAt,
        approvalRequestId: approvalId,
        parentApplicationId: application._id,
        parentSubmissionRevision: submittedRevision,
        enrollmentId: application.enrollmentId,
        academicPeriodId: application.academicPeriodId,
        classId: application.classId,
        sectionId: application.sectionId,
        fromDate: application.startDate,
        untilDate: application.endDate,
        clientOperationId: `parent-application:${application._id}`,
        fingerprint,
      },
    ],
    { session },
  );
  if (!row)
    throw new RequestContractError(409, 'Leave coverage was not created');
  return row._id;
}
