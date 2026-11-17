'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlanChange } from '@/app/api/plan/route';
import type { ShuttleResponse } from '@/app/api/shuttle/route';
import { defaultPrefs, parkedUp } from '@/lib/alerts.ts';
import { answerFor } from '@/lib/answer.ts';
import { advanceProgress, planAnswer, planDay } from '@/lib/plan.ts';
import { CAMPUS, HOME, hasClasses, hasPlan, stopWalkMinutes } from '@/lib/schedule.ts';
import { serviceState } from '@/lib/service.ts';
import { formatClock, formatSince, tempeDayKey } from '@/lib/time.ts';
import type { Progress, QuickTrip as Trip, Route, Schedule } from '@/lib/types.ts';
import { post, useAccount } from './Account';
import { TopBar } from './AppShell';
import QuickTrip from './QuickTrip';
import { JoinGate, SignInCard } from './SignIn';
import Timeline, { type OverrideChange } from './Timeline';

const ShuttleMap = dynamic(() => import('./ShuttleMap'), {
  ssr: false,
  loading: () => <div className="map map-loading" aria-hidden />,
});

const POLL_MS = 15_000;

type Fetched = { body: ShuttleResponse; requestedAt: number };

function useShuttle(signedIn: boolean) {
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    async function poll() {
      clearTimeout(timer);
      if (document.visibilityState === 'visible') {
        const requestedAt = Date.now();
        try {
          const res = await fetch('/api/shuttle', { cache: 'no-store' });
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
    // Signing in or out changes what the same address answers with, so ask again straight away.
  }, [signedIn]);

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
  if (parked && seconds >= 30) return `Parked ${Math.max(1, Math.round(seconds / 60))} min`;
  return seconds < 60 ? `Live, ${seconds}s ago` : `${Math.round(seconds / 60)} min ago`;
}

export default function Tracker({ route }: { route: Route }) {
  const account = useAccount();
  const signedIn = account.status === 'ready';
  const joined = signedIn && account.view!.user.joined;
  const { fetched, failed } = useShuttle(signedIn);
  const data = fetched?.body ?? null;
  const now = useNow(5_000);
  const prefs = account.view?.prefs ?? defaultPrefs;
  /** Which stop a signed-out visitor is asking about. Signed in, it's saved with the account. */
  const [visitorStop, setVisitorStop] = useState<string>(HOME);
  const stopId = signedIn ? (prefs.stopId ?? HOME) : visitorStop;

  // A choice tapped on this phone shows at once; the server's copy takes over on the next fetch after it.
  const [local, setLocal] = useState<{ schedule: Schedule; at: number } | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [localProgress, setLocalProgress] = useState<Progress | null>(null);
  const serverSchedule = data?.private?.schedule ?? null;
  const schedule = local && fetched && local.at > fetched.requestedAt ? local.schedule : serverSchedule;
  const scheduleRef = useRef(schedule);
  scheduleRef.current = schedule;
  // Saves go one at a time: each one reads today's choices, adds to them and writes them back, so
  // two at once could drop one of them.
  const saving = useRef<Promise<unknown>>(Promise.resolve());

  const changeToday = useCallback(async (change: OverrideChange) => {
    const current = scheduleRef.current;
    if (!current) return;
    const date = tempeDayKey(Date.now());
    const today = current.override?.date === date ? current.override : { date, skipped: [] };
    setLocal({ schedule: { ...current, override: change === null ? null : { ...today, ...change } }, at: Date.now() });
    setPlanError(null);
    const send = async () => {
      const body: PlanChange = { override: change };
      const res = await post('/api/plan', body);
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
  }, []);

  const plan = useMemo(() => {
    if (!data?.private || !schedule || !hasPlan(schedule, tempeDayKey(data.now))) return null;
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

  const planned = useMemo(() => (plan && data ? planAnswer(plan, route, data.now) : null), [plan, data, route]);
  const eta = data?.etas.find((e) => e.stopId === stopId) ?? null;
  const answer = useMemo(() => {
    if (!data) return null;
    if (planned) return planned;
    // Outside the bus's days and hours, say so instead of "no signal", unless the bus is plainly out driving.
    const service = serviceState(data.now, data.private?.timetable ?? null);
    const driving = data.status === 'live' && (data.ping?.mph ?? 0) >= 4;
    if (!service.open && !driving) return { tone: 'unknown' as const, lead: 'Right now', headline: service.headline, detail: service.detail };
    return answerFor({
      route,
      // SoL is the walk from the apartment; Gammage is a typical walk across campus.
      prefs: { ...prefs, stopId, walkMinutes: stopWalkMinutes(prefs, stopId) },
      status: data.status,
      eta,
      now: data.now,
      lastSeenAt: data.lastSeen?.time ?? null,
      parkedSince: data.parkedSince,
      onRoute: data.located !== null,
    });
  }, [data, eta, planned, prefs, route, stopId]);

  // The stop the next ride is caught at. On a class day that's the plan's call; otherwise the picker's.
  const focusStopId = useMemo(() => {
    if (plan && data) {
      const ride = plan.legs.find((leg) => leg.kind === 'bus' && leg.bus && (leg.end ?? Infinity) > data.now);
      if (ride?.bus) return ride.bus.stopId;
      if (plan.homeWatch) return CAMPUS;
    }
    return stopId;
  }, [plan, data, stopId]);

  const upcoming = useMemo(() => [...(data?.etas ?? [])].sort((a, b) => a.seconds - b.seconds), [data]);
  const parkedSince = data?.parkedSince ?? null;
  const out = parkedUp(parkedSince, data?.now ?? now);
  const live = data?.status === 'live' && !out;
  const moving = live && (data?.ping?.mph ?? 0) >= 4;
  const detour = live && Boolean(data?.ping) && data!.located === null;
  const nextStop = route.stops.find((s) => s.id === upcoming.find((e) => !e.atStop)?.stopId);
  const stoppedAt = route.stops.find((s) => s.id === upcoming.find((e) => e.atStop)?.stopId);

  // Built from the bus's place on the loop: Samsara's street addresses are often a block or two off.
  let caption = out ? `Parked since ${formatSince(parkedSince!, data!.now)}` : 'Last known position';
  if (live && stoppedAt) caption = `Stopped at ${stoppedAt.name}`;
  else if (detour && nextStop) caption = `Off its usual route, heading to ${nextStop.name}`;
  else if (detour) caption = 'Off its usual route';
  else if (live && nextStop) caption = `${moving ? `${Math.round(data!.ping!.mph)} mph` : 'Waiting'}, heading to ${nextStop.name}`;
  else if (live) caption = moving ? `${Math.round(data!.ping!.mph)} mph` : 'Stopped';

  const view = account.view;
  const watchActive = Boolean(view?.watchUntil && view.watchUntil > now);

  return (
    <main className="page today">
      <TopBar>
        <p className="freshness" data-live={live} role="status">
          <span className="dot" aria-hidden />
          {failed ? 'Connection lost' : out ? 'Not moving' : freshness(now, data?.ping?.time, live && (data?.ping?.mph ?? 0) < 2)}
        </p>
      </TopBar>

      <section className="hero" data-tone={answer?.tone ?? 'loading'} aria-live="polite">
        {answer ? (
          <>
            <p className="hero-lead">{answer.lead}</p>
            <h1 className="hero-headline">{answer.headline}</h1>
            <p className="hero-detail">{answer.detail}</p>
          </>
        ) : (
          <>
            <div className="skeleton skeleton-lead" />
            <div className="skeleton skeleton-headline" />
            <div className="skeleton skeleton-detail" />
          </>
        )}
        {live && upcoming.length > 0 && (
          <ul className="hero-stops" aria-label="Next arrivals">
            {upcoming.map((item) => {
              const stop = route.stops.find((s) => s.id === item.stopId);
              if (!stop) return null;
              return (
                <li key={item.stopId}>
                  <span>{stop.name}</span>
                  <strong>{item.atStop ? 'Here now' : `${item.rough ? '~' : ''}${formatClock(data!.now + item.seconds * 1000)}`}</strong>
                </li>
              );
            })}
          </ul>
        )}
        {!planned && route.stops.length > 1 && (
          <div className="hero-switch segmented" role="group" aria-label="Where you catch the bus">
            {route.stops
              .slice()
              .sort((a, b) => Number(b.id === HOME) - Number(a.id === HOME))
              .map((stop) => (
                <button
                  key={stop.id}
                  aria-pressed={stop.id === stopId}
                  onClick={() => (signedIn ? account.update({ prefs: { stopId: stop.id } }) : setVisitorStop(stop.id))}
                >
                  From {stop.name}
                </button>
              ))}
          </div>
        )}
      </section>

      <div className="map-card">
        <ShuttleMap
          route={route}
          ping={data?.lastSeen ?? null}
          live={live}
          s={data?.ping ? (data.located?.s ?? null) : null}
          ageMs={data?.ping ? data.now - data.ping.time : 0}
          focusStopId={focusStopId}
          detour={detour}
          lastS={data?.lastS ?? null}
          recent={data?.trail ?? []}
        />
        {data?.lastSeen && (
          <p className="map-caption" data-detour={detour}>
            {caption}
          </p>
        )}
      </div>

      <div className="stack">
        {account.status === 'signed-out' && <SignInCard />}
        {signedIn && !joined && <JoinGate />}
        {account.status === 'failed' && (
          <section className="panel">
            <p className="error" role="alert">
              Couldn&apos;t load your account. The live bus still works.
            </p>
            <button className="button" onClick={account.reload}>
              Try again
            </button>
          </section>
        )}

        {plan && schedule && data && <Timeline plan={plan} schedule={schedule} route={route} now={data.now} onChange={changeToday} />}
        {planError && (
          <p className="error" role="alert">
            {planError}
          </p>
        )}

        {joined && schedule && data && (
          <QuickTrip
            now={data.now}
            timetable={data.private?.timetable ?? null}
            count={schedule.override?.date === tempeDayKey(data.now) ? (schedule.override.trips?.length ?? 0) : 0}
            onAdd={(trip: Trip) => {
              const today = schedule.override?.date === tempeDayKey(data.now) ? (schedule.override.trips ?? []) : [];
              changeToday({ trips: [...today, trip] });
            }}
          />
        )}

        {joined && schedule && !hasClasses(schedule) && (
          <section className="panel setup">
            <div>
              <h2>Plan your class days</h2>
              <p className="note">Add your classes and the app works out which bus to catch, each walk, and the way home.</p>
            </div>
            <Link className="button primary" href="/schedule">
              Add classes
            </Link>
          </section>
        )}

        {joined && view?.subscribed && !plan?.homeWatch && (
          <section className="panel watch">
            <div>
              <h2>{watchActive ? 'Watching this bus' : 'A trip that isn’t in your plan?'}</h2>
              <p className="note">
                {watchActive
                  ? `Alerts for ${route.stops.find((s) => s.id === stopId)?.name ?? 'your stop'} until ${formatClock(view.watchUntil!)}.`
                  : 'Get the leave and arrival alerts for the next hour, whatever your classes say.'}
              </p>
            </div>
            <button className="button" aria-pressed={watchActive} onClick={() => account.update({ watchMinutes: watchActive ? 0 : 60 })}>
              {watchActive ? 'Stop' : 'Watch 1 hour'}
            </button>
          </section>
        )}

        {live && (
          <p className="note fine">
            {upcoming.some((item) => item.rough)
              ? 'The bus is off its usual route, so times are rough, worked out from how far away it is.'
              : `Times are estimates learned from the bus itself. ${plan?.service ?? ''}`}
          </p>
        )}
        <p className="note fine">
          <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link>. An independent project by a SoL resident, not run by SoL, ASU or Samsara.
        </p>
      </div>
    </main>
  );
}
