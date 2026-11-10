'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import type { ShuttleResponse } from '@/app/api/shuttle/route';
import { defaultPrefs, parkedUp } from '@/lib/alerts.ts';
import { answerFor } from '@/lib/answer.ts';
import { formatClock, formatSince } from '@/lib/time.ts';
import type { Route } from '@/lib/types.ts';
import { useSettings } from './useSettings';
import AlertsPanel from './AlertsPanel';

const ShuttleMap = dynamic(() => import('./ShuttleMap'), {
  ssr: false,
  loading: () => <div className="map map-loading" aria-hidden />,
});

const POLL_MS = 15_000;

function useShuttle() {
  const [data, setData] = useState<ShuttleResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    async function poll() {
      clearTimeout(timer);
      if (document.visibilityState === 'visible') {
        try {
          const res = await fetch('/api/shuttle', { cache: 'no-store' });
          if (!res.ok) throw new Error(String(res.status));
          const body = (await res.json()) as ShuttleResponse;
          if (!cancelled) {
            setData(body);
            setFailed(false);
          }
        } catch {
          if (!cancelled) setFailed(true);
        }
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    }

    poll();
    document.addEventListener('visibilitychange', poll);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', poll);
    };
  }, []);

  return { data, failed };
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function freshness(now: number, time: number | undefined, parked: boolean): string {
  if (!time) return 'Waiting for the bus';
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  // A parked bus stops reporting, so a quiet feed here means "not moving", not "out of date".
  if (parked && seconds >= 30) return `Parked for ${Math.max(1, Math.round(seconds / 60))} min`;
  return seconds < 60 ? `Updated ${seconds}s ago` : `Updated ${Math.round(seconds / 60)} min ago`;
}

export default function Tracker({ route }: { route: Route }) {
  const { data, failed } = useShuttle();
  const settings = useSettings();
  const now = useNow(5_000);
  const prefs = settings.view?.prefs ?? defaultPrefs;

  const eta = data?.etas.find((e) => e.stopId === prefs.stopId) ?? null;
  const answer = useMemo(
    () =>
      data &&
      answerFor({
        route,
        prefs,
        status: data.status,
        eta,
        now: data.now,
        lastSeenAt: data.lastSeen?.time ?? null,
        parkedSince: data.parkedSince,
        onRoute: data.located !== null,
      }),
    [data, eta, prefs, route],
  );

  const upcoming = useMemo(
    () => [...(data?.etas ?? [])].sort((a, b) => a.seconds - b.seconds),
    [data],
  );
  const parkedSince = data?.parkedSince ?? null;
  const out = parkedUp(parkedSince, data?.now ?? now);
  const live = data?.status === 'live' && !out;
  const moving = live && (data?.ping?.mph ?? 0) >= 4;
  const nextStop = route.stops.find((s) => s.id === upcoming.find((e) => !e.atStop)?.stopId);
  const stoppedAt = route.stops.find((s) => s.id === upcoming.find((e) => e.atStop)?.stopId);

  // Built from the bus's place on the loop: Samsara's street addresses are often a block or two off.
  let caption = out ? `Parked since ${formatSince(parkedSince!, data!.now)}` : 'Last known position';
  if (live && stoppedAt) caption = `Stopped at ${stoppedAt.name}`;
  else if (live && nextStop) caption = `${moving ? `${Math.round(data!.ping!.mph)} mph` : 'Waiting'}, heading to ${nextStop.name}`;
  else if (live) caption = moving ? `${Math.round(data!.ping!.mph)} mph` : 'Stopped';

  return (
    <main className="app">
      <header className="top">
        {route.stops.length > 0 ? (
          <label className="stop-picker">
            <span className="visually-hidden">Your stop</span>
            <select
              value={prefs.stopId ?? ''}
              onChange={(e) => settings.update({ prefs: { stopId: e.target.value } })}
            >
              <option value="" disabled>
                Choose your stop
              </option>
              {route.stops.map((stop) => (
                <option key={stop.id} value={stop.id}>
                  {stop.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="stop-picker-static">SoL Shuttle</span>
        )}
        <p className="freshness" data-live={live} role="status">
          <span className="dot" aria-hidden />
          {failed ? 'Connection lost' : out ? 'Not moving' : freshness(now, data?.ping?.time, live && (data?.ping?.mph ?? 0) < 2)}
        </p>
      </header>

      <section className="answer" data-tone={answer?.tone ?? 'loading'} aria-live="polite">
        {answer ? (
          <>
            <p className="answer-lead">{answer.lead}</p>
            <h1 className="answer-headline">{answer.headline}</h1>
            <p className="answer-detail">{answer.detail}</p>
          </>
        ) : (
          <>
            <div className="skeleton skeleton-lead" />
            <div className="skeleton skeleton-headline" />
            <div className="skeleton skeleton-detail" />
          </>
        )}
      </section>

      <div className="map-wrap">
        <ShuttleMap route={route} ping={data?.lastSeen ?? null} live={live} selectedStopId={prefs.stopId} />
        {data?.lastSeen && <p className="map-caption">{caption}</p>}
      </div>

      {live && upcoming.length > 0 && (
        <section className="section" aria-labelledby="stops-title">
          <h2 id="stops-title">Coming up</h2>
          <ol className="stops">
            {upcoming.map((item) => {
              const stop = route.stops.find((s) => s.id === item.stopId);
              if (!stop) return null;
              return (
                <li key={item.stopId} data-selected={item.stopId === prefs.stopId}>
                  <span className="stop-name">{stop.name}</span>
                  <span className="stop-time">
                    {item.atStop ? 'Here now' : formatClock(data!.now + item.seconds * 1000)}
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="note">
            Times are estimates from {route.loopsObserved} recorded {route.loopsObserved === 1 ? 'loop' : 'loops'}.
          </p>
        </section>
      )}

      <AlertsPanel settings={settings} hasStops={route.stops.length > 0} />
    </main>
  );
}
