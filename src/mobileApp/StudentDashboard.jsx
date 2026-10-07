import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  RefreshControl,
} from 'react-native';
import { studentApi } from './studentService';
import {
  APPLICATION_MESSAGE_LIMIT,
  APPLICATION_TITLE_LIMIT,
  validateApplicationDraft,
} from './applicationValidation';
import { studentPreview } from './previewData';
import SchoolPageHero from './SchoolPageHero';
import {
  errorCodes,
  isErrorWithCode,
  pick,
} from '@react-native-documents/picker';

const colors = {
  ink: '#282940',
  muted: '#92918A',
  blue: '#4857B5',
  pale: '#FFF9EF',
  line: '#E6E2D7',
  green: '#168A62',
  red: '#B42318',
  amber: '#B66A0A',
};

function Section({ title, activePage, children, empty, error, onRetry }) {
  const sectionPage = {
    Profile: 'Profile',
    Timetable: 'Timetable',
    Attendance: 'Attendance',
    Homework: 'Homework',
    'Published results': 'Results',
    Progress: 'Progress',
    Fees: 'Fees',
    'Application status history': 'Applications',
    'Application history': 'Applications',
  }[title];
  if (
    activePage &&
    activePage !== 'All' &&
    activePage !== 'My children' &&
    activePage !== sectionPage &&
    !(activePage === 'Learning' && title === 'Timetable')
  )
    return null;
  return (
    <View>
      <Text style={styles.sectionTitle}>{title}</Text>
      {error ? (
        <View accessibilityRole="alert" style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            style={styles.retry}
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : React.Children.count(children) === 0 ? (
        <Text style={styles.empty}>{empty}</Text>
      ) : (
        children
      )}
    </View>
  );
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

const resourcesByPage = {
  Profile: ['profile'],
  Timetable: ['profile', 'timetable'],
  Learning: ['profile', 'timetable'],
  Attendance: ['profile', 'attendance'],
  Results: ['profile', 'results'],
  Progress: ['profile', 'progress'],
  Homework: ['profile', 'homework'],
  Applications: ['profile', 'applications'],
  Fees: ['profile'],
};

function requestedResources(page) {
  return (
    resourcesByPage[page] || [
      'profile',
      'timetable',
      'attendance',
      'results',
      'progress',
      'homework',
      'applications',
    ]
  );
}

function isPastDeadline(value) {
  if (!value) return false;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(value));
  const deadline = new Date(dateOnly ? `${value}T23:59:59.999Z` : value);
  return Number.isFinite(deadline.getTime()) && Date.now() > deadline.getTime();
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
  page = 'All',
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
  const [resourceErrors, setResourceErrors] = useState({});
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [asset, setAsset] = useState({
    uri: '',
    name: '',
    type: 'application/pdf',
  });
  const [submissionText, setSubmissionText] = useState('');
  const [uploading, setUploading] = useState('');
  const [uploadMessage, setUploadMessage] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [submissionHistory, setSubmissionHistory] = useState({});
  const [historyLoading, setHistoryLoading] = useState('');
  const [historyErrors, setHistoryErrors] = useState({});
  const [applicationTitle, setApplicationTitle] = useState('');
  const [applicationMessage, setApplicationMessage] = useState('');
  const [applicationBusy, setApplicationBusy] = useState(false);
  const [applicationError, setApplicationError] = useState('');
  const [applicationNotice, setApplicationNotice] = useState('');
  const [selectedHomework, setSelectedHomework] = useState(null);
  const [homeworkDetailsLoading, setHomeworkDetailsLoading] = useState(false);
  const [homeworkDetailsError, setHomeworkDetailsError] = useState('');
  const requestVersion = useRef(0);
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
    const version = ++requestVersion.current;
    setLoading(true);
    setError('');
    setResourceErrors({});
    try {
      const names = requestedResources(page);
      const loaders = {
        profile: () => studentApi.getProfile(),
        timetable: () => studentApi.getTimetable(),
        attendance: () => studentApi.getAttendance(filters),
        results: () => studentApi.getResults(),
        progress: () => studentApi.getProgress(),
        homework: () => studentApi.getHomework(),
        applications: () => studentApi.getApplications(),
      };
      const requests = names.map(name => loaders[name]());
      const settled = await Promise.allSettled(requests);
      const nextRecords = {
        profile: null,
        timetable: [],
        attendance: [],
        results: [],
        progress: [],
        homework: [],
        applications: [],
      };
      const failures = {};
      settled.forEach((result, index) => {
        const name = names[index];
        if (result.status === 'fulfilled') {
          nextRecords[name] =
            name === 'profile' ? result.value : asList(result.value);
        } else {
          failures[name] =
            result.reason?.message || 'Could not load this section.';
        }
      });
      if (version !== requestVersion.current) return;
      setRecords(nextRecords);
      setResourceErrors(failures);
    } catch (loadError) {
      if (version === requestVersion.current) setError(loadError.message);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    if (previewOnly) return;
    loadDashboard({ from: '', to: '' });
    return () => {
      requestVersion.current += 1;
    };
  }, [loadDashboard, previewOnly]);

  async function submit(homeworkId) {
    if (previewOnly) return;
    setUploadError('');
    setUploadMessage('');
    const text = submissionText.trim();
    const hasFile = asset.uri.trim() || asset.name.trim();
    if (!text && !(asset.uri.trim() && asset.name.trim())) {
      setUploadError(
        'Enter submission text or provide both a file URI and filename.',
      );
      return;
    }
    if (text.length > 10000) {
      setUploadError('Submission text must be 10,000 characters or fewer.');
      return;
    }
    if (hasFile) {
      const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
      const extension = asset.name
        .trim()
        .toLowerCase()
        .match(/\.[^.]+$/)?.[0];
      const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png'];
      if (
        !allowedTypes.includes(asset.type) ||
        !allowedExtensions.includes(extension)
      ) {
        setUploadError(
          'Files must be PDF, JPEG, or PNG with a matching filename and MIME type.',
        );
        return;
      }
      if (asset.size != null && Number(asset.size) > 5 * 1024 * 1024) {
        setUploadError('Files must be 5 MB or smaller.');
        return;
      }
    }
    setUploading(homeworkId);
    try {
      const result = await studentApi.submitHomework(homeworkId, {
        ...asset,
        text,
        uri: asset.uri.trim(),
        name: asset.name.trim(),
      });
      setUploadMessage(`Submission saved. Status: ${result.status}.`);
      setSubmissionHistory(current => ({
        ...current,
        [homeworkId]: undefined,
      }));
      setSubmissionText('');
      setAsset({ uri: '', name: '', type: 'application/pdf' });
      await loadSubmissionHistory(homeworkId, true);
      await loadDashboard(dateRange);
      const details = await studentApi.getHomeworkDetails(homeworkId);
      setSelectedHomework(details);
    } catch (submitError) {
      setUploadError(submitError.message);
    } finally {
      setUploading('');
    }
  }

  async function chooseSubmissionFile() {
    setUploadError('');
    try {
      const [file] = await pick({
        type: ['application/pdf', 'image/jpeg', 'image/png'],
        allowMultiSelection: false,
        mode: 'import',
      });
      if (!file.hasRequestedType) {
        setUploadError('Choose a PDF, JPEG, or PNG file.');
        return;
      }
      if (file.size != null && file.size > 5 * 1024 * 1024) {
        setUploadError('Files must be 5 MB or smaller.');
        return;
      }
      if (!file.name || !file.type) {
        setUploadError('The selected file does not provide a filename or MIME type.');
        return;
      }
      setAsset({
        uri: file.uri,
        name: file.name,
        type: file.type,
        size: file.size,
      });
    } catch (pickerError) {
      if (
        !isErrorWithCode(pickerError) ||
        pickerError.code !== errorCodes.OPERATION_CANCELED
      ) {
        setUploadError('Could not open the file picker. Please try again.');
      }
    }
  }

  async function openHomework(item) {
    const homeworkId = item.id || String(item._id);
    setSelectedHomework(item);
    setHomeworkDetailsError('');
    setUploadError('');
    setUploadMessage('');
    if (previewOnly) return;
    setHomeworkDetailsLoading(true);
    try {
      const details = await studentApi.getHomeworkDetails(homeworkId);
      setSelectedHomework(details);
      await loadSubmissionHistory(homeworkId, true);
    } catch (detailsError) {
      setHomeworkDetailsError(detailsError.message);
    } finally {
      setHomeworkDetailsLoading(false);
    }
  }

  async function submitApplication() {
    if (previewOnly) return;
    setApplicationError('');
    setApplicationNotice('');
    const validation = validateApplicationDraft(
      applicationTitle,
      applicationMessage,
    );
    if (validation.error) {
      setApplicationError(validation.error);
      return;
    }
    setApplicationBusy(true);
    try {
      await studentApi.submitApplication(validation.value);
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

  async function loadSubmissionHistory(homeworkId, force = false) {
    if (previewOnly || (!force && submissionHistory[homeworkId])) return;
    setHistoryLoading(homeworkId);
    try {
      const history = await studentApi.getSubmissions(homeworkId);
      setSubmissionHistory(current => ({
        ...current,
        [homeworkId]: asList(history),
      }));
      setHistoryErrors(current => {
        const next = { ...current };
        delete next[homeworkId];
        return next;
      });
    } catch (historyError) {
      setHistoryErrors(current => ({
        ...current,
        [homeworkId]: historyError.message,
      }));
    } finally {
      setHistoryLoading('');
    }
  }

  const profileName =
    records.profile?.fullName || records.profile?.name || 'Student';
  return (
    <KeyboardAvoidingView
      style={styles.keyboard}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
    >
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          previewOnly ? undefined : (
            <RefreshControl
              refreshing={loading}
              onRefresh={() => loadDashboard(dateRange)}
              tintColor={colors.blue}
            />
          )
        }
      >
        <Text style={styles.eyebrow}>STUDENT PORTAL</Text>
        <Text style={styles.heading}>{profileName}</Text>
        {page === 'Homework' ? (
          <SchoolPageHero
            title="Practice for a brighter tomorrow"
            subtitle="Read your assignment, attach your work and track submissions."
            icon="homework"
          />
        ) : null}
        {page === 'Applications' ? (
          <SchoolPageHero
            title="Applications"
            subtitle="Send a request to your class teacher and follow its status."
            icon="file-pen"
          />
        ) : null}
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
        {resourceErrors.profile && page !== 'Profile' ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{resourceErrors.profile}</Text>
            <Pressable
              onPress={() => loadDashboard(dateRange)}
              style={styles.retry}
            >
              <Text style={styles.retryText}>Retry profile</Text>
            </Pressable>
          </View>
        ) : null}
        {previewOnly ? (
          <Text style={styles.previewNotice}>
            Design preview · sample records
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
        {!previewOnly && (page === 'Attendance' || page === 'All') ? (
          <Text style={styles.sectionTitle}>Attendance date range</Text>
        ) : null}
        {!previewOnly && (page === 'Attendance' || page === 'All') ? (
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

        {!loading ? (
          <>
            <Section
              activePage={page}
              title="Profile"
              empty="Your Student profile is not available."
              error={resourceErrors.profile}
              onRetry={() => loadDashboard(dateRange)}
            >
              {records.profile ? (
                <Record
                  title={records.profile.fullName || records.profile.name || 'Student'}
                  lines={[
                    records.profile.id && `Student ID: ${records.profile.id}`,
                    records.profile.grade && `Grade: ${records.profile.grade}`,
                    records.profile.section && `Section: ${records.profile.section}`,
                    records.profile.classId && `Class: ${records.profile.classId}`,
                    records.profile.status && `Status: ${records.profile.status}`,
                  ].filter(Boolean)}
                />
              ) : null}
            </Section>
            <Section
              activePage={page}
              title="Timetable"
              empty="No timetable entries are available."
              error={resourceErrors.timetable}
              onRetry={() => loadDashboard(dateRange)}
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
              activePage={page}
              title="Attendance"
              empty="No attendance records found for these dates."
              error={resourceErrors.attendance}
              onRetry={() => loadDashboard(dateRange)}
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
              activePage={page}
              title="Published results"
              empty="No results have been published for you."
              error={resourceErrors.results}
              onRetry={() => loadDashboard(dateRange)}
            >
              {visibleRecords.results.map(item => (
                <Record
                  key={item.id || item._id}
                  title={
                    item.examName || item.title || item.subject || 'Result'
                  }
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
            <Section
              activePage={page}
              title="Progress"
              empty="No progress records have been published for you."
              error={resourceErrors.progress}
              onRetry={() => loadDashboard(dateRange)}
            >
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
                      `Updated ${new Date(
                        item.updatedAt,
                      ).toLocaleDateString()}`,
                  ].filter(Boolean)}
                  feedback={item.teacherFeedback || item.feedback}
                />
              ))}
            </Section>
            <Section
              activePage={page}
              title="Homework"
              empty="No published homework is assigned to you."
            >
              {resourceErrors.homework ? (
                <Text style={styles.errorText}>{resourceErrors.homework}</Text>
              ) : null}
              {selectedHomework ? (
                <View style={styles.homeworkCard}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setSelectedHomework(null);
                      setSubmissionText('');
                      setAsset({ uri: '', name: '', type: 'application/pdf' });
                      setUploadError('');
                      setUploadMessage('');
                    }}
                    style={styles.historyButton}
                  >
                    <Text style={styles.historyButtonText}>‹ All homework</Text>
                  </Pressable>
                  {homeworkDetailsLoading ? (
                    <View style={styles.loading}>
                      <ActivityIndicator color={colors.blue} />
                      <Text style={styles.muted}>Loading homework details…</Text>
                    </View>
                  ) : null}
                  {homeworkDetailsError ? (
                    <View accessibilityRole="alert" style={styles.errorBox}>
                      <Text style={styles.errorText}>{homeworkDetailsError}</Text>
                      <Pressable
                        onPress={() => openHomework(selectedHomework)}
                        style={styles.retry}
                      >
                        <Text style={styles.retryText}>Retry details</Text>
                      </Pressable>
                    </View>
                  ) : null}
                  {(() => {
                    const item = selectedHomework;
                    const homeworkId = item.id || String(item._id);
                    const submission = item.latestSubmission;
                    const deadlinePassed = isPastDeadline(item.dueDate);
                    return (
                      <>
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
                        <Pressable
                          accessibilityRole="button"
                          disabled={historyLoading === homeworkId}
                          onPress={() => loadSubmissionHistory(homeworkId)}
                          style={styles.historyButton}
                        >
                          <Text style={styles.historyButtonText}>
                            {historyLoading === homeworkId
                              ? 'Loading history…'
                              : 'View submission history'}
                          </Text>
                        </Pressable>
                        {submissionHistory[homeworkId]?.map((entry, index) => (
                          <Text
                            key={
                              entry.id || entry._id || `${homeworkId}-${index}`
                            }
                            style={styles.cardLine}
                          >
                            {entry.status || 'submitted'} ·{' '}
                            {entry.submittedAt
                              ? new Date(entry.submittedAt).toLocaleString()
                              : 'Date unavailable'}
                            {entry.fileName ? ` · ${entry.fileName}` : ''}
                          </Text>
                        ))}
                        {historyErrors[homeworkId] ? (
                          <View style={styles.historyError}>
                            <Text style={styles.errorText}>
                              {historyErrors[homeworkId]}
                            </Text>
                            <Pressable
                              onPress={() => loadSubmissionHistory(homeworkId)}
                              style={styles.retry}
                            >
                              <Text style={styles.retryText}>
                                Retry history
                              </Text>
                            </Pressable>
                          </View>
                        ) : null}
                        <Text style={styles.uploadHint}>
                          Submit text, or one PDF, JPEG, or PNG file up to 5 MB.
                        </Text>
                        <TextInput
                          accessibilityLabel="Submission text"
                          value={submissionText}
                          onChangeText={setSubmissionText}
                          placeholder="Write your submission"
                          multiline
                          textAlignVertical="top"
                          style={[styles.input, styles.multiline]}
                          placeholderTextColor={colors.muted}
                        />
                        <Pressable
                          accessibilityRole="button"
                          disabled={!!submission || deadlinePassed}
                          onPress={chooseSubmissionFile}
                          style={styles.filePicker}
                        >
                          <Text style={styles.filePickerText}>
                            {asset.name || 'Choose PDF, JPEG, or PNG'}
                          </Text>
                          {asset.size != null ? (
                            <Text style={styles.cardLine}>
                              {(asset.size / 1024 / 1024).toFixed(2)} MB
                            </Text>
                          ) : null}
                        </Pressable>
                        {asset.uri ? (
                          <Pressable
                            accessibilityRole="button"
                            onPress={() =>
                              setAsset({ uri: '', name: '', type: 'application/pdf' })
                            }
                            style={styles.retry}
                          >
                            <Text style={styles.retryText}>Remove attachment</Text>
                          </Pressable>
                        ) : null}
                        {deadlinePassed && !submission ? (
                          <Text accessibilityRole="alert" style={styles.errorText}>
                            The submission deadline has passed.
                          </Text>
                        ) : null}
                        <Pressable
                          accessibilityRole="button"
                          disabled={
                            uploading === homeworkId ||
                            !!submission ||
                            deadlinePassed
                          }
                          onPress={() => submit(homeworkId)}
                          style={[
                            styles.button,
                            uploading === homeworkId && styles.disabled,
                          ]}
                        >
                          <Text style={styles.buttonText}>
                            {uploading === homeworkId
                              ? 'Uploading…'
                              : submission
                              ? 'Already submitted'
                              : 'Submit homework'}
                          </Text>
                        </Pressable>
                      </>
                    ) : (
                      <Text style={styles.uploadHint}>
                        Submission controls are disabled in this preview.
                      </Text>
                    )}
                      </>
                    );
                  })()}
                </View>
              ) : (
                visibleRecords.homework.map(item => {
                  const homeworkId = item.id || String(item._id);
                  const submission = item.latestSubmission;
                  return (
                    <Pressable
                      key={homeworkId}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${item.title || item.subject || 'homework'}`}
                      onPress={() => openHomework(item)}
                      style={styles.homeworkCard}
                    >
                      <Record
                        title={item.title || item.subject || 'Homework'}
                        lines={[
                          item.subject,
                          item.dueDate && `Due ${String(item.dueDate).slice(0, 10)}`,
                        ].filter(Boolean)}
                        status={submission?.status || (isPastDeadline(item.dueDate) ? 'Closed' : 'Not submitted')}
                      />
                    </Pressable>
                  );
                })
              )}
            </Section>
            {!previewOnly && (page === 'Applications' || page === 'All') ? (
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
                  maxLength={APPLICATION_TITLE_LIMIT}
                  placeholder="Application subject"
                  autoCapitalize="sentences"
                />
                <TextInput
                  accessibilityLabel="Application message"
                  value={applicationMessage}
                  onChangeText={setApplicationMessage}
                  maxLength={APPLICATION_MESSAGE_LIMIT}
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
                  activePage={page}
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
                activePage={page}
                title="Application history"
                empty="No preview applications."
              >
                {records.applications.map(item => (
                  <Record
                    key={item.id}
                    title={item.title}
                    status={item.status}
                  />
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboard: { flex: 1 },
  page: { flex: 1, backgroundColor: colors.pale },
  content: { padding: 18, paddingBottom: 30 },
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
    borderRadius: 18,
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
    backgroundColor: '#FFFEFA',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 15,
    minHeight: 48,
    paddingHorizontal: 10,
    color: colors.ink,
    fontSize: 12,
  },
  multiline: { minHeight: 100, paddingTop: 10, marginBottom: 10 },
  button: {
    backgroundColor: colors.blue,
    minHeight: 50,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 15,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  buttonText: { color: '#FFFEFA', fontWeight: '800', fontSize: 12 },
  disabled: { opacity: 0.55 },
  historyButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 15,
    backgroundColor: '#EEF0FF',
    marginBottom: 10,
  },
  historyButtonText: { color: colors.blue, fontWeight: '800' },
  empty: {
    backgroundColor: '#FFFEFA',
    color: colors.muted,
    borderRadius: 11,
    padding: 13,
    fontSize: 12,
  },
  card: {
    backgroundColor: '#FFFEFA',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 22,
    padding: 18,
    marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  cardTitle: { color: colors.ink, fontSize: 15, fontWeight: '800', flex: 1 },
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
  historyError: { marginBottom: 8 },
  filePicker: {
    borderWidth: 1,
    borderColor: colors.blue,
    borderRadius: 15,
    padding: 14,
    marginBottom: 8,
    backgroundColor: '#F4F5FF',
  },
  filePickerText: { color: colors.blue, fontWeight: '800', fontSize: 12 },
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
