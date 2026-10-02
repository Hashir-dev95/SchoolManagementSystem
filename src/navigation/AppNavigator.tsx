import React, {useState} from 'react';
import {NavigationContainer} from '@react-navigation/native';
import AuthNavigator from './AuthNavigator';
import MobileApp from '../mobileApp/MobileApp';
import {logout} from '../mobileApp/authService';
const AppNavigator = ({developmentPreview = false}: {developmentPreview?: boolean}) => {
  const [user, setUser] = useState<any>(null); const [developerPreview, setDeveloperPreview] = useState(false); const preview = (developmentPreview || developerPreview) && typeof __DEV__ !== 'undefined' && __DEV__;
  return <NavigationContainer>{preview ? <MobileApp developmentPreview /> : user ? <MobileApp authState={{isAuthenticated: true, user}} onLogout={async () => {await logout(); setUser(null);}} /> : <AuthNavigator onAuthenticated={setUser} onDeveloperPreview={() => {if (typeof __DEV__ !== 'undefined' && __DEV__) setDeveloperPreview(true);}} />}</NavigationContainer>;
};
export default AppNavigator;
