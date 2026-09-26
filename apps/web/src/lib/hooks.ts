import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import type { UserSettings } from '@cooldown/core';
import { api, ApiError } from './api';

export interface Me {
  id: string;
  email: string;
  settings: UserSettings;
  isAdmin: boolean;
  credits: number;
  paymentsEnabled: boolean;
}

export function useMe() {
  return useQuery<Me | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<Me>('/api/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 30_000,
  });
}

const ACTIVE_KEY = 'cooldown.activeAccount';

/** The account the user is working in (persisted per browser). */
export function useActiveAccountId(): [string | null, (id: string | null) => void] {
  const [id, setId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ACTIVE_KEY);
    } catch {
      return null;
    }
  });
  useEffect(() => {
    const on = () => {
      try {
        setId(localStorage.getItem(ACTIVE_KEY));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('cooldown:account', on);
    return () => window.removeEventListener('cooldown:account', on);
  }, []);
  const set = useCallback((v: string | null) => {
    try {
      if (v) localStorage.setItem(ACTIVE_KEY, v);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch {
      /* ignore */
    }
    setId(v);
    window.dispatchEvent(new Event('cooldown:account'));
  }, []);
  return [id, set];
}

/** Global keyboard shortcut (ignored while typing in a field). */
export function useHotkey(key: string, fn: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === key) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [key, fn, enabled]);
}
