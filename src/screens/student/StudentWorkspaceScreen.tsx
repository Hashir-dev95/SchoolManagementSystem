import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../../context/AuthContext';
import { ApiError } from '../../services/api/apiClient';
import {
  studentWorkspaceService as service,
  type StudentProfile,
  type StudentEnrollmentView,
  type StudentOccurrence,
  type AssignedRead,
} from '../../services/student/workspaceService';
import type { StudentResult } from '../../services/student/resultService';
import type { StudentStackParamList } from '../../navigation/StudentNavigator';
import {
  Button,
  DashboardShell,
  DashboardStateCard,
  HeroBanner,
  SectionCard,
  WorkspaceTabs,
} from '../../components/hiraDashboard';
import { colors, spacing, typography } from '../../theme/hiraDashboard';
import { FeeCards } from '../../components/hiraDashboard/FeeCards';
import type { FeeList } from '../../services/finance/financeService';

const panes = [
  'Profile',
  'Timetable',
  'Attendance',
  'Homework',
  'Quiz',
  'Results',
  'Fees',
] as const;
type Pane = (typeof panes)[number];
type Data =
  | { kind: 'Fees'; fees: FeeList }
  | {
      kind: 'Profile';
      profile: StudentProfile;
      enrollment: StudentEnrollmentView;
    }
  | {
      kind: 'Timetable' | 'Attendance';
      date: string;
      items: StudentOccurrence[];
    }
  | { kind: 'Homework' | 'Quiz'; items: AssignedRead[] }
  | { kind: 'Results'; items: StudentResult[] };
