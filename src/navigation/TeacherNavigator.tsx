import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { TeacherTupleIds } from '../services/teacher/teacherService';
import TeacherWorkspaceScreen from '../screens/teacher/TeacherWorkspaceScreen';
import TeacherRosterScreen from '../screens/teacher/TeacherRosterScreen';
import TeacherTimetableScreen from '../screens/teacher/TeacherTimetableScreen';
import TeacherPeriodScreen from '../screens/teacher/TeacherPeriodScreen';

export type TeacherStackParamList = {
  TeacherWorkspace: undefined;
  TeacherRoster: TeacherTupleIds;
  TeacherTimetable: undefined;
  TeacherPeriod: { periodId: string; date: string };
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
      <Stack.Screen
        name="TeacherTimetable"
        component={TeacherTimetableScreen}
        options={{ title: 'Timetable' }}
      />
      <Stack.Screen
        name="TeacherPeriod"
        component={TeacherPeriodScreen}
        options={{ title: 'Period detail' }}
      />
    </Stack.Navigator>
  );
}
