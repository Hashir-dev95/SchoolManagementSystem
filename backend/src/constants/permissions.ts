export const PERMISSIONS = {
  STUDENTS_VIEW: 'students.view',
  STUDENTS_CREATE: 'students.create',
  STUDENTS_UPDATE: 'students.update',
  STUDENTS_DELETE: 'students.delete',
  PRINCIPALS_MANAGE: 'principals.manage',
  PRINCIPAL_DASHBOARD_VIEW: 'principal.dashboard.view',
  PRINCIPAL_APPROVALS_VIEW: 'principal.approvals.view',
  PRINCIPAL_APPROVALS_MANAGE: 'principal.approvals.manage',
  PRINCIPAL_TASKS_MANAGE: 'principal.tasks.manage',
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
