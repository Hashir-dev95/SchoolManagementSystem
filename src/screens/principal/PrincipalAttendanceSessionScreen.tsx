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
import { AdminFeedback } from '../../components/hiraDashboard/AdminForm';
import { useAuth } from '../../context/AuthContext';
import { attendanceOversightService } from '../../services/principal/attendanceOversightService';
import { useTeacherResource } from '../teacher/useTeacherResource';
import {
  AttendanceReadState,
  OccurrenceContext,
  attendanceStyles,
  issueLabel,
} from './principalAttendanceUi';
type Props = NativeStackScreenProps<
  PrincipalStackParamList,
  'AttendanceSession'
>;
export default function PrincipalAttendanceSessionScreen(props: Props) {
  const { accessToken, user } = useAuth();
  return (
    <SessionDetail
      key={JSON.stringify([accessToken, user, props.route.params])}
      token={accessToken}
      {...props}
    />
  );
}
function SessionDetail({
  token,
  route,
  navigation,
}: { token: string | null } & Props) {
  const [offset, setOffset] = useState(0),
    [historyOffset, setHistoryOffset] = useState(0);
  const { periodId, date, mode } = route.params;
  const load = useCallback(() => {
    if (!token) throw new Error('Sign in again to view attendance.');
    return attendanceOversightService.detail(token, periodId, {
      date,
      mode,
      offset,
      historyOffset,
    });
  }, [token, periodId, date, mode, offset, historyOffset]);
  const resource = useTeacherResource(load),
    data = resource.data;
  return (
    <DashboardShell refreshing={resource.loading} onRefresh={resource.refresh}>
      <ScreenHeading
        title="Attendance Session"
        subtitle={date + (data ? ' · ' + data.timezone : '')}
      />
      <AttendanceReadState {...resource} retry={resource.refresh} />
      {data ? (
        <>
          <SectionCard title="Teaching Context">
            <OccurrenceContext occurrence={data.occurrence} />
            <Text style={attendanceStyles.muted}>
              {data.occurrence.submittedAt
                ? 'Submitted: ' +
                  new Date(data.occurrence.submittedAt).toLocaleString(
                    'en-PK',
                    { timeZone: data.timezone },
                  )
                : 'Not submitted'}
            </Text>
            {!data.occurrence.operational ? (
              <Text style={attendanceStyles.muted}>
                Historical submitted snapshot. Not part of the operational
                expected-session count.
              </Text>
            ) : null}
          </SectionCard>
          {data.occurrence.needsAttention ? (
            <AdminFeedback
              kind="error"
              title="Attendance Needs Attention"
              message={data.occurrence.issues.map(issueLabel).join('. ')}
            />
          ) : null}
          <SectionCard title="Roster Counts">
            <Text style={attendanceStyles.body}>
              Eligible roster: {data.counts.total}
            </Text>
            <Text style={attendanceStyles.body}>
              Present: {data.counts.present} · Absent: {data.counts.absent} ·
              Late: {data.counts.late}
            </Text>
            <Text style={attendanceStyles.body}>
              Leave marks: {data.counts.leave} · Unmarked:{' '}
              {data.counts.unmarked}
            </Text>
            <Text style={attendanceStyles.muted}>
              Approved leave on file: {data.counts.approvedLeave}. Leave context
              does not automatically change physical marks.
            </Text>
          </SectionCard>
          <SectionCard title="Student Roster">
            {data.students.length === 0 ? (
              <Text style={attendanceStyles.body}>
                No eligible Students are available. Review enrollment
                configuration.
              </Text>
            ) : null}
            {data.students.map(student => (
              <SectionCard key={student.studentId} title={student.fullName}>
                <Text style={attendanceStyles.muted}>
                  {student.admissionNumber}
                </Text>
                <Text style={attendanceStyles.body}>
                  {student.status
                    ? student.status[0].toUpperCase() + student.status.slice(1)
                    : 'Unmarked'}
                </Text>
                {student.originalStatus &&
                student.originalStatus !== student.status ? (
                  <Text style={attendanceStyles.muted}>
                    Original: {student.originalStatus} · approved correction
                    applied
                  </Text>
                ) : null}
                {student.approvedLeave ? (
                  <Text style={attendanceStyles.muted}>
                    Approved leave on file for this date
                  </Text>
                ) : null}
              </SectionCard>
            ))}
            <View style={attendanceStyles.controls}>
              {offset > 0 ? (
                <Button
                  title="Previous Students"
                  variant="secondary"
                  onPress={() => setOffset(Math.max(0, offset - 50))}
                />
              ) : null}
              {data.nextOffset !== null ? (
                <Button
                  title="Next Students"
                  variant="secondary"
                  onPress={() => setOffset(data.nextOffset!)}
                />
              ) : null}
            </View>
          </SectionCard>
          <SectionCard title="Corrections and Leave History">
            {data.amendments.length === 0 ? (
              <Text style={attendanceStyles.muted}>
                No correction or leave requests for this session.
              </Text>
            ) : null}
            {data.amendments.map(item => (
              <SectionCard
                key={item.requestId}
                title={
                  item.kind === 'correction'
                    ? 'Attendance Correction'
                    : 'Student Leave'
                }
              >
                <Text style={attendanceStyles.body}>
                  {item.state}
                  {item.requestedStatus
                    ? ' · requested ' + item.requestedStatus
                    : ''}
                </Text>
                {item.fromDate ? (
                  <Text style={attendanceStyles.muted}>
                    {item.fromDate} to {item.untilDate}
                  </Text>
                ) : null}
                {item.canOpenReview ? (
                  <Button
                    title={
                      item.kind === 'correction'
                        ? 'Open Correction Review'
                        : 'Open Leave Review'
                    }
                    variant="secondary"
                    onPress={() =>
                      navigation.navigate('AttendanceReview', {
                        approvalId: item.approvalId,
                      })
                    }
                  />
                ) : null}
              </SectionCard>
            ))}
            <View style={attendanceStyles.controls}>
              {historyOffset > 0 ? (
                <Button
                  title="Newer Requests"
                  variant="secondary"
                  onPress={() =>
                    setHistoryOffset(Math.max(0, historyOffset - 20))
                  }
                />
              ) : null}
              {data.nextHistoryOffset !== null ? (
                <Button
                  title="Older Requests"
                  variant="secondary"
                  onPress={() => setHistoryOffset(data.nextHistoryOffset!)}
                />
              ) : null}
            </View>
          </SectionCard>
          <SectionCard title="Recent Attendance History">
            {data.operationHistory.length === 0 ? (
              <Text style={attendanceStyles.muted}>
                No saved attendance operations.
              </Text>
            ) : (
              data.operationHistory.map(event => (
                <Text
                  key={event.resultingRevision}
                  style={attendanceStyles.muted}
                >
                  {event.action === 'submit' ? 'Submitted' : 'Draft saved'} ·
                  Revision {event.resultingRevision} ·{' '}
                  {new Date(event.createdAt).toLocaleString('en-PK', {
                    timeZone: data.timezone,
                  })}
                </Text>
              ))
            )}
          </SectionCard>
        </>
      ) : null}
    </DashboardShell>
  );
}
