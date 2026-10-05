import PageIcon from './PageIcon';
import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  AppState,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import NotificationDrawer from './NotificationDrawer';
import RoleDashboard from './RoleDashboard';
import HiraHome from './HiraHome';
import FeaturePage from './FeaturePage';
import { features, staffFeatures } from './featureScreens';
import { theme as t, rolePages, bottomPages } from './hiraTheme';
import { checkSessionExpiry, subscribeSessionExpiry } from './authSession';
import { validateSession } from './authService';

const roles = Object.keys(rolePages);
const roleNames = {
  parent: 'Parent',
  student: 'Student',
  finance: 'Finance',
  teacher: 'Teacher',
  principal: 'Principal',
  superadmin: 'Super Admin',
  'super admin': 'Super Admin',
  super_admin: 'Super Admin',
};
const ownedRoles = ['Parent', 'Student', 'Finance'];
function getGreeting(hour = new Date().getHours()) {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  return 'Good evening';
}
function Button({ children, onPress, style, label }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label || children}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        style,
        pressed && { opacity: 0.75, transform: [{ scale: 0.97 }] },
      ]}
    >
      <Text style={s.buttonText}>{children}</Text>
    </Pressable>
  );
}

/** Authenticated production shell. Role switching is only available in explicit development preview. */
/** @param {{authState?: any, authLoading?: boolean, onLogout?: (() => void|Promise<void>), developmentPreview?: boolean, roleScreens?: object, featureProviders?: object}} props */
export default function MobileApp({
  authState = null,
  authLoading = false,
  onLogout = undefined,
  developmentPreview = false,
  roleScreens = {},
  featureProviders = {},
}) {
  const previewOnly =
    developmentPreview && typeof __DEV__ !== 'undefined' && __DEV__;
  const [previewRole, setPreviewRole] = useState('Parent');
  const [page, setPage] = useState('Home');
  const [childId, setChildId] = useState('');
  const [drawer, setDrawer] = useState(false);
  const [rolePicker, setRolePicker] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [greeting, setGreeting] = useState(() => getGreeting());
  const user = authState?.isAuthenticated ? authState.user : null;
  const role = previewOnly
    ? previewRole
    : roleNames[String(user?.role || '').toLowerCase()];
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(width * 0.91, 370);
  const slide = useRef(new Animated.Value(-drawerWidth)).current;
  const entrance = useRef(new Animated.Value(0)).current;
  const greetingOpacity = useRef(new Animated.Value(1)).current;
  const greetingOffset = useRef(new Animated.Value(0)).current;
  const notificationRef = useRef(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  useEffect(() => {
    if (previewOnly || !user) return undefined;
    const unsubscribe = subscribeSessionExpiry(() => {
      setSessionExpired(true);
      if (onLogout) Promise.resolve(onLogout()).catch(() => {});
    });
    const check = () => {
      checkSessionExpiry();
      // Network failures keep the session; only a server 401 expires it.
      validateSession().catch(() => {});
    };
    check();
    const interval = setInterval(checkSessionExpiry, 30000);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') check();
    });
    return () => { unsubscribe(); clearInterval(interval); subscription.remove(); };
  }, [previewOnly, user, onLogout]);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (alive) setReducedMotion(value);
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReducedMotion,
    );
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    const refreshGreeting = () => setGreeting(getGreeting());
    refreshGreeting();
    const interval = setInterval(refreshGreeting, 60 * 1000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshGreeting();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    greetingOpacity.stopAnimation();
    greetingOffset.stopAnimation();
    if (reducedMotion) {
      greetingOpacity.setValue(1);
      greetingOffset.setValue(0);
      return undefined;
    }
    greetingOpacity.setValue(0);
    greetingOffset.setValue(6);
    Animated.parallel([
      Animated.timing(greetingOpacity, {
        toValue: 1,
        duration: 360,
        useNativeDriver: true,
      }),
      Animated.timing(greetingOffset, {
        toValue: 0,
        duration: 360,
        useNativeDriver: true,
      }),
    ]).start();
    return undefined;
  }, [greeting, greetingOffset, greetingOpacity, reducedMotion]);
  useEffect(() => {
    entrance.setValue(0);
    Animated.timing(entrance, {
      toValue: 1,
      duration: reducedMotion ? 0 : 300,
      useNativeDriver: true,
    }).start();
  }, [page, role, entrance, reducedMotion]);
  useEffect(() => {
    if (!drawer) return;
    slide.setValue(-drawerWidth);
    Animated.timing(slide, {
      toValue: 0,
      duration: reducedMotion ? 0 : 240,
      useNativeDriver: true,
    }).start();
  }, [drawer, drawerWidth, reducedMotion, slide]);
  const closeDrawer = () => {
    Animated.timing(slide, {
      toValue: -drawerWidth,
      duration: reducedMotion ? 0 : 180,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setDrawer(false);
        setRolePicker(false);
      }
    });
  };
  const navigate = (next, selectedChildId) => {
    if (selectedChildId) setChildId(selectedChildId);
    if (next === 'Inbox' && ownedRoles.includes(role))
      notificationRef.current?.open();
    else setPage(next);
    if (drawer) closeDrawer();
  };
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (drawer) {
        setDrawer(false);
        return true;
      }
      if (page !== 'Home') {
        setPage('Home');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [drawer, page]);
  if (!previewOnly && (sessionExpired || authLoading || !user || !role)) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="dark-content" backgroundColor={t.background} />
        <View style={s.center}>
          {authLoading ? <ActivityIndicator color={t.primary} /> : null}
          <Text style={s.title}>
            {sessionExpired ? 'Your session expired. Please sign in again.' : authLoading
              ? 'Restoring your session…'
              : !user
              ? 'Sign in to your school workspace'
              : 'Workspace unavailable'}
          </Text>
          <Text style={s.description}>
            {authLoading
              ? 'Your school day is almost ready.'
              : !user
              ? 'Connect the existing partner authentication flow to this workspace.'
              : 'Ask your school to check your assigned role.'}
          </Text>
          {onLogout && user ? (
            <Button onPress={onLogout}>Sign out</Button>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }
  const PartnerScreen = roleScreens[role];
  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor={t.background} />
      <View style={s.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open left navigation"
          hitSlop={6}
          onPress={() => setDrawer(true)}
          style={s.menu}
        >
          <PageIcon name="more" size={25} color={t.primary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go to home"
          onPress={() => navigate('Home')}
          style={s.logo}
        >
          <Text style={s.logoText}>H</Text>
        </Pressable>
        <View style={s.identity}>
          <Animated.Text
            style={[
              s.eyebrow,
              {
                opacity: greetingOpacity,
                transform: [{ translateY: greetingOffset }],
              },
            ]}
          >
            {greeting}
          </Animated.Text>
          <Text style={s.headerTitle}>
            {page === 'Home' ? 'Overview' : page}
          </Text>
        </View>
        {ownedRoles.includes(role) ? (
          <NotificationDrawer
            ref={notificationRef}
            key={role}
            role={role}
            previewOnly={previewOnly}
          />
        ) : null}
      </View>
      <Animated.View
        style={[
          s.body,
          {
            opacity: entrance,
            transform: [
              {
                translateY: entrance.interpolate({
                  inputRange: [0, 1],
                  outputRange: [12, 0],
                }),
              },
            ],
          },
        ]}
      >
        {page === 'Teachers DLP' &&
        ['Teacher', 'Principal', 'Super Admin'].includes(role) ? (
          <RoleDashboard role={role} page={page} previewOnly={previewOnly} />
        ) : features[page] && ownedRoles.includes(role) ? (
          <FeaturePage
            key={`${role}-${page}`}
            role={role}
            page={page}
            previewOnly={previewOnly}
            childId={childId}
            provider={featureProviders[role]?.[page]}
            onNavigate={navigate}
          />
        ) : ownedRoles.includes(role) ? (
          page === 'Home' ? (
            <HiraHome
              key={role}
              role={role}
              previewOnly={previewOnly}
              user={user}
              onNavigate={navigate}
              reducedMotion={reducedMotion}
            />
          ) : (
            <RoleDashboard
              key={`${role}-${page}`}
              role={role}
              previewOnly={previewOnly}
              page={page}
              initialChildId={childId}
              searchQuery=""
            />
          )
        ) : staffFeatures[role]?.[page] ? (
          <FeaturePage
            key={`${role}-${page}`}
            role={role}
            page={page}
            definition={staffFeatures[role][page]}
            previewOnly={previewOnly}
            provider={featureProviders[role]?.[page]}
            onNavigate={navigate}
          />
        ) : PartnerScreen ? (
          <PartnerScreen
            page={page}
            previewOnly={previewOnly}
            onNavigate={navigate}
          />
        ) : (
          <View style={s.center}>
            <Text style={s.title}>{role} workspace</Text>
            <Text style={s.description}>
              This role is ready for your partner’s screens.
            </Text>
            <Text style={s.description}>
              Classes, DLP, applications and reports connect through
              roleScreens.
            </Text>
          </View>
        )}
      </Animated.View>
      <View style={s.bottom}>
        {bottomPages[role].map((item) => (
          <Pressable
            key={item}
            accessibilityRole="tab"
            accessibilityState={{ selected: page === item }}
            accessibilityLabel={item}
            onPress={() => navigate(item)}
            style={s.tab}
          >
            <View style={[s.tabIcon, page === item && s.tabIconActive]}>
              <PageIcon
                name={item}
                size={24}
                color={page === item ? t.primary : t.muted}
              />
            </View>
            <Text style={[s.tabLabel, page === item && { color: t.primary }]}>
              {item}
            </Text>
          </Pressable>
        ))}
      </View>
      <Modal
        visible={drawer}
        transparent
        animationType="none"
        onRequestClose={closeDrawer}
        statusBarTranslucent={false}
      >
        <View style={s.overlay}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            accessibilityRole="button"
            accessibilityLabel="Close navigation"
            onPress={closeDrawer}
          />
          <Animated.View
            style={[
              s.drawer,
              { width: drawerWidth, transform: [{ translateX: slide }] },
            ]}
          >
            <SafeAreaView style={s.drawerSafe}>
              <View style={s.drawerHeading}>
                <View style={{ flex: 1 }}>
                  <Text style={s.eyebrow}>YOUR SCHOOL WORKSPACE</Text>
                  <Text style={s.drawerTitle}>Navigation</Text>
                </View>
                <Pressable
                  onPress={closeDrawer}
                  accessibilityRole="button"
                  accessibilityLabel="Close navigation"
                  style={s.close}
                >
                  <PageIcon name="close" size={22} color={t.ink} />
                </Pressable>
              </View>
              <Pressable
                disabled={!previewOnly}
                accessibilityRole="button"
                accessibilityLabel={
                  previewOnly ? 'Switch preview role' : `${role} account`
                }
                onPress={() => setRolePicker(!rolePicker)}
                style={s.role}
              >
                <Text style={s.roleText}>
                  {role === 'Parent' ? 'Parent / Guardian' : role}
                </Text>
                {previewOnly ? <PageIcon name="chevron-down" size={20} /> : null}
              </Pressable>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={s.drawerContent}
              >
                {rolePicker && previewOnly ? (
                  <View style={s.roleList}>
                    <Text style={s.group}>SWITCH PREVIEW ROLE</Text>
                    {roles.map((item) => (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Switch to ${item}`}
                        key={item}
                        onPress={() => {
                          setPreviewRole(item);
                          setChildId('');
                          setPage('Home');
                          closeDrawer();
                        }}
                        style={s.row}
                      >
                        <Text style={s.rowText}>{item}</Text>
                        {item === role ? (
                          <Text style={{ color: t.primary }}>✓</Text>
                        ) : null}
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                <Text style={s.group}>YOUR SCHOOL DAY</Text>
                {rolePages[role].map((item) => (
                    <Pressable
                      key={item}
                      accessibilityRole="button"
                      onPress={() => navigate(item)}
                      style={[s.row, page === item && s.activeRow]}
                    >
                      <PageIcon
                        name={item}
                        size={23}
                        color={page === item ? '#FFFFFF' : t.primary}
                      />
                      <Text style={[s.rowText, page === item && s.activeText]}>
                        {item}
                      </Text>
                      {page === item ? (
                        <Text style={{ color: '#FFE4AA' }}>•</Text>
                      ) : null}
                    </Pressable>
                  ))}
                {onLogout && !previewOnly ? (
                  <Button style={{ marginTop: 20 }} onPress={onLogout}>
                    Sign out
                  </Button>
                ) : null}
              </ScrollView>
              <Text style={s.drawerFooter}>
                {previewOnly
                  ? 'Design preview · local sample records'
                  : 'Your connected school workspace'}
              </Text>
            </SafeAreaView>
          </Animated.View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.background },
  body: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 15,
    paddingBottom: 22,
  },
  logo: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: t.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...t.shadow,
  },
  logoText: { color: '#FFF2C8', fontSize: 26, fontWeight: '900' },
  identity: { flex: 1 },
  eyebrow: {
    fontSize: 9,
    letterSpacing: 1.5,
    fontWeight: '700',
    color: t.muted,
  },
  headerTitle: { color: t.ink, fontSize: 16, fontWeight: '800', marginTop: 3 },
  menu: {
    width: 38,
    height: 42,
    borderRadius: 15,
    backgroundColor: t.lavender,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuText: { color: t.primary, fontSize: 29, lineHeight: 32 },
  bottom: {
    flexDirection: 'row',
    backgroundColor: t.paper,
    borderTopWidth: 1,
    borderTopColor: t.border,
    paddingTop: 6,
    paddingBottom: 5,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    minHeight: 56,
    justifyContent: 'center',
  },
  tabIcon: {
    width: 48,
    height: 33,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIconActive: { backgroundColor: t.lavender },
  icon: { color: t.muted, fontSize: 23 },
  tabLabel: { color: t.muted, fontSize: 11, marginTop: 4 },
  center: { flex: 1, padding: 30, justifyContent: 'center', gap: 16 },
  title: { fontSize: 25, color: t.ink, fontWeight: '800' },
  description: { fontSize: 14, lineHeight: 22, color: t.muted },
  button: {
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: t.primary,
    ...t.shadow,
  },
  buttonText: { color: 'white', fontSize: 13, fontWeight: '700' },
  overlay: { flex: 1, backgroundColor: '#28294066' },
  drawer: {
    height: '100%',
    backgroundColor: t.background,
    borderTopRightRadius: 28,
    borderBottomRightRadius: 28,
    ...t.shadow,
  },
  drawerSafe: { flex: 1, paddingHorizontal: 20 },
  drawerHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 20,
    marginBottom: 24,
  },
  drawerTitle: { fontSize: 27, color: t.ink, fontWeight: '800', marginTop: 7 },
  close: {
    width: 44,
    height: 44,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { fontSize: 25, color: t.ink },
  role: {
    backgroundColor: t.lavender,
    borderRadius: 17,
    minHeight: 56,
    paddingHorizontal: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  roleText: { color: t.ink, fontSize: 16, fontWeight: '700' },
  drawerContent: { paddingTop: 21, paddingBottom: 20 },
  group: {
    fontSize: 10,
    letterSpacing: 1.2,
    color: t.muted,
    fontWeight: '700',
    marginBottom: 12,
  },
  row: {
    minHeight: 49,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 5,
  },
  rowText: { flex: 1, fontSize: 14, color: t.ink },
  rowIcon: { color: t.primary, fontSize: 20 },
  activeRow: { backgroundColor: t.primary, ...t.shadow },
  activeText: { color: 'white' },
  roleList: {
    marginBottom: 20,
    borderBottomWidth: 1,
    borderColor: t.border,
    paddingBottom: 12,
  },
  drawerFooter: {
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: t.border,
    color: t.muted,
    fontSize: 11,
  },
});
