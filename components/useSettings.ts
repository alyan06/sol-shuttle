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

function storedPasscode(): string {
  try {
    return localStorage.getItem(PASSCODE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function useSettings() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passcode, setPasscodeState] = useState('');

  useEffect(() => {
    setPasscodeState(storedPasscode());
    async function load() {
      const registration = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
      const subscription = await registration?.pushManager.getSubscription().catch(() => null);
      const query = subscription ? `?endpoint=${encodeURIComponent(subscription.endpoint)}` : '';
      const res = await fetch(`/api/settings${query}`, { cache: 'no-store' });
      if (res.ok) setView((await res.json()) as SettingsView);
    }
    load().catch(() => setError("Couldn't load your settings."));
  }, []);

  const setPasscode = useCallback((value: string) => {
    setPasscodeState(value);
    try {
      localStorage.setItem(PASSCODE_KEY, value);
    } catch {
      // Private browsing: the passcode just lasts for this visit.
    }
  }, []);

  const update = useCallback(
    async (change: SettingsChange): Promise<boolean> => {
      setError(null);
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-passcode': passcode },
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

  return { view, error, setError, passcode, setPasscode, update, setView };
}

export type Settings = ReturnType<typeof useSettings>;
