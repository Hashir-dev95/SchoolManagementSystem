import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  Button,
  Card,
  ListRow,
  ScreenHeading,
  SectionCard,
} from '../../components/hiraDashboard';
import { DashboardShell } from '../../components/hiraDashboard/DashboardShell';
import { useAuth } from '../../context/AuthContext';
import {
  ApprovalAction,
  principalService,
} from '../../services/principal/principalService';
import { colors, typography } from '../../theme/hiraDashboard';
import type { PrincipalStackParamList } from '../../navigation/PrincipalNavigator';

type Props = NativeStackScreenProps<PrincipalStackParamList, 'ApprovalDetail'>;

const actionLabels: Record<ApprovalAction, string> = {
  approved: 'Approve',
  rejected: 'Reject',
  changes_requested: 'Request changes',
};

const requesterName = (value: string | { fullName: string }): string =>
  typeof value === 'string' ? value : value.fullName;

const prettyValue = (value: string): string =>
  value.replaceAll('_', ' ').replace(/^./, first => first.toUpperCase());

export default function ApprovalDetailScreen({ route, navigation }: Props) {
  const { accessToken } = useAuth();
  const [loadedRequest, setLoadedRequest] = useState(route.params.request);
  const [detailError, setDetailError] = useState<string | null>(null);
  const request = loadedRequest;
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [stillPending, setStillPending] = useState(
    request.status === 'pending',
  );

  const loadRequest = useCallback(async () => {
    if (!accessToken) return;
    setDetailError(null);
    try {
      const response = await principalService.getApprovalById(
        accessToken,
        route.params.request._id,
      );
      setLoadedRequest(response.data);
      setStillPending(response.data.status === 'pending');
    } catch (requestError: unknown) {
      setDetailError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to refresh approval details.',
      );
    }
  }, [accessToken, route.params.request._id]);

  useEffect(() => {
    loadRequest().catch(() => undefined);
  }, [loadRequest]);
  const submit = async (action: ApprovalAction) => {
    if (action !== 'approved' && !reason.trim()) {
      setActionError('Enter a reason before submitting this decision.');
      return;
    }
    if (!accessToken || submitting || !stillPending) return;

    setSubmitting(true);
    setActionError(null);
    try {
      const latest = await principalService.getPendingApprovals(accessToken);
      const current = latest.data.requests.find(
        item => item._id === request._id,
      );
      if (!current || current.status !== 'pending') {
        setStillPending(false);
        setActionError(
          'This request is no longer pending. The inbox has been updated.',
        );
        return;
      }

      const result = await principalService.processApproval(
        accessToken,
        request._id,
        action,
        reason.trim() || undefined,
      );
      setStillPending(false);
      Alert.alert(actionLabels[action], result.message, [
        { text: 'Done', onPress: () => navigation.goBack() },
      ]);
    } catch (requestError: unknown) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Unable to submit the decision.';
      setActionError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const openAttachment = async () => {
    const url = request.supportingFileUrl;
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {
      setActionError('This attachment could not be opened on this device.');
    }
  };

  return (
    <DashboardShell>
      <Button
        title="Back to approvals"
        variant="secondary"
        onPress={() => navigation.goBack()}
        style={styles.backButton}
      />
      <ScreenHeading title="Approval request" subtitle={request.entityType} />
      {detailError ? (
        <Card>
          <Text accessibilityRole="alert" style={styles.error}>{detailError}</Text>
          <Button title="Retry details" variant="secondary" onPress={() => { loadRequest().catch(() => undefined); }} />
        </Card>
      ) : null}
      <SectionCard
        title={`${prettyValue(request.approvalType)} · ${requesterName(
          request.requesterId,
        )}`}
      >
        <InfoRow label="Requester" value={requesterName(request.requesterId)} />
        <InfoRow
          label="Request type"
          value={prettyValue(request.approvalType)}
        />
        <InfoRow label="Subject" value={request.entityType} />
        {request.entityId ? (
          <InfoRow label="Record ID" value={request.entityId} />
        ) : null}
        {request.amount !== undefined ? (
          <InfoRow
            label="Amount"
            value={request.amount.toLocaleString('en-PK')}
          />
        ) : null}
        <InfoRow label="Reason" value={request.reason} />
        {request.supportingFileUrl ? (
          <Button
            title="Open attachment"
            variant="secondary"
            onPress={openAttachment}
            style={styles.attachmentButton}
          />
        ) : null}
      </SectionCard>
      {request.beforeData !== undefined || request.afterData !== undefined ? (
        <SectionCard title="Requested change">
          {request.beforeData !== undefined ? (
            <InfoRow
              label="Before"
              value={JSON.stringify(request.beforeData, null, 2) ?? '—'}
            />
          ) : null}
          {request.afterData !== undefined ? (
            <InfoRow
              label="After"
              value={JSON.stringify(request.afterData, null, 2) ?? '—'}
            />
          ) : null}
        </SectionCard>
      ) : null}
      <SectionCard title="Decision history">
        {request.history.length === 0 ? (
          <Text style={styles.muted}>
            No decisions have been recorded for this request.
          </Text>
        ) : (
          request.history.map((entry, index) => (
            <ListRow
              key={`${entry.createdAt}-${entry.action}`}
              icon="◷"
              title={prettyValue(entry.action)}
              subtitle={[
                typeof entry.performedBy === 'string'
                  ? entry.performedBy
                  : entry.performedBy.fullName,
                new Date(entry.createdAt).toLocaleString(),
                entry.reason,
              ]
                .filter(Boolean)
                .join(' · ')}
              last={index === request.history.length - 1}
            />
          ))
        )}
      </SectionCard>
      {stillPending ? (
        <SectionCard title="Your decision">
          <Text style={styles.fieldLabel}>
            Reason for rejection or requested changes
          </Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            multiline
            accessibilityLabel="Decision reason"
            placeholder="Required for Reject and Request changes"
            placeholderTextColor={colors.muted}
            style={styles.reasonInput}
          />
          {actionError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {actionError}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Button
              title="Approve"
              onPress={() => submit('approved')}
              disabled={submitting}
              style={styles.actionButton}
            />
            <Button
              title="Reject"
              variant="danger"
              onPress={() => submit('rejected')}
              disabled={submitting || !reason.trim()}
              style={styles.actionButton}
            />
            <Button
              title="Request changes"
              variant="secondary"
              onPress={() => submit('changes_requested')}
              disabled={submitting || !reason.trim()}
              style={styles.actionButton}
            />
          </View>
          {submitting ? (
            <Text style={styles.muted}>Rechecking request status…</Text>
          ) : null}
        </SectionCard>
      ) : (
        <Card>
          <Text style={styles.muted}>
            This request is no longer available for review.
          </Text>
        </Card>
      )}
    </DashboardShell>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backButton: { alignSelf: 'flex-start', marginBottom: 16 },
  infoRow: {
    gap: 4,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  fieldLabel: { ...typography.caption, color: colors.muted },
  infoValue: { ...typography.body, color: colors.ink },
  attachmentButton: { alignSelf: 'flex-start', marginTop: 12 },
  reasonInput: {
    minHeight: 94,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    color: colors.ink,
    textAlignVertical: 'top',
    backgroundColor: colors.cardWarm,
  },
  actions: { gap: 10, marginTop: 14 },
  actionButton: { width: '100%' },
  error: { ...typography.small, color: colors.danger.text, marginTop: 10 },
  muted: { ...typography.small, color: colors.muted },
});
