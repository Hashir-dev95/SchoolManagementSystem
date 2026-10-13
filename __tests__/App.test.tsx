/**
 * @format
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';
import LoginScreen from '../src/screens/auth/LoginScreen';

// Exercise the real App/Auth/root route while replacing native navigation
// boundaries that cannot run in the Node renderer.
jest.mock('@react-navigation/native', () => ({
  NavigationContainer: ({ children }: { children: React.ReactNode }) =>
    children,
}));
jest.mock('@react-navigation/native-stack', () => {
  const ReactRuntime = jest.requireActual('react');
  return {
    createNativeStackNavigator: () => ({
      Navigator: ({ children }: { children: React.ReactNode }) =>
        ReactRuntime.Children.toArray(children)[0],
      Screen: ({ component }: { component: React.ComponentType }) =>
        ReactRuntime.createElement(component, { navigation: {}, route: {} }),
    }),
  };
});
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}));

test('App mounts the unauthenticated login destination', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<App />);
  });
  expect(tree.root.findAllByType(LoginScreen)).toHaveLength(1);
  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});
