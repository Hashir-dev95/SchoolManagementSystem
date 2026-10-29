import { Types, type ClientSession } from 'mongoose';
import { TimetableVersion } from '../models/timetable';

// Shared operational version selection. Approval windows are half-open school
// civil dates; only the highest approved version wins on each requested day.
export async function operationalTimetableVersions(
  branchId: string,
  dates: string[],
  session?: ClientSession,
) {
  type Version = {
    _id: Types.ObjectId;
    versionNumber: number;
    effectiveFrom: string;
    effectiveUntil: string;
  };
  const [selected] = await TimetableVersion.aggregate<
    Record<string, Version[]>
  >([
    {
      $match: {
        branchId: new Types.ObjectId(branchId),
        status: 'approved',
        effectiveFrom: { $lte: dates[dates.length - 1] },
        effectiveUntil: { $gt: dates[0] },
      },
    },
    {
      $facet: Object.fromEntries(
        dates.map(date => [
          date,
          [
            {
              $match: {
                effectiveFrom: { $lte: date },
                effectiveUntil: { $gt: date },
              },
            },
            { $sort: { versionNumber: -1 } },
            { $limit: 1 },
            {
              $project: {
                _id: 1,
                versionNumber: 1,
                effectiveFrom: 1,
                effectiveUntil: 1,
              },
            },
          ],
        ]),
      ),
    },
  ]).read('primary').session(session ?? null);
  return new Map(dates.map(date => [date, selected?.[date]?.[0]]));
}

// Callers supply only the approved replacement for this period/date and the
// winning version. Keep temporary responsibility/time/room projection shared.
export function effectiveTimetableOccurrence(
  period: {teacherId: unknown; startTime: string; endTime: string; room: string; roomId?: unknown},
  replacement?: {substituteTeacherId: unknown; startTime: string; endTime: string; room: string; roomId?: unknown},
) {
  return {
    teacherId: String(replacement?.substituteTeacherId ?? period.teacherId),
    startTime: replacement?.startTime ?? period.startTime,
    endTime: replacement?.endTime ?? period.endTime,
    room: replacement?.room ?? period.room,
    roomId: replacement ? replacement.roomId : period.roomId,
  };
}
