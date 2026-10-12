import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import type { ApprovalRequest } from '../services/principal/principalService';
import ApprovalDetailScreen from '../screens/principal/ApprovalDetailScreen';
import NoticeDetailScreen from '../screens/principal/NoticeDetailScreen';
import PrincipalWorkspaceScreen from '../screens/principal/PrincipalWorkspaceScreen';
import PrincipalTasksScreen from '../screens/principal/PrincipalTasksScreen';
import PrincipalTaskDetailScreen from '../screens/principal/PrincipalTaskDetailScreen';
import AssignPrincipalTaskScreen from '../screens/principal/AssignPrincipalTaskScreen';
import PrincipalSafetyOverviewScreen from '../screens/principal/PrincipalSafetyOverviewScreen';
import PrincipalSafetyDetailScreen from '../screens/principal/PrincipalSafetyDetailScreen';

export type PrincipalStackParamList = {
  PrincipalWorkspace: undefined;
  ApprovalDetail: { request: ApprovalRequest };
  NoticeDetail: { noticeId: string };
  Tasks: undefined;
  TaskDetail: { taskId: string; createdMessage?: string };
  AssignTask: undefined;
  SafetyOverview: undefined;
  SafetyDetail: { alertId: string };
};

const Stack = createNativeStackNavigator<PrincipalStackParamList>();

export default function PrincipalNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen
        name="PrincipalWorkspace"
        component={PrincipalWorkspaceScreen}
      />
      <Stack.Screen name="ApprovalDetail" component={ApprovalDetailScreen} />
      <Stack.Screen name="NoticeDetail" component={NoticeDetailScreen} />
      <Stack.Screen name="Tasks" component={PrincipalTasksScreen} />
      <Stack.Screen name="TaskDetail" component={PrincipalTaskDetailScreen} />
      <Stack.Screen name="AssignTask" component={AssignPrincipalTaskScreen} />
      <Stack.Screen
        name="SafetyOverview"
        component={PrincipalSafetyOverviewScreen}
      />
      <Stack.Screen
        name="SafetyDetail"
        component={PrincipalSafetyDetailScreen}
      />
    </Stack.Navigator>
  );
}
