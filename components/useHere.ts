'use client';

import { useCallback, useEffect, useState } from 'react';
import { estimateWalk } from '@/lib/schedule.ts';

const KEY = 'shuttle.location';
const REFRESH_MS = 60_000;

export type Here = {
  /** off: never asked. on: allowed. denied: blocked in the browser. unavailable: the device has no location. */
  status: 'off' | 'on' | 'denied' | 'unavailable';
  /** Minutes on foot to the target from the last reading. The position itself never leaves this hook. */
  reading: { walkMin: number; at: number } | null;
  enable: () => void;
};

/**
 * Times the walk from where the phone is to a fixed point. It only reads the position while the
 * app is open and `wanted` is true, and only after the person has tapped to turn it on.
 */
export function useHere(target: { lat: number; lng: number } | null, paceMPerMin: number, wanted: boolean): Here {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<Here['status']>('on');
  const [reading, setReading] = useState<Here['reading']>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) === '1') setEnabled(true);
    } catch {
      // Private browsing: it has to be turned on again each visit.
    }
  }, []);

  const read = useCallback(() => {
    if (!target) return;
    if (!('geolocation' in navigator)) {
      setStatus('unavailable');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const from = { lat: position.coords.latitude, lng: position.coords.longitude };
        setStatus('on');
        setReading({ walkMin: estimateWalk(from, target, paceMPerMin), at: Date.now() });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) setStatus('denied');
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 15_000 },
    );
  }, [target, paceMPerMin]);

  useEffect(() => {
    if (!enabled || !wanted) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') read();
    };
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [enabled, wanted, read]);

  const enable = useCallback(() => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // Still works for this visit.
    }
    setEnabled(true);
    // Asked from the tap itself, which is when iPhone Safari is willing to show the permission prompt.
    read();
  }, [read]);

  return { status: enabled ? status : 'off', reading: enabled ? reading : null, enable };
}
