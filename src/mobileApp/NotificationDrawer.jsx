import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  ActivityIndicator,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { financeApi } from './financeService';
import { parentApi } from './parentService';
import { studentApi } from './studentService';

const palette = {
  ink: '#14243A',
  muted: '#69788C',
  blue: '#246BFD',
  line: '#E3EAF3',
  pale: '#F2F6FC',
  red: '#B42318',
};

const apiForRole = {
  Student: studentApi,
  Parent: parentApi,
  Finance: financeApi,
};

function notificationId(item) {
  return item.id || String(item._id || '');
}

function Details({ value }) {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number') {
    return <Text style={styles.detailText}>{String(value)}</Text>;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => (
      <View key={item?.id || index} style={styles.detailSection}>
        {item?.title || item?.heading ? (
          <Text style={styles.detailTitle}>{item.title || item.heading}</Text>
        ) : null}
        <Details value={item?.content || item?.body || item} />
      </View>
    ));
  }
  const lines = Object.entries(value).filter(
    ([key, item]) =>
      !['_id', 'fileData', 'recipientUserId', 'parentUserId'].includes(key) &&
      item != null &&
      typeof item !== 'object',
  );
  return lines.map(([key, item]) => (
    <Text key={key} style={styles.detailText}>
      {key.replace(/([A-Z])/g, ' $1')}: {String(item)}
    </Text>
  ));
}

