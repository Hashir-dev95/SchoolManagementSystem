import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { studentApi } from './studentService';
import { studentPreview } from './previewData';

const colors = {
  ink: '#14243A',
  muted: '#69788C',
  blue: '#246BFD',
  pale: '#F2F6FC',
  line: '#E3EAF3',
  green: '#168A62',
  red: '#B42318',
  amber: '#B66A0A',
};

function Section({ title, children, empty }) {
  return (
    <View>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children.length === 0 ? (
        <Text style={styles.empty}>{empty}</Text>
      ) : (
        children
      )}
    </View>
  );
}

function Record({ title, lines = [], status, feedback }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{title}</Text>
        {status ? <Text style={styles.status}>{status}</Text> : null}
      </View>
      {lines.filter(Boolean).map((line, index) => (
        <Text key={`${title}-${index}`} style={styles.cardLine}>
          {line}
        </Text>
      ))}
      {feedback ? (
        <View style={styles.feedback}>
          <Text style={styles.feedbackLabel}>Teacher feedback</Text>
          <Text style={styles.feedbackText}>{feedback}</Text>
        </View>
      ) : null}
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  autoCapitalize = 'none',
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        autoCapitalize={autoCapitalize}
        style={styles.input}
        placeholderTextColor={colors.muted}
      />
    </View>
  );
}

