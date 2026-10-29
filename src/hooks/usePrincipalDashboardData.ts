import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';

import { useAuth } from '../context/AuthContext';
import { principalService } from '../services/principal/principalService';
import { PrincipalDashboardData } from '../services/principal/principalService';

export const usePrincipalDashboardData = () => {
  const { accessToken, user } = useAuth();
  const authorityKey = JSON.stringify([accessToken, user]);
  const [owner, setOwner] = useState<string | null>(null);
  const [data, setData] = useState<PrincipalDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const current = ++generation.current;
    setData(null);
    if (!accessToken) {
      setError('Your session is unavailable. Please sign in again.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await principalService.getDashboard(accessToken);
      if (current === generation.current) {
        setData(response.data);
        setOwner(authorityKey);
      }
    } catch (requestError: unknown) {
      if (current === generation.current)
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Unable to load dashboard data.',
        );
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [accessToken, authorityKey]);

  useFocusEffect(
    useCallback(() => {
      reload().catch(() => undefined);
      return () => {
        ++generation.current;
      };
    }, [reload]),
  );

  return { data: owner === authorityKey ? data : null, loading, error, reload };
};
