import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ParentWorkspaceScreen from '../screens/parent/ParentWorkspaceScreen';
import NotificationInboxScreen from '../screens/notifications/NotificationInboxScreen';
export type ParentStackParamList = {
  ParentWorkspace: undefined;
  ParentNotifications: undefined;
};
const Stack = createNativeStackNavigator<ParentStackParamList>();
export default function ParentNavigator() {
  return (
    <Stack.Navigator initialRouteName="ParentWorkspace">
      <Stack.Screen
        name="ParentNotifications"
        component={NotificationInboxScreen}
        options={{ title: 'Notifications' }}
      />
      <Stack.Screen
        name="ParentWorkspace"
        component={ParentWorkspaceScreen}
        options={{ title: 'Parent workspace' }}
      />
    </Stack.Navigator>
  );
}
