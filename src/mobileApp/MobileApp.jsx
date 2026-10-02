import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  TextInput,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import NotificationDrawer from './NotificationDrawer';
import RoleDashboard from './RoleDashboard';

const dashboardRoles = {
  student: 'Student',
  parent: 'Parent',
  finance: 'Finance',
};
const APP_BACKGROUND = '#F2F6FC';

function LoadingScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={APP_BACKGROUND} />
      <View style={styles.centered}>
        <ActivityIndicator
          accessibilityLabel="Restoring your session"
          color="#246BFD"
        />
        <Text style={styles.muted}>Restoring your session…</Text>
      </View>
    </SafeAreaView>
  );
}

function UnsupportedRole({ role, onLogout }) {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={APP_BACKGROUND} />
      <View style={styles.centered}>
        <Text style={styles.title}>Role not available in this app</Text>
        <Text style={styles.muted}>
          {role
            ? `The authenticated role “${role}” has no Student, Parent, or Finance dashboard here.`
            : 'The authenticated account has no role.'}
        </Text>
        {typeof onLogout === 'function' ? (
          <Pressable
            accessibilityRole="button"
            onPress={onLogout}
            style={styles.logoutButton}
          >
            <Text style={styles.logoutText}>Sign out</Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function IntegrationPending() {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={APP_BACKGROUND} />
      <View style={styles.centered}>
        <Text style={styles.title}>Authentication integration pending</Text>
        <Text style={styles.muted}>
          This app area requires an authenticated user session from the partner
          auth provider. Sign in through AuthNavigator, then provide that
          verified session to MobileApp.
        </Text>
      </View>
    </SafeAreaView>
  );
}

/**
 * Post-authentication app shell. The partner auth layer must pass its trusted
 * AuthState and callbacks; this component never creates or assumes a session.
 */
export default function MobileApp({
  authState,
  authLoading = false,
  onLogout,
  developmentPreview = false,
}) {
  const previewActive =
    developmentPreview && typeof __DEV__ !== 'undefined' && __DEV__;
  const [previewRole, setPreviewRole] = React.useState('Student');
  const [previewMenuOpen, setPreviewMenuOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');
  const entrance = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    if (!previewActive) return undefined;
    Animated.timing(entrance, {
      toValue: 1,
      duration: 360,
      useNativeDriver: true,
    }).start();
    return () => entrance.stopAnimation();
  }, [entrance, previewActive]);

  if (previewActive) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" backgroundColor={APP_BACKGROUND} />
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open preview navigation"
            onPress={() => setPreviewMenuOpen(true)}
            style={styles.iconButton}
          >
            <Text style={styles.menuIcon}>⋮</Text>
          </Pressable>
          <View style={styles.identity}>
            <Text numberOfLines={1} style={styles.name}>
              School day
            </Text>
            <Text style={styles.role}>{previewRole} · UI preview</Text>
          </View>
          <TextInput
            accessibilityLabel="Search preview records"
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search"
            placeholderTextColor="#69788C"
            style={styles.search}
          />
          <NotificationDrawer role={previewRole} previewOnly />
        </View>
        <View style={styles.previewBanner}>
          <Text style={styles.mascot}>🧑🏽‍🎓</Text>
          <View style={styles.bannerCopy}>
            <Text style={styles.bannerTitle}>A bright day to learn!</Text>
            <Text style={styles.bannerSubtitle}>
              Development preview · fictional content only
            </Text>
          </View>
          <Text style={styles.bannerDecoration}>✦</Text>
        </View>
        <Animated.View
          style={[
            styles.dashboardAnimated,
            {
              opacity: entrance,
              transform: [
                {
                  translateY: entrance.interpolate({
                    inputRange: [0, 1],
                    outputRange: [10, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <RoleDashboard
            role={previewRole}
            previewOnly
            searchQuery={searchQuery}
          />
        </Animated.View>
        <PreviewDrawer
          visible={previewMenuOpen}
          onClose={() => setPreviewMenuOpen(false)}
          role={previewRole}
          onSwitch={role => {
            setPreviewRole(role);
            setSearchQuery('');
            setPreviewMenuOpen(false);
          }}
        />
      </SafeAreaView>
    );
  }

  if (authLoading) return <LoadingScreen />;

  const user = authState?.isAuthenticated === true ? authState.user : null;
  if (!user) return <IntegrationPending />;

  const roleKey = typeof user.role === 'string' ? user.role.toLowerCase() : '';
  const displayRole = dashboardRoles[roleKey];
  if (!displayRole) {
    return <UnsupportedRole role={user.role} onLogout={onLogout} />;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={APP_BACKGROUND} />
      <View style={styles.topBar}>
        <View style={styles.identity}>
          <Text numberOfLines={1} style={styles.name}>
            {user.fullName || user.email || displayRole}
          </Text>
          <Text style={styles.role}>{displayRole}</Text>
        </View>
        <NotificationDrawer role={displayRole} />
        {typeof onLogout === 'function' ? (
          <Pressable
            accessibilityRole="button"
            onPress={onLogout}
            style={styles.logoutButton}
          >
            <Text style={styles.logoutText}>Sign out</Text>
          </Pressable>
        ) : null}
      </View>
      <RoleDashboard role={displayRole} />
    </SafeAreaView>
  );
}

function PreviewDrawer({ visible, onClose, role, onSwitch }) {
  const slide = React.useRef(new Animated.Value(-340)).current;
  React.useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 0 : -340,
      duration: 210,
      useNativeDriver: true,
    }).start();
  }, [slide, visible]);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={styles.drawerLayer}>
        <Pressable
          accessibilityLabel="Close preview menu"
          onPress={onClose}
          style={styles.drawerScrim}
        />
        <Animated.View
          style={[styles.previewDrawer, { transform: [{ translateX: slide }] }]}
        >
          <Text style={styles.drawerTitle}>Your school</Text>
          <Text style={styles.drawerSubtitle}>Choose a UI preview</Text>
          {['Student', 'Parent', 'Finance'].map(item => (
            <Pressable
              key={item}
              accessibilityRole="button"
              accessibilityState={{ selected: role === item }}
              onPress={() => onSwitch(item)}
              style={[
                styles.roleOption,
                role === item && styles.roleOptionActive,
              ]}
            >
              <Text style={styles.roleOptionText}>Switch to {item}</Text>
              <Text style={styles.roleOptionArrow}>
                {role === item ? '✓' : '›'}
              </Text>
            </Pressable>
          ))}
          <Text style={styles.drawerFoot}>
            Preview mode only · no account is signed in
          </Text>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: APP_BACKGROUND },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 8,
    minHeight: 54,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E3EAF3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIcon: {
    color: '#14243A',
    fontSize: 25,
    lineHeight: 28,
    fontWeight: '800',
  },
  search: {
    width: 82,
    height: 38,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#E3EAF3',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    fontSize: 12,
    color: '#14243A',
  },
  previewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 7,
    padding: 13,
    backgroundColor: '#FFE9A8',
    borderRadius: 20,
    minHeight: 82,
    overflow: 'hidden',
  },
  mascot: { fontSize: 38, marginRight: 11 },
  bannerCopy: { flex: 1 },
  bannerTitle: { color: '#553F12', fontSize: 15, fontWeight: '900' },
  bannerSubtitle: { color: '#755E2B', fontSize: 10, marginTop: 4 },
  bannerDecoration: { color: '#F0A926', fontSize: 24, marginRight: 4 },
  dashboardAnimated: { flex: 1 },
  drawerLayer: {
    flex: 1,
    zIndex: 10,
    flexDirection: 'row',
    backgroundColor: '#14243A88',
  },
  drawerScrim: { ...StyleSheet.absoluteFillObject },
  previewDrawer: {
    width: '78%',
    maxWidth: 310,
    height: '100%',
    backgroundColor: '#F2F6FC',
    paddingTop: 30,
    paddingHorizontal: 17,
    elevation: 12,
  },
  drawerTitle: { color: '#14243A', fontSize: 21, fontWeight: '900' },
  drawerSubtitle: {
    color: '#69788C',
    fontSize: 12,
    marginTop: 5,
    marginBottom: 21,
  },
  roleOption: {
    minHeight: 51,
    borderRadius: 15,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E3EAF3',
    paddingHorizontal: 14,
    marginBottom: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  roleOptionActive: { backgroundColor: '#E8F0FF', borderColor: '#246BFD' },
  roleOptionText: { color: '#14243A', fontSize: 13, fontWeight: '800' },
  roleOptionArrow: { color: '#246BFD', fontSize: 17, fontWeight: '900' },
  drawerFoot: { color: '#69788C', fontSize: 11, lineHeight: 16, marginTop: 10 },
  identity: { flex: 1, minWidth: 0 },
  name: { color: '#14243A', fontSize: 13, fontWeight: '800' },
  role: { color: '#69788C', fontSize: 11, marginTop: 3 },
  logoutButton: {
    alignItems: 'center',
    backgroundColor: '#E6EDF7',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 11,
  },
  logoutText: { color: '#14243A', fontSize: 11, fontWeight: '700' },
  centered: {
    alignItems: 'center',
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    padding: 26,
  },
  title: {
    color: '#14243A',
    fontSize: 19,
    fontWeight: '800',
    textAlign: 'center',
  },
  muted: {
    color: '#69788C',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
});
