import { Platform } from 'react-native';

// 10.0.2.2 is emulator-only. The connected development phone reaches the
// local backend through the host PC's LAN address. Production auth remains
// server-controlled and does not use preview data.
const DEV_ANDROID_HOST = '192.168.1.7';
export const API_ROOT =
  Platform.OS === 'android'
    ? `http://${__DEV__ ? DEV_ANDROID_HOST : '10.0.2.2'}:5000/api`
    : 'http://localhost:5000/api';
