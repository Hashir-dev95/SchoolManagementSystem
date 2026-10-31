import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../../theme/hiraDashboard';

type Props = {
  /** Unique, visible labels for the available content panes. */
  items: readonly string[];
  selected: string;
  onSelect: (item: string) => void;
  accessibilityLabel: string;
};

/** Controlled presentation-only tabs, adapted from donor workspace chip rows. */
export function WorkspaceTabs({
  items,
  selected,
  onSelect,
  accessibilityLabel,
}: Props) {
  if (!items.length) {
    return null;
  }
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={styles.row}
    >
      {items.map(item => (
        <Pressable
          key={item}
          accessibilityRole="tab"
          accessibilityLabel={item}
          accessibilityState={{ selected: item === selected }}
          onPress={() => onSelect(item)}
          style={({ pressed }) => [
            styles.tab,
            item === selected && styles.active,
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.text, item === selected && styles.activeText]}>
            {item}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  tab: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.cardWarm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  active: { backgroundColor: colors.soft, borderColor: colors.primary },
  text: { ...typography.body, color: colors.muted },
  activeText: { ...typography.bodyStrong, color: colors.primary },
  pressed: { opacity: 0.85 },
});
