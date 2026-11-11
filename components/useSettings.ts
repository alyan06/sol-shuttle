'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SettingsView } from '@/app/api/settings/route';
import { subscriptionEndpoint } from '@/lib/push-client.ts';
import type { Prefs } from '@/lib/types.ts';

const PASSCODE_KEY = 'shuttle.passcode';

export type SettingsChange = {
  prefs?: Partial<Prefs>;
  watchMinutes?: number;
  subscribe?: PushSubscriptionJSON;
  unsubscribe?: string;
  test?: boolean;
};

export function storedPasscode(): string {
  try {
    return localStorage.getItem(PASSCODE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function storePasscode(value: string) {
  try {
    localStorage.setItem(PASSCODE_KEY, value);
  } catch {
    // Private browsing: the passcode just lasts for this visit.
  }
}

export function useSettings() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Null until this device's saved passcode has been read. */
  const [passcode, setPasscodeState] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'locked' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => setPasscodeState(storedPasscode()), []);

  useEffect(() => {
    if (passcode === null) return;
    let cancelled = false;
    async function load(code: string) {
      // Never lets a missing push feature (iPhone Safari outside the Home Screen app) block the page.
      const endpoint = await subscriptionEndpoint(navigator);
      const query = endpoint ? `?endpoint=${encodeURIComponent(endpoint)}` : '';
      const res = await fetch(`/api/settings${query}`, { cache: 'no-store', headers: { 'x-passcode': code } });
      if (cancelled) return;
      if (res.status === 401) {
        setStatus('locked');
        if (code) setError('That passcode is wrong.');
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      setView((await res.json()) as SettingsView);
      setStatus('ready');
      setError(null);
    }
    load(passcode).catch(() => !cancelled && setStatus('failed'));
    return () => {
      cancelled = true;
    };
  }, [passcode, attempt]);

  const retry = useCallback(() => {
    setStatus('loading');
    setAttempt((n) => n + 1);
  }, []);

  const unlock = useCallback((value: string) => {
    storePasscode(value);
    setError(null);
    // The lock screen stays up while the passcode is checked, so a wrong one can be corrected in place.
    setPasscodeState(value);
    // Counts as a fresh try even when the same passcode is entered again.
    setAttempt((n) => n + 1);
  }, []);

  const update = useCallback(
    async (change: SettingsChange): Promise<boolean> => {
      setError(null);
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-passcode': passcode ?? '' },
        body: JSON.stringify(change),
      });
      if (!res.ok) {
        setError(res.status === 401 ? 'That passcode is wrong.' : "Couldn't save that. Try again.");
        return false;
      }
      const next = (await res.json()) as SettingsView;
      setView((prev) => ({ ...next, subscribed: change.subscribe ? true : (prev?.subscribed ?? false) }));
      return true;
    },
    [passcode],
  );

  return { view, error, setError, passcode, locked: status === 'locked', failed: status === 'failed', retry, unlock, update, setView };
}

export type Settings = ReturnType<typeof useSettings>;
