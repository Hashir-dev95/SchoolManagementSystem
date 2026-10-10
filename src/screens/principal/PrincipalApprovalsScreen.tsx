import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import {
  Button,
  Card,
  ScreenHeading,
  SectionCard,
} from '../../components/hiraDashboard';
import { DashboardShell } from '../../components/hiraDashboard/DashboardShell';
import { useAuth } from '../../context/AuthContext';
import {
  ApprovalRequest,
  principalService,
} from '../../services/principal/principalService';
import { colors, typography } from '../../theme/hiraDashboard';

interface PrincipalApprovalsScreenProps {
  onReview: (request: ApprovalRequest) => void;
}

const approvalTitle = (request: ApprovalRequest): string => {
  const typeNames: Record<string, string> = {
    leave: 'Leave request',
    refund: 'Refund request',
    discount: 'Fee concession',
    result: 'Results',
    paper: 'Examination paper',
    purchase: 'Purchase request',
    payroll: 'Payroll request',
    certificate: 'Certificate request',
  };
  const category = typeNames[request.approvalType] ?? request.approvalType;
  const requester = request.requesterId;
  const subject =
    typeof requester === 'string' ? request.entityType : requester.fullName;
  return `${category} · ${subject}`;
};

const formatDate = (rawDate: string): string => {
  const date = new Date(rawDate);
  return Number.isNaN(date.getTime())
    ? rawDate
    : date.toLocaleDateString('en-PK', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
};

export default function PrincipalApprovalsScreen({
  onReview,
}: PrincipalApprovalsScreenProps) {
  const { accessToken } = useAuth();
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  const load = useCallback(async () => {
    if (!accessToken) {
      setError('Your session is unavailable. Please sign in again.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await principalService.getPendingApprovals(accessToken);
      setRequests(response.data.requests);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to load approvals.',
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  const visibleRequests = requests.filter(request => {
    const requester = request.requesterId;
    const requesterText = typeof requester === 'string'
      ? requester
      : `${requester.fullName} ${requester.email}`;
    const searchable = `${requesterText} ${request.entityType} ${request.approvalType} ${request.reason}`.toLocaleLowerCase();
    return (typeFilter === 'all' || request.approvalType === typeFilter) &&
      searchable.includes(query.trim().toLocaleLowerCase());
  });
  const approvalTypes = ['all', ...new Set(requests.map(request => request.approvalType))];

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  return (
    <DashboardShell
      safeArea={false}
      refreshing={loading}
      onRefresh={() => load()}
    >
      <ScreenHeading
        title="A thoughtful second look."
        subtitle="Review the requests that keep your school moving."
      />
      <SectionCard title="Approval inbox">
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search requester, type, subject or reason"
          placeholderTextColor={colors.muted}
          accessibilityLabel="Search approval requests"
          style={styles.searchInput}
        />
        <View style={styles.filters}>
          {approvalTypes.map(type => (
            <Button
              key={type}
              title={type === 'all' ? 'All types' : type.replaceAll('_', ' ')}
              variant={typeFilter === type ? 'primary' : 'secondary'}
              onPress={() => setTypeFilter(type)}
              style={styles.filterButton}
            />
          ))}
        </View>
        {loading && requests.length === 0 ? (
          <View>
            {[0, 1, 2].map(index => (
              <View key={index} style={styles.skeletonRow}>
                <View style={styles.skeletonIcon} />
                <View style={styles.skeletonCopy}>
                  <View style={styles.skeletonTitle} />
                  <View style={styles.skeletonSubtitle} />
                </View>
                <View style={styles.skeletonChip} />
              </View>
            ))}
          </View>
        ) : error ? (
          <View style={styles.state}>
            <Text style={styles.body}>{error}</Text>
            <Button title="Retry" variant="secondary" onPress={() => load()} />
          </View>
        ) : requests.length === 0 ? (
          <View style={styles.state}>
            <Text style={styles.title}>Nothing waiting for you</Text>
            <Text style={styles.muted}>New requests will appear here.</Text>
          </View>
        ) : visibleRequests.length === 0 ? (
          <View style={styles.state}>
            <Text style={styles.muted}>No requests match this search or filter.</Text>
          </View>
        ) : (
          visibleRequests.map((request, index) => (
            <View
              key={request._id}
              style={[
                styles.row,
                index < visibleRequests.length - 1 && styles.divider,
              ]}
            >
              <View style={styles.iconTile}>
                <Text style={styles.icon}>✓</Text>
              </View>
              <View style={styles.rowCopy}>
                <Text style={styles.title}>{approvalTitle(request)}</Text>
                <Text style={styles.muted} numberOfLines={2}>
                  {[
                    formatDate(request.createdAt),
                    request.entityType,
                    request.amount !== undefined
                      ? `Amount ${request.amount.toLocaleString('en-PK')}`
                      : undefined,
                    request.reason,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <View style={styles.rowActions}>
                <Text style={styles.pending}>Pending</Text>
                <Button
                  title="Review"
                  variant="secondary"
                  onPress={() => onReview(request)}
                  style={styles.reviewButton}
                />
              </View>
            </View>
          ))
        )}
      </SectionCard>
      <Card style={styles.policyNote}>
        <Text style={styles.policyText}>
          Each decision records its reviewer, time and reason. High-impact
          actions follow the school’s configured approval limits.
        </Text>
      </Card>
    </DashboardShell>
  );
}

const styles = StyleSheet.create({
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  skeletonIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#f0eee9',
  },
  skeletonCopy: { flex: 1, gap: 7 },
  skeletonTitle: {
    height: 12,
    width: '78%',
    borderRadius: 6,
    backgroundColor: '#f0eee9',
  },
  skeletonSubtitle: {
    height: 10,
    width: '92%',
    borderRadius: 5,
    backgroundColor: '#f0eee9',
  },
  skeletonChip: {
    height: 26,
    width: 56,
    borderRadius: 6,
    backgroundColor: '#f6ead3',
  },
  state: { alignItems: 'center', gap: 12, paddingVertical: 24 },
  searchInput: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    color: colors.ink,
    ...typography.small,
    marginBottom: 10,
  },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 8 },
  filterButton: { minHeight: 34, paddingVertical: 5, paddingHorizontal: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  iconTile: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.softBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { color: colors.primary, fontSize: 18 },
  rowCopy: { flex: 1, gap: 5 },
  rowActions: { alignItems: 'flex-end', gap: 7 },
  reviewButton: { minHeight: 36, paddingVertical: 6, paddingHorizontal: 12 },
  title: { ...typography.bodyStrong, color: colors.ink },
  muted: { ...typography.caption, color: colors.muted },
  body: { ...typography.body, color: colors.ink, textAlign: 'center' },
  pending: {
    ...typography.caption,
    color: colors.pending.text,
    backgroundColor: colors.pending.bg,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: 'hidden',
  },
  policyNote: {
    backgroundColor: '#f2f8f2',
    borderStyle: 'dashed',
    borderColor: '#b4d0ba',
  },
  policyText: { ...typography.small, color: '#4d6b56' },
});
