import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import FinanceWorkspaceScreen from '../screens/finance/FinanceWorkspaceScreen';
export type FinanceStackParamList = { FinanceWorkspace: undefined };
const Stack = createNativeStackNavigator<FinanceStackParamList>();
export default function FinanceNavigator() {
  return (
    <Stack.Navigator initialRouteName="FinanceWorkspace">
      <Stack.Screen
        name="FinanceWorkspace"
        component={FinanceWorkspaceScreen}
        options={{ title: 'Finance workspace' }}
      />
    </Stack.Navigator>
  );
}
