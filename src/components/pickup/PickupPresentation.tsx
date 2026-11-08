import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { SectionCard, StatusBadge } from '../hiraDashboard';
import { colors, radius, spacing, typography } from '../../theme/hiraDashboard';
import type {
  PickupFields,
  PickupState,
  PickupSummary,
  PickupDetail,
} from '../../services/parent/pickupAuthorizationService';

export const pickupLabels: Record<PickupState, string> = {
  draft: 'Draft',
  pending: 'Pending',
  changes_requested: 'Changes Requested',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  approved: 'Approved (history only)',
};
export function PickupStatus({ state }: { state: PickupState }) {
  return (
    <StatusBadge
      status={state === 'rejected' ? 'unpaid' : 'pending'}
      label={pickupLabels[state]}
    />
  );
}
export function PickupSafety({
  record,
}: {
  record?: Pick<
    PickupSummary,
    'eligibility' | 'reviewRoutingState' | 'policyBindingCurrent'
  >;
}) {
  return (
    <View style={pickupStyles.safety}>
      <Text style={pickupStyles.label}>School verification required</Text>
      <Text style={pickupStyles.body}>
        School identity verification and custody policy are not available.
        Pickup permission inactive: this proposal is not a gate pass.
      </Text>
      {record?.reviewRoutingState !== undefined &&
      record.reviewRoutingState !== 'configured' ? (
        <Text style={pickupStyles.body}>
          Pickup request review is not available for this branch yet. Refresh
          after the school configures review routing.
        </Text>
      ) : null}
      {record && !record.policyBindingCurrent ? (
        <Text style={pickupStyles.body}>
          School policy changed. This proposal cannot be changed in its current
          scope.
        </Text>
      ) : null}
      {record?.eligibility.custodyState === 'hold' ? (
        <Text style={pickupStyles.error}>
          School custody restrictions prevent operational pickup.
        </Text>
      ) : null}
    </View>
  );
}
export function PickupHistory({
  detail,
}: {
  detail: Pick<PickupDetail, 'history' | 'submissions'>;
}) {
  return (
    <SectionCard title="Request history">
      {detail.history.map(event => (
        <View key={event.revision} style={pickupStyles.event}>
          <Text style={pickupStyles.label}>
            {event.action.replace(/_/g, ' ')} ·{' '}
            {new Date(event.at).toLocaleString()}
          </Text>
          {event.reason ? (
            <Text style={pickupStyles.body}>{event.reason}</Text>
          ) : null}
        </View>
      ))}
      {detail.submissions.map(snapshot => (
        <View key={snapshot.cycle} style={pickupStyles.event}>
          <Text style={pickupStyles.label}>
            Submission {snapshot.cycle} ·{' '}
            {new Date(snapshot.submittedAt).toLocaleString()}
          </Text>
          <Text style={pickupStyles.body}>
            {snapshot.fullName} · {snapshot.relationship} · {snapshot.phone}
          </Text>
          <Text style={pickupStyles.body}>
            {snapshot.validFromDate} – {snapshot.validUntilDate}
          </Text>
          <Text style={pickupStyles.body}>{snapshot.notes}</Text>
        </View>
      ))}
    </SectionCard>
  );
}
export const pickupFieldLabels: Record<keyof PickupFields, string> = {
  fullName: 'Full name',
  relationship: 'Relationship',
  phone: 'Phone',
  validFromDate: 'Valid from',
  validUntilDate: 'Valid until',
  notes: 'Notes (optional)',
};
export function PickupForm({
  fields,
  errors,
  disabled,
  onChange,
}: {
  fields: PickupFields;
  errors: Partial<Record<keyof PickupFields, string>>;
  disabled: boolean;
  onChange: (fields: PickupFields) => void;
}) {
  return (
    <SectionCard title="Pickup person proposal">
      <Text style={pickupStyles.body}>
        Propose a person and validity dates. The school validates dates against
        current enrollment. Identity verification is a separate school process.
      </Text>
      {(Object.keys(pickupFieldLabels) as (keyof PickupFields)[]).map(key => (
        <View key={key} style={pickupStyles.event}>
          <Text style={pickupStyles.label}>{pickupFieldLabels[key]}</Text>
          <TextInput
            accessibilityLabel={pickupFieldLabels[key]}
            value={fields[key]}
            editable={!disabled}
            onChangeText={value => onChange({ ...fields, [key]: value })}
            style={[pickupStyles.input, key === 'notes' && pickupStyles.notes]}
            keyboardType={key === 'phone' ? 'phone-pad' : 'default'}
            autoCapitalize={key.startsWith('valid') ? 'none' : 'sentences'}
            multiline={key === 'notes'}
            placeholder={key.startsWith('valid') ? 'YYYY-MM-DD' : undefined}
            placeholderTextColor={colors.muted}
          />
          {errors[key] ? (
            <Text accessibilityRole="alert" style={pickupStyles.error}>
              {errors[key]}
            </Text>
          ) : null}
        </View>
      ))}
    </SectionCard>
  );
}
export const pickupStyles = StyleSheet.create({
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
