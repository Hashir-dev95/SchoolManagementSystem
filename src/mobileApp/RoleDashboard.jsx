import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import FinanceDashboard from './FinanceDashboard';
import StudentDashboard from './StudentDashboard';
import ParentDashboard from './ParentDashboard';

const palette = {
  ink: '#14243A',
  muted: '#69788C',
  blue: '#246BFD',
  pale: '#F2F6FC',
  line: '#E3EAF3',
  green: '#168A62',
  amber: '#B66A0A',
};

function Metric({ label, value, detail }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
      {detail ? <Text style={styles.metricDetail}>{detail}</Text> : null}
    </View>
  );
}

function Row({ title, subtitle, right, tone }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
      <Text
        style={[
          styles.badge,
          tone === 'green' && styles.green,
          tone === 'amber' && styles.amber,
        ]}
      >
        {right}
      </Text>
    </View>
  );
}

export default function RoleDashboard({ role, data }) {
  if (role === 'Finance') return <FinanceDashboard />;
  if (role === 'Student') return <StudentDashboard />;
  if (role === 'Parent') return <ParentDashboard />;
  const parent = role === 'Parent';
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>SCHOOL MANAGEMENT</Text>
      <Text style={styles.heading}>{role} overview</Text>
      <Text style={styles.greeting}>
        {parent
          ? `Welcome back, ${data.parent}`
          : 'Your school day at a glance'}
      </Text>
      {parent ? (
        <View style={styles.metrics}>
          <Metric
            label="Children"
            value={data.children.length}
            detail="Linked to your account"
          />
          <Metric
            label="Attendance"
            value={data.children[0]?.attendance || '—'}
            detail="This term"
          />
        </View>
      ) : (
        <View style={styles.metrics}>
          <Metric label="My attendance" value="96%" detail="This term" />
          <Metric label="Assignments" value="3" detail="Due this week" />
        </View>
      )}
      <Text style={styles.sectionTitle}>
        {parent ? 'My children' : 'My profile'}
      </Text>
      {parent ? (
        data.children.map(item => (
          <Row
            key={item.id}
            title={item.name}
            subtitle={`${item.grade} · Section ${item.section} · ${item.attendance} attendance`}
            right={item.status}
            tone="green"
          />
        ))
      ) : (
        <Row
          title="Amina Khan"
          subtitle="Student ID STU-1001 · Grade 8, Section A"
          right="Active"
          tone="green"
        />
      )}
      {parent ? (
        <>
          <Text style={styles.sectionTitle}>School notices</Text>
          {data.notices.map((notice, index) => (
            <Row
              key={notice}
              title={notice}
              subtitle={index === 0 ? 'Posted today' : 'Posted October 1'}
              right="Notice"
            />
          ))}
        </>
      ) : null}
      {!parent ? (
        <>
          <Text style={styles.sectionTitle}>Upcoming</Text>
          <Row
            title="Mathematics assignment"
            subtitle="Chapter 4 · Due Thursday"
            right="Due soon"
            tone="amber"
          />
          <Row
            title="Science fair"
            subtitle="Project proposal · Due October 14"
            right="In 8 days"
          />
        </>
      ) : null}
      <Text style={styles.footnote}>
        Demo information · Connect your school account for live records.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.pale },
  content: { padding: 22, paddingBottom: 36 },
  eyebrow: {
    color: palette.blue,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginTop: 12,
  },
  heading: {
    fontSize: 29,
    fontWeight: '800',
    color: palette.ink,
    marginTop: 8,
  },
  greeting: {
    fontSize: 14,
    color: palette.muted,
    marginTop: 6,
    marginBottom: 22,
  },
  metrics: { flexDirection: 'row', gap: 12 },
  metric: {
    flex: 1,
    minHeight: 118,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 16,
    justifyContent: 'center',
  },
  metricValue: { color: palette.ink, fontSize: 20, fontWeight: '800' },
  metricLabel: { color: palette.muted, fontSize: 12, marginTop: 8 },
  metricDetail: { color: palette.green, fontSize: 11, marginTop: 5 },
  sectionTitle: {
    color: palette.ink,
    fontSize: 17,
    fontWeight: '800',
    marginTop: 26,
    marginBottom: 11,
  },
  row: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 14,
    padding: 15,
    marginBottom: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  rowCopy: { flex: 1 },
  rowTitle: { color: palette.ink, fontSize: 14, fontWeight: '700' },
  rowSubtitle: {
    color: palette.muted,
    fontSize: 11,
    marginTop: 5,
    lineHeight: 16,
  },
  badge: {
    color: palette.blue,
    backgroundColor: '#EBF2FF',
    overflow: 'hidden',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 9,
    fontSize: 10,
    fontWeight: '700',
  },
  green: { color: palette.green, backgroundColor: '#E8F7F1' },
  amber: { color: palette.amber, backgroundColor: '#FFF3E2' },
  footnote: {
    textAlign: 'center',
    color: palette.muted,
    fontSize: 11,
    marginTop: 20,
  },
});
