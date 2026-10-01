import React, { useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import RoleDashboard from './RoleDashboard';
import NotificationDrawer from './NotificationDrawer';

const roles = ['Student', 'Parent', 'Finance'];
const screenData = {
  Student: {},
  Parent: {},
  Finance: {},
};

export default function MobileApp() {
  const [role, setRole] = useState('Student');
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#F2F6FC" />
      <View style={styles.topBar}>
        <View style={styles.switcher} accessibilityRole="tablist">
          {roles.map(item => (
            <Pressable
              key={item}
              accessibilityRole="tab"
              accessibilityState={{ selected: role === item }}
              onPress={() => setRole(item)}
              style={[styles.tab, role === item && styles.activeTab]}
            >
              <Text
                style={[styles.tabLabel, role === item && styles.activeLabel]}
              >
                {item}
              </Text>
            </Pressable>
          ))}
        </View>
        <NotificationDrawer role={role} />
      </View>
      <RoleDashboard role={role} data={screenData[role]} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F2F6FC' },
  switcher: {
    flex: 1,
    flexDirection: 'row',
    marginHorizontal: 18,
    marginTop: 8,
    padding: 4,
    backgroundColor: '#E6EDF7',
    borderRadius: 14,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 18,
    marginTop: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderRadius: 11,
  },
  activeTab: { backgroundColor: '#FFFFFF' },
  tabLabel: { color: '#69788C', fontSize: 13, fontWeight: '600' },
  activeLabel: { color: '#246BFD', fontWeight: '800' },
});
