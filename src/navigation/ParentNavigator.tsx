import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ParentWorkspaceScreen from '../screens/parent/ParentWorkspaceScreen';
import ParentLeaveApplicationsScreen from '../screens/parent/ParentLeaveApplicationsScreen';
import NotificationInboxScreen from '../screens/notifications/NotificationInboxScreen';
import ChatWorkspaceScreen from '../screens/chat/ChatWorkspaceScreen';
export type ParentStackParamList = {
  ParentWorkspace: undefined;
  ParentLeaveApplications: undefined;
  ParentNotifications: undefined;
  ParentChat: { conversationId?: string } | undefined;
};
const Stack = createNativeStackNavigator<ParentStackParamList>();
export default function ParentNavigator() {
  return (
    <Stack.Navigator initialRouteName="ParentWorkspace">
      <Stack.Screen
        name="ParentLeaveApplications"
        component={ParentLeaveApplicationsScreen}
        options={{ title: 'Leave applications' }}
      />
      <Stack.Screen
        name="ParentChat"
        component={ChatWorkspaceScreen}
        options={{ title: 'Messages' }}
      />
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
