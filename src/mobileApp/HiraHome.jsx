import PageIcon from './PageIcon';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { theme as t } from './hiraTheme';
import { parentApi } from './parentService';
import { studentApi } from './studentService';
import { financeApi } from './financeService';
import { parentPreview, studentPreview, financePreview } from './previewData';
import {
  SchoolPanel,
  SchoolQuickActions,
  SchoolRow,
} from './SchoolReferenceUI';

const copy = {
  Parent: {
    title: 'Watching them grow\nis the best part.',
    tag: 'A HAPPY PLACE TO GROW',
    description:
      'Choose your child below. Their school record stays separate at every step.',
    action: 'My children',
    page: 'My children',
  },
  Student: {
    title: 'Big ideas start\nwith curious minds.',
    tag: 'A LITTLE CURIOSITY GOES A LONG WAY',
    description: 'Your classes, your progress, your next little adventure.',
    action: 'My timetable',
    page: 'Timetable',
  },
  Finance: {
    title: 'Less paperwork.\nMore peace of mind.',
    tag: 'KEEP EVERY LITTLE DETAIL IN BALANCE',
    description:
      'Collections, vouchers and receipts — all in one calm workspace.',
    action: 'View invoices',
    page: 'Invoices',
  },
};
const money = (value, currency = 'PKR') =>
  value == null ? '—' : `${currency} ${Number(value).toLocaleString()}`;
