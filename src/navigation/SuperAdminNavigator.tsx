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
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="SuperAdminBranchDetails"
        component={SuperAdminBranchDetailsScreen}
        options={{
          title: 'Branch details',
          headerStyle: {backgroundColor: '#fbf9f4'},
          headerTintColor: '#23595a',
          headerShadowVisible: false,
          headerTitleStyle: {fontFamily: 'Nunito-Bold', fontSize: 18},
        }}
      />
    </Stack.Navigator>
  );
};

export default SuperAdminNavigator;
