'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SettingsView, SignedOut } from '@/app/api/settings/route';
import { subscriptionEndpoint } from '@/lib/push-client.ts';
import type { Prefs } from '@/lib/types.ts';

export type SettingsChange = {
  prefs?: Partial<Prefs>;
  watchMinutes?: number;
  subscribe?: PushSubscriptionJSON;
  unsubscribe?: string;
  test?: boolean;
};

type Status = 'loading' | 'signed-out' | 'ready' | 'failed';

type Account = {
  status: Status;
  /** The signed-in person's settings. Null until loaded, and when signed out. */
  view: SettingsView | null;
  /** How a signed-out browser can sign in. */
  signIn: SignedOut['signIn'] | null;
  error: string | null;
  setError: (message: string | null) => void;
  setView: (change: (prev: SettingsView | null) => SettingsView | null) => void;
  reload: () => void;
  update: (change: SettingsChange) => Promise<boolean>;
  signOut: () => Promise<void>;
};

const AccountContext = createContext<Account | null>(null);

/** Sends JSON to one of the app's own routes. The session cookie rides along by itself. */
export function post(url: string, body: unknown, method = 'POST'): Promise<Response> {
  return fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [view, setView] = useState<SettingsView | null>(null);
  const [signIn, setSignIn] = useState<SignedOut['signIn'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // Never lets a missing push feature (iPhone Safari outside the Home Screen app) block the page.
      const endpoint = await subscriptionEndpoint(navigator);
      const query = endpoint ? `?endpoint=${encodeURIComponent(endpoint)}` : '';
      const res = await fetch(`/api/settings${query}`, { cache: 'no-store' });
      if (cancelled) return;
      if (res.status === 401) {
        const body = (await res.json()) as SignedOut;
        setSignIn(body.signIn);
        setView(null);
        setStatus('signed-out');
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      setView((await res.json()) as SettingsView);
      setStatus('ready');
    }
    load().catch(() => !cancelled && setStatus('failed'));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    // The single-user version kept its passcode on the device. Nothing reads it any more.
    try {
      localStorage.removeItem('shuttle.passcode');
    } catch {
      // Nothing to clean up.
    }
  }, []);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const update = useCallback(async (change: SettingsChange): Promise<boolean> => {
    setError(null);
    try {
      const res = await post('/api/settings', change);
      if (res.status === 401) {
        setStatus('signed-out');
        setAttempt((n) => n + 1);
        return false;
      }
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as SettingsView;
      setView((prev) => ({ ...next, subscribed: change.subscribe ? true : change.unsubscribe ? false : (prev?.subscribed ?? false) }));
      return true;
    } catch {
      setError("Couldn't save that. Check your connection and try again.");
      return false;
    }
  }, []);

  const signOut = useCallback(async () => {
    await post('/api/auth/signout', {}).catch(() => undefined);
    setView(null);
    setStatus('loading');
    setAttempt((n) => n + 1);
  }, []);

  const value = useMemo<Account>(
    () => ({ status, view, signIn, error, setError, setView, reload, update, signOut }),
    [status, view, signIn, error, reload, update, signOut],
  );
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount(): Account {
  const account = useContext(AccountContext);
  if (!account) throw new Error('useAccount needs the AccountProvider in app/layout.tsx');
  return account;
}
