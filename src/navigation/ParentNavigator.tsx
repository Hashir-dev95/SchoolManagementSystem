import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ParentWorkspaceScreen from '../screens/parent/ParentWorkspaceScreen';
export type ParentStackParamList = { ParentWorkspace: undefined };
const Stack = createNativeStackNavigator<ParentStackParamList>();
export default function ParentNavigator() {
  return (
    <Stack.Navigator initialRouteName="ParentWorkspace">
      <Stack.Screen
        name="ParentWorkspace"
        component={ParentWorkspaceScreen}
        options={{ title: 'Parent workspace' }}
      />
    </Stack.Navigator>
  );
}
