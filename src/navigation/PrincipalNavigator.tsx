import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import type { ApprovalRequest } from '../services/principal/principalService';
import ApprovalDetailScreen from '../screens/principal/ApprovalDetailScreen';
import NoticeDetailScreen from '../screens/principal/NoticeDetailScreen';
import PrincipalWorkspaceScreen from '../screens/principal/PrincipalWorkspaceScreen';

export type PrincipalStackParamList = {
  PrincipalWorkspace: undefined;
  ApprovalDetail: { request: ApprovalRequest };
  NoticeDetail: { noticeId: string };
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
    </Stack.Navigator>
  );
}
