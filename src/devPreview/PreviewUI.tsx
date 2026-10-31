// Visual palette and record cards adapted from faraz-audit dashboards/theme.
// Deliberately independent of donor services, session, forms and upload packages.
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export const previewStyles = StyleSheet.create({
  page: { padding: 20, gap: 16, backgroundColor: '#FFF9EF', flexGrow: 1 },
  badge: { color: '#4857B5', fontWeight: '800', fontSize: 12 },
  hero: { backgroundColor: '#EEEDFF', padding: 22, borderRadius: 22, gap: 10 },
  title: { color: '#282940', fontWeight: '800', fontSize: 25 },
  heading: { color: '#282940', fontWeight: '700', fontSize: 18 },
  text: { color: '#525268', lineHeight: 22 },
  card: {
    padding: 18,
    borderRadius: 18,
    backgroundColor: '#FFFEFA',
    borderWidth: 1,
    borderColor: '#E6E2D7',
    gap: 8,
  },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tab: { padding: 12, borderRadius: 12, backgroundColor: '#EEEDFF' },
  active: { borderWidth: 2, borderColor: '#4857B5' },
});

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
    <ScrollView contentContainerStyle={previewStyles.page}>
      <Text
        style={previewStyles.badge}
      >{`${role} preview · FICTIONAL SAMPLE DATA`}</Text>
      <View style={previewStyles.hero}>
        <Text style={previewStyles.title}>{title}</Text>
        <Text style={previewStyles.text}>
          Read-only visual preview. No backend connection or saved changes.
        </Text>
      </View>
      {children}
    </ScrollView>
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
    <View style={previewStyles.card}>
      <Text style={previewStyles.heading}>{title}</Text>
      {lines.map(line => (
        <Text key={line} style={previewStyles.text}>
          {line}
        </Text>
      ))}
    </View>
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
    <View style={previewStyles.tabs}>
      {items.map(item => (
        <Pressable
          key={item}
          accessibilityRole="button"
          accessibilityLabel={item}
          accessibilityState={{ selected: item === selected }}
          onPress={() => onSelect(item)}
          style={[previewStyles.tab, item === selected && previewStyles.active]}
        >
          <Text style={previewStyles.text}>{item}</Text>
        </Pressable>
      ))}
    </View>
  );
}
