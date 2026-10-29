import React, { useCallback, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { PrincipalStackParamList } from '../../navigation/PrincipalNavigator';
import {
  DashboardShell,
  ScreenHeading,
  SectionCard,
  Button,
  StatGrid,
  StatCard,
} from '../../components/hiraDashboard';
import {
  AdminDateField,
  formStyles,
} from '../../components/hiraDashboard/AdminForm';
import { useAuth } from '../../context/AuthContext';
import {
  attendanceOversightService,
  type AttendanceFilters,
} from '../../services/principal/attendanceOversightService';
import { useTeacherResource } from '../teacher/useTeacherResource';
import {
  AttendanceReadState,
  OccurrenceContext,
  AttendanceScopeFilters,
  attendanceStyles,
  scopeQuery,
  type SelectedAttendanceFilters,
} from './principalAttendanceUi';
type Props = NativeStackScreenProps<PrincipalStackParamList, 'Attendance'>;
export default function PrincipalAttendanceScreen({ navigation }: Props) {
  const { accessToken, user } = useAuth();
  return (
    <AttendanceWorkspace
      key={JSON.stringify([accessToken, user])}
      token={accessToken}
      navigation={navigation}
    />
  );
}
function AttendanceWorkspace({
  token,
  navigation,
}: {
  token: string | null;
  navigation: Props['navigation'];
}) {
  const [filters, setFilters] = useState<AttendanceFilters>({
      mode: 'scheduled',
      state: 'all',
    }),
    [dateInput, setDateInput] = useState(''),
    [searchInput, setSearchInput] = useState(''),
    [scope, setScope] = useState<SelectedAttendanceFilters>({});
  const update = (value: AttendanceFilters) =>
    setFilters(current => ({ ...current, ...value, offset: 0 }));
  return (
    <AttendancePage
      key={JSON.stringify(filters)}
      token={token}
      filters={filters}
      navigation={navigation}
      controls={
        <>
          <SectionCard title="School Date">
            <AdminDateField
              label="Attendance date"
              value={dateInput}
              onChange={setDateInput}
              helper="YYYY-MM-DD · leave blank for the current school date"
            />
            <View style={attendanceStyles.controls}>
              <Button
                title="Apply Date"
                variant="secondary"
                onPress={() => update({ date: dateInput.trim() || undefined })}
              />
              <Button
                title="Today"
                variant="secondary"
                onPress={() => {
                  setDateInput('');
                  update({ date: undefined });
                }}
              />
              <Button
                title={
                  filters.mode === 'history'
                    ? 'View Scheduled Sessions'
                    : 'Submitted History'
                }
                variant="secondary"
                onPress={() =>
                  update({
                    mode: filters.mode === 'history' ? 'scheduled' : 'history',
                    state: 'all',
                  })
                }
              />
            </View>
          </SectionCard>
          <AttendanceScopeFilters
            token={token}
            selected={scope}
            onChange={next => {
              setScope(next);
              update(scopeQuery(next));
            }}
          />
          <SectionCard title="Find Sessions">
            <View style={attendanceStyles.controls}>
              <TextInput
                accessibilityLabel="Search attendance"
                placeholder="Class, Subject, Teacher or Room"
                value={searchInput}
                onChangeText={setSearchInput}
                maxLength={80}
                style={formStyles.input}
                onSubmitEditing={() => update({ search: searchInput.trim() })}
              />
              <Button
                title="Search Sessions"
                variant="secondary"
                onPress={() => update({ search: searchInput.trim() })}
              />
              {(
                [
                  'all',
                  'unmarked',
                  'in_progress',
                  'submitted',
                  'needs_attention',
                ] as const
              ).map(state => (
                <Button
                  key={state}
                  title={
                    {
                      all: 'All Sessions',
                      unmarked: 'Unmarked',
                      in_progress: 'In Progress',
                      submitted: 'Submitted',
                      needs_attention: 'Needs Attention',
                    }[state]
                  }
                  variant={filters.state === state ? 'primary' : 'secondary'}
                  onPress={() => update({ state })}
                />
              ))}
            </View>
          </SectionCard>
          <Button
            title="Absence & Late Patterns"
            variant="secondary"
            onPress={() =>
              navigation.navigate('AttendancePatterns', {
                ...scopeQuery(scope),
                until: filters.date,
              })
            }
          />
        </>
      }
      onPage={offset => setFilters(current => ({ ...current, offset }))}
    />
  );
}
function AttendancePage({
  token,
  filters,
  navigation,
  controls,
  onPage,
}: {
  token: string | null;
  filters: AttendanceFilters;
  navigation: Props['navigation'];
  controls: React.ReactNode;
  onPage: (offset: number) => void;
}) {
  const load = useCallback(() => {
    if (!token) throw new Error('Sign in again to view attendance.');
    return attendanceOversightService.overview(token, filters);
  }, [token, filters]);
  const resource = useTeacherResource(load),
    data = resource.data;
  return (
    <DashboardShell
      refreshing={resource.loading}
      onRefresh={resource.refresh}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenHeading
        title="Attendance"
        subtitle={
          data
            ? data.date + ' · ' + data.timezone
            : 'Physical attendance · school date'
        }
      />
      <AttendanceReadState {...resource} retry={resource.refresh} />
      {data ? (
        <SectionCard
          title={
            data.mode === 'history'
              ? 'Submitted History'
              : 'Attendance Overview'
          }
        >
          <StatGrid>
            <StatCard
              icon="✓"
              accentIndex={0}
              label={data.mode === 'history' ? 'Recorded Sessions' : 'Expected'}
              value={data.summary.expected}
            />
            <StatCard
              icon="✓"
              accentIndex={1}
              label="Submitted"
              value={data.summary.submitted}
            />
            <StatCard
              icon="✓"
              accentIndex={2}
              label="Unmarked"
              value={data.summary.unmarked}
            />
            <StatCard
              icon="✓"
              accentIndex={3}
              label="Needs Attention"
              value={data.summary.needsAttention}
            />
          </StatGrid>
          <Text style={attendanceStyles.muted}>
            {data.summary.inProgress} in progress. Attention flags can overlap
            session states.
          </Text>
          <Text style={attendanceStyles.muted}>
            Unmarked is not absent. Live participation and recording activity do
            not mark physical attendance.
          </Text>
        </SectionCard>
      ) : null}
      {controls}
      {data ? (
        <SectionCard title="Sessions">
          {data.items.length === 0 ? (
            <Text style={attendanceStyles.body}>
              {data.summary.expected === 0 &&
              !filters.search &&
              !filters.classId &&
              !filters.sectionId &&
              !filters.subjectId &&
              !filters.teacherId
                ? data.mode === 'history'
                  ? 'No submitted attendance history for this school date.'
                  : 'No scheduled sessions for this school date.'
                : 'No matching filtered sessions.'}
            </Text>
          ) : null}
          {data.mode === 'scheduled' &&
          data.summary.expected > 0 &&
          data.summary.submitted === 0 ? (
            <Text style={attendanceStyles.muted}>
              No attendance submissions yet for this selection.
            </Text>
          ) : null}
          {data.items.map(row => (
            <SectionCard key={row.periodId} title={row.subjectName}>
              <OccurrenceContext occurrence={row} />
              {row.configurationIssue ? (
                <Text style={attendanceStyles.muted}>
                  Academic configuration needs review.
                </Text>
              ) : null}
              <Button
                title="View Session"
                variant="secondary"
                onPress={() =>
                  navigation.navigate('AttendanceSession', {
                    periodId: row.periodId,
                    date: row.date,
                    mode: data.mode,
                  })
                }
              />
            </SectionCard>
          ))}
          <View style={attendanceStyles.controls}>
            {(filters.offset ?? 0) > 0 ? (
              <Button
                title="Previous Sessions"
                variant="secondary"
                onPress={() => onPage(Math.max(0, (filters.offset ?? 0) - 20))}
              />
            ) : null}
            {data.nextOffset !== null ? (
              <Button
                title="Next Sessions"
                variant="secondary"
                onPress={() => onPage(data.nextOffset!)}
              />
            ) : null}
          </View>
        </SectionCard>
      ) : null}
    </DashboardShell>
  );
}