export default function StudentDashboard({
  previewOnly = false,
  searchQuery = '',
}) {
  const [records, setRecords] = useState(
    previewOnly
      ? studentPreview
      : {
          profile: null,
          timetable: [],
          attendance: [],
          results: [],
          progress: [],
          homework: [],
          applications: [],
        },
  );
  const [loading, setLoading] = useState(!previewOnly);
  const [error, setError] = useState('');
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [asset, setAsset] = useState({
    uri: '',
    name: '',
    type: 'application/pdf',
  });
  const [uploading, setUploading] = useState('');
  const [uploadMessage, setUploadMessage] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [applicationTitle, setApplicationTitle] = useState('');
  const [applicationMessage, setApplicationMessage] = useState('');
  const [applicationBusy, setApplicationBusy] = useState(false);
  const [applicationError, setApplicationError] = useState('');
  const [applicationNotice, setApplicationNotice] = useState('');
  const visibleRecords = React.useMemo(() => {
    if (!previewOnly || !searchQuery.trim()) return records;
    const query = searchQuery.trim().toLowerCase();
    const matches = item => JSON.stringify(item).toLowerCase().includes(query);
    return {
      ...records,
      timetable: records.timetable.filter(matches),
      attendance: records.attendance.filter(matches),
      results: records.results.filter(matches),
      progress: records.progress.filter(matches),
      homework: records.homework.filter(matches),
      applications: records.applications.filter(matches),
    };
  }, [previewOnly, records, searchQuery]);

  const loadDashboard = useCallback(async filters => {
    setLoading(true);
    setError('');
    try {
      const [
        profile,
        timetable,
        attendance,
        results,
        progress,
        homework,
        applications,
      ] = await Promise.all([
        studentApi.getProfile(),
        studentApi.getTimetable(),
        studentApi.getAttendance(filters),
        studentApi.getResults(),
        studentApi.getProgress(),
        studentApi.getHomework(),
        studentApi.getApplications(),
      ]);
      setRecords({
        profile,
        timetable,
        attendance,
        results,
        progress,
        homework,
        applications,
      });
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (previewOnly) return;
    loadDashboard({ from: '', to: '' });
  }, [loadDashboard, previewOnly]);

  async function submit(homeworkId) {
    if (previewOnly) return;
    setUploadError('');
    setUploadMessage('');
    if (!asset.uri.trim() || !asset.name.trim()) {
      setUploadError('Provide the selected file URI and filename.');
      return;
    }
    setUploading(homeworkId);
    try {
      const result = await studentApi.submitHomework(homeworkId, {
        ...asset,
        uri: asset.uri.trim(),
        name: asset.name.trim(),
      });
      setUploadMessage(`Submission saved. Status: ${result.status}.`);
      await loadDashboard(dateRange);
    } catch (submitError) {
      setUploadError(submitError.message);
    } finally {
      setUploading('');
    }
  }

  async function submitApplication() {
    if (previewOnly) return;
    setApplicationError('');
    setApplicationNotice('');
    setApplicationBusy(true);
    try {
      await studentApi.submitApplication({
        title: applicationTitle,
        message: applicationMessage,
      });
      setApplicationTitle('');
      setApplicationMessage('');
      setApplicationNotice('Application sent to your assigned class teacher.');
      await loadDashboard(dateRange);
    } catch (submitError) {
      setApplicationError(submitError.message);
    } finally {
      setApplicationBusy(false);
    }
  }

  const profileName =
    records.profile?.fullName || records.profile?.name || 'Student';
  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.eyebrow}>STUDENT PORTAL</Text>
      <Text style={styles.heading}>{profileName}</Text>
      <Text style={styles.subtitle}>
        {records.profile
          ? [
              records.profile.id,
              records.profile.grade,
              records.profile.section && `Section ${records.profile.section}`,
            ]
              .filter(Boolean)
              .join(' · ')
          : 'Your school information'}
      </Text>
      {previewOnly ? (
        <Text style={styles.previewNotice}>
          DEVELOPMENT UI PREVIEW · Fictional records · APIs and submissions are
          disabled
        </Text>
      ) : null}

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.blue} />
          <Text style={styles.muted}>Loading your school records…</Text>
        </View>
      ) : null}
      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => loadDashboard(dateRange)}
            style={styles.retry}
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {!previewOnly ? (
        <Text style={styles.sectionTitle}>Attendance date range</Text>
      ) : null}
      {!previewOnly ? (
        <>
          <View style={styles.filters}>
            <Field
              label="From (YYYY-MM-DD)"
              value={dateRange.from}
              onChangeText={value =>
                setDateRange(current => ({ ...current, from: value }))
              }
              placeholder="2026-01-01"
            />
            <Field
              label="To (YYYY-MM-DD)"
              value={dateRange.to}
              onChangeText={value =>
                setDateRange(current => ({ ...current, to: value }))
              }
              placeholder="2026-12-31"
            />
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={loading}
            onPress={() => loadDashboard(dateRange)}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Apply attendance dates</Text>
          </Pressable>
        </>
      ) : null}

      {!loading && !error ? (
        <>
          <Section
            title="Timetable"
            empty="No timetable entries are available."
          >
            {visibleRecords.timetable.map(item => (
              <Record
                key={
                  item.id ||
                  `${item.dayOfWeek}-${item.startTime}-${item.subject}`
                }
                title={item.subject || item.course || 'Class'}
                lines={[
                  item.day || item.dayOfWeek,
                  [item.startTime, item.endTime].filter(Boolean).join(' – '),
                  item.room,
                  item.teacher,
                ].filter(Boolean)}
              />
            ))}
          </Section>
          <Section
            title="Attendance"
            empty="No attendance records found for these dates."
          >
            {visibleRecords.attendance.map(item => (
              <Record
                key={item.id || `${item.date}-${item._id}`}
                title={
                  item.date
                    ? new Date(item.date).toLocaleDateString()
                    : 'Attendance'
                }
                lines={[item.subject, item.note].filter(Boolean)}
                status={item.status}
              />
            ))}
          </Section>
          <Section
            title="Published results"
            empty="No results have been published for you."
          >
            {visibleRecords.results.map(item => (
              <Record
                key={item.id || item._id}
                title={item.examName || item.title || item.subject || 'Result'}
                lines={[
                  item.subject,
                  item.score != null && `Score: ${item.score}`,
                  item.grade && `Grade: ${item.grade}`,
                  item.publishedAt &&
                    `Published ${new Date(
                      item.publishedAt,
                    ).toLocaleDateString()}`,
                ].filter(Boolean)}
                feedback={item.teacherFeedback || item.feedback}
              />
            ))}
          </Section>
          <Section title="Progress" empty="No progress records are available.">
            {visibleRecords.progress.map(item => (
              <Record
                key={item.id || item._id}
                title={item.subject || item.area || item.title || 'Progress'}
                lines={[
                  item.progress != null &&
                    `Progress: ${item.progress}${
                      typeof item.progress === 'number' ? '%' : ''
                    }`,
                  item.grade && `Grade: ${item.grade}`,
                  item.updatedAt &&
                    `Updated ${new Date(item.updatedAt).toLocaleDateString()}`,
                ].filter(Boolean)}
                feedback={item.teacherFeedback || item.feedback}
              />
            ))}
          </Section>
          <Section
            title="Homework"
            empty="No published homework is assigned to you."
          >
            {visibleRecords.homework.map(item => {
              const submission = item.latestSubmission;
              const homeworkId = item.id || String(item._id);
              return (
                <View key={homeworkId} style={styles.homeworkCard}>
                  <Record
                    title={item.title || item.subject || 'Homework'}
                    lines={[
                      item.description,
                      item.dueDate &&
                        `Due ${String(item.dueDate).slice(0, 10)}`,
                      item.subject,
                      submission?.fileName,
                      submission?.submittedAt &&
                        `Submitted ${new Date(
                          submission.submittedAt,
                        ).toLocaleDateString()}`,
                    ].filter(Boolean)}
                    status={submission?.status || 'Not submitted'}
                    feedback={
                      submission?.teacherFeedback || submission?.feedback
                    }
                  />
                  {!previewOnly ? (
                    <>
                      <Text style={styles.uploadHint}>
                        Submission files: PDF, JPEG, or PNG, up to 5 MB.
                      </Text>
                      <Field
                        label="File URI from device"
                        value={asset.uri}
                        onChangeText={value =>
                          setAsset(current => ({ ...current, uri: value }))
                        }
                        placeholder="Select a file in your device flow"
                      />
                      <Field
                        label="Filename"
                        value={asset.name}
                        onChangeText={value =>
                          setAsset(current => ({ ...current, name: value }))
                        }
                        placeholder="homework.pdf"
                        autoCapitalize="none"
                      />
                      <Field
                        label="MIME type"
                        value={asset.type}
                        onChangeText={value =>
                          setAsset(current => ({ ...current, type: value }))
                        }
                        placeholder="application/pdf"
                      />
                      <Pressable
                        accessibilityRole="button"
                        disabled={uploading === homeworkId}
                        onPress={() => submit(homeworkId)}
                        style={[
                          styles.button,
                          uploading === homeworkId && styles.disabled,
                        ]}
                      >
                        <Text style={styles.buttonText}>
                          {uploading === homeworkId
                            ? 'Uploading…'
                            : 'Submit homework'}
                        </Text>
                      </Pressable>
                    </>
                  ) : (
                    <Text style={styles.uploadHint}>
                      Submission controls are disabled in this preview.
                    </Text>
                  )}
                </View>
              );
            })}
          </Section>
          {!previewOnly ? (
            <>
              <Text style={styles.sectionTitle}>
                Applications to class teacher
              </Text>
              <Text style={styles.muted}>
                Your application is routed using your assigned class. Status
                changes are recorded by the school.
              </Text>
              <Field
                label="Subject"
                value={applicationTitle}
                onChangeText={setApplicationTitle}
                placeholder="Application subject"
                autoCapitalize="sentences"
              />
              <TextInput
                accessibilityLabel="Application message"
                value={applicationMessage}
                onChangeText={setApplicationMessage}
                placeholder="Write your application"
                multiline
                textAlignVertical="top"
                style={[styles.input, styles.multiline]}
                placeholderTextColor={colors.muted}
              />
              <Pressable
                accessibilityRole="button"
                disabled={applicationBusy || loading}
                onPress={submitApplication}
                style={[
                  styles.button,
                  (applicationBusy || loading) && styles.disabled,
                ]}
              >
                <Text style={styles.buttonText}>
                  {applicationBusy ? 'Sending…' : 'Send application'}
                </Text>
              </Pressable>
              {!!applicationNotice && (
                <Text style={styles.successText}>{applicationNotice}</Text>
              )}
              {!!applicationError && (
                <Text accessibilityRole="alert" style={styles.errorText}>
                  {applicationError}
                </Text>
              )}
              <Section
                title="Application status history"
                empty="You have no applications yet."
              >
                {records.applications.map(item => (
                  <View key={item.id || item._id} style={styles.card}>
                    <View style={styles.cardHeader}>
                      <Text style={styles.cardTitle}>{item.title}</Text>
                      <Text style={styles.status}>
                        {String(item.status || '').replace(/_/g, ' ')}
                      </Text>
                    </View>
                    <Text style={styles.cardLine}>{item.message}</Text>
                    {(item.statusHistory || []).map((entry, index) => (
                      <Text
                        key={`${item.id || item._id}-${index}`}
                        style={styles.cardLine}
                      >
                        {String(entry.status || '').replace(/_/g, ' ')} ·{' '}
                        {entry.changedAt
                          ? new Date(entry.changedAt).toLocaleString()
                          : ''}
                        {entry.note ? ` · ${entry.note}` : ''}
                      </Text>
                    ))}
                  </View>
                ))}
              </Section>
            </>
          ) : (
            <Section
              title="Application history"
              empty="No preview applications."
            >
              {records.applications.map(item => (
                <Record key={item.id} title={item.title} status={item.status} />
              ))}
            </Section>
          )}
          <Text accessibilityRole="alert" style={styles.successText}>
            {uploadMessage}
          </Text>
          <Text accessibilityRole="alert" style={styles.errorText}>
            {uploadError}
          </Text>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.pale },
  content: { padding: 20, paddingBottom: 42 },
  eyebrow: {
    color: colors.blue,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginTop: 12,
  },
  heading: { color: colors.ink, fontSize: 28, fontWeight: '800', marginTop: 8 },
  subtitle: { color: colors.muted, fontSize: 13, marginTop: 5 },
  sectionTitle: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: '800',
    marginTop: 25,
    marginBottom: 10,
  },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 20,
  },
  muted: { color: colors.muted, fontSize: 12 },
  errorBox: {
    backgroundColor: '#FFF0EF',
    borderRadius: 12,
    padding: 14,
    marginTop: 14,
  },
  errorText: { color: colors.red, fontSize: 12, lineHeight: 18, marginTop: 7 },
  retry: { paddingTop: 10 },
  retryText: { color: colors.blue, fontWeight: '800' },
  filters: { flexDirection: 'row', gap: 10 },
  field: { flex: 1, marginBottom: 10 },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 5,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    minHeight: 42,
    paddingHorizontal: 10,
    color: colors.ink,
    fontSize: 12,
  },
  multiline: { minHeight: 100, paddingTop: 10, marginBottom: 10 },
  button: {
    backgroundColor: colors.blue,
    minHeight: 43,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  buttonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 },
  disabled: { opacity: 0.55 },
  empty: {
    backgroundColor: '#FFFFFF',
    color: colors.muted,
    borderRadius: 11,
    padding: 13,
    fontSize: 12,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 13,
    marginBottom: 8,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  cardTitle: { color: colors.ink, fontSize: 13, fontWeight: '800', flex: 1 },
  cardLine: { color: colors.muted, fontSize: 11, marginTop: 5, lineHeight: 16 },
  status: {
    color: colors.green,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  feedback: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    marginTop: 9,
    paddingTop: 8,
  },
  feedbackLabel: { color: colors.blue, fontSize: 10, fontWeight: '800' },
  feedbackText: {
    color: colors.ink,
    fontSize: 12,
    marginTop: 4,
    lineHeight: 17,
  },
  homeworkCard: { marginBottom: 12 },
  uploadHint: { color: colors.muted, fontSize: 11, marginBottom: 8 },
  successText: { color: colors.green, fontSize: 12, marginTop: 7 },
  previewNotice: {
    color: '#8A4D00',
    backgroundColor: '#FFF1D6',
    borderRadius: 13,
    padding: 11,
    marginTop: 13,
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 16,
  },
});
