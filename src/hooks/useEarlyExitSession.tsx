import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../services/api/apiClient';

/** A private instance belongs to one focus epoch and cannot become live again. */
export function useEarlyExitLifetime() {
  const live = useRef(false);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useFocusEffect(
    useCallback(
      () => () => {
        live.current = false;
      },
      [],
    ),
  );
  return live;
}

/** Canonical auth identity only; focus/context loss destroys private local state. */
export function EarlyExitSession({
  role,
  children,
}: {
  role: 'parent' | 'principal';
  children: (token: string, branch: string) => React.ReactNode;
}) {
  const { user, accessToken } = useAuth();
  const [focused, setFocused] = useState(false);
  const [focusEpoch, setFocusEpoch] = useState(0);
  useFocusEffect(
    useCallback(() => {
      // Functional increment survives a batched blur/refocus ending in true.
      setFocusEpoch(epoch => epoch + 1);
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  if (!user || !accessToken || user.role !== role || !user.branchId)
    return (
      <Text>
        Early Exit unavailable. Sign in with your current school account.
      </Text>
    );
  return focused ? (
    <React.Fragment
      key={JSON.stringify([
        user.id,
        user.role,
        user.branchId,
        accessToken,
        focusEpoch,
      ])}
    >
      {children(accessToken, user.branchId)}
    </React.Fragment>
  ) : null;
}
export const earlyExitDenied = (error: unknown) =>
  error instanceof ApiError && [401, 403, 404].includes(error.status);
export const earlyExitConflict = (error: unknown) =>
  error instanceof ApiError && error.status === 409;
// A server failure may occur while projecting an already-committed operation.
// Preserve identical commands even on 503; never infer that a write did not commit.
export const earlyExitUncertain = (error: unknown) =>
  !(error instanceof ApiError) || error.status >= 500;
export function earlyExitError(error: unknown) {
  if (earlyExitDenied(error))
    return 'Early Exit unavailable in your current scope. Refresh to recheck access.';
  if (earlyExitConflict(error))
    return 'The request changed. Review refreshed versions before trying again.';
  if (error instanceof ApiError && error.status === 400)
    return 'Check the date and reason, then try again.';
  if (error instanceof ApiError && error.status === 503)
    return 'School review is unavailable. An attempted write is unconfirmed; retry the same operation.';
  return 'Connection interrupted. The operation may be unconfirmed. Retry safely with the same operation.';
}
