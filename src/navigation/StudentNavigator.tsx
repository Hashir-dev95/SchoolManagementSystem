import React, { useMemo } from 'react';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import StudentLiveLessonsScreen from '../screens/liveLessons/StudentLiveLessonsScreen';
import LiveLessonRoomScreen from '../screens/liveLessons/LiveLessonRoomScreen';
import StudentWorkspaceScreen from '../screens/student/StudentWorkspaceScreen';
import NotificationInboxScreen from '../screens/notifications/NotificationInboxScreen';
import ChatWorkspaceScreen from '../screens/chat/ChatWorkspaceScreen';
export type StudentStackParamList = {
  StudentWorkspace: undefined;
  StudentNotifications: undefined;
  StudentChat: undefined;
  StudentLiveLessons: undefined;
  StudentLiveRoom: { sessionId: string };
};
const Stack = createNativeStackNavigator<StudentStackParamList>();
function StudentLiveRoom({
  route,
}: NativeStackScreenProps<StudentStackParamList, 'StudentLiveRoom'>) {
  const target = useMemo(
    () => ({ kind: 'student' as const, sessionId: route.params.sessionId }),
    [route.params.sessionId],
  );
  return <LiveLessonRoomScreen target={target} />;
}
export default function StudentNavigator() {
  return (
    <Stack.Navigator initialRouteName="StudentWorkspace">
      <Stack.Screen
        name="StudentChat"
        component={ChatWorkspaceScreen}
        options={{ title: 'Messages' }}
      />
      <Stack.Screen
        name="StudentNotifications"
        component={NotificationInboxScreen}
        options={{ title: 'Notifications' }}
      />
      <Stack.Screen
        name="StudentWorkspace"
        component={StudentWorkspaceScreen}
        options={{ title: 'Student workspace' }}
      />
      <Stack.Screen
        name="StudentLiveLessons"
        component={StudentLiveLessonsScreen}
        options={{ title: 'Live lessons' }}
      />
      <Stack.Screen
        name="StudentLiveRoom"
        component={StudentLiveRoom}
        getId={({ params }) => params.sessionId}
        options={{ title: 'Live lesson' }}
      />
    </Stack.Navigator>
  );
}
