'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SettingsView } from '@/app/api/settings/route';
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
  const [locked, setLocked] = useState(false);

  useEffect(() => setPasscodeState(storedPasscode()), []);

  useEffect(() => {
    if (passcode === null) return;
    let cancelled = false;
    async function load(code: string) {
      const registration = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
      const subscription = await registration?.pushManager.getSubscription().catch(() => null);
      const query = subscription ? `?endpoint=${encodeURIComponent(subscription.endpoint)}` : '';
      const res = await fetch(`/api/settings${query}`, { cache: 'no-store', headers: { 'x-passcode': code } });
      if (cancelled) return;
      if (res.status === 401) {
        setLocked(true);
        if (code) setError('That passcode is wrong.');
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      setView((await res.json()) as SettingsView);
      setLocked(false);
      setError(null);
    }
    load(passcode).catch(() => !cancelled && setError("Couldn't load your settings."));
    return () => {
      cancelled = true;
    };
  }, [passcode]);

  const unlock = useCallback((value: string) => {
    storePasscode(value);
    setError(null);
    setPasscodeState(value);
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

  return { view, error, setError, passcode, locked, unlock, update, setView };
}

export type Settings = ReturnType<typeof useSettings>;