async function loadPane(token: string, pane: Pane): Promise<Data | null> {
  switch (pane) {
    case 'Profile': {
      const [profile, enrollment] = await Promise.all([
        service.profile(token),
        service.enrollment(token),
      ]);
      return { kind: 'Profile', profile, enrollment };
    }
    case 'Timetable':
      return { kind: pane, ...(await service.timetable(token)) };
    case 'Attendance':
      return { ...(await service.attendance(token)), kind: pane };
    case 'Homework':
      return { kind: pane, ...(await service.homework(token)) };
    case 'Quiz':
      return { kind: pane, ...(await service.quizzes(token)) };
    case 'Results':
      return { kind: pane, ...(await service.results(token)) };
    case 'Fees':
      return { kind: 'Fees', fees: await service.fees(token) };
  }
}
export default function StudentWorkspaceScreen() {
  const { user, accessToken } = useAuth();
  if (!user || !accessToken) {
    return null;
  }
  return <Workspace key={user.id} token={accessToken} />;
}
function Workspace({ token }: { token: string }) {
  const { logout } = useAuth();
  const navigation =
    useNavigation<NativeStackNavigationProp<StudentStackParamList>>();
  const [pane, setPane] = useState<Pane>('Profile');
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    setLoading(true);
    loadPane(token, pane)
      .then(value => {
        if (active) {
          setData(value);
        }
      })
      .catch((failure: unknown) => {
        if (active) {
          setError(
            failure instanceof ApiError && failure.status === 403
              ? 'Forbidden: your Student record or enrollment is unavailable. Contact your school.'
              : failure instanceof ApiError && failure.status === 401
              ? 'Session unavailable. Sign in again.'
              : 'Could not load your school records. Please retry.',
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [token, pane, attempt]);
  const retry = useCallback(async () => {
    setAttempt(value => value + 1);
  }, []);
  return (
    <DashboardShell>
      <HeroBanner
        roleLabel="STUDENT WORKSPACE"
        dateLabel="Connected"
        title="Your school day"
        subtitle="Your authenticated school records. Academic placement comes from current enrollment."
      />
      <View style={styles.actions}>
        <Button
          title="Notifications"
          variant="secondary"
          onPress={() => navigation.navigate('StudentNotifications')}
        />
        <Button
          title="Live lessons"
          onPress={() => navigation.navigate('StudentLiveLessons')}
        />
        <Button
          title="Sign out"
          variant="secondary"
          onPress={() => {
            logout().catch(() =>
              setLogoutError('Sign out could not be confirmed.'),
            );
          }}
        />
      </View>
      {logoutError ? (
        <Text accessibilityRole="alert" style={styles.text}>
          {logoutError}
        </Text>
      ) : null}
      <WorkspaceTabs
        items={panes}
        selected={pane}
        accessibilityLabel="Student workspace sections"
        onSelect={value => setPane(value as Pane)}
      />
      <DashboardStateCard loading={loading} error={error} onRetry={retry} />
      {!loading && !error && data ? <ReadContent data={data} /> : null}
    </DashboardShell>
  );
}
function ReadContent({ data }: { data: Data }) {
  if (data.kind === 'Fees') {
    return <FeeCards data={data.fees} />;
  }
  if (data.kind === 'Profile') {
    const { profile, enrollment: e } = data;
    return (
      <>
        <SectionCard title={profile.fullName}>
          <Text style={styles.text}>{profile.email}</Text>
          <Text style={styles.text}>Admission: {profile.admissionNumber}</Text>
        </SectionCard>
        <SectionCard title="Current enrollment">
          <Text style={styles.text}>
            {e.branch.name} · {e.schoolClass.name} · {e.section.name}
          </Text>
          <Text style={styles.text}>
            {e.academicPeriod.name} · {e.status}
          </Text>
        </SectionCard>
      </>
    );
  }
  if (data.kind === 'Timetable' || data.kind === 'Attendance') {
    return (
      <>
        <Text style={styles.note}>
          {data.date}
          {data.kind === 'Attendance'
            ? ' · Physical attendance only; live participation and recording completion are separate.'
            : ''}
        </Text>
        {!data.items.length ? (
          <Text style={styles.text}>No scheduled periods for this date.</Text>
        ) : (
          data.items.map(item => (
            <SectionCard key={item.periodId} title={item.subject}>
              <Text style={styles.text}>
                {item.startTime}–{item.endTime} · {item.room}
              </Text>
              <Text style={styles.text}>
                {item.teacher}
                {item.isSubstitute ? ' · Substitute' : ''}
              </Text>
              {data.kind === 'Attendance' ? (
                <Text style={styles.text}>
                  {item.status ??
                    (item.state === 'in_progress'
                      ? 'In progress — no submitted mark'
                      : 'Unmarked')}
                </Text>
              ) : null}
            </SectionCard>
          ))
        )}
      </>
    );
  }
  if (data.kind === 'Results') {
    return data.items.length ? (
      <>
        {data.items.map(item => (
          <SectionCard key={item.resultId} title={item.assessment.title}>
            <Text style={styles.text}>
              {item.subject.name} · {item.awardedMarks}/{item.maxMarks} ·{' '}
              {item.percentage}%
            </Text>
            {item.releasedFeedback ? (
              <Text style={styles.text}>{item.releasedFeedback.feedback}</Text>
            ) : null}
          </SectionCard>
        ))}
      </>
    ) : (
      <Text style={styles.text}>No published results.</Text>
    );
  }
  // Only Homework/Quiz variants remain; no submission or attempt controls.
  if (data.kind === 'Homework' || data.kind === 'Quiz') {
    return (
      <>
        <Text style={styles.note}>
          Read-only assigned work. Submission and quiz attempt flows are not
          integrated in this phase.
        </Text>
        {data.items.length ? (
          data.items.map(item => (
            <SectionCard key={item.id} title={item.title}>
              <Text style={styles.text}>{item.instructions}</Text>
              <Text style={styles.text}>
                {item.dueAt
                  ? `Due ${item.dueAt}`
                  : `${item.availableFrom} – ${item.availableUntil}`}
              </Text>
            </SectionCard>
          ))
        ) : (
          <Text style={styles.text}>
            No assigned published{' '}
            {data.kind === 'Homework' ? 'homework' : 'quizzes'}.
          </Text>
        )}
      </>
    );
  }
  return null;
}
const styles = StyleSheet.create({
  actions: { gap: spacing.sm, marginBottom: spacing.lg },
  text: { ...typography.body, color: colors.ink },
  note: { ...typography.small, color: colors.muted, marginBottom: spacing.lg },
});
