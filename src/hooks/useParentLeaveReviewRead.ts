import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../services/api/apiClient';

export function useParentLeaveReviewRead<T>(
  load: (token: string) => Promise<T>,
  approvalId?: string,
) {
  const { user, accessToken } = useAuth();
  const scope = JSON.stringify([
    user?.id,
    accessToken,
    user?.role,
    user?.branchId,
    approvalId,
  ]);
  const allowed = Boolean(
    user?.id && user.role === 'principal' && user.branchId && accessToken,
  );
  const generation = useRef(0);
  const focused = useRef(false);
  const [result, setResult] = useState<{
    scope: string;
    data?: T;
    error?: string;
  } | null>(null);

  const reload = useCallback(async () => {
    if (!focused.current) return;
    const current = ++generation.current;
    // Drop data during every revalidation, including when returning from a detail.
    setResult(null);
    if (!allowed || !accessToken) {
      setResult({
        scope,
        error: 'Parent leave review is unavailable for this session.',
      });
      return;
    }
    try {
      const data = await load(accessToken);
      if (current === generation.current) setResult({ scope, data });
    } catch (error) {
      if (current !== generation.current) return;
      const denied =
        error instanceof ApiError && [401, 403, 404].includes(error.status);
      const conflict = error instanceof ApiError && error.status === 409;
      setResult({
        scope,
        error: denied
          ? 'Parent leave review is unavailable for this session.'
          : conflict
          ? 'The request changed. Refresh to check its current status.'
          : 'Parent leave review could not be loaded. Try again.',
      });
    }
  }, [accessToken, allowed, load, scope]);

  const conceal = useCallback(() => {
    if (!focused.current) return;
    ++generation.current;
    setResult({
      scope,
      error: 'Parent leave review is unavailable for this session.',
    });
  }, [scope]);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      reload().catch(() => undefined);
      return () => {
        focused.current = false;
        ++generation.current;
        setResult(null);
      };
    }, [reload]),
  );

  const current = result?.scope === scope ? result : null;
  return {
    data: current?.data,
    error: current?.error,
    loading: !current,
    reload,
    conceal,
  };
}
