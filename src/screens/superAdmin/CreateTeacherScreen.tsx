import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  Button,
  Card,
  DashboardShell,
  ScreenHeading,
  SectionCard,
} from '../../components/hiraDashboard';
import { useAuth } from '../../context/AuthContext';
import { hasPermission, PERMISSIONS } from '../../constants/permissions';
import { adminService } from '../../services/admin/adminService';
import { colors, typography } from '../../theme/hiraDashboard';

type BranchOption = { id: string; name: string; code: string };
const initial = { fullName: '', email: '', password: '' };
const passwordBytes = (value: string) =>
  Array.from(value).reduce((bytes, char) => {
    const code = char.codePointAt(0)!;
    return bytes + (code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4);
  }, 0);
export default function CreateTeacherScreen() {
  const { user, accessToken } = useAuth();
  const allowed =
    user?.role === 'super_admin' &&
    hasPermission(user.role, PERMISSIONS.TEACHERS_CREATE);
  const [form, setForm] = useState(initial);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [branchId, setBranchId] = useState('');
  const [loading, setLoading] = useState(true);
  const [branchError, setBranchError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const generation = useRef(0),
    busy = useRef(false);
  const load = useCallback(async () => {
    if (busy.current) return;
    const id = ++generation.current;
    if (!allowed || !accessToken) return;
    setLoading(true);
    setBranchError('');
    try {
      const response = await adminService.getTeacherBranches(accessToken);
      if (id !== generation.current) return;
      setBranches(response.data);
      setBranchId(selected =>
        response.data.some(b => b.id === selected) ? selected : '',
      );
    } catch (e) {
      if (id === generation.current) {
        setBranches([]);
        setBranchError(
          e instanceof Error ? e.message : 'Unable to load active branches.',
        );
      }
    } finally {
      if (id === generation.current) setLoading(false);
    }
  }, [accessToken, allowed]);
  useFocusEffect(
    useCallback(() => {
      load();
      return () => {
        generation.current++;
      };
    }, [load]),
  );
  const submit = async () => {
    if (busy.current || !allowed || !accessToken) return;
    if (
      form.fullName.trim().length < 2 ||
      form.fullName.trim().length > 100 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) ||
      form.email.trim().length > 254 ||
      form.password.length < 12 ||
      passwordBytes(form.password) > 72 ||
      !branches.some(b => b.id === branchId)
    ) {
      setError(
        'Enter a name, valid email, password of at least 12 characters (at most 72 UTF-8 bytes), and active branch.',
      );
      return;
    }
    const id = generation.current;
    busy.current = true;
    setSaving(true);
    setError('');
    try {
      const response = await adminService.createTeacher(accessToken, {
        ...form,
        fullName: form.fullName.trim(),
        email: form.email.trim().toLowerCase(),
        branchId,
      });
      if (id !== generation.current) return;
      if (
        !response.success ||
        response.data?.role !== 'teacher' ||
        typeof response.data.id !== 'string' ||
        !response.data.id ||
        response.data.branchId !== branchId
      )
        throw new Error('Account creation was not confirmed.');
      setSuccess(true);
      setForm(initial);
    } catch (e) {
      if (id === generation.current)
        setError(
          e instanceof Error ? e.message : 'Unable to create Teacher account.',
        );
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  if (!allowed)
    return (
      <DashboardShell>
        <ScreenHeading
          title="Access restricted"
          subtitle="Only an authorized Super Admin can create Teacher accounts."
        />
      </DashboardShell>
    );
  return (
    <DashboardShell refreshing={loading} onRefresh={load}>
      <ScreenHeading
        title="Create Teacher"
        subtitle="Teacher account and academic assignment are separate."
      />
      {success ? (
        <Card>
          <Text style={styles.copy}>Teacher account created successfully.</Text>
          <Text style={styles.copy}>
            This Teacher still requires class/section/subject assignment before
            academic modules become available. Assignment administration is
            managed separately by an authorized school administrator.
          </Text>
          <Button
            title="Create another Teacher"
            onPress={() => {
              setSuccess(false);
              setBranchId('');
              load();
            }}
          />
        </Card>
      ) : (
        <>
          <SectionCard title="Login credentials">
            <Text style={styles.copy}>Role: Teacher (fixed)</Text>
            {(['fullName', 'email', 'password'] as const).map(field => (
              <TextInput
                key={field}
                accessibilityLabel={
                  field === 'fullName'
                    ? 'Full name'
                    : field === 'email'
                    ? 'Login email'
                    : 'Password'
                }
                placeholder={
                  field === 'fullName'
                    ? 'Full name'
                    : field === 'email'
                    ? 'Login email'
                    : 'Password (12+ characters)'
                }
                value={form[field]}
                editable={!saving}
                secureTextEntry={field === 'password'}
                autoCapitalize={field === 'fullName' ? 'words' : 'none'}
                autoCorrect={false}
                keyboardType={field === 'email' ? 'email-address' : 'default'}
                onChangeText={value =>
                  setForm(current => ({ ...current, [field]: value }))
                }
                style={styles.input}
              />
            ))}
          </SectionCard>
          <SectionCard title="Active branch">
            {loading ? (
              <ActivityIndicator
                accessibilityLabel="Loading branches"
                color={colors.primary}
              />
            ) : branchError ? (
              <>
                <Text style={styles.copy}>{branchError}</Text>
                <Button
                  title="Retry branches"
                  onPress={() => {
                    load();
                  }}
                />
              </>
            ) : branches.length === 0 ? (
              <Text style={styles.copy}>No active branches are available.</Text>
            ) : (
              branches.map(branch => (
                <Button
                  key={branch.id}
                  title={`${branch.name} (${branch.code})${
                    branchId === branch.id ? ' — Selected' : ''
                  }`}
                  variant={branchId === branch.id ? 'primary' : 'secondary'}
                  disabled={saving}
                  onPress={() => setBranchId(branch.id)}
                  style={styles.option}
                />
              ))
            )}
          </SectionCard>
          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}
          <Button
            title={saving ? 'Creating Teacher…' : 'Create Teacher account'}
            disabled={saving || loading || !!branchError || !branches.length}
            onPress={() => {
              submit();
            }}
          />
        </>
      )}
    </DashboardShell>
  );
}
const styles = StyleSheet.create({
  copy: { ...typography.body, color: colors.muted, marginBottom: 12 },
  input: {
    ...typography.body,
    color: colors.ink,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  option: { marginBottom: 8 },
  error: { ...typography.body, color: colors.danger.text, marginBottom: 12 },
});
