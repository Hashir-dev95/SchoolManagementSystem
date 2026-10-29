import React, { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { PrincipalStackParamList } from '../../navigation/PrincipalNavigator';
import {
  DashboardShell,
  ScreenHeading,
  SectionCard,
  Button,
} from '../../components/hiraDashboard';
import { AdminDateField } from '../../components/hiraDashboard/AdminForm';
import { useAuth } from '../../context/AuthContext';
import { attendanceOversightService } from '../../services/principal/attendanceOversightService';
import { useTeacherResource } from '../teacher/useTeacherResource';
import { AttendanceReadState, attendanceStyles } from './principalAttendanceUi';
type Props = NativeStackScreenProps<
  PrincipalStackParamList,
  'AttendancePatterns'
>;
export default function PrincipalAttendancePatternsScreen({ route }: Props) {
  const { accessToken, user } = useAuth();
  return (
    <Patterns
      key={JSON.stringify([accessToken, user, route.params])}
      token={accessToken}
      scope={route.params ?? {}}
    />
  );
}
function Patterns({
  token,
  scope,
}: {
  token: string | null;
  scope: NonNullable<Props['route']['params']>;
}) {
  const [from, setFrom] = useState(''),
    [until, setUntil] = useState(scope.until ?? ''),
    [range, setRange] = useState({}),
    [offset, setOffset] = useState(0);
  const load = useCallback(() => {
    if (!token) throw new Error('Sign in again to view attendance.');
    return attendanceOversightService.patterns(token, {
      ...scope,
      ...range,
      offset,
    });
  }, [token, scope, range, offset]);
  const resource = useTeacherResource(load),
    data = resource.data;
  return (
    <DashboardShell
      refreshing={resource.loading}
      onRefresh={resource.refresh}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenHeading
        title="Absence & Late Patterns"
        subtitle="Submitted physical attendance · period counts"
      />
      <SectionCard title="Date Range">
        <AdminDateField
          label="From school date"
          value={from}
          onChange={setFrom}
          helper="YYYY-MM-DD · default: seven school dates"
        />
        <AdminDateField
          label="Until school date"
          value={until}
          onChange={setUntil}
          helper="At most 31 school dates, ending today or earlier"
        />
        <Button
          title="Apply Range"
          variant="secondary"
          onPress={() => {
            setRange({
              from: from.trim() || undefined,
              until: until.trim() || undefined,
            });
            setOffset(0);
          }}
        />
      </SectionCard>
      <AttendanceReadState {...resource} retry={resource.refresh} />
      {data ? (
        <SectionCard title={data.from + ' to ' + data.until}>
          <Text style={attendanceStyles.muted}>
            {data.timezone} · Counts are absent/late periods, not absent days.
            Approved corrections are applied; unmarked sessions are excluded.
          </Text>
          {data.items.length === 0 ? (
            <Text style={attendanceStyles.body}>
              No absence or late marks match this range and context.
            </Text>
          ) : (
            data.items.map(row => (
              <SectionCard key={row.studentId} title={row.fullName}>
                <Text style={attendanceStyles.muted}>
                  {row.admissionNumber}
                </Text>
                <Text style={attendanceStyles.body}>
                  Absent periods: {row.absent} · Late periods: {row.late}
                </Text>
              </SectionCard>
            ))
          )}
          <View style={attendanceStyles.controls}>
            {offset > 0 ? (
              <Button
                title="Previous Patterns"
                variant="secondary"
                onPress={() => setOffset(Math.max(0, offset - 20))}
              />
            ) : null}
            {data.nextOffset !== null ? (
              <Button
                title="Next Patterns"
                variant="secondary"
                onPress={() => setOffset(data.nextOffset!)}
              />
            ) : null}
          </View>
        </SectionCard>
      ) : null}
    </DashboardShell>
  );
}
