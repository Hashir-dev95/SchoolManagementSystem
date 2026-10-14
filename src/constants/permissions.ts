import { USER_ROLES, UserRole } from './roles';

export const PERMISSIONS = {
  TEACHER_NOTICES_VIEW: 'teacher.notices.view',
  TEACHER_NOTICES_MANAGE: 'teacher.notices.manage',
  TEACHER_WORK_VIEW: 'teacher.work.view',
  TEACHER_WORK_COMPLETE: 'teacher.work.complete',
  TEACHER_ATTENDANCE_VIEW: 'teacher.attendance.view',
  TEACHER_ATTENDANCE_MANAGE: 'teacher.attendance.manage',
  TEACHER_TIMETABLE_VIEW: 'teacher.timetable.view',
  TEACHER_TIMETABLE_ACKNOWLEDGE: 'teacher.timetable.acknowledge',
  TEACHER_TIMETABLE_ISSUE: 'teacher.timetable.issue',
  TEACHER_CLASSES_VIEW: 'teacher.classes.view',
  BRANCHES_VIEW: 'branches.view',
  PRINCIPALS_MANAGE: 'principals.manage',
  PRIVILEGED_REQUESTS_MANAGE: 'privileged_requests.manage',
  AUTOMATIONS_MANAGE: 'automations.manage',
  SESSIONS_MANAGE: 'sessions.manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [USER_ROLES.SUPER_ADMIN]: [
    PERMISSIONS.BRANCHES_VIEW,
    PERMISSIONS.PRINCIPALS_MANAGE,
    PERMISSIONS.PRIVILEGED_REQUESTS_MANAGE,
    PERMISSIONS.AUTOMATIONS_MANAGE,
    PERMISSIONS.SESSIONS_MANAGE,
  ],
  [USER_ROLES.PRINCIPAL]: [],
  [USER_ROLES.TEACHER]: [
    PERMISSIONS.TEACHER_NOTICES_VIEW,
    PERMISSIONS.TEACHER_NOTICES_MANAGE,
    PERMISSIONS.TEACHER_WORK_VIEW,
    PERMISSIONS.TEACHER_WORK_COMPLETE,
    PERMISSIONS.TEACHER_ATTENDANCE_VIEW,
    PERMISSIONS.TEACHER_ATTENDANCE_MANAGE,
    PERMISSIONS.TEACHER_CLASSES_VIEW,
    PERMISSIONS.TEACHER_TIMETABLE_VIEW,
    PERMISSIONS.TEACHER_TIMETABLE_ACKNOWLEDGE,
    PERMISSIONS.TEACHER_TIMETABLE_ISSUE,
  ],
  [USER_ROLES.STUDENT]: [],
};

export const hasPermission = (
  userRole: UserRole | undefined | null,
  permission: Permission,
): boolean => {
  if (!userRole) return false;
  const userPerms = ROLE_PERMISSIONS[userRole];
  return userPerms ? userPerms.includes(permission) : false;
};
