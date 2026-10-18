import React, {
  createContext,
  ReactNode,
  useContext,
  useState,
} from 'react';
import {authService} from '../services/auth/authService';

import {User} from '../types/auth';

interface AuthContextValue {
  user: User | null;
  accessToken: string | null;
  login: (user: User, accessToken: string) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(
  undefined,
);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({children}: AuthProviderProps) => {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(
    null,
  );

  const login = (loggedInUser: User, token: string) => {
    setUser(loggedInUser);
    setAccessToken(token);
  };

  const logout = async () => {
    const token=accessToken;
    // Authentication and all protected screen state are memory-only. Clear the
    // provider before network I/O so protected navigation is removed immediately.
    // A late revoke response must also never clear a newer signed-in identity.
    setUser(null);
    setAccessToken(null);
    if (token) await authService.logout(token);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken,
        login,
        logout,
      }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return context;
};
