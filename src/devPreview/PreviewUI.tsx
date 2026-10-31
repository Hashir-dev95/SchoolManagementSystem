// Preview labels/data stay local; presentation comes from canonical Hira UI.
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import {
  DashboardShell,
  HeroBanner,
  SectionCard,
  WorkspaceTabs,
} from '../components/hiraDashboard';
import { colors, spacing, typography } from '../theme/hiraDashboard';

export function PreviewPage({
  role,
  title,
  children,
}: {
  role: string;
  title: string;
  children: React.ReactNode;
}) {
  if (!__DEV__) {
    return null;
  }
  return (
    <DashboardShell safeArea={false}>
      <HeroBanner
        roleLabel={`${role} preview · FICTIONAL SAMPLE DATA`}
        dateLabel="Sample"
        title={title}
        subtitle="Read-only visual preview. No backend connection or saved changes."
      />
      {children}
    </DashboardShell>
  );
}

export function PreviewCard({
  title,
  lines,
}: {
  title: string;
  lines: readonly string[];
}) {
  return (
    <SectionCard title={title}>
      {lines.map((line, index) => (
        <Text key={`${index}-${line}`} style={styles.line}>
          {line}
        </Text>
      ))}
    </SectionCard>
  );
}

export function PreviewTabs({
  items,
  selected,
  onSelect,
}: {
  items: readonly string[];
  selected: string;
  onSelect: (item: string) => void;
}) {
  return (
    <WorkspaceTabs
      items={items}
      selected={selected}
      onSelect={onSelect}
      accessibilityLabel="Preview options"
    />
  );
}

const styles = StyleSheet.create({
  line: { ...typography.body, color: colors.muted, marginTop: spacing.sm },
});
