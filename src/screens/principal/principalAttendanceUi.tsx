import React, { useCallback, useState } from 'react';
import { Text, TextInput, View, StyleSheet } from 'react-native';
import {
  Button,
  SectionCard,
  StatusBadge,
} from '../../components/hiraDashboard';
import {
  AdminDialog,
  AdminFeedback,
  formStyles,
} from '../../components/hiraDashboard/AdminForm';
import { colors, spacing, typography } from '../../theme/hiraDashboard';
import {
  attendanceOversightService,
  type AttendanceFilterKind,
  type AttendanceOccurrence,
  type AttendanceState,
} from '../../services/principal/attendanceOversightService';
import { useTeacherResource } from '../teacher/useTeacherResource';
export const attendanceStyles = StyleSheet.create({
  body: { ...typography.body, color: colors.ink },
  muted: { ...typography.small, color: colors.muted },
  controls: { gap: spacing.sm, marginBottom: spacing.md },
});
export const stateLabel = (state: AttendanceState) =>
  ({ unmarked: 'Unmarked', in_progress: 'In Progress', submitted: 'Submitted' }[
    state
  ]);
export const issueLabel = (issue: string) =>
  ({
    academic_configuration: 'Academic references need review',
    teacher_unavailable: 'Teacher is unavailable',
    assignment_unavailable: 'Teacher assignment needs review',
    curriculum_configuration:
      'Academic Period or Class Subject setup needs review',
    overdue: 'Attendance is overdue',
    partial_roster: 'Roster is only partly marked',
    empty_roster: 'No eligible roster is available',
    pending_correction: 'Correction awaiting review',
    pending_leave: 'Leave awaiting review',
    occurrence_issue: 'Teacher reported a timetable issue',
    teacher_changed: 'Responsible Teacher has changed',
    approved_leave_mismatch: 'Approved leave differs from the recorded mark',
  }[issue] ?? 'Attendance context needs review');
export function AttendanceStatus({
  occurrence,
}: {
  occurrence: AttendanceOccurrence;
}) {
  return (
    <View style={attendanceStyles.controls}>
      <StatusBadge
        status={occurrence.state === 'submitted' ? 'paid' : 'pending'}
        label={stateLabel(occurrence.state)}
      />
      {occurrence.needsAttention ? (
        <StatusBadge status="unpaid" label="Needs Attention" />
      ) : null}
    </View>
  );
}
export function OccurrenceContext({
  occurrence,
}: {
  occurrence: AttendanceOccurrence;
}) {
  return (
    <View style={attendanceStyles.controls}>
      <Text style={attendanceStyles.body}>
        {occurrence.className} / {occurrence.sectionName} ·{' '}
        {occurrence.subjectName}
      </Text>
      <Text style={attendanceStyles.muted}>
        {occurrence.teacherName}
        {occurrence.isSubstitute ? ' · Substitute' : ''}
      </Text>
      <Text style={attendanceStyles.muted}>
        {occurrence.date} · {occurrence.startTime}–{occurrence.endTime} ·{' '}
        {occurrence.room}
      </Text>
      <AttendanceStatus occurrence={occurrence} />
    </View>
  );
}
export function AttendanceReadState({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: string | null;
  retry: () => void;
}) {
  return loading ? (
    <Text style={attendanceStyles.body}>Loading attendance...</Text>
  ) : error ? (
    <View style={attendanceStyles.controls}>
      <AdminFeedback
        kind="error"
        title="Unable to Load Attendance"
        message={error}
      />
      <Button title="Retry" variant="secondary" onPress={retry} />
    </View>
  ) : null;
}
export type SelectedAttendanceFilters = Partial<
  Record<AttendanceFilterKind, { id: string; label: string }>
>;
const kinds: AttendanceFilterKind[] = [
  'class',
  'section',
  'subject',
  'teacher',
];
export function AttendanceScopeFilters({
  token,
  selected,
  onChange,
}: {
  token: string | null;
  selected: SelectedAttendanceFilters;
  onChange: (value: SelectedAttendanceFilters) => void;
}) {
  const [open, setOpen] = useState<AttendanceFilterKind | null>(null);
  return (
    <SectionCard title="Class and Teaching Context">
      <View style={attendanceStyles.controls}>
        {kinds.map(kind => (
          <Button
            key={kind}
            title={
              kind[0].toUpperCase() +
              kind.slice(1) +
              ': ' +
              (selected[kind]?.label ?? 'All')
            }
            variant="secondary"
            onPress={() => setOpen(kind)}
          />
        ))}
        {Object.keys(selected).length ? (
          <Button
            title="Clear Context Filters"
            variant="secondary"
            onPress={() => onChange({})}
          />
        ) : null}
      </View>
      {open ? (
        <FilterPicker
          key={open}
          kind={open}
          token={token}
          classId={selected.class?.id}
          close={() => setOpen(null)}
          select={value => {
            const next = { ...selected, [open]: value };
            if (open === 'class') delete next.section;
            onChange(next);
            setOpen(null);
          }}
        />
      ) : null}
    </SectionCard>
  );
}
function FilterPicker({
  kind,
  token,
  classId,
  close,
  select,
}: {
  kind: AttendanceFilterKind;
  token: string | null;
  classId?: string;
  close: () => void;
  select: (value: { id: string; label: string } | undefined) => void;
}) {
  const [input, setInput] = useState(''),
    [search, setSearch] = useState(''),
    [offset, setOffset] = useState(0);
  const load = useCallback(() => {
    if (!token) throw new Error('Sign in again to view attendance.');
    return attendanceOversightService.filters(token, kind, {
      search,
      offset,
      ...(kind === 'section' ? { classId } : {}),
    });
  }, [token, kind, search, offset, classId]);
  const resource = useTeacherResource(load);
  return (
    <AdminDialog
      visible
      title={'Select ' + kind}
      closeTitle="Close"
      onClose={close}
    >
      <View style={attendanceStyles.controls}>
        <TextInput
          accessibilityLabel={'Search ' + kind}
          placeholder={'Search ' + kind}
          value={input}
          onChangeText={setInput}
          maxLength={80}
          style={formStyles.input}
          onSubmitEditing={() => {
            setSearch(input.trim());
            setOffset(0);
          }}
        />
        <Button
          title="Find Options"
          variant="secondary"
          onPress={() => {
            setSearch(input.trim());
            setOffset(0);
          }}
        />
        <Button
          title={'All ' + kind + ' options'}
          variant="secondary"
          onPress={() => select(undefined)}
        />
        <AttendanceReadState {...resource} retry={resource.refresh} />
        {resource.data?.items.map(option => (
          <Button
            key={option.id}
            title={option.label}
            variant="secondary"
            onPress={() => select(option)}
          />
        ))}
        {resource.data?.total === 0 ? (
          <Text style={attendanceStyles.body}>No matching options.</Text>
        ) : null}
        {offset > 0 ? (
          <Button
            title="Previous Options"
            variant="secondary"
            onPress={() => setOffset(Math.max(0, offset - 20))}
          />
        ) : null}
        {resource.data?.nextOffset != null ? (
          <Button
            title="More Options"
            variant="secondary"
            onPress={() => setOffset(resource.data!.nextOffset!)}
          />
        ) : null}
      </View>
    </AdminDialog>
  );
}
export const scopeQuery = (selected: SelectedAttendanceFilters) => ({
  classId: selected.class?.id,
  sectionId: selected.section?.id,
  subjectId: selected.subject?.id,
  teacherId: selected.teacher?.id,
});
