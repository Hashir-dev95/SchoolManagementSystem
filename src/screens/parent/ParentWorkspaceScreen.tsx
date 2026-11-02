import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ParentStackParamList } from '../../navigation/ParentNavigator';
import { useAuth } from '../../context/AuthContext';
import { ApiError } from '../../services/api/apiClient';
import {
  parentService as service,
  type VerifiedChild,
} from '../../services/parent/parentService';
import {
  DashboardShell,
  HeroBanner,
  SectionCard,
  WorkspaceTabs,
  DashboardStateCard,
  Button,
} from '../../components/hiraDashboard';
import { colors, spacing, typography } from '../../theme/hiraDashboard';
import { FeeCards } from '../../components/hiraDashboard/FeeCards';
import type { FeeList } from '../../services/finance/financeService';

const panes = [
  'Profile',
  'Enrollment',
  'Timetable',
  'Attendance',
  'Homework',
  'Quiz',
  'Results',
  'Fees',
] as const;
type Pane = (typeof panes)[number];
type PaneData = {
  fees?: FeeList;
  note?: string;
  empty: string;
  records: { id: string; title: string; lines: string[] }[];
};
const failureMessage = (failure: unknown) =>
  failure instanceof ApiError && failure.status === 403
    ? 'Forbidden: verified child access is unavailable. Contact your school.'
    : failure instanceof ApiError && failure.status === 401
    ? 'Session expired or unavailable. Sign in again.'
    : 'Could not load school records. Please retry.';
const childLabel = (child: VerifiedChild) =>
  `${child.fullName} · ${child.enrollment.branch.name} · ${child.enrollment.schoolClass.name} ${child.enrollment.section.name} · ${child.admissionNumber}`;

