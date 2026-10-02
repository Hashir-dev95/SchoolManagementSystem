import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { parentApi } from './parentService';
import { parentPreview, previewNotifications } from './previewData';

const colors = {
  ink: '#282940',
  muted: '#92918A',
  blue: '#4857B5',
  pale: '#FFF9EF',
  line: '#E6E2D7',
  green: '#168A62',
  red: '#B42318',
};

function Empty({ children }) {
  return <Text style={styles.empty}>{children}</Text>;
}

function DataCard({ title, lines = [], status, feedback }) {
  return (
    <View style={styles.dataCard}>
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

function Section({ title, activePage, records, empty, render }) {
  const sectionPage = {
    Timetable: 'Learning',
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
    !(activePage === 'Timetable' && title === 'Timetable')
  )
    return null;
  return (
    <View>
      <Text style={styles.sectionTitle}>{title}</Text>
      {records.length ? records.map(render) : <Empty>{empty}</Empty>}
    </View>
  );
}

function money(amount, currency = 'PKR') {
  return `${currency} ${Number(amount || 0).toLocaleString()}`;
}

export default function ParentDashboard({
  previewOnly = false,
  searchQuery = '',
  page = 'All',
  initialChildId = '',
}) {
  const [children, setChildren] = useState(
    previewOnly ? parentPreview.children : [],
  );
  const [selectedChildId, setSelectedChildId] = useState(
    previewOnly
      ? initialChildId || parentPreview.children[0].id
      : initialChildId,
  );
  const [childRecords, setChildRecords] = useState(
    previewOnly
      ? parentPreview.records[initialChildId || parentPreview.children[0].id]
      : null,
  );
  const [childrenLoading, setChildrenLoading] = useState(!previewOnly);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [childrenError, setChildrenError] = useState('');
  const [recordsError, setRecordsError] = useState('');
  const [notifications, setNotifications] = useState(
    previewOnly ? previewNotifications : [],
  );
  const [notificationsLoading, setNotificationsLoading] = useState(
    !previewOnly,
  );
  const [notificationsError, setNotificationsError] = useState('');
  const [openedDlp, setOpenedDlp] = useState(null);
  const [dlpLoadingId, setDlpLoadingId] = useState('');
  const [dlpError, setDlpError] = useState('');
  const [applicationTitle, setApplicationTitle] = useState('');
  const [applicationMessage, setApplicationMessage] = useState('');
  const [applicationBusy, setApplicationBusy] = useState(false);
  const [applicationError, setApplicationError] = useState('');
  const [applicationNotice, setApplicationNotice] = useState('');
  const requestVersion = useRef(0);
  const childrenVersion = useRef(0);
  const notificationVersion = useRef(0);

  const loadChild = useCallback(
    async (childId) => {
      if (previewOnly) {
        setSelectedChildId(childId);
        setChildRecords(parentPreview.records[childId] || null);
        return;
      }
      const version = ++requestVersion.current;
      notificationVersion.current += 1;
      setOpenedDlp(null);
      setDlpError('');
      setDlpLoadingId('');
      setApplicationTitle('');
      setApplicationMessage('');
      setApplicationNotice('');
      setApplicationError('');
      setSelectedChildId(childId);
      setChildRecords(null);
      setRecordsError('');
      setRecordsLoading(true);
      try {
        const [
          profile,
          attendance,
          timetable,
          homework,
          results,
          fees,
          feedback,
          applications,
        ] = await Promise.all([
          parentApi.getChild(childId),
          parentApi.getAttendance(childId),
          parentApi.getTimetable(childId),
          parentApi.getHomework(childId),
          parentApi.getResults(childId),
          parentApi.getFees(childId),
          parentApi.getFeedback(childId),
          parentApi.getApplications(childId),
        ]);
        if (version !== requestVersion.current) return;
        setChildRecords({
          profile,
          attendance,
          timetable,
          homework,
          results,
          fees,
          feedback,
          applications,
        });
      } catch (error) {
        if (version === requestVersion.current) setRecordsError(error.message);
      } finally {
        if (version === requestVersion.current) setRecordsLoading(false);
      }
    },
    [previewOnly],
  );

  const loadNotifications = useCallback(async () => {
    if (previewOnly) return;
    const version = ++notificationVersion.current;
    setNotificationsLoading(true);
    setNotificationsError('');
    try {
      const data = await parentApi.getNotifications();
      if (version === notificationVersion.current)
        setNotifications(data.notifications || []);
    } catch (error) {
      if (version === notificationVersion.current)
        setNotificationsError(error.message);
    } finally {
      if (version === notificationVersion.current)
        setNotificationsLoading(false);
    }
  }, [previewOnly]);

  const openDlp = useCallback(
    async (notificationId) => {
      if (previewOnly) return;
      const version = ++notificationVersion.current;
      setOpenedDlp(null);
      setDlpError('');
      setDlpLoadingId(notificationId);
      try {
        await parentApi.markNotificationRead(notificationId);
        const data = await parentApi.openNotification(notificationId);
        if (version === notificationVersion.current) setOpenedDlp(data);
      } catch (error) {
        if (version === notificationVersion.current) setDlpError(error.message);
      } finally {
        if (version === notificationVersion.current) setDlpLoadingId('');
      }
    },
    [previewOnly],
  );

  async function submitApplication() {
    if (previewOnly) return;
    if (!selectedChildId) return;
    setApplicationError('');
    setApplicationNotice('');
    setApplicationBusy(true);
    try {
      await parentApi.submitApplication(selectedChildId, {
        title: applicationTitle,
        message: applicationMessage,
      });
      setApplicationTitle('');
      setApplicationMessage('');
      setApplicationNotice(
        'Application sent to the selected child’s assigned class teacher.',
      );
      await loadChild(selectedChildId);
    } catch (error) {
      setApplicationError(error.message);
    } finally {
      setApplicationBusy(false);
    }
  }

  const loadChildren = useCallback(async () => {
    if (previewOnly) return;
    const version = ++childrenVersion.current;
    setChildrenLoading(true);
    setChildrenError('');
    try {
      const data = await parentApi.getChildren();
      if (version !== childrenVersion.current) return;
      setChildren(data);
      if (data.length)
        await loadChild(
          data.find((child) => child.id === initialChildId)?.id || data[0].id,
        );
      else {
        setSelectedChildId('');
        setChildRecords(null);
      }
    } catch (error) {
      if (version === childrenVersion.current) setChildrenError(error.message);
    } finally {
      if (version === childrenVersion.current) setChildrenLoading(false);
    }
  }, [loadChild, previewOnly, initialChildId]);

  useEffect(() => {
    if (previewOnly) return;
    loadChildren();
    loadNotifications();
    return () => {
      requestVersion.current += 1;
      childrenVersion.current += 1;
      notificationVersion.current += 1;
    };
  }, [loadChildren, loadNotifications, previewOnly]);

  const selectedChild = children.find((child) => child.id === selectedChildId);
  const visibleChildren =
    previewOnly && searchQuery.trim()
      ? children.filter((child) =>
          JSON.stringify(child)
            .toLowerCase()
            .includes(searchQuery.trim().toLowerCase()),
        )
      : children;
  const visibleChildRecords = React.useMemo(() => {
    if (!previewOnly || !childRecords || !searchQuery.trim())
      return childRecords;
    const query = searchQuery.trim().toLowerCase();
    const matches = (item) =>
      JSON.stringify(item).toLowerCase().includes(query);
    return {
      ...childRecords,
      attendance: childRecords.attendance.filter(matches),
      timetable: childRecords.timetable.filter(matches),
      homework: childRecords.homework.filter(matches),
      results: childRecords.results.filter(matches),
      fees: childRecords.fees.filter(matches),
      feedback: {
        homework: childRecords.feedback.homework.filter(matches),
        results: childRecords.feedback.results.filter(matches),
        progress: childRecords.feedback.progress.filter(matches),
      },
    };
  }, [childRecords, previewOnly, searchQuery]);

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>FAMILY PORTAL</Text>
      <Text style={styles.heading}>Parent dashboard</Text>
      <Text style={styles.subtitle}>
        Only verified linked children are shown.
      </Text>
      {previewOnly ? (
        <Text style={styles.previewNotice}>
          Design preview · sample records
        </Text>
      ) : null}

      <View style={styles.headingRow}>
        <Text style={styles.sectionTitle}>Your children</Text>
        {!previewOnly ? (
          <Pressable accessibilityRole="button" onPress={loadChildren}>
            <Text style={styles.refresh}>Refresh</Text>
          </Pressable>
        ) : null}
      </View>
      {childrenLoading && children.length === 0 ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.blue} />
          <Text style={styles.muted}>Loading verified children…</Text>
        </View>
      ) : null}
      {childrenError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{childrenError}</Text>
          <Pressable accessibilityRole="button" onPress={loadChildren}>
            <Text style={styles.refresh}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      {!childrenLoading && !childrenError && children.length === 0 ? (
        <Empty>No verified children are linked to this parent account.</Empty>
      ) : null}

      {page === 'Inbox' && (
        <>
          {' '}
          <View style={styles.headingRow}>
            <Text style={styles.sectionTitle}>
              {previewOnly
                ? 'Preview notifications'
                : 'Parent DLP notifications'}
            </Text>
            {!previewOnly ? (
              <Pressable accessibilityRole="button" onPress={loadNotifications}>
                <Text style={styles.refresh}>Refresh</Text>
              </Pressable>
            ) : null}
          </View>
          {notificationsLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.blue} />
              <Text style={styles.muted}>Loading notifications…</Text>
            </View>
          ) : null}
          {notificationsError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{notificationsError}</Text>
              <Pressable accessibilityRole="button" onPress={loadNotifications}>
                <Text style={styles.refresh}>Retry notifications</Text>
              </Pressable>
            </View>
          ) : null}
          {!notificationsLoading &&
          !notificationsError &&
          notifications.length === 0 ? (
            <Empty>No Parent DLP notifications are available.</Empty>
          ) : null}
          {notifications.map((item) => (
            <Pressable
              key={item.id || item._id}
              accessibilityRole="button"
              disabled={!!dlpLoadingId}
              onPress={() => openDlp(item.id || String(item._id))}
              style={styles.childCard}
            >
              <Text style={styles.childName}>
                {item.title || 'Parent DLP shared'}
              </Text>
              <Text style={styles.cardLine}>
                {previewOnly
                  ? 'Fictional notification · preview only'
                  : `${
                      item.createdAt
                        ? new Date(item.createdAt).toLocaleString()
                        : ''
                    } · Open shared class version`}
              </Text>
              {dlpLoadingId === (item.id || String(item._id)) ? (
                <ActivityIndicator color={colors.blue} />
              ) : null}
            </Pressable>
          ))}
          {dlpError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{dlpError}</Text>
            </View>
          ) : null}
          {openedDlp ? (
            <View style={styles.dataCard}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>
                  {openedDlp.dlpVersion.title ||
                    openedDlp.notification.title ||
                    'Parent DLP'}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    notificationVersion.current += 1;
                    setOpenedDlp(null);
                  }}
                >
                  <Text style={styles.refresh}>Close</Text>
                </Pressable>
              </View>
              <Text style={styles.cardLine}>
                Class:{' '}
                {openedDlp.dlpVersion.className || openedDlp.dlpVersion.classId}{' '}
                · Version:{' '}
                {openedDlp.dlpVersion.version ||
                  openedDlp.dlpVersion.versionNumber ||
                  openedDlp.dlpVersion.id}
              </Text>
              {typeof openedDlp.dlpVersion.content === 'string' ? (
                <Text style={styles.cardLine}>
                  {openedDlp.dlpVersion.content}
                </Text>
              ) : null}
              {Array.isArray(openedDlp.dlpVersion.sections)
                ? openedDlp.dlpVersion.sections.map((section, index) => (
                    <View key={section.id || index}>
                      <Text style={styles.childName}>
                        {section.title || section.heading}
                      </Text>
                      <Text style={styles.cardLine}>
                        {section.content || section.body || ''}
                      </Text>
                    </View>
                  ))
                : null}
              {!openedDlp.dlpVersion.content &&
              !openedDlp.dlpVersion.sections?.length ? (
                <Text style={styles.cardLine}>
                  The published version is loaded, but has no displayable
                  content fields.
                </Text>
              ) : null}
            </View>
          ) : null}
        </>
      )}
      {visibleChildren.map((child) => {
        const selected = child.id === selectedChildId;
        return (
          <Pressable
            key={child.id}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => (selected ? null : loadChild(child.id))}
            style={[styles.childCard, selected && styles.selectedChild]}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.childName}>
                {child.fullName || child.name || 'Child'}
              </Text>
              <Text style={[styles.status, selected && styles.selectedLabel]}>
                {selected ? 'Selected' : 'View records'}
              </Text>
            </View>
            <Text style={styles.cardLine}>
              {[child.grade, child.section && `Section ${child.section}`]
                .filter(Boolean)
                .join(' · ') || 'Student record'}
            </Text>
          </Pressable>
        );
      })}

      {selectedChild ? (
        <>
          <Text style={styles.sectionTitle}>
            {selectedChild.fullName || selectedChild.name || 'Selected child'} ·
            records
          </Text>
          {recordsLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.blue} />
              <Text style={styles.muted}>Loading this child’s records…</Text>
            </View>
          ) : null}
          {recordsError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{recordsError}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => loadChild(selectedChild.id)}
              >
                <Text style={styles.refresh}>Retry selected child</Text>
              </Pressable>
            </View>
          ) : null}
          {!recordsLoading && !recordsError && childRecords ? (
            <>
              <Section
                activePage={page}
                title="Attendance"
                records={visibleChildRecords.attendance}
                empty="No attendance records are available."
                render={(item) => (
                  <DataCard
                    key={item.id || item._id}
                    title={
                      item.date
                        ? new Date(item.date).toLocaleDateString()
                        : 'Attendance'
                    }
                    lines={[item.subject, item.note].filter(Boolean)}
                    status={item.status}
                  />
                )}
              />
              <Section
                activePage={page}
                title="Timetable"
                records={visibleChildRecords.timetable}
                empty="No timetable entries are available."
                render={(item) => (
                  <DataCard
                    key={item.id || item._id}
                    title={item.subject || item.course || 'Class'}
                    lines={[
                      item.day || item.dayOfWeek,
                      [item.startTime, item.endTime]
                        .filter(Boolean)
                        .join(' – '),
                      item.room,
                      item.teacher,
                    ].filter(Boolean)}
                  />
                )}
              />
              <Section
                activePage={page}
                title="Homework"
                records={visibleChildRecords.homework}
                empty="No published homework is assigned."
                render={(item) => (
                  <DataCard
                    key={item.id || item._id}
                    title={item.title || item.subject || 'Homework'}
                    lines={[
                      item.description,
                      item.subject,
                      item.dueDate &&
                        `Due ${String(item.dueDate).slice(0, 10)}`,
                    ].filter(Boolean)}
                    status="Published"
                  />
                )}
              />
              <Section
                activePage={page}
                title="Published results"
                records={visibleChildRecords.results}
                empty="No results have been published."
                render={(item) => (
                  <DataCard
                    key={item.id || item._id}
                    title={
                      item.examName || item.title || item.subject || 'Result'
                    }
                    lines={[
                      item.subject,
                      item.score != null && `Score: ${item.score}`,
                      item.grade && `Grade: ${item.grade}`,
                    ].filter(Boolean)}
                    feedback={item.teacherFeedback || item.feedback}
                  />
                )}
              />
              <Section
                activePage={page}
                title="Fees"
                records={visibleChildRecords.fees}
                empty="No fee records are available."
                render={(item) => (
                  <DataCard
                    key={item.id || item._id}
                    title={item.description || item.id || 'Fee'}
                    lines={[
                      `Amount: ${money(item.amount, item.currency)}`,
                      `Confirmed paid: ${money(
                        item.confirmedPaidAmount,
                        item.currency,
                      )}`,
                      item.dueDate &&
                        `Due ${String(item.dueDate).slice(0, 10)}`,
                    ].filter(Boolean)}
                    status={item.status}
                  />
                )}
              />
              {(page === 'Progress' ||
                page === 'My children' ||
                page === 'All') && (
                <>
                  <Text style={styles.sectionTitle}>Teacher feedback</Text>
                  {visibleChildRecords.feedback.homework.length +
                    visibleChildRecords.feedback.results.length +
                    visibleChildRecords.feedback.progress.length ===
                  0 ? (
                    <Empty>No teacher feedback is available.</Empty>
                  ) : null}
                  {visibleChildRecords.feedback.homework.map((item) => (
                    <DataCard
                      key={`homework-${item.id || item._id}`}
                      title={
                        item.homework?.title ||
                        item.homeworkId ||
                        'Homework feedback'
                      }
                      lines={[
                        item.status,
                        item.submittedAt &&
                          `Submitted ${new Date(
                            item.submittedAt,
                          ).toLocaleDateString()}`,
                      ].filter(Boolean)}
                      feedback={item.teacherFeedback || item.feedback}
                    />
                  ))}
                  {visibleChildRecords.feedback.results.map((item) => (
                    <DataCard
                      key={`result-${item.id || item._id}`}
                      title={
                        item.examName ||
                        item.title ||
                        item.subject ||
                        'Result feedback'
                      }
                      feedback={item.teacherFeedback || item.feedback}
                    />
                  ))}
                  {visibleChildRecords.feedback.progress.map((item) => (
                    <DataCard
                      key={`progress-${item.id || item._id}`}
                      title={item.subject || item.title || 'Progress feedback'}
                      feedback={item.teacherFeedback || item.feedback}
                    />
                  ))}
                </>
              )}
              {previewOnly && page === 'Applications' ? (
                <View style={styles.dataCard}>
                  <Text style={styles.cardTitle}>Applications</Text>
                  <Text style={styles.cardLine}>
                    Sign in with a linked Parent account to send an application
                    to your child’s class teacher.
                  </Text>
                </View>
              ) : null}
              {!previewOnly && (page === 'Applications' || page === 'All') ? (
                <>
                  <Text style={styles.sectionTitle}>
                    Applications to class teacher
                  </Text>
                  <Text style={styles.muted}>
                    This application is routed by the selected child’s verified
                    class assignment.
                  </Text>
                  <Text style={styles.label}>Subject</Text>
                  <TextInput
                    accessibilityLabel="Application subject"
                    value={applicationTitle}
                    onChangeText={setApplicationTitle}
                    placeholder="Application subject"
                    style={styles.input}
                    placeholderTextColor={colors.muted}
                  />
                  <Text style={styles.label}>Message</Text>
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
                    disabled={applicationBusy || recordsLoading}
                    onPress={submitApplication}
                    style={styles.actionButton}
                  >
                    <Text style={styles.actionText}>
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
                    records={childRecords.applications}
                    empty="No applications have been sent for this child."
                    render={(item) => (
                      <View key={item.id || item._id} style={styles.dataCard}>
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
                    )}
                  />
                </>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
  headingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: '800',
    marginTop: 22,
    marginBottom: 10,
  },
  refresh: { color: colors.blue, fontWeight: '800', fontSize: 12 },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 17,
  },
  muted: { color: colors.muted, fontSize: 12 },
  errorBox: {
    backgroundColor: '#FFF0EF',
    borderRadius: 18,
    padding: 13,
    marginVertical: 8,
  },
  errorText: { color: colors.red, fontSize: 12, lineHeight: 18 },
  empty: {
    color: colors.muted,
    backgroundColor: '#FFFEFA',
    borderRadius: 11,
    padding: 13,
    fontSize: 12,
    marginBottom: 7,
  },
  childCard: {
    backgroundColor: '#FFFEFA',
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 13,
    padding: 14,
    marginBottom: 9,
  },
  selectedChild: { borderColor: colors.blue, borderWidth: 2 },
  selectedLabel: { color: colors.blue },
  childName: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  status: {
    color: colors.green,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  cardLine: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 5 },
  dataCard: {
    backgroundColor: '#FFFEFA',
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 18,
    padding: 13,
    marginBottom: 8,
  },
  cardTitle: { color: colors.ink, fontSize: 13, fontWeight: '800', flex: 1 },
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
    lineHeight: 17,
    marginTop: 4,
  },
  input: {
    backgroundColor: '#FFFEFA',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    minHeight: 42,
    paddingHorizontal: 10,
    color: colors.ink,
    fontSize: 12,
    marginBottom: 10,
  },
  multiline: { minHeight: 100, paddingTop: 10 },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 5,
  },
  actionButton: {
    backgroundColor: colors.blue,
    minHeight: 43,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  actionText: { color: '#FFFEFA', fontWeight: '800', fontSize: 12 },
  successText: { color: colors.green, fontSize: 12, marginVertical: 7 },
});
