import React from 'react';
import { Text, View } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/hiraDashboard';

export default function GateFoundationScreen() {
  const { logout } = useAuth();
  return (
    <View accessibilityLabel="Gate Staff account">
      <Text>Gate Staff</Text>
      <Text>
        Your account is ready. Gate operations require school activation.
      </Text>
      <Button
        title="Sign out"
        onPress={() => logout().catch(() => undefined)}
      />
    </View>
  );
}
