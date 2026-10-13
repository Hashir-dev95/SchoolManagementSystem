import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { TeacherTupleIds } from '../services/teacher/teacherService';
import TeacherWorkspaceScreen from '../screens/teacher/TeacherWorkspaceScreen';
import TeacherRosterScreen from '../screens/teacher/TeacherRosterScreen';

export type TeacherStackParamList = {
  TeacherWorkspace: undefined;
  TeacherRoster: TeacherTupleIds;
};
const Stack = createNativeStackNavigator<TeacherStackParamList>();

export default function TeacherNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="TeacherWorkspace"
        component={TeacherWorkspaceScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="TeacherRoster"
        component={TeacherRosterScreen}
        options={{ title: 'Assigned roster' }}
      />
    </Stack.Navigator>
  );
}
