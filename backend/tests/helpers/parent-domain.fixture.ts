import { state, put, oid } from './parent-workspace.fixture';
import {
  TimetablePeriod,
  TimetableVersion,
  SubstituteAssignment,
} from '../../src/models/timetable';
import {
  AttendanceSession,
  PeriodAttendanceRecord,
} from '../../src/models/periodAttendance';
import { ClassSubject } from '../../src/models/classSubject';
import Subject from '../../src/models/subject';
import User from '../../src/models/user';
import {
  scheduleWeekday,
  addScheduleDays,
} from '../../src/services/school-date.service';
import { Homework } from '../../src/models/homework';
import { Quiz } from '../../src/models/quiz';
import { AcademicWorkAudience } from '../../src/models/academicWorkAudience';
import { AcademicResult } from '../../src/models/academicResult';

export async function seedOccurrence() {
  const version = await put(TimetableVersion, {
    branchId: state.branch._id,
    versionNumber: 1,
    status: 'approved',
    effectiveFrom: state.today,
    effectiveUntil: addScheduleDays(state.today, 10),
  });
  const subject = await put(Subject, {
    branchId: state.branch._id,
    name: 'Mathematics',
    isActive: true,
  });
  await put(ClassSubject, {
    branchId: state.branch._id,
    classId: state.cls._id,
    academicPeriodId: state.period._id,
    subjectId: subject._id,
    isActive: true,
  });
  const teacher = await put(User, {
    branchId: state.branch._id,
    fullName: 'Teacher',
    role: 'teacher',
    isActive: true,
  });
  const period = await put(TimetablePeriod, {
    branchId: state.branch._id,
    timetableVersionId: version._id,
    classId: state.cls._id,
    sectionId: state.section._id,
    subjectId: subject._id,
    teacherId: teacher._id,
    dayOfWeek: scheduleWeekday(state.today),
    startTime: '08:00',
    endTime: '08:45',
    room: 'Room 1',
  });
  const substitute = await put(User, {
    branchId: state.branch._id,
    fullName: 'Effective Teacher',
    role: 'teacher',
    isActive: true,
  });
  await put(SubstituteAssignment, {
    branchId: state.branch._id,
    periodId: period._id,
    originalTeacherId: teacher._id,
    substituteTeacherId: substitute._id,
    date: state.today,
    status: 'approved',
    startTime: '09:00',
    endTime: '09:45',
    room: 'Room 2',
  });
  const session = await put(AttendanceSession, {
    branchId: state.branch._id,
    periodId: period._id,
    timetableVersionId: version._id,
    date: state.today,
    classId: state.cls._id,
    sectionId: state.section._id,
    rosterStudentIds: [state.student._id, state.otherStudent._id],
    state: 'submitted',
    revision: 1,
  });
  await put(PeriodAttendanceRecord, {
    branchId: state.branch._id,
    attendanceSessionId: session._id,
    studentId: state.student._id,
    status: 'present',
    revision: 1,
  });
  await put(PeriodAttendanceRecord, {
    branchId: state.branch._id,
    attendanceSessionId: session._id,
    studentId: state.otherStudent._id,
    status: 'absent',
    revision: 1,
  });
  return { period, session };
}
export async function seedWork(type: 'homework' | 'quiz' = 'homework') {
  const row = await put(type === 'homework' ? Homework : Quiz, {
    branchId: state.branch._id,
    classId: state.cls._id,
    sectionId: state.section._id,
    subjectId: oid(),
    academicYear: state.cls.academicYear,
    lessonPlanId: oid(),
    topicIds: [],
    title: 'Child assigned work',
    instructions: 'Published instructions',
    status: 'published',
    revision: 1,
    publishedRevision: 1,
    dueAt: state.today,
    availableFrom: state.today,
    availableUntil: state.today,
    questions: [
      {
        questionId: 'q1',
        type: 'true_false',
        text: 'Question',
        options: [],
        correctBoolean: true,
      },
    ],
  });
  const audience = await put(AcademicWorkAudience, {
    branchId: state.branch._id,
    workType: type,
    workId: row._id,
    studentId: state.student._id,
    recipientUserId: state.user._id,
    state: 'assigned',
    publishedRevision: 1,
  });
  return { row, audience };
}
export async function seedResult(status = 'published') {
  const subject = await put(Subject, {
    branchId: state.branch._id,
    name: 'Mathematics',
  });
  return put(AcademicResult, {
    branchId: state.branch._id,
    classId: state.cls._id,
    sectionId: state.section._id,
    subjectId: subject._id,
    studentId: state.student._id,
    recipientUserId: state.user._id,
    status,
    publishedAt: new Date(),
    publishedRevision: 1,
    currentRevision: 1,
    assessmentTitle: 'Child published result',
    assessmentSourceType: 'homework_submission',
    sourcePublishedRevision: 1,
    revisions: [
      {
        revision: 1,
        awardedMarks: 8,
        maxMarks: 10,
        teacherPrivateNote: 'Teacher private note',
      },
    ],
    moderationHistory: [{ note: 'Private moderation' }],
  });
}
