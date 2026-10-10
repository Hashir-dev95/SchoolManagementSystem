import { hasPermission, PERMISSIONS, ROLE_PERMISSIONS } from '../src/constants/permissions';
import { USER_ROLES } from '../src/constants/roles';

describe('super admin permissions', () => {
  it('includes principal management permission for super admins', () => {
    expect(PERMISSIONS.PRINCIPALS_MANAGE).toBe('principals.manage');
    expect(ROLE_PERMISSIONS[USER_ROLES.SUPER_ADMIN]).toContain(
      PERMISSIONS.PRINCIPALS_MANAGE,
    );
    expect(hasPermission(USER_ROLES.SUPER_ADMIN, PERMISSIONS.PRINCIPALS_MANAGE)).toBe(true);
  });
});
