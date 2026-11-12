'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { PlanChange } from '@/app/api/plan/route';
import type { ShuttleResponse } from '@/app/api/shuttle/route';
import { defaultPrefs, parkedUp } from '@/lib/alerts.ts';
import { answerFor } from '@/lib/answer.ts';
import { advanceProgress, planAnswer, planDay } from '@/lib/plan.ts';
import { CAMPUS, hasClasses, stopWalkMinutes } from '@/lib/schedule.ts';
import { formatClock, formatSince, tempeDayKey } from '@/lib/time.ts';
import type { Progress, Route, Schedule } from '@/lib/types.ts';
import AlertsPanel from './AlertsPanel';
import Timeline, { type OverrideChange } from './Timeline';
import { useSettings } from './useSettings';

const ShuttleMap = dynamic(() => import('./ShuttleMap'), {
  ssr: false,
  loading: () => <div className="map map-loading" aria-hidden />,
});

const POLL_MS = 15_000;


type Fetched = { body: ShuttleResponse; requestedAt: number };

function useShuttle(passcode: string | null) {
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (passcode === null) return;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    async function poll() {
      clearTimeout(timer);
      if (document.visibilityState === 'visible') {
        const requestedAt = Date.now();
        try {
          const res = await fetch('/api/shuttle', { cache: 'no-store', headers: { 'x-passcode': passcode ?? '' } });
          if (!res.ok) throw new Error(String(res.status));
          const body = (await res.json()) as ShuttleResponse;
          if (!cancelled) {
            setFetched({ body, requestedAt });
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
  }, [passcode]);

  return { fetched, failed };
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

function PasscodeGate({ onUnlock, error }: { onUnlock: (code: string) => void; error: string | null }) {
  const [code, setCode] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    if (code) onUnlock(code);
  }
  return (
    <form className="section gate" onSubmit={submit}>
      <h2>Your day is locked</h2>
      <p className="note">The bus is public. Your stop, classes and alerts need the passcode, once on each device.</p>
      <label className="field">
        <span>Passcode</span>
        <input type="password" autoComplete="current-password" value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="button primary" type="submit" disabled={!code}>
        Unlock
      </button>
    </form>
  );
}

export default function Tracker({ route }: { route: Route }) {
  const settings = useSettings();
  const { fetched, failed } = useShuttle(settings.passcode);
  const data = fetched?.body ?? null;
  const now = useNow(5_000);
  const prefs = settings.view?.prefs ?? defaultPrefs;

  // A choice tapped on this phone shows at once; the server's copy takes over on the next fetch after it.
  const [local, setLocal] = useState<{ schedule: Schedule; at: number } | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [localProgress, setLocalProgress] = useState<Progress | null>(null);
  const serverSchedule = data?.private?.schedule ?? null;
  const schedule = local && fetched && local.at > fetched.requestedAt ? local.schedule : serverSchedule;
  const scheduleRef = useRef(schedule);
  scheduleRef.current = schedule;
  // Saves go one at a time: each one reads today's choices, adds to them and writes them back, so
  // two at once (a tap and a location reading, say) could drop one of them.
  const saving = useRef<Promise<unknown>>(Promise.resolve());

  const changeToday = useCallback(
    async (change: OverrideChange) => {
      const current = scheduleRef.current;
      if (!current) return;
      const date = tempeDayKey(Date.now());
      const today = current.override?.date === date ? current.override : { date, skipped: [] };
      setLocal({ schedule: { ...current, override: change === null ? null : { ...today, ...change } }, at: Date.now() });
      setPlanError(null);
      const send = async () => {
        const body: PlanChange = { override: change };
        const res = await fetch('/api/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-passcode': settings.passcode ?? '' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as { schedule: Schedule };
      };
      const turn = saving.current.then(send, send);
      saving.current = turn.catch(() => undefined);
      try {
        const saved = await turn;
        // A later save may already be showing its own change; the last one to finish has them all.
        setLocal({ schedule: saved.schedule, at: Date.now() });
      } catch {
        setLocal(null);
        setPlanError("Couldn't save that choice. Try again.");
      }
    },
    [settings.passcode],
  );

  const plan = useMemo(() => {
    if (!data?.private || !schedule || !hasClasses(schedule)) return null;
    const server = data.private.progress;
    const date = tempeDayKey(data.now);
    const boarded = { ...(localProgress?.date === date ? localProgress.boarded : {}), ...(server?.date === date ? server.boarded : {}) };
    return planDay({
      now: data.now,
      schedule,
      route,
      prefs,
      live: { status: data.status, etas: data.etas, parked: parkedUp(data.parkedSince, data.now) },
      timetable: data.private.timetable,
      progress: { date, boarded },
    });
  }, [data, schedule, route, prefs, localProgress]);

  // The moment to leave has passed: hold on to that bus here too, so the screen doesn't jump ahead
  // of the server's next check.
  useEffect(() => {
    if (!plan || !data) return;
    const step = advanceProgress(localProgress, plan, data.now);
    if (step.committed.length > 0) setLocalProgress(step.progress);
  }, [plan, data, localProgress]);

  const eta = data?.etas.find((e) => e.stopId === prefs.stopId) ?? null;
  const answer = useMemo(() => {
    if (!data) return null;
    const planned = plan && planAnswer(plan, route, data.now);
    if (planned) return planned;
    return answerFor({
      route,
      // SoL is the walk from the apartment; Gammage is a typical walk across campus.
      prefs: { ...prefs, walkMinutes: stopWalkMinutes(prefs, prefs.stopId) },
      status: data.status,
      eta,
      now: data.now,
      lastSeenAt: data.lastSeen?.time ?? null,
      parkedSince: data.parkedSince,
      onRoute: data.located !== null,
    });
  }, [data, eta, plan, prefs, route]);

  // The stop the next ride is caught at. On a class day that's the plan's call; otherwise the picker's.
  const focusStopId = useMemo(() => {
    if (plan && data) {
      const ride = plan.legs.find((leg) => leg.kind === 'bus' && leg.bus && (leg.end ?? Infinity) > data.now);
      if (ride?.bus) return ride.bus.stopId;
      if (plan.homeWatch) return CAMPUS;
    }
    return prefs.stopId;
  }, [plan, data, prefs.stopId]);

  const upcoming = useMemo(() => [...(data?.etas ?? [])].sort((a, b) => a.seconds - b.seconds), [data]);
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

  const unlocked = Boolean(data?.private);

  return (
    <main className="app">
      <header className="top">
        {route.stops.length > 0 && settings.view ? (
          <label className="stop-picker">
            <span className="visually-hidden">Where you catch the bus</span>
            <select value={prefs.stopId ?? ''} onChange={(e) => settings.update({ prefs: { stopId: e.target.value } })}>
              <option value="" disabled>
                Where you catch the bus
              </option>
              {route.stops.map((stop) => (
                <option key={stop.id} value={stop.id}>
                  From {stop.name}
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

      {settings.locked && <PasscodeGate onUnlock={settings.unlock} error={settings.error} />}
      {settings.failed && (
        <section className="section">
          <p className="error" role="alert">
            Couldn't load your settings. The bus map still works.
          </p>
          <button className="button" onClick={settings.retry}>
            Try again
          </button>
        </section>
      )}

      {plan && schedule && data && <Timeline plan={plan} schedule={schedule} route={route} now={data.now} onChange={changeToday} />}
      {planError && (
        <p className="error inset" role="alert">
          {planError}
        </p>
      )}
      {unlocked && schedule && !hasClasses(schedule) && (
        <section className="section">
          <div className="setup">
            <div>
              <h3>Plan your class days</h3>
              <p className="note">Add your classes and the app works out which bus to catch, each walk, and the way home.</p>
            </div>
            <Link className="button" href="/schedule">
              Add classes
            </Link>
          </div>
        </section>
      )}

      <div className="map-wrap">
        <ShuttleMap
          route={route}
          ping={data?.lastSeen ?? null}
          live={live}
          s={data?.ping ? (data.located?.s ?? null) : null}
          ageMs={data?.ping ? data.now - data.ping.time : 0}
          focusStopId={focusStopId}
        />
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
                  <span className="stop-time">{item.atStop ? 'Here now' : formatClock(data!.now + item.seconds * 1000)}</span>
                </li>
              );
            })}
          </ol>
          <p className="note">
            Times are estimates from {route.loopsObserved} recorded {route.loopsObserved === 1 ? 'loop' : 'loops'}.
          </p>
        </section>
      )}

      <AlertsPanel settings={settings} hasStops={route.stops.length > 0} planning={Boolean(plan)} />
    </main>
  );
}
