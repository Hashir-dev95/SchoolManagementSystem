import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import SuperAdminNavigator from '../navigation/SuperAdminNavigator';
import PrincipalNavigator from '../navigation/PrincipalNavigator';
import TeacherNavigator from '../navigation/TeacherNavigator';
import StudentPreview from './StudentPreview';
import ParentPreview from './ParentPreview';
import FinancePreview from './FinancePreview';

const roles = [
  'Super Admin',
  'Principal',
  'Teacher',
  'Student',
  'Parent',
  'Finance',
] as const;
type PreviewRole = (typeof roles)[number];
const destinations: Record<PreviewRole, React.ComponentType> = {
  'Super Admin': SuperAdminNavigator,
  Principal: PrincipalNavigator,
  Teacher: TeacherNavigator,
  Student: StudentPreview,
  Parent: ParentPreview,
  Finance: FinancePreview,
};

// No auth provider, token, API adapter or persisted role is created here.
// Losing the real session unmounts this entire workspace and its local state.
export default function DeveloperPreview({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, accessToken } = useAuth();
  if (!__DEV__ || !user || !accessToken) {
    return <>{children}</>;
  }
  return (
    <PreviewWorkspace key={user.id} identity={user.role}>
      {children}
    </PreviewWorkspace>
  );
}

function PreviewWorkspace({
  children,
  identity,
}: {
  children: React.ReactNode;
  identity: string;
}) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<PreviewRole | null>(null);
  const Destination = role ? destinations[role] : null;
  const close = () => {
    setOpen(false);
    setRole(null);
  };
  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.toolbar}>
        <Text style={styles.note}>
          {open
            ? `Developer Preview · real session: ${identity}`
            : 'Development build'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            open ? 'Exit Developer Preview' : 'Open Developer Preview'
          }
          onPress={open ? close : () => setOpen(true)}
          style={styles.button}
        >
          <Text style={styles.buttonText}>
            {open ? 'Exit Developer Preview' : 'Open Developer Preview'}
          </Text>
        </Pressable>
        {open && role ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to preview roles"
            onPress={() => setRole(null)}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Back to preview roles</Text>
          </Pressable>
        ) : null}
      </SafeAreaView>
      <View key={open ? role || 'launcher' : 'canonical'} style={styles.root}>
        {!open ? (
          children
        ) : Destination ? (
          <Destination />
        ) : (
          <ScrollView contentContainerStyle={styles.launcher}>
            <Text style={styles.title}>Developer Preview</Text>
            <Text style={styles.description}>
              Canonical workspaces use your real session and permissions. A
              different role may receive 403 responses. Student, Parent and
              Finance contain read-only fictional samples, with no API
              connection.
            </Text>
            {roles.map(item => (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityLabel={item}
                onPress={() => setRole(item)}
                style={styles.button}
              >
                <Text style={styles.buttonText}>{item}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  toolbar: {
    backgroundColor: '#EEEDFF',
    paddingHorizontal: 14,
    paddingBottom: 6,
  },
  note: { color: '#282940', fontSize: 12, paddingVertical: 4 },
  button: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#4857B5',
    marginVertical: 4,
  },
  buttonText: { color: '#FFFFFF', fontWeight: '700' },
  launcher: { padding: 20, gap: 12 },
  title: { fontSize: 26, fontWeight: '800', color: '#282940' },
  description: { color: '#525268', lineHeight: 22 },
});
