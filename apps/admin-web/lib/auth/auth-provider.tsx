'use client';

import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, login as apiLogin, logout as apiLogout, onSessionChange, refreshAccessToken, setActiveFacility } from '@/lib/api/client';
import type { Me } from './types';

type AuthState = {
  status: 'loading' | 'signed-out' | 'signed-in';
  me: Me | null;
  signIn: (email: string, password: string) => Promise<Me>;
  signOut: () => Promise<void>;
  reload: () => Promise<Me | null>;
};

const AuthContext = createContext<AuthState | null>(null);

/** Restores the session from the refresh cookie on load; nothing about the session is stored in the browser. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [me, setMe] = useState<Me | null>(null);

  const loadMe = useCallback(async () => {
    try {
      const profile = await api<Me>('/me');
      setActiveFacility(profile.facility?.facilityId ?? null);
      setMe(profile);
      setStatus('signed-in');
      return profile;
    } catch {
      setMe(null);
      setStatus('signed-out');
      return null;
    }
  }, []);

  useEffect(() => {
    void (async () => {
      if (await refreshAccessToken()) await loadMe();
      else setStatus('signed-out');
    })();
    return onSessionChange((signedIn) => {
      if (signedIn) return;
      setMe(null);
      setStatus('signed-out');
      queryClient.clear();
    });
  }, [loadMe, queryClient]);

  const signIn = useCallback(async (email: string, password: string) => {
    await apiLogin(email, password);
    const profile = await loadMe();
    if (!profile) throw new Error('Unable to load your account.');
    return profile;
  }, [loadMe]);

  const signOut = useCallback(async () => {
    await apiLogout();
    setActiveFacility(null);
  }, []);

  const value = useMemo(() => ({ status, me, signIn, signOut, reload: loadMe }), [status, me, signIn, signOut, loadMe]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
