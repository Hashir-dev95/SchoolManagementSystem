import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Text, TextInput } from 'react-native';
import {
  DashboardShell,
  ScreenHeading,
  SectionCard,
  Button,
  StatusBadge,
} from '../../components/hiraDashboard';
import {
  AdminDateField,
  AdminSelect,
  AdminDialog,
  AdminFeedback,
  formStyles as styles,
} from '../../components/hiraDashboard/AdminForm';
import { useAuth } from '../../context/AuthContext';
import { hasPermission, PERMISSIONS } from '../../constants/permissions';
import { useTeacherResource } from '../teacher/useTeacherResource';
import { ApiError } from '../../services/api/apiClient';
import {
  substitutionService as service,
  type SubstitutionOccurrence,
} from '../../services/principal/substitutionService';

export default function PrincipalSubstitutionsScreen() {
  const { accessToken, user } = useAuth();
  if (
    !accessToken ||
    user?.role !== 'principal' ||
    !hasPermission(user.role, PERMISSIONS.TIMETABLE_MANAGE)
  )
    return (
      <DashboardShell>
        <AdminFeedback
          kind="error"
          title="Access unavailable"
          message="Substitution management is no longer available."
        />
      </DashboardShell>
    );
  return (
    <Workspace key={JSON.stringify([accessToken, user])} token={accessToken} />
  );
}
function Workspace({ token }: { token: string }) {
  const [input, setInput] = useState(''),
    [date, setDate] = useState<string>(),
    [offset, setOffset] = useState(0);
  return (
    <DashboardShell keyboardShouldPersistTaps="handled">
      <ScreenHeading
        title="Substitutions"
        subtitle="Temporary responsibility for one scheduled lesson"
      />
      <SectionCard title="School date">
        <AdminDateField
          label="Substitution date"
          value={input}
          onChange={setInput}
          helper="YYYY-MM-DD · blank uses the school date"
        />
        <Button
          title="Apply Date"
          onPress={() => {
            setDate(input.trim() || undefined);
            setOffset(0);
          }}
        />
      </SectionCard>
      <Overview
        key={`${date}/${offset}`}
        token={token}
        date={date}
        offset={offset}
        setOffset={setOffset}
      />
    </DashboardShell>
  );
}
function Overview({
  token,
  date,
  offset,
  setOffset,
}: {
  token: string;
  date?: string;
  offset: number;
  setOffset: (n: number) => void;
}) {
  const resource = useTeacherResource(
    useCallback(
      () => service.overview(token, date, offset),
      [token, date, offset],
    ),
  );
  const [selected, setSelected] = useState(''),
    [feedback, setFeedback] = useState<{
      kind: 'error' | 'success';
      title: string;
      message: string;
    } | null>(null);
  const refresh = () => {
    setSelected('');
    return resource.refresh();
  };
  const row = resource.data?.items.find(p => p.periodId === selected);
  return (
    <>
      <Button
        title="Refresh Lessons"
        onPress={refresh}
        disabled={resource.loading}
        variant="secondary"
      />
      {feedback && <AdminFeedback {...feedback} />}
      {resource.loading && (
        <ActivityIndicator accessibilityLabel="Loading lessons" />
      )}
      {resource.error && (
        <AdminFeedback
          kind="error"
          title="Lessons unavailable"
          message={resource.error}
        />
      )}
      {resource.data && (
        <Text style={styles.helper}>
          {resource.data.date} · {resource.data.timezone}
        </Text>
      )}
      {resource.data?.items.length === 0 && (
        <Text style={styles.copy}>No scheduled lessons on this date.</Text>
      )}
      {resource.data?.items.map(p => (
        <SectionCard
          key={p.periodId}
          title={`${p.className} · ${p.sectionName}`}
        >
          <Lesson row={p} />
          <StatusBadge
            status={p.substituteTeacher ? 'paid' : 'pending'}
            label={p.substituteTeacher ? 'Assigned' : 'Original'}
          />
          <Button
            title="View Lesson"
            variant="secondary"
            onPress={() => setSelected(p.periodId)}
          />
        </SectionCard>
      ))}
      {offset > 0 && (
        <Button
          title="Previous Lessons"
          onPress={() => {
            setSelected('');
            setOffset(Math.max(0, offset - 30));
          }}
        />
      )}
      {resource.data?.nextOffset != null && (
        <Button
          title="Next Lessons"
          onPress={() => {
            setSelected('');
            setOffset(resource.data!.nextOffset!);
          }}
        />
      )}
      {row && (
        <Detail
          key={`${row.periodId}/${row.date}/${row.revision}`}
          row={row}
          token={token}
          onClose={() => setSelected('')}
          onDone={async (kind, title, message) => {
            setFeedback({ kind, title, message });
            await refresh();
          }}
        />
      )}
    </>
  );
}
function Lesson({ row }: { row: SubstitutionOccurrence }) {
  return (
    <>
      <Text style={styles.copy}>{row.subjectName}</Text>
      <Text style={styles.copy}>
        {row.date} · {row.startTime}–{row.endTime} · {row.room}
      </Text>
      <Text style={styles.copy}>
        Original Teacher: {row.originalTeacher.name}
      </Text>
      {row.substituteTeacher && (
        <Text style={styles.copy}>
          Substitute: {row.substituteTeacher.name} ·{' '}
          {row.reason ?? 'Temporary duty'}
        </Text>
      )}
    </>
  );
}
function Detail({
  row,
  token,
  onClose,
  onDone,
}: {
  row: SubstitutionOccurrence;
  token: string;
  onClose: () => void;
  onDone: (
    kind: 'success' | 'error',
    title: string,
    message: string,
  ) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false),
    [confirm, setConfirm] = useState(false),
    [cancel, setCancel] = useState(false),
    [busy, setBusy] = useState(false);
  const [teacher, setTeacher] = useState(''),
    [reason, setReason] = useState('Teacher absent'),
    [searchInput, setSearchInput] = useState(''),
    [search, setSearch] = useState(''),
    [offset, setOffset] = useState(0);
  const candidates = useTeacherResource(
    useCallback(
      () => service.candidates(token, row.periodId, row.date, search, offset),
      [token, row.periodId, row.date, search, offset],
    ),
    'This lesson is no longer available.',
    editing,
  );
  const selected = candidates.data?.items.find(c => c.id === teacher);
  const current = candidates.data?.revision === row.revision;
  const mutate = async () => {
    if (busy || (!cancel && (!selected || !current))) return;
    setBusy(true);
    try {
      if (cancel) await service.cancel(token, row);
      else await service.assign(token, row, teacher, reason);
      await onDone(
        'success',
        cancel ? 'Substitution Cancelled' : 'Substitute Assigned',
        cancel
          ? 'The original Teacher is responsible for this lesson again.'
          : `${selected!.name} is assigned to this lesson for ${row.date}.`,
      );
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 0;
      await onDone(
        'error',
        status === 401 || status === 403
          ? 'Access unavailable'
          : status === 409
          ? 'Schedule Updated'
          : 'Assignment unavailable',
        status === 409
          ? 'This lesson or Teacher availability changed. Review the latest timetable and choose again.'
          : 'Unable to save. Refresh lessons to recheck your access and the latest schedule.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <AdminDialog
      visible
      title={
        confirm
          ? cancel
            ? 'Cancel Substitution?'
            : 'Assign Substitute?'
          : 'Scheduled Lesson'
      }
      onClose={onClose}
      busy={busy}
      busyLabel="Saving substitution"
      confirmTitle={cancel ? 'Cancel Substitution' : 'Assign Substitute'}
      onConfirm={
        confirm && (cancel || (selected && current)) ? mutate : undefined
      }
    >
      <Text style={styles.heading}>
        {row.className} · {row.sectionName}
      </Text>
      <Lesson row={row} />
      <Text style={styles.helper}>
        This lesson and date only. Permanent Teacher assignments stay unchanged.
      </Text>
      {cancel && row.originalWindow && (
        <Text style={styles.copy}>
          Restore original schedule: {row.originalWindow.startTime}–
          {row.originalWindow.endTime} · {row.originalWindow.room}
        </Text>
      )}
      {!row.canManage && (
        <Text style={styles.copy}>
          This lesson has started. Substitution history remains available below.
        </Text>
      )}
      {!editing && !confirm && row.canManage && (
        <>
          <Button
            title={
              row.substituteTeacher ? 'Replace Substitute' : 'Assign Substitute'
            }
            onPress={() => setEditing(true)}
          />
          {row.substituteTeacher && (
            <Button
              title="Cancel Substitution"
              variant="danger"
              onPress={() => {
                setCancel(true);
                setConfirm(true);
              }}
            />
          )}
        </>
      )}
      {editing && !confirm && (
        <>
          <TextInput
            accessibilityLabel="Search replacement Teachers"
            value={searchInput}
            onChangeText={setSearchInput}
            maxLength={80}
            style={styles.input}
            placeholder="Teacher name"
          />
          <Button
            title="Search Teachers"
            onPress={() => {
              setTeacher('');
              setOffset(0);
              setSearch(searchInput.trim());
            }}
          />
          {candidates.loading && (
            <ActivityIndicator accessibilityLabel="Loading available Teachers" />
          )}
          {candidates.error && (
            <AdminFeedback
              kind="error"
              title="Teachers unavailable"
              message={candidates.error}
            />
          )}
          <Button
            title="Refresh Teachers"
            variant="secondary"
            onPress={() => {
              setTeacher('');
              candidates.refresh();
            }}
            disabled={candidates.loading}
          />
          {candidates.data && !current && (
            <Text style={styles.copy}>
              Schedule updated. Close this dialog and refresh lessons.
            </Text>
          )}
          {candidates.data && current && (
            <>
              <AdminSelect
                label="Replacement Teacher"
                value={teacher}
                options={candidates.data.items.map(c => ({
                  id: c.id,
                  label: c.name,
                  detail: c.eligibility,
                }))}
                onSelect={setTeacher}
                placeholder="Choose available Teacher"
                helper={candidates.data.policy}
              />
              {!candidates.data.items.length && (
                <Text style={styles.copy}>
                  No available Teachers match this search.
                </Text>
              )}
              {offset > 0 && (
                <Button
                  title="Previous Teachers"
                  onPress={() => {
                    setTeacher('');
                    setOffset(Math.max(0, offset - 30));
                  }}
                />
              )}
              {candidates.data.nextOffset != null && (
                <Button
                  title="Next Teachers"
                  onPress={() => {
                    setTeacher('');
                    setOffset(candidates.data!.nextOffset!);
                  }}
                />
              )}
              <AdminSelect
                label="Reason"
                value={reason}
                options={[
                  'Teacher absent',
                  'Approved leave',
                  'Emergency',
                  'Official duty',
                  'Schedule adjustment',
                  'Other',
                ].map(r => ({ id: r, label: r }))}
                onSelect={setReason}
                placeholder="Choose reason"
                helper="Operational reason only; do not include private details."
              />
              <Button
                title="Review Assignment"
                disabled={!selected}
                onPress={() => setConfirm(true)}
              />
            </>
          )}
        </>
      )}
      {confirm && !cancel && (
        <Text style={styles.copy}>
          Substitute: {selected?.name} · {reason}
        </Text>
      )}
      {!confirm &&
        row.history.map(h => (
          <Text key={h.id} style={styles.helper}>
            {h.status} · {h.teacher.name} · {h.reason ?? 'Temporary duty'} ·{' '}
            {h.createdAt}
          </Text>
        ))}
    </AdminDialog>
  );
}
