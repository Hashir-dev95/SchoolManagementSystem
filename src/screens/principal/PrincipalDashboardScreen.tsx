import React from 'react';
import { StyleSheet, Text } from 'react-native';

import {
  Card,
  HeroBanner,
  ListRow,
  ScreenHeading,
  SectionCard,
  StatCard,
  StatGrid,
  Button,
} from '../../components/hiraDashboard';
import {
  DashboardShell,
  DashboardStateCard,
} from '../../components/hiraDashboard/DashboardShell';
import { usePrincipalDashboardData } from '../../hooks/usePrincipalDashboardData';
import { colors, typography } from '../../theme/hiraDashboard';
import { TeacherAssignmentEntry } from '../admin/TeacherAssignmentEntry';

interface PrincipalDashboardScreenProps {
  onOpenApprovals: () => void;
  onOpenInbox: () => void;
  onOpenTasks: () => void;
  onOpenSafety: () => void;
  onAssignTeacher?: () => void;
  onOpenAttendance?: () => void;
}

export default function PrincipalDashboardScreen({
  onOpenApprovals,
  onOpenInbox,
  onOpenTasks,
  onOpenSafety,
  onAssignTeacher,
  onOpenAttendance,
}: PrincipalDashboardScreenProps) {
  const { data, loading, error, reload } = usePrincipalDashboardData();
  const today = data?.attendance
    ? new Date(data.attendance.date + 'T12:00:00Z').toLocaleDateString(
        'en-PK',
        {
          timeZone: 'UTC',
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        },
      )
    : 'School operations';

  return (
    <DashboardShell safeArea={false}>
      <ScreenHeading title="Principal overview" subtitle={data?.branch.name} />
      <DashboardStateCard loading={loading} error={error} onRetry={reload} />
      <SectionCard title="Safety / School Overview">
        <Text style={styles.note}>
          {data
            ? `${data.safetyAlerts.total} active alerts · ${data.safetyAlerts.critical} critical`
            : 'Review operational alerts in your branch.'}
        </Text>
        <Button
          title="Open Safety Overview"
          variant="secondary"
          onPress={onOpenSafety}
        />
      </SectionCard>
      {onAssignTeacher ? (
        <TeacherAssignmentEntry onAssign={onAssignTeacher} />
      ) : null}
      <SectionCard title="Attendance Today">
        {data?.attendance ? (
          <>
            <Text style={styles.note}>
              {data.attendance.date} · {data.attendance.timezone}
            </Text>
            <Text style={styles.note}>
              Expected sessions: {data.attendance.expected} · Submitted:{' '}
              {data.attendance.submitted}
            </Text>
            <Text style={styles.note}>
              Unmarked: {data.attendance.unmarked} · In progress:{' '}
              {data.attendance.inProgress} · Needs attention:{' '}
              {data.attendance.needsAttention}
            </Text>
            <Text style={styles.note}>
              Attention flags can overlap session states. Unmarked is not
              absent.
            </Text>
          </>
        ) : (
          <Text style={styles.note}>
            {loading
              ? 'Loading attendance overview...'
              : error
              ? 'Attendance could not be loaded. Retry the overview.'
              : 'Attendance overview is unavailable for your account or active Branch.'}
          </Text>
        )}
        {onOpenAttendance ? (
          <Button
            title="Open Attendance"
            variant="secondary"
            onPress={onOpenAttendance}
          />
        ) : null}
      </SectionCard>
      <SectionCard title="Tasks">
        <Text style={styles.note}>
          {data?.tasks
            ? `${data.tasks.length} branch tasks · ${
                data.tasks.filter(
                  task =>
                    task.status === 'pending' || task.status === 'in_progress',
                ).length
              } active`
            : 'Assign and track tasks in your branch.'}
        </Text>
        <Button title="Open Tasks" variant="secondary" onPress={onOpenTasks} />
      </SectionCard>
      {data ? (
        <>
          <HeroBanner
            roleLabel="SCHOOL OPERATIONS"
            dateLabel={today}
            bigValue={data.students.total.toLocaleString('en-PK')}
            bigValueCaption="students in this branch"
            title="Your school at a glance"
            subtitle="Enrollment, attendance and approval activity"
          />
          <StatGrid>
            <StatCard
              accentIndex={0}
              icon="◇"
              label="Fee outstanding"
              value={data.feeSummary.outstandingAmount.toLocaleString('en-PK')}
              foot={`${data.feeSummary.overdueInvoices} overdue invoices`}
            />
            <StatCard
              accentIndex={1}
              icon="✓"
              label="Attendance submitted"
              value={data.attendance?.submitted ?? 'Unavailable'}
              foot={
                data.attendance
                  ? `${data.attendance.expected} expected sessions`
                  : 'Active Branch and attendance permission required'
              }
              onPress={onOpenAttendance}
            />
            <StatCard
              accentIndex={2}
              icon="▤"
              label="Safety alerts"
              value={data.safetyAlerts.total}
              foot={`${data.safetyAlerts.critical} critical · ${data.safetyAlerts.open} open`}
            />
            <StatCard
              accentIndex={3}
              icon="✉"
              label="School notices"
              value={data.notices.length}
              foot="Published notices for this branch"
            />
          </StatGrid>
          <SectionCard title="Branch snapshot">
            <Card style={styles.unavailableCard}>
              <Text style={styles.note}>
                {data.students.active} active of {data.students.total} students
                · {data.attendance?.submitted ?? 'Unavailable'} attendance
                submissions ·{' '}
                {data.feeSummary.paidAmount.toLocaleString('en-PK')} collected
              </Text>
            </Card>
          </SectionCard>
          <SectionCard title="Review workspace">
            <ListRow
              icon="✓"
              title="School approvals"
              subtitle={`${data.pendingApprovals.total} pending requests`}
              tag="Review"
              last
              onPress={onOpenApprovals}
            />
            <ListRow
              icon="✉"
              title="School notices"
              subtitle={`${data.notices.length} published notices`}
              tag="Open"
              last
              onPress={onOpenInbox}
            />
          </SectionCard>
        </>
      ) : null}
    </DashboardShell>
  );
}

const styles = StyleSheet.create({
  unavailableCard: {
    padding: 12,
    marginBottom: 0,
    borderBottomWidth: 1,
    shadowOpacity: 0,
    elevation: 0,
  },
  note: { ...typography.small, color: colors.muted },
});
