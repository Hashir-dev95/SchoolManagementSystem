const API_BASE_URL = 'http://192.168.18.32:5000/api';
const DEFAULT_TIMEOUT_MS = 10000;

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string;
  timeoutMs?: number;
}

export const apiClient = {
  request: async <T>(
    endpoint: string,
    options: ApiOptions = {},
  ): Promise<T> => {
    const {method = 'GET', body, token, timeoutMs = DEFAULT_TIMEOUT_MS} = options;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? {Authorization: `Bearer ${token}`} : {}),
        },
        ...(body !== undefined ? {body: JSON.stringify(body)} : {}),
        signal: controller.signal as any,
      });

      const data = (await response.json()) as T & {message?: string};

      if (!response.ok) {
        throw new Error((data as {message?: string}).message || 'API request failed');
      }

      return data;
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          throw new Error('Network request timed out. Please check server connection.');
        }
        throw err;
      }
      throw new Error('Network request failed');
    } finally {
      clearTimeout(timeoutId);
    }
  },
};