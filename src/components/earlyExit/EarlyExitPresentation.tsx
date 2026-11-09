import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { SectionCard, StatusBadge } from '../hiraDashboard';
import { colors, radius, spacing, typography } from '../../theme/hiraDashboard';
import type {
  EarlyExitFields,
  EarlyExitState,
  EarlyExitSummary,
  EarlyExitDetail,
} from '../../services/parent/earlyExitService';

export const earlyExitLabels: Record<EarlyExitState, string> = {
  draft: 'Draft',
  pending: 'Pending',
  changes_requested: 'Changes Requested',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};
export function EarlyExitStatus({ state }: { state: EarlyExitState }) {
  return (
    <StatusBadge
      status={state === 'rejected' ? 'unpaid' : 'pending'}
      label={earlyExitLabels[state]}
    />
  );
}
export function EarlyExitSafety({
  record,
  principal = false,
}: {
  record?: Pick<EarlyExitSummary, 'eligibility' | 'reviewRoutingState'>;
  principal?: boolean;
}) {
  return (
    <View style={styles.safety}>
      <Text style={styles.label}>
        School policy required · No release authority
      </Text>
      <Text style={styles.body}>
        {principal
          ? "Early Exit approval is unavailable until the school's identity and custody policy is formally configured."
          : 'Submitting an Early Exit request does not authorize the child to leave school.'}
      </Text>
      <Text style={styles.body}>
        No gate pass, QR/OTP or physical checkout is provided.
      </Text>
      {record ? (
        <Text style={styles.body}>
          {`Custody: ${record.eligibility.custodyState}. School policy: unconfigured. Review routing: ${record.reviewRoutingState.replace(/_/g, ' ')}.`}
        </Text>
      ) : null}
    </View>
  );
}
export function EarlyExitHistory({
  detail,
}: {
  detail: Pick<EarlyExitDetail, 'history' | 'submissions'>;
}) {
  return (
    <SectionCard title="Request history">
      {detail.history.map(event => (
        <View key={event.revision} style={styles.event}>
          <Text style={styles.label}>
            {event.action.replace(/_/g, ' ')} ·{' '}
            {new Date(event.at).toLocaleString()}
          </Text>
          {event.decisionReason ? (
            <Text style={styles.body}>{event.decisionReason}</Text>
          ) : null}
        </View>
      ))}
      {detail.submissions.map(snapshot => (
        <View key={snapshot.cycle} style={styles.event}>
          <Text style={styles.label}>
            Submission {snapshot.cycle} ·{' '}
            {new Date(snapshot.submittedAt).toLocaleString()}
          </Text>
          <Text style={styles.body}>{snapshot.exitDate}</Text>
          <Text style={styles.body}>{snapshot.reason}</Text>
        </View>
      ))}
    </SectionCard>
  );
}
export function EarlyExitForm({
  fields,
  errors,
  disabled,
  onChange,
}: {
  fields: EarlyExitFields;
  errors: Partial<Record<keyof EarlyExitFields, string>>;
  disabled: boolean;
  onChange: (fields: EarlyExitFields) => void;
}) {
  return (
    <SectionCard title="Private Early Exit request">
      <Text style={styles.body}>
        Propose a date and reason. The school checks your child's current
        enrollment.
      </Text>
      {(['exitDate', 'reason'] as const).map(key => (
        <View key={key} style={styles.event}>
          <Text style={styles.label}>
            {key === 'exitDate' ? 'Exit date · YYYY-MM-DD' : 'Private reason'}
          </Text>
          <TextInput
            accessibilityLabel={
              key === 'exitDate' ? 'Exit date' : 'Private reason'
            }
            value={fields[key]}
            editable={!disabled}
            onChangeText={value => onChange({ ...fields, [key]: value })}
            style={[styles.input, key === 'reason' && styles.notes]}
            autoCapitalize={key === 'exitDate' ? 'none' : 'sentences'}
            autoCorrect={key === 'reason'}
            multiline={key === 'reason'}
            placeholder={
              key === 'exitDate'
                ? 'YYYY-MM-DD'
                : 'Explain your request privately'
            }
            placeholderTextColor={colors.muted}
          />
          {errors[key] ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {errors[key]}
            </Text>
          ) : null}
        </View>
      ))}
      <Text style={styles.body}>
        {fields.reason.normalize('NFC').trim().length}/500 characters · kept in
        memory only
      </Text>
    </SectionCard>
  );
}
export const styles = StyleSheet.create({
  shell: { flex: 1 },
  body: { ...typography.body, color: colors.muted, marginVertical: spacing.xs },
  label: {
    ...typography.bodyStrong,
    color: colors.ink,
    marginVertical: spacing.xs,
  },
  error: {
    ...typography.body,
    color: colors.danger.text,
    marginVertical: spacing.sm,
  },
  safety: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.soft,
    marginVertical: spacing.sm,
  },
  event: { marginVertical: spacing.sm, gap: spacing.xs },
  actions: { gap: spacing.sm, marginVertical: spacing.md },
  input: {
    ...typography.body,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.ink,
    backgroundColor: colors.white,
    minHeight: 48,
  },
  notes: { minHeight: 96, textAlignVertical: 'top' },
});
