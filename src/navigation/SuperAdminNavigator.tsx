import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import SuperAdminDashboardScreen from '../screens/superAdmin/SuperAdminDashboardScreen';
import SuperAdminBranchDetailsScreen from '../screens/superAdmin/SuperAdminBranchDetailsScreen';
export type SuperAdminStackParamList = {
  SuperAdminDashboard: undefined;
  SuperAdminBranchDetails: { branchId: string };
};

const Stack = createNativeStackNavigator<SuperAdminStackParamList>();

const SuperAdminNavigator = () => {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="SuperAdminDashboard"
        component={SuperAdminDashboardScreen}
        options={{
          title: 'Super Admin',
        }}
      />
      <Stack.Screen
        name="SuperAdminBranchDetails"
        component={SuperAdminBranchDetailsScreen}
        options={{ title: 'Branch Details' }}
      />
    </Stack.Navigator>
  );
};

export default SuperAdminNavigator;
