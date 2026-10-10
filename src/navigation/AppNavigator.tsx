import React from 'react';
import { NavigationContainer } from '@react-navigation/native';

import { AuthProvider, useAuth } from '../context/AuthContext';
import { USER_ROLES } from '../constants/roles';

import AuthNavigator from './AuthNavigator';
import SuperAdminNavigator from './SuperAdminNavigator';
import PrincipalNavigator from './PrincipalNavigator';
const RoleNavigator = () => {
  const { user } = useAuth();

  if (!user) {
    return <AuthNavigator />;
  }

  switch (user.role) {
    case USER_ROLES.SUPER_ADMIN:
      return <SuperAdminNavigator />;
    case USER_ROLES.PRINCIPAL:
      return <PrincipalNavigator />;

    default:
      return <AuthNavigator />;
  }
};

const AppNavigator = () => {
  return (
    <AuthProvider>
      <NavigationContainer>
        <RoleNavigator />
      </NavigationContainer>
    </AuthProvider>
  );
};

export default AppNavigator;
