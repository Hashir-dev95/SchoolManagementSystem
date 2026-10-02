import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

const LoginScreen = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>School Management System</Text>
      <Text accessibilityRole="header" style={styles.status}>
        Authentication integration pending
      </Text>
      <Text style={styles.description}>
        Sign-in is not available yet. Student, Parent, and Finance dashboards
        will be available once school account authentication is connected.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#F2F6FC',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 10,
    color: '#14243A',
    textAlign: 'center',
  },
  status: {
    fontSize: 18,
    fontWeight: '600',
    color: '#14243A',
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    color: '#526176',
    textAlign: 'center',
    maxWidth: 420,
  },
});

export default LoginScreen;
