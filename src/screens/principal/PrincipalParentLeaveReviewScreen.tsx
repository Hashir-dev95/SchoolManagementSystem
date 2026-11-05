import React, { useCallback } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Button,
  DashboardShell,
  ListRow,
  ScreenHeading,
  SectionCard,
  StatusBadge,
} from '../../components/hiraDashboard';
import { useParentLeaveReviewRead } from '../../hooks/useParentLeaveReviewRead';
import type { PrincipalStackParamList } from '../../navigation/PrincipalNavigator';
import {
  parentLeaveReviewService,
  type ParentLeaveReviewDetail,
} from '../../services/principal/parentLeaveReviewService';

const dateRange = (start: string, end: string) =>
  start === end ? start : `${start} to ${end}`;

export function PrincipalParentLeaveQueue({
  onOpen,
}: {
  onOpen: (approvalId: string) => void;
}) {
  const { data, error, loading, reload } = useParentLeaveReviewRead(
    parentLeaveReviewService.list,
  );
  return (
    <SectionCard title="Parent leave applications">
      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading parent leave" />
      ) : null}
      {error ? (
        <>
          <Text>{error}</Text>
          <Button
            title="Retry parent leave"
            variant="secondary"
            onPress={reload}
          />
        </>
      ) : null}
      {data?.length === 0 ? (
        <Text>No parent leave requests are waiting for review.</Text>
      ) : null}
      {data?.map(request => (
        <ListRow
          key={request.approvalId}
          icon="▤"
          title={request.studentName}
          subtitle={dateRange(request.startDate, request.endDate)}
          right={<StatusBadge status="pending" label="Pending" />}
          onPress={() => onOpen(request.approvalId)}
        />
      ))}
    </SectionCard>
  );
}

const historyLabels: Record<
  ParentLeaveReviewDetail['history'][number]['action'],
  string
> = {
  draft_created: 'Draft created',
  draft_edited: 'Draft edited',
  submitted: 'Submitted for review',
};

export default function PrincipalParentLeaveReviewScreen({
  route,
}: NativeStackScreenProps<PrincipalStackParamList, 'ParentLeaveReview'>) {
  const { approvalId } = route.params;
  const load = useCallback(
    (token: string) => parentLeaveReviewService.detail(token, approvalId),
    [approvalId],
  );
  const { data, error, loading, reload } = useParentLeaveReviewRead(
    load,
    approvalId,
  );
  return (
    <DashboardShell refreshing={loading} onRefresh={reload}>
      <ScreenHeading
        title="Parent leave review"
        subtitle="Read-only review. Decisions are not available yet."
      />
      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading parent leave detail" />
      ) : null}
      {error ? (
        <SectionCard title="Parent leave unavailable">
          <Text>{error}</Text>
          <Button title="Retry" variant="secondary" onPress={reload} />
        </SectionCard>
      ) : null}
      {data ? (
        <>
          <SectionCard title={data.studentName}>
            <StatusBadge status="pending" label="Pending" />
            <ListRow
              icon="▤"
              title={data.leaveType}
              subtitle={dateRange(data.startDate, data.endDate)}
            />
            <Text>{data.reason}</Text>
          </SectionCard>
          <SectionCard title="Request history">
            {data.history.map(event => (
              <ListRow
                key={event.revision}
                icon="•"
                title={historyLabels[event.action]}
                subtitle={new Date(event.at).toLocaleString('en-PK')}
              />
            ))}
          </SectionCard>
        </>
      ) : null}
    </DashboardShell>
  );
}
