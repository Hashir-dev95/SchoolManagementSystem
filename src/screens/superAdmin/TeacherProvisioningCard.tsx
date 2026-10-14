import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { Button, SectionCard } from '../../components/hiraDashboard';
import { useAuth } from '../../context/AuthContext';
import { hasPermission, PERMISSIONS } from '../../constants/permissions';
import { colors, typography } from '../../theme/hiraDashboard';
export function TeacherProvisioningCard({
  onCreate,
}: {
  onCreate: () => void;
}) {
  const { user } = useAuth();
  if (
    user?.role !== 'super_admin' ||
    !hasPermission(user.role, PERMISSIONS.TEACHERS_CREATE)
  )
    return null;
  return (
    <SectionCard title="Teacher administration">
      <Text style={styles.copy}>
        Create a Teacher login account. Academic assignments are managed
        separately.
      </Text>
      <Button title="Create Teacher" onPress={onCreate} />
    </SectionCard>
  );
}
const styles = StyleSheet.create({
  copy: { ...typography.body, color: colors.muted, marginBottom: 12 },
});
