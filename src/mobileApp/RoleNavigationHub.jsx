import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { theme } from './hiraTheme';
import { getRoleNavigationGroups } from './roleNavigation';

const routeLabels = {
  'Student Fees': 'Invoices',
  'Receipt Details': 'Receipts',
  'Installment Requests': 'Installments',
  'Student Progress Tracking': 'Progress',
  'PTM & Appointments': 'PTM',
  'Pickup & Early Exit': 'Pickup',
  'Transport & Alerts': 'Alerts',
};

export default function RoleNavigationHub({
  role,
  page,
  route,
  authorizedPages,
  onNavigate,
}) {
  const groups = getRoleNavigationGroups(role, authorizedPages);
  const activeGroup = groups.find(group => group.title === page) || groups[0];
  if (!activeGroup) return null;

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.groupTabs}
        accessibilityLabel="Parent and student sections"
      >
        {groups.map(group => {
          const active = group.title === activeGroup.title;
          return (
            <Pressable
              key={group.title}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Open ${group.title} tab`}
              onPress={() => onNavigate(group.title)}
              style={[styles.groupTab, active && styles.groupTabActive]}
            >
              <Text style={[styles.groupText, active && styles.groupTextActive]}>
                {group.title}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {activeGroup.routes.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.routeTabs}
          accessibilityLabel={`${activeGroup.title} pages`}
        >
          {activeGroup.routes.map(item => {
            const active = item === route;
            return (
              <Pressable
                key={item}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Open ${item}`}
                onPress={() => onNavigate(item)}
                style={[styles.routeTab, active && styles.routeTabActive]}
              >
                <Text style={[styles.routeText, active && styles.routeTextActive]}>
                  {routeLabels[item] || item}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 0 },
  groupTabs: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  groupTab: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 15,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.paper,
  },
  groupTabActive: {
    borderColor: theme.primary,
    backgroundColor: theme.primary,
  },
  groupText: { color: theme.ink, fontSize: 13, fontWeight: '700' },
  groupTextActive: { color: '#FFFFFF' },
  routeTabs: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 7,
  },
  routeTab: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 15,
    backgroundColor: theme.lavender,
  },
  routeTabActive: { backgroundColor: '#DCD9FF' },
  routeText: { color: theme.ink, fontSize: 12, fontWeight: '600' },
  routeTextActive: { color: theme.primary, fontWeight: '800' },
});