export default function NotificationDrawer({ role }) {
  const [visible, setVisible] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [openingId, setOpeningId] = useState('');
  const requestVersion = useRef(0);
  const drawerWidth = Math.min(Dimensions.get('window').width * 0.84, 340);
  const slideX = useRef(new Animated.Value(-drawerWidth)).current;
  const api = apiForRole[role];

  useEffect(() => {
    if (visible) {
      slideX.setValue(-drawerWidth);
      Animated.timing(slideX, {
        toValue: 0,
        duration: 210,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, drawerWidth, slideX]);

  const loadNotifications = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError('');
    try {
      const response = await api.getNotifications();
      if (version !== requestVersion.current) return;
      setNotifications(response.notifications || []);
      setUnreadCount(Number(response.unreadCount) || 0);
    } catch (loadError) {
      if (version === requestVersion.current) setError(loadError.message);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    setSelected(null);
    setNotifications([]);
    setUnreadCount(0);
    loadNotifications();
    return () => {
      requestVersion.current += 1;
    };
  }, [loadNotifications]);

  const openNotification = useCallback(
    async item => {
      const id = notificationId(item);
      if (!id) return;
      const version = ++requestVersion.current;
      setOpeningId(id);
      setSelected(null);
      setError('');
      try {
        await api.markNotificationRead(id);
        const record = await api.getNotification(id);
        if (version !== requestVersion.current) return;
        setSelected(record);
        setNotifications(current =>
          current.map(notification =>
            notificationId(notification) === id
              ? { ...notification, readAt: new Date().toISOString() }
              : notification,
          ),
        );
        setUnreadCount(current => Math.max(0, current - (item.readAt ? 0 : 1)));
      } catch (openError) {
        if (version === requestVersion.current) setError(openError.message);
      } finally {
        if (version === requestVersion.current) setOpeningId('');
      }
    },
    [api],
  );

  const detail =
    selected?.dlpVersion ||
    selected?.record ||
    selected?.notification ||
    selected;
  const title =
    detail?.title ||
    detail?.subject ||
    selected?.notification?.title ||
    'Notification';
  const exactVersion = selected?.dlpVersion;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${role} notifications, ${unreadCount} unread`}
        onPress={() => {
          setSelected(null);
          setVisible(true);
          loadNotifications();
        }}
        style={styles.trigger}
      >
        <Text style={styles.dots}>⋮</Text>
        {unreadCount > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </Text>
          </View>
        ) : null}
      </Pressable>
      <Modal
        visible={visible}
        transparent
        animationType="none"
        onRequestClose={() => setVisible(false)}
      >
        <View style={styles.scrim}>
          <Animated.View
            style={[
              styles.drawer,
              { width: drawerWidth, transform: [{ translateX: slideX }] },
            ]}
          >
            <View style={styles.header}>
              <View>
                <Text style={styles.heading}>Notifications</Text>
                <Text style={styles.subtitle}>
                  {unreadCount} unread · {role}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close notifications"
                onPress={() => setVisible(false)}
                style={styles.close}
              >
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
            {selected ? (
              <ScrollView contentContainerStyle={styles.body}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setSelected(null)}
                  style={styles.back}
                >
                  <Text style={styles.backText}>‹ All notifications</Text>
                </Pressable>
                <Text style={styles.detailTitle}>{title}</Text>
                {exactVersion ? (
                  <Text style={styles.subtitle}>
                    Class {exactVersion.className || exactVersion.classId} ·
                    Version{' '}
                    {exactVersion.version ||
                      exactVersion.versionNumber ||
                      exactVersion.id}
                  </Text>
                ) : null}
                <Details
                  value={detail?.content || detail?.sections || detail}
                />
                {selected?.targetType || selected?.targetId ? (
                  <View style={styles.reference}>
                    <Text style={styles.referenceText}>
                      Record: {selected.targetType || 'school record'} ·{' '}
                      {selected.targetId || selected.recordId}
                    </Text>
                    {selected.recordSnapshot ? (
                      <Details value={selected.recordSnapshot} />
                    ) : null}
                  </View>
                ) : null}
              </ScrollView>
            ) : (
              <ScrollView contentContainerStyle={styles.body}>
                <Pressable
                  accessibilityRole="button"
                  onPress={loadNotifications}
                  style={styles.refresh}
                >
                  <Text style={styles.refreshText}>Refresh</Text>
                </Pressable>
                {loading ? <ActivityIndicator color={palette.blue} /> : null}
                {error ? (
                  <Text accessibilityRole="alert" style={styles.error}>
                    {error}
                  </Text>
                ) : null}
                {!loading && !error && notifications.length === 0 ? (
                  <Text style={styles.empty}>No notifications yet.</Text>
                ) : null}
                {notifications.map(item => {
                  const id = notificationId(item);
                  return (
                    <Pressable
                      key={id}
                      accessibilityRole="button"
                      disabled={!!openingId}
                      onPress={() => openNotification(item)}
                      style={styles.item}
                    >
                      <View
                        style={[
                          styles.unreadDot,
                          item.readAt && styles.readDot,
                        ]}
                      />
                      <View style={styles.itemCopy}>
                        <Text style={styles.itemTitle} numberOfLines={2}>
                          {item.title || item.subject || 'Notification'}
                        </Text>
                        <Text style={styles.itemBody} numberOfLines={2}>
                          {item.body ||
                            item.message ||
                            item.preview ||
                            (item.type === 'parent_dlp_shared'
                              ? 'A Parent DLP version was shared for your class.'
                              : 'Open the exact linked record.')}
                        </Text>
                        <Text style={styles.itemDate}>
                          {item.createdAt
                            ? new Date(item.createdAt).toLocaleString()
                            : 'Date unavailable'}
                        </Text>
                      </View>
                      {openingId === id ? (
                        <ActivityIndicator color={palette.blue} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </Animated.View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close notifications drawer"
            onPress={() => setVisible(false)}
            style={styles.dismissArea}
          />
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, flexDirection: 'row', backgroundColor: '#14243A88' },
  drawer: {
    width: '84%',
    maxWidth: 340,
    height: '100%',
    backgroundColor: palette.pale,
    paddingTop: 24,
    paddingHorizontal: 16,
  },
  dismissArea: { flex: 1 },
  trigger: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: palette.line,
  },
  dots: { color: palette.ink, fontSize: 25, lineHeight: 27, fontWeight: '800' },
  badge: {
    position: 'absolute',
    right: -5,
    top: -5,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: palette.red,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
    marginBottom: 10,
  },
  heading: { color: palette.ink, fontSize: 20, fontWeight: '800' },
  subtitle: { color: palette.muted, fontSize: 11, marginTop: 4 },
  close: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
  },
  closeText: { color: palette.ink, fontSize: 24, lineHeight: 26 },
  body: { paddingBottom: 24 },
  refresh: { alignSelf: 'flex-end', padding: 8 },
  refreshText: { color: palette.blue, fontSize: 12, fontWeight: '800' },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 12,
    padding: 11,
    marginBottom: 8,
  },
  unreadDot: {
    width: 8,
    height: 8,
    marginTop: 4,
    borderRadius: 4,
    backgroundColor: palette.blue,
  },
  readDot: { backgroundColor: '#CAD3DF' },
  itemCopy: { flex: 1 },
  itemTitle: { color: palette.ink, fontSize: 12, fontWeight: '800' },
  itemBody: {
    color: palette.muted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 4,
  },
  itemDate: { color: palette.muted, fontSize: 9, marginTop: 5 },
  empty: {
    color: palette.muted,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    fontSize: 12,
  },
  error: { color: palette.red, fontSize: 12, lineHeight: 17, marginBottom: 10 },
  back: { paddingVertical: 9 },
  backText: { color: palette.blue, fontSize: 12, fontWeight: '800' },
  detailTitle: {
    color: palette.ink,
    fontSize: 17,
    fontWeight: '800',
    marginTop: 8,
    marginBottom: 7,
  },
  detailSection: {
    borderTopWidth: 1,
    borderColor: palette.line,
    paddingVertical: 9,
  },
  detailText: {
    color: palette.ink,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 7,
  },
  reference: {
    borderTopWidth: 1,
    borderColor: palette.line,
    marginTop: 12,
    paddingTop: 8,
  },
  referenceText: { color: palette.muted, fontSize: 10 },
});