async function loadPane(
  token: string,
  id: string,
  pane: Pane,
): Promise<PaneData> {
  switch (pane) {
    case 'Profile': {
      const child = await service.child(token, id);
      return {
        empty: '',
        records: [
          {
            id,
            title: child.fullName,
            lines: [
              child.email,
              `Admission: ${child.admissionNumber}`,
              `Relationship: ${child.relationship}`,
            ],
          },
        ],
      };
    }
    case 'Enrollment': {
      const e = await service.enrollment(token, id);
      return {
        empty: '',
        records: [
          {
            id: e.enrollmentId,
            title: 'Current enrollment',
            lines: [
              e.branch.name,
              `${e.schoolClass.name} · ${e.section.name}`,
              `${e.academicPeriod.name} · ${e.status}`,
            ],
          },
        ],
      };
    }
    case 'Timetable':
    case 'Attendance': {
      const data =
        pane === 'Timetable'
          ? await service.timetable(token, id)
          : await service.attendance(token, id);
      return {
        note: `${data.date}${
          pane === 'Attendance'
            ? ' · Physical attendance only. Live participation and recording completion are separate.'
            : ''
        }`,
        empty: 'No scheduled periods for this date.',
        records: data.items.map(item => ({
          id: item.periodId,
          title: item.subject,
          lines: [
            `${item.startTime}–${item.endTime} · ${item.room}`,
            `${item.teacher}${item.isSubstitute ? ' · Substitute' : ''}`,
            ...(pane === 'Attendance'
              ? [
                  item.status ??
                    (item.state === 'in_progress'
                      ? 'In progress — no submitted mark'
                      : 'Unmarked'),
                ]
              : []),
          ],
        })),
      };
    }
    case 'Homework':
    case 'Quiz': {
      const data =
        pane === 'Homework'
          ? await service.homework(token, id)
          : await service.quizzes(token, id);
      return {
        note: 'Read-only published assigned information. Parents cannot submit work or attempt quizzes.',
        empty: 'No authorized published work available.',
        records: data.items.map(item => ({
          id: item.id,
          title: item.title,
          lines: [
            item.instructions,
            item.dueAt
              ? `Due ${item.dueAt}`
              : `${item.availableFrom} – ${item.availableUntil}`,
          ],
        })),
      };
    }
    case 'Results': {
      const data = await service.results(token, id);
      return {
        empty: 'No published results available.',
        records: data.items.map(item => ({
          id: item.resultId,
          title: item.assessment.title,
          lines: [
            `${item.subject.name} · ${item.awardedMarks}/${item.maxMarks} · ${item.percentage}%`,
            ...(item.releasedFeedback ? [item.releasedFeedback.feedback] : []),
          ],
        })),
      };
    }
    case 'Fees':
      return {
        empty: '',
        records: [],
        fees: await service.fees(token, id),
      };
  }
}
export default function ParentWorkspaceScreen() {
  const { user, accessToken } = useAuth();
  if (!user || !accessToken) {
    return null;
  }
  return <Workspace key={user.id} token={accessToken} />;
}
function Workspace({ token }: { token: string }) {
  const navigation =
    useNavigation<NativeStackNavigationProp<ParentStackParamList>>();
  const { logout } = useAuth();
  const [children, setChildren] = useState<VerifiedChild[]>([]);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setChildren([]);
    setError(null);
    setLoading(true);
    Promise.all([service.me(token), service.children(token)])
      .then(([parent, data]) => {
        if (active) {
          setName(parent.fullName);
          setChildren(data.items);
          setSelected(current =>
            data.items.some(child => child.studentId === current)
              ? current
              : data.items[0]?.studentId ?? '',
          );
        }
      })
      .catch((failure: unknown) => {
        if (active) {
          setError(failureMessage(failure));
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
  }, [token, attempt]);
  const retry = useCallback(async () => {
    setAttempt(value => value + 1);
  }, []);
  const child = children.find(item => item.studentId === selected);
  return (
    <DashboardShell>
      <HeroBanner
        roleLabel="PARENT WORKSPACE"
        dateLabel="Verified children"
        title={name ? `Welcome, ${name}` : 'Your children’s school day'}
        subtitle="Child access is verified by your school on every request."
      />
      <View style={styles.actions}>
        <Button
          title="Notifications"
          variant="secondary"
          onPress={() => navigation.navigate('ParentNotifications')}
        />
        <Button title="Refresh children" variant="secondary" onPress={retry} />
        <Button
          title="Sign out"
          variant="secondary"
          onPress={() => {
            logout().catch(() => setError('Sign out could not be confirmed.'));
          }}
        />
      </View>
      <DashboardStateCard loading={loading} error={error} onRetry={retry} />
      {!loading && !error && !children.length ? (
        <Text style={styles.text}>
          No verified children available. Contact your school.
        </Text>
      ) : null}
      {!loading && !error && child ? (
        <>
          <WorkspaceTabs
            items={children.map(childLabel)}
            selected={childLabel(child)}
            accessibilityLabel="Verified children"
            onSelect={label => {
              const choice = children.find(item => childLabel(item) === label);
              if (choice) {
                setSelected(choice.studentId);
              }
            }}
          />
          <ChildPane
            key={child.studentId}
            childId={child.studentId}
            token={token}
          />
        </>
      ) : null}
    </DashboardShell>
  );
}
function ChildPane({ childId, token }: { childId: string; token: string }) {
  const [pane, setPane] = useState<Pane>('Profile');
  const [data, setData] = useState<PaneData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    setLoading(true);
    loadPane(token, childId, pane)
      .then(value => {
        if (active) {
          setData(value);
        }
      })
      .catch((failure: unknown) => {
        if (active) {
          setError(failureMessage(failure));
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
  }, [token, childId, pane, attempt]);
  const retry = useCallback(async () => {
    setAttempt(value => value + 1);
  }, []);
  return (
    <>
      <WorkspaceTabs
        items={panes}
        selected={pane}
        accessibilityLabel="Child workspace sections"
        onSelect={value => setPane(value as Pane)}
      />
      <DashboardStateCard loading={loading} error={error} onRetry={retry} />
      {!loading && !error && data ? (
        <>
          {data.note ? <Text style={styles.note}>{data.note}</Text> : null}
          {data.fees ? (
            <FeeCards data={data.fees} />
          ) : !data.records.length ? (
            <Text style={styles.text}>{data.empty}</Text>
          ) : (
            data.records.map(record => (
              <SectionCard key={record.id} title={record.title}>
                {record.lines.map((line, index) => (
                  <Text key={`${index}-${line}`} style={styles.text}>
                    {line}
                  </Text>
                ))}
              </SectionCard>
            ))
          )}
        </>
      ) : null}
    </>
  );
}
const styles = StyleSheet.create({
  actions: { gap: spacing.sm, marginBottom: spacing.lg },
  text: { ...typography.body, color: colors.ink },
  note: { ...typography.small, color: colors.muted, marginBottom: spacing.lg },
});
