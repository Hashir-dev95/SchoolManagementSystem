import mongoose, { type PipelineStage } from 'mongoose';
import SchoolClass from '../models/schoolClass';
import Section from '../models/section';
import Subject from '../models/subject';
import User from '../models/user';
import Student from '../models/student';
import TeacherAssignment from '../models/teacherAssignment';
import { ClassSubject } from '../models/classSubject';
import { AcademicPeriod } from '../models/academicPeriod';
import {
  AttendanceSession,
  AttendanceOperation,
  PeriodAttendanceRecord,
} from '../models/periodAttendance';
import {
  AttendanceCorrection,
  StudentLeave,
} from '../models/attendanceAmendment';
import {
  TimetablePeriod,
  TimetableVersion,
  SubstituteAssignment,
  TimetableIssue,
} from '../models/timetable';
import { PERMISSIONS } from '../constants/permissions';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import {
  currentAcademicActor,
  requireActiveAcademicBranch,
} from './teacher-scope.service';
import { operationalTimetableVersions } from './timetable-occurrence.service';
import { effectiveAttendanceStages } from './attendance-effective.service';
import {
  enrollmentMembership,
  enrollmentMembershipForOccurrence,
} from './enrollment-membership.service';
import {
  schoolDateTime,
  schoolTimezone,
  scheduleDate,
  scheduleWeekday,
  addScheduleDays,
} from './school-date.service';
import {
  objectBody,
  objectIdField,
  enumField,
  textField,
  RequestContractError,
} from '../utils/request-validation';
import type { JwtPayload } from './jwt.service';
import { assertApprovalAuthority } from './approval-authority.policy';

const id = (value: unknown) => new mongoose.Types.ObjectId(String(value));
const unavailable = () =>
  new RequestContractError(
    404,
    'Attendance occurrence is unavailable or outside your Branch',
  );
const pageOffset = (value: unknown) => {
  if (value === undefined) return 0;
  if (
    typeof value !== 'string' ||
    !/^\d{1,6}$/.test(value) ||
    Number(value) > 100000
  )
    throw new RequestContractError(400, 'Invalid page offset');
  return Number(value);
};
export async function principalAttendanceActor(
  identity: JwtPayload | undefined,
) {
  const actor = await currentAcademicActor(identity);
  if (
    actor.role !== 'principal' ||
    !ROLE_PERMISSIONS.principal.includes(PERMISSIONS.ATTENDANCE_VIEW)
  )
    throw new RequestContractError(
      403,
      'Principal attendance view is not permitted',
    );
  return {
    actor,
    branchId: await requireActiveAcademicBranch(actor.branchId?.toString()),
  };
}
const scopedFilters = async (
  branchId: string,
  input: Record<string, unknown>,
) => {
  const filters: Record<string, mongoose.Types.ObjectId> = {};
  for (const [key, model] of [
    ['classId', SchoolClass],
    ['sectionId', Section],
    ['subjectId', Subject],
    ['teacherId', User],
  ] as const) {
    if (input[key] === undefined) continue;
    const value = objectIdField(input[key], key);
    const query: any = {
      _id: value,
      branchId,
      ...(key === 'teacherId' ? { role: 'teacher' } : {}),
    };
    if (!(await (model as any).exists(query).read('primary')))
      throw unavailable();
    filters[key] = id(value);
  }
  if (
    filters.sectionId &&
    filters.classId &&
    !(await Section.exists({})
      .where('_id')
      .equals(filters.sectionId)
      .where('classId')
      .equals(filters.classId)
      .where('branchId')
      .equals(branchId)
      .read('primary'))
  )
    throw unavailable();
  return filters;
};
const countStage: PipelineStage.FacetPipelineStage[] = [{ $count: 'total' }];
const total = (rows: any[]) => rows[0]?.total ?? 0;
const summaryStages: PipelineStage.FacetPipelineStage[] = [
  {
    $group: {
      _id: null,
      expected: { $sum: 1 },
      submitted: { $sum: { $cond: [{ $eq: ['$state', 'submitted'] }, 1, 0] } },
      unmarked: { $sum: { $cond: [{ $eq: ['$state', 'unmarked'] }, 1, 0] } },
      inProgress: {
        $sum: { $cond: [{ $eq: ['$state', 'in_progress'] }, 1, 0] },
      },
      needsAttention: { $sum: { $cond: ['$needsAttention', 1, 0] } },
    },
  },
  { $project: { _id: 0 } },
];
const zeroSummary = () => ({
  expected: 0,
  submitted: 0,
  unmarked: 0,
  inProgress: 0,
  needsAttention: 0,
});

