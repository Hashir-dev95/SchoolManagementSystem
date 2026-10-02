import React from 'react';
import {NavigationContainer} from '@react-navigation/native';

import AuthNavigator from './AuthNavigator';
import MobileApp from '../mobileApp/MobileApp';

const AppNavigator = () => {
  return (
    <NavigationContainer>
      {__DEV__ ? <MobileApp developmentPreview /> : <AuthNavigator />}
    </NavigationContainer>
  );
};

export default AppNavigator;
