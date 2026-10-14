export const PERMISSIONS = {
  TEACHER_NOTICES_VIEW: 'teacher.notices.view',
  TEACHER_NOTICES_MANAGE: 'teacher.notices.manage',
  TEACHER_WORK_VIEW: 'teacher.work.view',
  TEACHER_WORK_COMPLETE: 'teacher.work.complete',
  ASSIGNED_WORK_MANAGE: 'assigned_work.manage',
  TEACHER_ATTENDANCE_VIEW: 'teacher.attendance.view',
  TEACHER_ATTENDANCE_MANAGE: 'teacher.attendance.manage',
  TEACHER_TIMETABLE_VIEW: 'teacher.timetable.view',
  TEACHER_TIMETABLE_ACKNOWLEDGE: 'teacher.timetable.acknowledge',
  TEACHER_TIMETABLE_ISSUE: 'teacher.timetable.issue',
  TIMETABLE_MANAGE: 'timetable.manage',
  TEACHER_CLASSES_VIEW: 'teacher.classes.view',
  TEACHER_ASSIGNMENTS_MANAGE: 'teacher.assignments.manage',
  STUDENTS_VIEW: 'students.view',
  STUDENTS_CREATE: 'students.create',
  STUDENTS_UPDATE: 'students.update',
  STUDENTS_DELETE: 'students.delete',
  PRINCIPALS_MANAGE: 'principals.manage',
  PRINCIPAL_DASHBOARD_VIEW: 'principal.dashboard.view',
  PRINCIPAL_APPROVALS_VIEW: 'principal.approvals.view',
  PRINCIPAL_APPROVALS_MANAGE: 'principal.approvals.manage',
  PRINCIPAL_TASKS_MANAGE: 'principal.tasks.manage',
  PRINCIPAL_SAFETY_VIEW: 'principal.safety.view',
  PRINCIPAL_SAFETY_MANAGE: 'principal.safety.manage',
  BRANCHES_VIEW: 'branches.view',
  BRANCHES_MANAGE: 'branches.manage',
  PRIVILEGED_REQUESTS_MANAGE: 'privileged_requests.manage',
  AUTOMATIONS_MANAGE: 'automations.manage',
  SESSIONS_MANAGE: 'sessions.manage',

  TEACHERS_VIEW: 'teachers.view',
  TEACHERS_CREATE: 'teachers.create',
  TEACHERS_UPDATE: 'teachers.update',
  TEACHERS_DELETE: 'teachers.delete',

  ATTENDANCE_VIEW: 'attendance.view',
  ATTENDANCE_MANAGE: 'attendance.manage',

  EXAMS_VIEW: 'exams.view',
  EXAMS_MANAGE: 'exams.manage',

  RESULTS_VIEW: 'results.view',
  RESULTS_MANAGE: 'results.manage',

  FINANCE_VIEW: 'finance.view',
  FINANCE_MANAGE: 'finance.manage',

  REPORTS_VIEW: 'reports.view',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
