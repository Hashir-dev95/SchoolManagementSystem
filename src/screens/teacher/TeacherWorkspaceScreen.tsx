import React, { useCallback, useState } from 'react';
import { ScrollView, Text, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TeacherStackParamList } from '../../navigation/TeacherNavigator';
import { useAuth } from '../../context/AuthContext';
import { hasPermission, PERMISSIONS } from '../../constants/permissions';
import { teacherService } from '../../services/teacher/teacherService';
import TeacherClassesScreen from './TeacherClassesScreen';
import TeacherInboxScreen from './TeacherInboxScreen';
import TeacherTasksScreen from './TeacherTasksScreen';
import { useTeacherResource } from './useTeacherResource';
import { LoadState, TeacherButton, styles } from './teacherUi';

export const teacherDestinations = [
  'Home',
  'Classes',
  'Tasks',
  'Inbox',
  'Me',
] as const;
type Destination = (typeof teacherDestinations)[number];

export default function TeacherWorkspaceScreen({
  navigation,
}: NativeStackScreenProps<TeacherStackParamList, 'TeacherWorkspace'>) {
  const { user, accessToken, logout } = useAuth();
  const [destination, setDestination] = useState<Destination>('Home');
  const [visited, setVisited] = useState({ Inbox: false, Tasks: false });
  const canViewClasses = hasPermission(
    user?.role,
    PERMISSIONS.TEACHER_CLASSES_VIEW,
  );
  const load = useCallback(() => {
    if (!accessToken || !canViewClasses)
      return Promise.reject(new Error('Class access is unavailable.'));
    return teacherService.getAssignedClasses(accessToken);
  }, [accessToken, canViewClasses]);
  const resource = useTeacherResource(load);
  return (
    <SafeAreaView style={styles.shell}>
      <View style={[styles.page, destination !== 'Classes' && styles.hidden]}>
        {canViewClasses ? (
          <TeacherClassesScreen
            assignments={resource.data}
            loading={resource.loading}
            error={resource.error}
            refresh={resource.refresh}
            onOpenRoster={ids => navigation.navigate('TeacherRoster', ids)}
          />
        ) : (
          <Text style={styles.body}>Class access is unavailable.</Text>
        )}
      </View>
      {visited.Inbox ? (
        <View style={[styles.page, destination !== 'Inbox' && styles.hidden]}>
          <TeacherInboxScreen
            active={destination === 'Inbox'}
            onOpen={noticeId =>
              navigation.navigate('TeacherNotice', { noticeId })
            }
          />
        </View>
      ) : null}
      {visited.Tasks ? (
        <View style={[styles.page, destination !== 'Tasks' && styles.hidden]}>
          <TeacherTasksScreen
            active={destination === 'Tasks'}
            onOpen={workId => navigation.navigate('TeacherWork', { workId })}
          />
        </View>
      ) : null}
      {destination !== 'Classes' &&
      destination !== 'Inbox' &&
      destination !== 'Tasks' ? (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>{destination}</Text>
          {destination === 'Home' ? (
            <>
              <Text style={styles.body}>Welcome, {user?.fullName}</Text>
              <Text style={styles.muted}>Teacher workspace</Text>
              {hasPermission(
                user?.role,
                PERMISSIONS.TEACHER_ATTENDANCE_VIEW,
              ) ? (
                <TeacherButton
                  title="Open attendance pending"
                  onPress={() => navigation.navigate('TeacherAttendanceQueue')}
                />
              ) : null}
              {hasPermission(user?.role, PERMISSIONS.TEACHER_TIMETABLE_VIEW) ? (
                <TeacherButton
                  title="Open timetable"
                  onPress={() => navigation.navigate('TeacherTimetable')}
                />
              ) : null}
              <LoadState
                loading={resource.loading}
                error={resource.error}
                retry={resource.refresh}
              />
              {resource.data ? (
                <Text style={styles.body}>
                  {resource.data.length} current assignment
                  {resource.data.length === 1 ? '' : 's'}
                </Text>
              ) : null}
              {canViewClasses ? (
                <TeacherButton
                  title="View assigned classes"
                  onPress={() => setDestination('Classes')}
                />
              ) : null}
            </>
          ) : (
            <>
              <Text style={styles.body}>{user?.fullName}</Text>
              <Text style={styles.muted}>Teacher</Text>
              <Text style={styles.body}>{user?.email}</Text>
              <TeacherButton title="Log out" onPress={logout} />
            </>
          )}
        </ScrollView>
      ) : null}
      <View style={styles.tabs}>
        {teacherDestinations.map(tab => (
          <Pressable
            key={tab}
            accessibilityRole="tab"
            accessibilityLabel={tab}
            accessibilityState={{ selected: destination === tab }}
            disabled={tab === 'Classes' && !canViewClasses}
            style={[styles.tab, destination === tab && styles.selected]}
            onPress={() => {
              if (tab === 'Inbox' || tab === 'Tasks')
                setVisited(previous => ({ ...previous, [tab]: true }));
              setDestination(tab);
            }}
          >
            <Text style={styles.muted}>{tab}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}
