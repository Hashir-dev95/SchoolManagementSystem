import { Platform } from 'react-native';

// Development device: adb reverse tcp:5001 tcp:5001, with the JS API on 5001.
// This avoids a changing Wi-Fi address and the unrelated service on port 5000.
export const API_ROOT =
  __DEV__ ? 'http://127.0.0.1:5001/api' : Platform.OS === 'android'
    ? 'http://10.0.2.2:5000/api'
    : 'http://localhost:5000/api';
