export const USER_ROLES = {
  SUPER_ADMIN: 'super_admin',
  PRINCIPAL: 'principal',
  TEACHER: 'teacher',
  STUDENT: 'student',
  PARENT: 'parent',
  FINANCE: 'finance',
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];
