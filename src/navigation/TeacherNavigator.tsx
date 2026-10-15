import TeacherAttendanceReviewScreen from '../screens/teacher/TeacherAttendanceReviewScreen';
import TeacherAcademicScreen from '../screens/teacher/TeacherAcademicScreen';
import TeacherLessonScreen from '../screens/teacher/TeacherLessonScreen';
import type {LessonPlan} from '../services/teacher/academicService';
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { TeacherTupleIds } from '../services/teacher/teacherService';
import TeacherWorkspaceScreen from '../screens/teacher/TeacherWorkspaceScreen';
import TeacherRosterScreen from '../screens/teacher/TeacherRosterScreen';
import TeacherTimetableScreen from '../screens/teacher/TeacherTimetableScreen';
import TeacherPeriodScreen from '../screens/teacher/TeacherPeriodScreen';
import TeacherAttendanceQueueScreen from '../screens/teacher/TeacherAttendanceQueueScreen';
import TeacherAttendanceScreen from '../screens/teacher/TeacherAttendanceScreen';
import TeacherNoticeScreen from '../screens/teacher/TeacherNoticeScreen';
import TeacherWorkScreen from '../screens/teacher/TeacherWorkScreen';

export type TeacherStackParamList = {
  TeacherAcademic: TeacherTupleIds;
  TeacherLesson: TeacherTupleIds & {lesson?: LessonPlan};
  TeacherWorkspace: undefined;
  TeacherAttendanceReview: { sessionId: string; studentId: string };
  TeacherNotice: { noticeId?: string };
  TeacherWork: { workId: string };
  TeacherRoster: TeacherTupleIds;
  TeacherTimetable: undefined;
  TeacherPeriod: { periodId: string; date: string };
  TeacherAttendanceQueue: undefined;
  TeacherAttendance: { periodId: string; date: string };
};
const Stack = createNativeStackNavigator<TeacherStackParamList>();

export default function TeacherNavigator() {
  return (
    <Stack.Navigator initialRouteName="TeacherWorkspace">
      <Stack.Screen name="TeacherAcademic" component={TeacherAcademicScreen} options={{title: 'Class academics'}} />
      <Stack.Screen name="TeacherLesson" component={TeacherLessonScreen} options={{title: 'Lesson Plan'}} />
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
      <Stack.Screen
        name="TeacherAttendanceQueue"
        component={TeacherAttendanceQueueScreen}
        options={{ title: 'Attendance pending' }}
      />
      <Stack.Screen
        name="TeacherAttendance"
        component={TeacherAttendanceScreen}
        options={{ title: 'Period attendance' }}
      />
      <Stack.Screen
        name="TeacherAttendanceReview"
        component={TeacherAttendanceReviewScreen}
        options={{ title: 'Attendance review' }}
      />
      <Stack.Screen
        name="TeacherNotice"
        component={TeacherNoticeScreen}
        options={{ title: 'Notice' }}
      />
      <Stack.Screen
        name="TeacherWork"
        component={TeacherWorkScreen}
        options={{ title: 'Assigned work' }}
      />
    </Stack.Navigator>
  );
}