// Lookup pipelines remain on the server. No Branch-wide period, student, mark,
// or amendment collection is materialized in application memory.
async function occurrencePipeline(
  branchId: string,
  date: string,
  filters: Record<string, mongoose.Types.ObjectId>,
  mode: 'scheduled' | 'history',
  until = date,
  patternsOnly = false,
): Promise<PipelineStage[]> {
  const branch = id(branchId),
    now = schoolDateTime();
  let pipeline: PipelineStage[];
  if (mode === 'scheduled') {
    const winner = (await operationalTimetableVersions(branchId, [date])).get(
      date,
    );
    pipeline = [
      {
        $match: {
          branchId: branch,
          timetableVersionId: winner ? winner._id : { $in: [] },
          dayOfWeek: scheduleWeekday(date),
        },
      },
      { $set: { date, operational: true } },
    ];
  } else {
    // Historical submitted snapshots are separate from the operational expected
    // denominator. Replaced/retired schedules retain their genuine evidence.
    pipeline = [
      {
        $match: {
          branchId: branch,
          state: 'submitted',
          date: { $gte: date, $lte: until },
        },
      },
      {
        $lookup: {
          from: TimetableVersion.collection.name,
          let: { version: '$timetableVersionId', date: '$date' },
          pipeline: [
            {
              $match: {
                branchId: branch,
                status: { $in: ['approved', 'retired'] },
                $expr: {
                  $and: [
                    { $eq: ['$_id', '$$version'] },
                    { $lte: ['$effectiveFrom', '$$date'] },
                    { $gt: ['$effectiveUntil', '$$date'] },
                  ],
                },
              },
            },
          ],
          as: '_version',
        },
      },
      { $match: { '_version.0': { $exists: true } } },
      {
        $lookup: {
          from: TimetablePeriod.collection.name,
          let: {
            period: '$periodId',
            version: '$timetableVersionId',
            class: '$classId',
            section: '$sectionId',
            subject: '$subjectId',
            date: '$date',
          },
          pipeline: [
            {
              $match: {
                branchId: branch,
                $expr: {
                  $and: [
                    { $eq: ['$_id', '$$period'] },
                    { $eq: ['$timetableVersionId', '$$version'] },
                    { $eq: ['$classId', '$$class'] },
                    { $eq: ['$sectionId', '$$section'] },
                    { $eq: ['$subjectId', '$$subject'] },
                    {
                      $eq: [
                        '$dayOfWeek',
                        {
                          $subtract: [
                            {
                              $dayOfWeek: {
                                $dateFromString: {
                                  dateString: '$$date',
                                  format: '%Y-%m-%d',
                                },
                              },
                            },
                            1,
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
            },
          ],
          as: '_period',
        },
      },
      { $unwind: '$_period' },
      {
        $replaceWith: {
          $mergeObjects: [
            '$_period',
            { date: '$date', attendance: '$$ROOT', operational: false },
          ],
        },
      },
    ];
  }
  for (const key of ['classId', 'sectionId', 'subjectId'])
    if (filters[key]) pipeline.push({ $match: { [key]: filters[key] } });
  pipeline.push(
    {
      $lookup: {
        from: SubstituteAssignment.collection.name,
        let: {
          period: '$_id',
          date: '$date',
          teacher: '$teacherId',
          historicalSub: '$attendance.substituteId',
          submittedTeacher: '$attendance.responsibleTeacherId',
        },
        pipeline: [
          {
            $match: {
              branchId: branch,
              status:
                mode === 'history'
                  ? { $in: ['approved', 'retired'] }
                  : 'approved',
              $expr: {
                $and: [
                  { $eq: ['$periodId', '$$period'] },
                  { $eq: ['$date', '$$date'] },
                  { $eq: ['$originalTeacherId', '$$teacher'] },
                  ...(mode === 'history'
                    ? [
                        { $eq: ['$_id', '$$historicalSub'] },
                        { $eq: ['$substituteTeacherId', '$$submittedTeacher'] },
                      ]
                    : []),
                ],
              },
            },
          },
          { $limit: 1 },
        ],
        as: '_sub',
      },
    },
    { $set: { replacement: { $arrayElemAt: ['$_sub', 0] } } },
  );
  if (mode === 'scheduled')
    pipeline.push(
      {
        $lookup: {
          from: AttendanceSession.collection.name,
          let: {
            period: '$_id',
            date: '$date',
            version: '$timetableVersionId',
            class: '$classId',
            section: '$sectionId',
            subject: '$subjectId',
          },
          pipeline: [
            {
              $match: {
                branchId: branch,
                $expr: {
                  $and: [
                    { $eq: ['$periodId', '$$period'] },
                    { $eq: ['$date', '$$date'] },
                    { $eq: ['$timetableVersionId', '$$version'] },
                    { $eq: ['$classId', '$$class'] },
                    { $eq: ['$sectionId', '$$section'] },
                    { $eq: ['$subjectId', '$$subject'] },
                  ],
                },
              },
            },
            { $limit: 1 },
          ],
          as: '_attendance',
        },
      },
      { $set: { attendance: { $arrayElemAt: ['$_attendance', 0] } } },
    );
  pipeline.push({
    $set: {
      effectiveTeacherId:
        mode === 'history'
          ? '$attendance.responsibleTeacherId'
          : { $ifNull: ['$replacement.substituteTeacherId', '$teacherId'] },
      startTime: { $ifNull: ['$replacement.startTime', '$startTime'] },
      endTime: { $ifNull: ['$replacement.endTime', '$endTime'] },
      room: { $ifNull: ['$replacement.room', '$room'] },
    },
  });
  if (filters.teacherId)
    pipeline.push({ $match: { effectiveTeacherId: filters.teacherId } });
  // Patterns need submitted occurrence authority, not operational card flags.
  if (patternsOnly) return pipeline;
  for (const [from, field, as] of [
    [SchoolClass.collection.name, 'classId', 'schoolClass'],
    [Section.collection.name, 'sectionId', 'section'],
    [Subject.collection.name, 'subjectId', 'subject'],
    [User.collection.name, 'effectiveTeacherId', 'teacher'],
  ] as const)
    pipeline.push(
      {
        $lookup: {
          from,
          localField: field,
          foreignField: '_id',
          pipeline: [
            {
              $match: {
                branchId: branch,
                ...(as === 'teacher' ? { role: 'teacher' } : {}),
              },
            },
            {
              $project: {
                name: 1,
                fullName: 1,
                isActive: 1,
                classId: 1,
                academicPeriodId: 1,
              },
            },
          ],
          as: '_' + as,
        },
      },
      { $set: { [as]: { $arrayElemAt: ['$_' + as, 0] } } },
    );
  pipeline.push(
    {
      $lookup: {
        from: TeacherAssignment.collection.name,
        let: {
          teacher: '$effectiveTeacherId',
          class: '$classId',
          section: '$sectionId',
          subject: '$subjectId',
        },
        pipeline: [
          {
            $match: {
              branchId: branch,
              isActive: true,
              validFrom: { $lte: new Date() },
              $and: [
                {
                  $or: [
                    { validUntil: { $exists: false } },
                    { validUntil: { $gt: new Date() } },
                  ],
                },
              ],
              $expr: {
                $and: [
                  { $eq: ['$teacherId', '$$teacher'] },
                  { $eq: ['$classId', '$$class'] },
                  { $eq: ['$sectionId', '$$section'] },
                  { $eq: ['$subjectId', '$$subject'] },
                ],
              },
            },
          },
          { $limit: 1 },
          { $project: { _id: 1 } },
        ],
        as: '_assignment',
      },
    },
    {
      $lookup: {
        from: AcademicPeriod.collection.name,
        localField: 'schoolClass.academicPeriodId',
        foreignField: '_id',
        pipeline: [
          { $match: { branchId: branch, status: 'active' } },
          { $project: { _id: 1 } },
        ],
        as: '_academicPeriod',
      },
    },
    {
      $lookup: {
        from: ClassSubject.collection.name,
        let: {
          class: '$classId',
          subject: '$subjectId',
          period: '$schoolClass.academicPeriodId',
        },
        pipeline: [
          {
            $match: {
              branchId: branch,
              isActive: true,
              $expr: {
                $and: [
                  { $eq: ['$classId', '$$class'] },
                  { $eq: ['$subjectId', '$$subject'] },
                  { $eq: ['$academicPeriodId', '$$period'] },
                ],
              },
            },
          },
          { $limit: 1 },
          { $project: { _id: 1 } },
        ],
        as: '_curriculum',
      },
    },
    {
      $lookup: {
        from: PeriodAttendanceRecord.collection.name,
        let: {
          session: '$attendance._id',
          roster: { $ifNull: ['$attendance.rosterStudentIds', []] },
        },
        pipeline: [
          {
            $match: {
              branchId: branch,
              $expr: {
                $and: [
                  { $eq: ['$attendanceSessionId', '$$session'] },
                  { $in: ['$studentId', '$$roster'] },
                ],
              },
            },
          },
          { $count: 'total' },
        ],
        as: '_marked',
      },
    },
    {
      $lookup: {
        from: TimetableIssue.collection.name,
        let: { period: '$_id', date: '$date' },
        pipeline: [
          {
            $match: {
              branchId: branch,
              status: 'open',
              $expr: {
                $and: [
                  { $eq: ['$periodId', '$$period'] },
                  { $eq: ['$date', '$$date'] },
                ],
              },
            },
          },
          { $limit: 1 },
          { $project: { _id: 1 } },
        ],
        as: '_issues',
      },
    },
  );
  for (const [model, as] of [
    [AttendanceCorrection, '_pendingCorrections'],
    [StudentLeave, '_pendingLeaves'],
  ] as const)
    pipeline.push({
      $lookup: {
        from: model.collection.name,
        let: { session: '$attendance._id' },
        pipeline: [
          {
            $match: {
              branchId: branch,
              state: 'pending',
              $expr: { $eq: ['$attendanceSessionId', '$$session'] },
            },
          },
          { $limit: 1 },
          { $project: { _id: 1 } },
        ],
        as,
      },
    });
  pipeline.push({
    $lookup: {
      from: Student.collection.name,
      let: {
        class: '$classId',
        section: '$sectionId',
        state: { $ifNull: ['$attendance.state', 'open'] },
      },
      pipeline: [
        { $match: { $expr: { $ne: ['$$state', 'submitted'] } } },
        ...enrollmentMembershipForOccurrence(branchId, date),
        {
          $lookup: {
            from: User.collection.name,
            localField: 'userId',
            foreignField: '_id',
            pipeline: [
              { $match: { branchId: branch, isActive: true, role: 'student' } },
              { $project: { _id: 1 } },
            ],
            as: '_identity',
          },
        },
        { $match: { '_identity.0': { $exists: true } } },
        { $limit: 1 },
        { $project: { _id: 1 } },
      ],
      as: '_eligibleRoster',
    },
  });
  pipeline.push({
    $lookup: {
      from: PeriodAttendanceRecord.collection.name,
      let: {
        session: '$attendance._id',
        date: '$date',
        roster: { $ifNull: ['$attendance.rosterStudentIds', []] },
      },
      pipeline: [
        {
          $match: {
            branchId: branch,
            $expr: {
              $and: [
                { $eq: ['$attendanceSessionId', '$$session'] },
                { $in: ['$studentId', '$$roster'] },
              ],
            },
          },
        },
        ...effectiveAttendanceStages(branchId),
        { $match: { status: { $ne: 'leave' } } },
        {
          $lookup: {
            from: StudentLeave.collection.name,
            let: { student: '$studentId' },
            pipeline: [
              {
                $match: {
                  branchId: branch,
                  state: 'approved',
                  $expr: {
                    $and: [
                      { $eq: ['$studentId', '$$student'] },
                      { $lte: ['$fromDate', '$$date'] },
                      { $gte: ['$untilDate', '$$date'] },
                    ],
                  },
                },
              },
              { $limit: 1 },
              { $project: { _id: 1 } },
            ],
            as: '_leave',
          },
        },
        { $match: { '_leave.0': { $exists: true } } },
        { $limit: 1 },
        { $project: { _id: 1 } },
      ],
      as: '_leaveMismatch',
    },
  });
  pipeline.push(
    {
      $set: {
        state: {
          $cond: [
            { $eq: ['$attendance.state', 'submitted'] },
            'submitted',
            {
              $cond: [
                { $ifNull: ['$attendance._id', false] },
                'in_progress',
                'unmarked',
              ],
            },
          ],
        },
        configurationIssue: {
          $not: [
            {
              $and: [
                { $eq: ['$schoolClass.isActive', true] },
                { $eq: ['$section.isActive', true] },
                { $eq: ['$section.classId', '$classId'] },
                { $eq: ['$subject.isActive', true] },
              ],
            },
          ],
        },
      },
    },
    {
      $set: {
        issues: {
          $concatArrays: [
            { $cond: ['$configurationIssue', ['academic_configuration'], []] },
            {
              $cond: [
                { $ne: ['$teacher.isActive', true] },
                ['teacher_unavailable'],
                [],
              ],
            },
            {
              $cond: [
                {
                  $and: [
                    { $ne: ['$state', 'submitted'] },
                    { $not: [{ $ifNull: ['$replacement._id', false] }] },
                    { $eq: [{ $size: '$_assignment' }, 0] },
                  ],
                },
                ['assignment_unavailable'],
                [],
              ],
            },
            {
              $cond: [
                {
                  $and: [
                    { $ne: ['$state', 'submitted'] },
                    {
                      $or: [
                        { $eq: [{ $size: '$_academicPeriod' }, 0] },
                        { $eq: [{ $size: '$_curriculum' }, 0] },
                      ],
                    },
                  ],
                },
                ['curriculum_configuration'],
                [],
              ],
            },
            {
              $cond: [
                {
                  $and: [
                    { $ne: ['$state', 'submitted'] },
                    {
                      $or: [
                        { $lt: ['$date', now.date] },
                        {
                          $and: [
                            { $eq: ['$date', now.date] },
                            { $lte: ['$endTime', now.time] },
                          ],
                        },
                      ],
                    },
                  ],
                },
                ['overdue'],
                [],
              ],
            },
            {
              $cond: [
                {
                  $and: [
                    { $eq: ['$state', 'in_progress'] },
                    {
                      $gt: [
                        {
                          $size: {
                            $ifNull: ['$attendance.rosterStudentIds', []],
                          },
                        },
                        {
                          $ifNull: [{ $arrayElemAt: ['$_marked.total', 0] }, 0],
                        },
                      ],
                    },
                  ],
                },
                ['partial_roster'],
                [],
              ],
            },
            {
              $cond: [
                {
                  $and: [
                    { $ifNull: ['$attendance._id', false] },
                    {
                      $eq: [
                        {
                          $size: {
                            $ifNull: ['$attendance.rosterStudentIds', []],
                          },
                        },
                        0,
                      ],
                    },
                  ],
                },
                ['empty_roster'],
                [],
              ],
            },
            {
              $cond: [
                {
                  $and: [
                    { $ne: ['$state', 'submitted'] },
                    { $eq: [{ $size: '$_eligibleRoster' }, 0] },
                  ],
                },
                ['empty_roster'],
                [],
              ],
            },
            {
              $cond: [
                { $gt: [{ $size: '$_pendingCorrections' }, 0] },
                ['pending_correction'],
                [],
              ],
            },
            {
              $cond: [
                { $gt: [{ $size: '$_pendingLeaves' }, 0] },
                ['pending_leave'],
                [],
              ],
            },
            {
              $cond: [
                { $gt: [{ $size: '$_leaveMismatch' }, 0] },
                ['approved_leave_mismatch'],
                [],
              ],
            },
            {
              $cond: [
                { $gt: [{ $size: '$_issues' }, 0] },
                ['occurrence_issue'],
                [],
              ],
            },
            {
              $cond: [
                {
                  $and: [
                    { $ifNull: ['$attendance._id', false] },
                    {
                      $ne: [
                        '$attendance.responsibleTeacherId',
                        '$effectiveTeacherId',
                      ],
                    },
                  ],
                },
                ['teacher_changed'],
                [],
              ],
            },
          ],
        },
      },
    },
    { $set: { issues: { $setUnion: ['$issues', []] } } },
    { $set: { needsAttention: { $gt: [{ $size: '$issues' }, 0] } } },
  );
  return pipeline;
}
const safeOccurrence: PipelineStage.Project = {
  $project: {
    _id: 0,
    periodId: { $toString: '$_id' },
    date: 1,
    versionId: { $toString: '$timetableVersionId' },
    classId: { $toString: '$classId' },
    sectionId: { $toString: '$sectionId' },
    subjectId: { $toString: '$subjectId' },
    teacherId: { $toString: '$effectiveTeacherId' },
    className: { $ifNull: ['$schoolClass.name', 'Unavailable'] },
    sectionName: { $ifNull: ['$section.name', 'Unavailable'] },
    subjectName: { $ifNull: ['$subject.name', 'Unavailable'] },
    teacherName: { $ifNull: ['$teacher.fullName', 'Unavailable'] },
    room: 1,
    startTime: 1,
    endTime: 1,
    isSubstitute: {
      $cond: [{ $ifNull: ['$replacement._id', false] }, true, false],
    },
    state: 1,
    needsAttention: 1,
    issues: 1,
    configurationIssue: 1,
    operational: 1,
    sessionId: { $ifNull: [{ $toString: '$attendance._id' }, null] },
    revision: { $ifNull: ['$attendance.revision', 0] },
    submittedAt: { $ifNull: ['$attendance.submittedAt', null] },
  },
};
const rootModel = (mode: string) =>
  mode === 'history' ? AttendanceSession : TimetablePeriod;
export async function listPrincipalAttendance(
  identity: JwtPayload | undefined,
  query: unknown,
) {
  const { branchId } = await principalAttendanceActor(identity);
  const input = objectBody(query, [
    'date',
    'classId',
    'sectionId',
    'subjectId',
    'teacherId',
    'state',
    'search',
    'offset',
    'mode',
  ]);
  const date =
      input.date === undefined
        ? schoolDateTime().date
        : scheduleDate(input.date),
    offset = pageOffset(input.offset);
  const mode = enumField(input.mode ?? 'scheduled', 'attendance view', [
    'scheduled',
    'history',
  ] as const);
  const state = enumField(input.state ?? 'all', 'attendance state', [
    'all',
    'unmarked',
    'in_progress',
    'submitted',
    'needs_attention',
  ] as const);
  const filters = await scopedFilters(branchId, input),
    pipeline = await occurrencePipeline(branchId, date, filters, mode);
  const search =
    input.search === undefined
      ? ''
      : textField(input.search, 'search', 80).toLowerCase();
  if (search)
    pipeline.push({
      $match: {
        $expr: {
          $or: [
            'schoolClass.name',
            'section.name',
            'subject.name',
            'teacher.fullName',
            'room',
          ].map(field => ({
            $gte: [
              {
                $indexOfCP: [
                  { $toLower: { $ifNull: ['$' + field, ''] } },
                  search,
                ],
              },
              0,
            ],
          })),
        },
      },
    });
  const selected =
    state === 'all'
      ? []
      : [
          {
            $match:
              state === 'needs_attention'
                ? { needsAttention: true }
                : { state },
          },
        ];
  pipeline.push({
    $facet: {
      summary: summaryStages,
      items: [
        ...selected,
        { $sort: { startTime: 1, _id: 1 } },
        { $skip: offset },
        { $limit: 20 },
        safeOccurrence,
      ],
      count: [...selected, ...countStage],
    },
  });
  const [page] = await (rootModel(mode) as any)
    .aggregate(pipeline)
    .read('primary');
  const count = total(page.count);
  return {
    date,
    today: schoolDateTime().date,
    timezone: schoolTimezone(),
    mode,
    summary: page.summary[0] ?? zeroSummary(),
    items: page.items,
    total: count,
    nextOffset:
      offset + page.items.length < count ? offset + page.items.length : null,
  };
}
export async function principalAttendanceSummary(
  identity: JwtPayload | undefined,
) {
  const data = await listPrincipalAttendance(identity, {});
  return { date: data.date, timezone: data.timezone, ...data.summary };
}

export async function principalAttendanceFilters(
  identity: JwtPayload | undefined,
  query: unknown,
) {
  const { branchId } = await principalAttendanceActor(identity),
    input = objectBody(query, ['kind', 'search', 'offset', 'classId']);
  const kind = enumField(input.kind, 'filter type', [
      'class',
      'section',
      'subject',
      'teacher',
    ] as const),
    offset = pageOffset(input.offset);
  const filters = await scopedFilters(branchId, input),
    search =
      input.search === undefined ? '' : textField(input.search, 'search', 80);
  const model: any = {
    class: SchoolClass,
    section: Section,
    subject: Subject,
    teacher: User,
  }[kind];
  const field = kind === 'teacher' ? 'fullName' : 'name';
  const match: any = {
    branchId: id(branchId),
    isActive: true,
    ...(kind === 'teacher' ? { role: 'teacher' } : {}),
    ...(kind === 'section' && filters.classId
      ? { classId: filters.classId }
      : {}),
  };
  if (search)
    match[field] = {
      $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      $options: 'i',
    };
  const [rows, count] = await Promise.all([
    model
      .find(match)
      .select(field)
      .sort({ [field]: 1, _id: 1 })
      .skip(offset)
      .limit(20)
      .read('primary')
      .lean(),
    model.countDocuments(match).read('primary'),
  ]);
  return {
    items: rows.map((row: any) => ({ id: String(row._id), label: row[field] })),
    total: count,
    nextOffset: offset + rows.length < count ? offset + rows.length : null,
  };
}

export async function getPrincipalAttendanceOccurrence(
  identity: JwtPayload | undefined,
  periodValue: unknown,
  query: unknown,
) {
  const { branchId, actor } = await principalAttendanceActor(identity),
    input = objectBody(query, ['date', 'offset', 'historyOffset', 'mode']);
  const periodId = objectIdField(periodValue, 'period ID'),
    date = scheduleDate(input.date),
    offset = pageOffset(input.offset),
    historyOffset = pageOffset(input.historyOffset);
  const mode = enumField(input.mode ?? 'scheduled', 'attendance view', [
    'scheduled',
    'history',
  ] as const);
  const pipeline = await occurrencePipeline(branchId, date, {}, mode);
  pipeline.push({ $match: { _id: id(periodId) } }, { $limit: 1 });
  const [resolved] = await (rootModel(mode) as any)
    .aggregate([
      ...pipeline,
      { $facet: { raw: [{ $limit: 1 }], safe: [safeOccurrence] } },
    ])
    .read('primary');
  const raw = resolved.raw[0],
    occurrence = resolved.safe[0];
  if (!raw) throw unavailable();
  const attendance = raw.attendance,
    submitted = attendance?.state === 'submitted',
    sessionId = attendance?._id;
  const roster: PipelineStage[] = submitted
    ? [
        {
          $match: {
            branchId: id(branchId),
            _id: { $in: attendance.rosterStudentIds },
          },
        },
      ]
    : enrollmentMembership(
        branchId,
        String(raw.classId),
        String(raw.sectionId),
        date,
      );
  roster.push(
    {
      $lookup: {
        from: User.collection.name,
        localField: 'userId',
        foreignField: '_id',
        pipeline: [
          {
            $match: {
              branchId: id(branchId),
              role: 'student',
              ...(submitted ? {} : { isActive: true }),
            },
          },
          { $project: { fullName: 1 } },
        ],
        as: '_identity',
      },
    },
    { $unwind: '$_identity' },
    {
      $lookup: {
        from: PeriodAttendanceRecord.collection.name,
        let: { student: '$_id' },
        pipeline: [
          {
            $match: {
              branchId: id(branchId),
              attendanceSessionId: sessionId ?? null,
              $expr: { $eq: ['$studentId', '$$student'] },
            },
          },
          ...(submitted ? effectiveAttendanceStages(branchId) : []),
          { $project: { status: 1, originalStatus: 1, effectiveRevision: 1 } },
        ],
        as: '_mark',
      },
    },
    { $set: { mark: { $arrayElemAt: ['$_mark', 0] } } },
    {
      $lookup: {
        from: StudentLeave.collection.name,
        let: { student: '$_id' },
        pipeline: [
          {
            $match: {
              branchId: id(branchId),
              state: 'approved',
              fromDate: { $lte: date },
              untilDate: { $gte: date },
              $expr: { $eq: ['$studentId', '$$student'] },
            },
          },
          { $sort: { createdAt: -1 } },
          { $limit: 1 },
          { $project: { _id: 1 } },
        ],
        as: '_approvedLeave',
      },
    },
    { $set: { approvedLeave: { $gt: [{ $size: '$_approvedLeave' }, 0] } } },
  );
  roster.push({
    $facet: {
      counts: [
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            present: {
              $sum: { $cond: [{ $eq: ['$mark.status', 'present'] }, 1, 0] },
            },
            absent: {
              $sum: { $cond: [{ $eq: ['$mark.status', 'absent'] }, 1, 0] },
            },
            late: {
              $sum: { $cond: [{ $eq: ['$mark.status', 'late'] }, 1, 0] },
            },
            leave: {
              $sum: { $cond: [{ $eq: ['$mark.status', 'leave'] }, 1, 0] },
            },
            unmarked: {
              $sum: { $cond: [{ $ifNull: ['$mark.status', false] }, 0, 1] },
            },
            approvedLeave: { $sum: { $cond: ['$approvedLeave', 1, 0] } },
            leaveMismatch: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      '$approvedLeave',
                      { $ne: ['$mark.status', 'leave'] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
        { $project: { _id: 0 } },
      ],
      items: [
        { $sort: { admissionNumber: 1, _id: 1 } },
        { $skip: offset },
        { $limit: 50 },
        {
          $project: {
            _id: 0,
            studentId: { $toString: '$_id' },
            fullName: '$_identity.fullName',
            admissionNumber: 1,
            status: { $ifNull: ['$mark.status', null] },
            originalStatus: {
              $ifNull: ['$mark.originalStatus', '$mark.status'],
            },
            effectiveRevision: { $ifNull: ['$mark.effectiveRevision', 0] },
            approvedLeave: 1,
          },
        },
      ],
    },
  });
  const [page] = await Student.aggregate(roster).read('primary');
  const counts = page.counts[0] ?? {
    total: 0,
    present: 0,
    absent: 0,
    late: 0,
    leave: 0,
    unmarked: 0,
    approvedLeave: 0,
    leaveMismatch: 0,
  };
  // Bound history independently from roster pages. Reasons/private identities
  // stay in the existing authorized review endpoint, rather than this summary.
  const amendmentPipeline = (kind: 'correction' | 'leave'): PipelineStage[] => [
    {
      $match: {
        branchId: id(branchId),
        attendanceSessionId: sessionId ?? null,
      },
    },
    {
      $lookup: {
        from: Student.collection.name,
        localField: 'studentId',
        foreignField: '_id',
        pipeline: [
          { $match: { branchId: id(branchId) } },
          { $project: { _id: 1 } },
        ],
        as: '_student',
      },
    },
    { $match: { '_student.0': { $exists: true } } },
    {
      $project: {
        _id: 0,
        requestId: { $toString: '$_id' },
        approvalId: { $toString: '$approvalRequestId' },
        studentId: { $toString: '$studentId' },
        kind: { $literal: kind },
        state: 1,
        requestedStatus: 1,
        createdAt: 1,
        reviewedAt: 1,
        fromDate: 1,
        untilDate: 1,
      },
    },
  ];
  const history = await AttendanceCorrection.aggregate([
    ...amendmentPipeline('correction'),
    {
      $unionWith: {
        coll: StudentLeave.collection.name,
        pipeline: amendmentPipeline('leave') as any,
      },
    },
    { $sort: { createdAt: -1, requestId: 1 } },
    {
      $facet: {
        items: [{ $skip: historyOffset }, { $limit: 20 }],
        count: countStage,
      },
    },
  ]).read('primary');
  const operationHistory = sessionId
    ? await AttendanceOperation.find({
        branchId,
        attendanceSessionId: sessionId,
      })
        .sort({ resultingRevision: -1 })
        .limit(20)
        .select('action resultingRevision createdAt -_id')
        .read('primary')
        .lean()
    : [];
  const issues = [
    ...new Set([
      ...occurrence.issues,
      ...(counts.total === 0 && !occurrence.issues.includes('empty_roster')
        ? ['empty_roster']
        : []),
      ...(counts.leaveMismatch > 0 ? ['approved_leave_mismatch'] : []),
    ]),
  ];
  const canOpenReview = (kind: string) => {
    if (
      !ROLE_PERMISSIONS.principal.includes(PERMISSIONS.PRINCIPAL_APPROVALS_VIEW)
    )
      return false;
    try {
      assertApprovalAuthority(String(actor._id), branchId, {
        approvalType: kind === 'correction' ? 'attendance_correction' : 'leave',
      });
      return true;
    } catch {
      return false;
    }
  };
  return {
    occurrence: { ...occurrence, issues, needsAttention: issues.length > 0 },
    timezone: schoolTimezone(),
    counts,
    students: page.items,
    nextOffset:
      offset + page.items.length < counts.total
        ? offset + page.items.length
        : null,
    amendments: history[0].items.map((item: any) => ({
      ...item,
      canOpenReview: canOpenReview(item.kind),
    })),
    historyTotal: total(history[0].count),
    nextHistoryOffset:
      historyOffset + history[0].items.length < total(history[0].count)
        ? historyOffset + history[0].items.length
        : null,
    operationHistory,
  };
}

export async function principalAttendancePatterns(
  identity: JwtPayload | undefined,
  query: unknown,
) {
  const { branchId } = await principalAttendanceActor(identity),
    input = objectBody(query, [
      'from',
      'until',
      'classId',
      'sectionId',
      'subjectId',
      'teacherId',
      'studentId',
      'offset',
    ]);
  const until =
      input.until === undefined
        ? schoolDateTime().date
        : scheduleDate(input.until),
    from =
      input.from === undefined
        ? addScheduleDays(until, -6)
        : scheduleDate(input.from),
    offset = pageOffset(input.offset);
  if (
    from > until ||
    until > schoolDateTime().date ||
    Date.parse(until) - Date.parse(from) > 30 * 86400000
  )
    throw new RequestContractError(
      400,
      'Choose a past or current range of at most 31 school dates',
    );
  const filters = await scopedFilters(branchId, input),
    pipeline = await occurrencePipeline(
      branchId,
      from,
      filters,
      'history',
      until,
      true,
    );
  pipeline.push(
    {
      $lookup: {
        from: PeriodAttendanceRecord.collection.name,
        let: {
          session: '$attendance._id',
          roster: '$attendance.rosterStudentIds',
        },
        pipeline: [
          {
            $match: {
              branchId: id(branchId),
              $expr: {
                $and: [
                  { $eq: ['$attendanceSessionId', '$$session'] },
                  { $in: ['$studentId', '$$roster'] },
                ],
              },
            },
          },
          ...effectiveAttendanceStages(branchId),
          { $match: { status: { $in: ['absent', 'late'] } } },
        ],
        as: '_records',
      },
    },
    { $unwind: '$_records' },
  );
  if (input.studentId !== undefined) {
    const studentId = objectIdField(input.studentId, 'student ID');
    if (
      !(await Student.exists({})
        .where('_id')
        .equals(studentId)
        .where('branchId')
        .equals(branchId)
        .read('primary'))
    )
      throw unavailable();
    pipeline.push({ $match: { '_records.studentId': id(studentId) } });
  }
  pipeline.push(
    {
      $group: {
        _id: '$_records.studentId',
        absent: {
          $sum: { $cond: [{ $eq: ['$_records.status', 'absent'] }, 1, 0] },
        },
        late: {
          $sum: { $cond: [{ $eq: ['$_records.status', 'late'] }, 1, 0] },
        },
        sessions: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: Student.collection.name,
        localField: '_id',
        foreignField: '_id',
        pipeline: [
          { $match: { branchId: id(branchId) } },
          { $project: { userId: 1, admissionNumber: 1 } },
        ],
        as: '_student',
      },
    },
    { $unwind: '$_student' },
    {
      $lookup: {
        from: User.collection.name,
        localField: '_student.userId',
        foreignField: '_id',
        pipeline: [
          { $match: { branchId: id(branchId), role: 'student' } },
          { $project: { fullName: 1 } },
        ],
        as: '_user',
      },
    },
    { $unwind: '$_user' },
    {
      $facet: {
        items: [
          { $sort: { absent: -1, late: -1, _id: 1 } },
          { $skip: offset },
          { $limit: 20 },
          {
            $project: {
              _id: 0,
              studentId: { $toString: '$_id' },
              fullName: '$_user.fullName',
              admissionNumber: '$_student.admissionNumber',
              absent: 1,
              late: 1,
              sessions: 1,
            },
          },
        ],
        count: countStage,
      },
    },
  );
  const [page] = await AttendanceSession.aggregate(pipeline).read('primary'),
    count = total(page.count);
  return {
    from,
    until,
    timezone: schoolTimezone(),
    items: page.items,
    total: count,
    nextOffset:
      offset + page.items.length < count ? offset + page.items.length : null,
  };
}
