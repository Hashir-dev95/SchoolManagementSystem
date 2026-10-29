import mongoose, { type ClientSession, type PipelineStage } from 'mongoose';
import {
  AttendanceCorrection,
  AttendanceDownstreamIntent,
} from '../models/attendanceAmendment';
import {
  AttendanceSession,
  PeriodAttendanceRecord,
  type PeriodAttendanceStatus,
} from '../models/periodAttendance';

// The same effective-status projection serves Teacher review, oversight and
// bounded pattern aggregation. Original marks are never rewritten.
export function effectiveAttendanceStages(branchId: string): PipelineStage.FacetPipelineStage[] {
  return [
    {
      $lookup: {
        from: AttendanceCorrection.collection.name,
        let: {
          session: '$attendanceSessionId',
          student: '$studentId',
          original: '$status',
          revision: '$revision',
        },
        pipeline: [
          {
            $match: {
              branchId: new mongoose.Types.ObjectId(branchId),
              state: 'approved',
              $expr: {
                $and: [
                  { $eq: ['$attendanceSessionId', '$$session'] },
                  { $eq: ['$studentId', '$$student'] },
                  { $eq: ['$originalStatus', '$$original'] },
                  { $eq: ['$submittedRevision', '$$revision'] },
                ],
              },
            },
          },
          { $sort: { approvedVersion: -1 } },
          { $limit: 1 },
          { $project: { requestedStatus: 1, approvedVersion: 1 } },
        ],
        as: '_effectiveCorrection',
      },
    },
    {
      $set: {
        originalStatus: '$status',
        status: {
          $ifNull: [
            { $arrayElemAt: ['$_effectiveCorrection.requestedStatus', 0] },
            '$status',
          ],
        },
        effectiveRevision: {
          $ifNull: [
            { $arrayElemAt: ['$_effectiveCorrection.approvedVersion', 0] },
            0,
          ],
        },
      },
    },
    { $unset: '_effectiveCorrection' },
  ];
}
export const effectiveAttendance = async (
  branchId: string,
  sessionId: string,
  transaction?: ClientSession,
) => {
  const rows = await PeriodAttendanceRecord.aggregate<{
    studentId: mongoose.Types.ObjectId;
    originalStatus: PeriodAttendanceStatus;
    status: PeriodAttendanceStatus;
    effectiveRevision: number;
  }>([
    {
      $match: {
        branchId: new mongoose.Types.ObjectId(branchId),
        attendanceSessionId: new mongoose.Types.ObjectId(sessionId),
      },
    },
    ...effectiveAttendanceStages(branchId),
    {
      $project: {
        studentId: 1,
        originalStatus: 1,
        status: 1,
        effectiveRevision: 1,
      },
    },
  ])
    .read('primary')
    .session(transaction ?? null);
  return new Map(
    rows.map(row => [
      String(row.studentId),
      {
        originalStatus: row.originalStatus,
        status: row.status,
        effectiveRevision: row.effectiveRevision,
      },
    ]),
  );
};
// Trusted integration boundary. No public endpoint can enqueue, approve or send
// these intents. Future workers must revalidate immediately before delivery.
export const absenceIntentIsCurrent = async (id: string) => {
  const intent = await AttendanceDownstreamIntent.findById(id).lean();
  if (
    !intent ||
    intent.state !== 'pending' ||
    intent.approvalState !== 'approved' ||
    intent.notBefore > new Date()
  )
    return false;
  const submitted = await AttendanceSession.exists({
    _id: intent.attendanceSessionId,
    branchId: intent.branchId,
    state: 'submitted',
  });
  if (!submitted) return false;
  const state = (
    await effectiveAttendance(
      String(intent.branchId),
      String(intent.attendanceSessionId),
    )
  ).get(String(intent.studentId));
  return (
    state?.status === 'absent' &&
    state.effectiveRevision === intent.effectiveRevision
  );
};
export const suppressStaleAttendanceIntents = async (
  branchId: string,
  sessionId: string,
  studentId: string,
  correctionId: string,
  transaction: ClientSession,
) =>
  AttendanceDownstreamIntent.updateMany(
    { branchId, attendanceSessionId: sessionId, studentId, state: 'pending' },
    { $set: { state: 'suppressed', suppressedAt: new Date(), correctionId } },
    { session: transaction },
  );

// Disabled unless trusted deployment configuration specifies a grace period.
// Intents still require independent approval before any future dispatcher acts.
export const stageSubmittedAbsenceIntents = async (
  branchId: string,
  sessionId: string,
  transaction: ClientSession,
) => {
  const configured = process.env.ATTENDANCE_ABSENCE_GRACE_MINUTES;
  if (configured === undefined) return;
  if (!/^\d{1,5}$/.test(configured) || Number(configured) > 10080)
    throw new Error('Invalid absence grace configuration');
  const source = await AttendanceSession.findOne({
    _id: sessionId,
    branchId,
    state: 'submitted',
  })
    .session(transaction)
    .lean();
  if (!source) return;
  const state = await effectiveAttendance(branchId, sessionId, transaction);
  for (const [studentId, value] of state) {
    if (value.status !== 'absent') continue;
    for (const kind of ['absence_notice', 'catch_up'] as const)
      await AttendanceDownstreamIntent.updateOne(
        {
          branchId,
          attendanceSessionId: sessionId,
          studentId,
          effectiveRevision: value.effectiveRevision,
          kind,
        },
        {
          $setOnInsert: {
            notBefore: new Date(Date.now() + Number(configured) * 60000),
            approvalState: 'pending',
            state: 'pending',
          },
        },
        { session: transaction, upsert: true, runValidators: true },
      );
  }
};
