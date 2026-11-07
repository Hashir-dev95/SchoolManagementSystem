export const USER_ROLES = {
  SUPER_ADMIN: 'super_admin',
  PRINCIPAL: 'principal',
  TEACHER: 'teacher',
  STUDENT: 'student',
  PARENT: 'parent',
  FINANCE: 'finance',
  GATE_STAFF: 'gate_staff',
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];
