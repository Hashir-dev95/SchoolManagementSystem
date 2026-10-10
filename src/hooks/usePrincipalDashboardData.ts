import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '../context/AuthContext';
import { principalService } from '../services/principal/principalService';
import { PrincipalDashboardData } from '../services/principal/principalService';

export const usePrincipalDashboardData = () => {
  const { accessToken } = useAuth();
  const [data, setData] = useState<PrincipalDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!accessToken) {
      setError('Your session is unavailable. Please sign in again.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await principalService.getDashboard(accessToken);
      setData(response.data);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to load dashboard data.',
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  return { data, loading, error, reload };
};