const list = value => (Array.isArray(value) ? value : []);
function Action({ children, onPress, secondary = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        s.action,
        secondary && s.secondary,
        pressed && { opacity: 0.8 },
      ]}
    >
      <Text style={[s.actionText, secondary && { color: t.primary }]}>
        {children}
      </Text>
    </Pressable>
  );
}
export default function HiraHome({
  role,
  previewOnly,
  user,
  onNavigate,
  reducedMotion,
}) {
  const [records, setRecords] = useState(null);
  const [loading, setLoading] = useState(!previewOnly);
  const [error, setError] = useState('');
  const version = useRef(0);
  const float = useRef(new Animated.Value(0)).current;
  const load = useCallback(async () => {
    const current = ++version.current;
    if (previewOnly) {
      setRecords(
        role === 'Parent'
          ? parentPreview
          : role === 'Student'
          ? studentPreview
          : financePreview,
      );
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      let data;
      if (role === 'Parent') data = { children: await parentApi.getChildren() };
      else if (role === 'Student') {
        const [profile, attendance, homework, results] = await Promise.all([
          studentApi.getProfile(),
          studentApi.getAttendance(),
          studentApi.getHomework(),
          studentApi.getResults(),
        ]);
        data = { profile, attendance, homework, results };
      } else {
        const [summary, pendingPayments] = await Promise.all([
          financeApi.getSummary(),
          financeApi.getPendingPayments(),
        ]);
        data = { summary: summary.data, pendingPayments: pendingPayments.data };
      }
      if (current === version.current) setRecords(data);
    } catch (failure) {
      if (current === version.current) {
        setRecords(null);
        setError(failure.message || 'Could not load your school records.');
      }
    } finally {
      if (current === version.current) setLoading(false);
    }
  }, [previewOnly, role]);
  useEffect(() => {
    load();
    return () => {
      version.current += 1;
    };
  }, [load]);
  useEffect(() => {
    float.setValue(0);
    if (reducedMotion) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(float, {
          toValue: 1,
          duration: 2500,
          useNativeDriver: true,
        }),
        Animated.timing(float, {
          toValue: 0,
          duration: 2500,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [float, reducedMotion]);
  const content = copy[role];
  const profileName =
    records?.profile?.fullName || user?.fullName || user?.name;
  const greeting =
    role === 'Parent'
      ? `Hello${
          previewOnly
            ? ', Farah'
            : profileName
            ? `, ${profileName.split(' ')[0]}`
            : ''
        }! ☀`
      : role === 'Student'
      ? `Hi${profileName ? `, ${profileName.split(' ')[0]}` : ''}! ✨`
      : 'A good day to keep things balanced.';
  const homework = list(records?.homework);
  const pending = list(records?.pendingPayments);
  const children = list(records?.children);
  const attendance = list(records?.attendance);
  const attendancePercent = attendance.length
    ? `${Math.round(
        (attendance.filter(
          item => String(item.status).toLowerCase() === 'present',
        ).length /
          attendance.length) *
          100,
      )}%`
    : '—';
  const result = list(records?.results)[0];
  return (
    <ScrollView
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl
          refreshing={loading}
          onRefresh={load}
          tintColor={t.primary}
        />
      }
    >
      <Text style={s.greeting}>{greeting}</Text>
      <Text style={s.subtitle}>
        {role === 'Parent'
          ? 'Your children, their progress, and all the little moments.'
          : role === 'Student'
          ? 'Ready for a little learning adventure?'
          : 'Your connected school finance workspace.'}
      </Text>
      <View style={s.hero}>
        <Animated.Image
          source={require('./assets/school-art.webp')}
          resizeMode="cover"
          style={[
            s.art,
            {
              transform: [
                {
                  translateY: float.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -4],
                  }),
                },
                { scale: 1.04 },
              ],
            },
          ]}
        />
        <View style={s.wash} />
        {Array.from({ length: 25 }, (_, index) => (
          <View
            key={index}
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${31 + index * 2}%`,
              width: '2.1%',
              backgroundColor: '#FFE8B7',
              opacity: 1 - index / 25,
            }}
          />
        ))}
        <View style={s.heroCopy}>
          <Text style={s.tag}>{content.tag}</Text>
          <Text style={s.heroTitle}>{content.title}</Text>
          <Text style={s.heroDescription}>{content.description}</Text>
          <Action onPress={() => onNavigate(content.page)}>
            {content.action}
          </Action>
        </View>
      </View>
      {error ? (
        <View style={s.error}>
          <Text style={s.errorText}>{error}</Text>
          <Action onPress={load}>Try again</Action>
        </View>
      ) : null}
      {loading && !records ? (
        <ActivityIndicator style={{ marginVertical: 20 }} color={t.primary} />
      ) : null}
      {role === 'Parent' ? (
        <>
          <Text style={s.section}>My children</Text>
          {children.map((child, index) => (
            <Pressable
              key={child.id || child._id || index}
              onPress={() => onNavigate('Student Progress Tracking', child.id)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${
                child.fullName || child.name
              } child dashboard`}
              style={s.child}
            >
              <View
                style={[
                  s.portrait,
                  index % 2 === 1 && { backgroundColor: '#F3D9EA' },
                ]}
              >
                <Text style={s.star}>✦</Text>
                <Text style={s.avatar}>{index % 2 === 0 ? '👦' : '👧'}</Text>
              </View>
              <View style={s.childCopy}>
                <Text style={s.enrolled}>
                  {child.status === 'Preview'
                    ? 'Preview enrollment'
                    : child.status || 'Linked child'}
                </Text>
                <Text style={s.childName}>{child.fullName || child.name}</Text>
                <Text style={s.childMeta}>
                  {[child.grade, child.section, child.id]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                <View style={s.childMetrics}>
                  <View>
                    <Text style={s.childValue}>{child.attendance || '—'}</Text>
                    <Text style={s.caption}>Attendance</Text>
                  </View>
                  <View>
                    <Text style={s.childValue}>
                      {child.latestResult || '—'}
                    </Text>
                    <Text style={s.caption}>Latest result</Text>
                  </View>
                </View>
                <Text style={s.childLink}>Open child dashboard</Text>
              </View>
            </Pressable>
          ))}
          {!loading && !error && !children.length ? (
            <Text style={s.subtitle}>No linked children available.</Text>
          ) : null}
          <SchoolPanel title="Stay connected" style={s.connected}>
            <SchoolQuickActions
              actions={[
                {
                  label: 'Request',
                  icon: '💌',
                  onPress: () => onNavigate('Applications'),
                },
                {
                  label: 'Feedback',
                  icon: '🌟',
                  onPress: () => onNavigate('Monthly Feedback'),
                },
                {
                  label: 'Calendar',
                  icon: '📅',
                  onPress: () => onNavigate('Academic Calendar'),
                },
                {
                  label: 'Inbox',
                  icon: '💬',
                  onPress: () => onNavigate('Inbox'),
                },
              ]}
            />
          </SchoolPanel>
          <SchoolPanel title="A date for your diary" style={s.connected}>
            <SchoolRow
              icon="👩‍🏫"
              title="Parent–Teacher Meetings"
              subtitle={
                previewOnly
                  ? '7 October · Book your preferred slot'
                  : 'View meeting availability with your school'
              }
              badge={previewOnly ? 'Upcoming' : undefined}
              action="Book"
              last
              onPress={() => onNavigate('PTM & Appointments')}
            />
          </SchoolPanel>
        </>
      ) : (
        <View style={s.metrics}>
          {(role === 'Finance'
            ? [
                [
                  'Collection',
                  money(
                    records?.summary?.collected,
                    records?.summary?.currency,
                  ),
                  'Collection report',
                  '#F5E9FF',
                ],
                [
                  'Outstanding',
                  money(
                    records?.summary?.outstanding,
                    records?.summary?.currency,
                  ),
                  'Outstanding dues',
                  '#FFF0D4',
                ],
                [
                  'Pending',
                  records ? String(pending.length) : '—',
                  'Pending verification',
                  '#E4F2F0',
                ],
                [
                  'Drawer balance',
                  money(
                    records?.summary?.drawerBalance,
                    records?.summary?.currency,
                  ),
                  'Payment history',
                  '#E9ECFF',
                ],
              ]
            : [
                [
                  'Attendance',
                  records ? attendancePercent : '—',
                  'Attendance',
                  '#E6F1FF',
                ],
                [
                  'Homework',
                  records ? String(homework.length) : '—',
                  'Homework',
                  '#FFF0D4',
                ],
                [
                  'Latest result',
                  result?.score == null ? '—' : String(result.score),
                  'Results',
                  '#F3E9FF',
                ],
                ['Timetable', 'View classes', 'Timetable', '#E4F2F0'],
              ]
          ).map(([label, value, route, color]) => (
            <Pressable
              key={label}
              accessibilityRole="button"
              onPress={() => onNavigate(route)}
              style={[s.metric, { backgroundColor: color }]}
            >
              <PageIcon name={label} size={25} style={{ marginBottom: 13 }} />
              <Text style={s.metricValue}>{value}</Text>
              <Text style={s.metricLabel}>{label} ↗</Text>
            </Pressable>
          ))}
        </View>
      )}
      {previewOnly ? (
        <Text style={s.preview}>Design preview · sample records</Text>
      ) : null}
    </ScrollView>
  );
}
const s = StyleSheet.create({
  connected: { marginTop: 14, marginBottom: 4 },
  content: { paddingHorizontal: 18, paddingBottom: 25 },
  action: {
    backgroundColor: t.primary,
    borderRadius: 16,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignSelf: 'flex-start',
    ...t.shadow,
  },
  actionText: { color: 'white', fontSize: 12, fontWeight: '700' },
  secondary: {
    backgroundColor: t.paper,
    borderWidth: 1,
    borderColor: t.border,
  },
  greeting: {
    color: t.ink,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '900',
    marginTop: 20,
  },
  subtitle: { color: '#8C8B85', fontSize: 13, lineHeight: 21, marginTop: 6 },
  hero: {
    minHeight: 260,
    marginTop: 20,
    marginBottom: 20,
    borderRadius: 24,
    backgroundColor: '#FFE8B7',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#EAD7AD',
    ...t.shadow,
  },
  art: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: '75%',
    height: '100%',
  },
  wash: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '39%',
    backgroundColor: '#FFE8B7',
  },
  washEdge: {
    position: 'absolute',
    left: '39%',
    width: '18%',
    top: 0,
    bottom: 0,
    backgroundColor: '#FFE8B7AA',
  },
  heroCopy: { padding: 20, width: '65%', gap: 10 },
  tag: {
    color: '#8B7044',
    fontSize: 8,
    lineHeight: 12,
    fontWeight: '700',
    letterSpacing: 1.3,
  },
  heroTitle: { color: t.ink, fontWeight: '800', fontSize: 23, lineHeight: 28 },
  heroDescription: { color: '#8B785A', fontSize: 12, lineHeight: 19 },
  section: { color: t.ink, fontSize: 19, fontWeight: '800', marginBottom: 14 },
  child: {
    flexDirection: 'row',
    minHeight: 201,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: '#EEE1D0',
    backgroundColor: t.paper,
    overflow: 'hidden',
    marginBottom: 14,
    ...t.shadow,
  },
  portrait: {
    width: '31%',
    backgroundColor: '#D4DCFA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  star: {
    position: 'absolute',
    right: 18,
    top: 20,
    color: '#FFF5DB',
    fontSize: 23,
  },
  avatar: { fontSize: 61 },
  childCopy: { flex: 1, padding: 16 },
  enrolled: {
    alignSelf: 'flex-start',
    color: '#536D4F',
    backgroundColor: '#EDF3E2',
    borderRadius: 7,
    paddingHorizontal: 9,
    paddingVertical: 5,
    fontSize: 10,
  },
  childName: { color: t.ink, fontSize: 19, fontWeight: '700', marginTop: 9 },
  childMeta: { color: t.muted, fontSize: 11, marginTop: 4 },
  childMetrics: { flexDirection: 'row', gap: 25, marginTop: 15 },
  childValue: { fontSize: 21, fontWeight: '800', color: t.primary },
  caption: { color: t.muted, fontSize: 10, marginTop: 4 },
  childLink: {
    color: t.primary,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 16,
  },
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 13,
  },
  metric: {
    width: '48%',
    minHeight: 140,
    padding: 17,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: t.border,
    ...t.shadow,
  },
  metricIcon: { color: t.primary, fontSize: 22, marginBottom: 13 },
  metricValue: { fontSize: 19, color: t.ink, fontWeight: '800' },
  metricLabel: { color: '#777683', fontSize: 12, marginTop: 8 },
  error: {
    padding: 15,
    backgroundColor: '#FFF0EE',
    borderRadius: 18,
    marginBottom: 15,
    gap: 12,
  },
  errorText: { color: '#A13B42', fontSize: 13, lineHeight: 20 },
  preview: { color: t.muted, fontSize: 10, textAlign: 'center', marginTop: 18 },
});
