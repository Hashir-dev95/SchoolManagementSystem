import { USER_ROLES, UserRole } from './roles';

export const PERMISSIONS = {
  BRANCHES_VIEW: 'branches.view',
  PRIVILEGED_REQUESTS_MANAGE: 'privileged_requests.manage',
  AUTOMATIONS_MANAGE: 'automations.manage',
  SESSIONS_MANAGE: 'sessions.manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [USER_ROLES.SUPER_ADMIN]: Object.values(PERMISSIONS),
  [USER_ROLES.PRINCIPAL]: [],
  [USER_ROLES.TEACHER]: [],
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
