import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../services/api/apiClient';

/** Unmount all private state on identity change or focus loss. No preview identity. */
export function PickupSession({
  role,
  children,
}: {
  role: 'parent' | 'principal';
  children: (token: string) => React.ReactNode;
}) {
  const { user, accessToken } = useAuth();
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  if (
    !user ||
    !accessToken ||
    user.role !== role ||
    (role === 'principal' && !user.branchId)
  )
    return (
      <Text>
        Pickup requests unavailable. Sign in with your current school account.
      </Text>
    );
  return focused ? (
    <React.Fragment
      key={JSON.stringify([user.id, user.role, user.branchId, accessToken])}
    >
      {children(accessToken)}
    </React.Fragment>
  ) : null;
}
export function usePickupLifetime() {
  const live = useRef(false);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useFocusEffect(
    useCallback(() => {
      live.current = true;
      return () => {
        live.current = false;
      };
    }, []),
  );
  return live;
}
export const pickupDenied = (error: unknown) =>
  error instanceof ApiError && [401, 403, 404].includes(error.status);
export const pickupConflict = (error: unknown) =>
  error instanceof ApiError && error.status === 409;
export const pickupUncertain = (error: unknown) =>
  !(error instanceof ApiError) || (error.status >= 500 && error.status !== 503);
export function pickupError(error: unknown) {
  if (pickupDenied(error))
    return 'Pickup requests unavailable in your current scope. Refresh to recheck access.';
  if (pickupConflict(error))
    return 'The request changed. Review refreshed versions before trying again.';
  if (error instanceof ApiError && error.status === 503)
    return 'Pickup request review is not available for this branch yet.';
  if (error instanceof ApiError && error.status === 400)
    return 'Check the proposal fields and requested dates, then try again.';
  return 'Connection interrupted. The operation may be unconfirmed. Retry safely with the same operation.';
}
