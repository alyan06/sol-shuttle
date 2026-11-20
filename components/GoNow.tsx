'use client';

import { useState } from 'react';
import { GO_NOW_LASTS_MS, type DayPlan } from '@/lib/plan.ts';
import { CAMPUS, HOME, estimateWalk } from '@/lib/schedule.ts';
import { metresBetween } from '@/lib/geo.ts';
import { serviceState } from '@/lib/service.ts';
import { formatClock, tempeDayKey } from '@/lib/time.ts';
import type { GoNow as Going, Route, Schedule, Timetable } from '@/lib/types.ts';
import type { OverrideChange } from './Timeline';

const MIN = 60_000;
const CHOICES = [0, 2, 5, 10, 15, 20];
/** Closer than this to the stop counts as being at it: phone GPS is rarely better than this in town. */
const AT_STOP_M = 60;

type Props = {
  now: number;
  plan: DayPlan | null;
  schedule: Schedule;
  route: Route;
  /** What's known about the bus's hours today. */
  timetable: Timetable | null;
  onChange: (change: OverrideChange) => void;
};

/**
 * "I'm heading home / to campus now": the person says how far they are from the stop, or lets the
 * phone work it out once, and the plan takes the next bus they can still reach. A position, if
 * used, stays on the phone: only the minutes are sent.
 */
export default function GoNow({ now, plan, schedule, route, timetable, onChange }: Props) {
  const today = schedule.override?.date === tempeDayKey(now) ? schedule.override : null;
  const active = today?.goNow && today.goNow.at > now - GO_NOW_LASTS_MS ? today.goNow : null;
  // On campus or after a class, home is the likely way; otherwise campus.
  const onCampus = Boolean(plan?.homeWatch) || Boolean(plan?.legs.some((leg) => leg.kind === 'class' && !leg.skipped && leg.start! <= now + 20 * MIN && leg.end! > now - 60 * MIN));
  const [asking, setAsking] = useState<Going['to'] | null>(null);
  const [locating, setLocating] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const stopFor = (to: Going['to']) => route.stops.find((s) => s.id === (to === 'home' ? CAMPUS : HOME));

  function go(to: Going['to'], walkMin: number) {
    const at = Date.now();
    const change: OverrideChange = { goNow: { to, at, walkMin } };
    // Heading home now: what's left of today's classes is off, the same as leaving campus.
    if (to === 'home' && plan) {
      const unfinished = plan.legs.filter((leg) => leg.kind === 'class' && !leg.skipped && leg.end! > at).map((leg) => leg.classId!);
      if (unfinished.length > 0) change.skipped = [...new Set([...(today?.skipped ?? []), ...unfinished])];
    }
    onChange(change);
    setAsking(null);
    setProblem(null);
  }

  function locate(to: Going['to']) {
    const stop = stopFor(to);
    if (!stop || !('geolocation' in navigator)) {
      setProblem('This phone can’t share its location here. Pick how far you are instead.');
      return;
    }
    setLocating(true);
    setProblem(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const here = { lat: position.coords.latitude, lng: position.coords.longitude };
        if (metresBetween(here, stop) <= AT_STOP_M) return go(to, 0);
        const minutes = estimateWalk(here, stop, schedule.paceMPerMin);
        if (minutes > 60) return setProblem(`You look to be more than an hour’s walk from the ${stop.name} stop, so this can’t plan it.`);
        go(to, minutes);
      },
      (error) => {
        setLocating(false);
        setProblem(error.code === error.PERMISSION_DENIED ? 'Location is off for this app. Pick how far you are instead.' : 'Couldn’t find where you are. Pick how far you are instead.');
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    );
  }

  if (active) {
    const stop = stopFor(active.to);
    const where = active.walkMin === 0 ? `at the ${stop?.name ?? ''} stop` : `${active.walkMin} min from the ${stop?.name ?? ''} stop`;
    return (
      <section className="panel go-now" aria-labelledby="go-title">
        <div>
          <h2 id="go-title">{active.to === 'home' ? 'Heading home' : 'Heading to campus'}</h2>
          <p className="note">
            Since {formatClock(active.at)}, {where}. The bus at the top is the next one you can reach from there.
          </p>
        </div>
        <div className="button-row wrap">
          <button className="button" onClick={() => setAsking(active.to)}>
            I&apos;ve moved
          </button>
          {active.to === 'home' && (
            <button className="button" onClick={() => onChange({ onBusAt: Date.now(), goNow: null })}>
              I&apos;m on the bus
            </button>
          )}
          <button className="button quiet" onClick={() => onChange({ goNow: null })}>
            Not going now
          </button>
        </div>
        {asking && <Distance to={asking} stopName={stopFor(asking)?.name ?? 'the'} locating={locating} onPick={(m) => go(asking, m)} onLocate={() => locate(asking)} onClose={() => setAsking(null)} />}
        {problem && <p className="error" role="alert">{problem}</p>}
      </section>
    );
  }

  // Outside the bus's hours there's nothing to go now for.
  const service = serviceState(now, timetable);
  if (!service.open) {
    return (
      <section className="panel go-now" aria-labelledby="go-title">
        <div>
          <h2 id="go-title">Going now?</h2>
          <p className="note">
            {service.headline}. {service.detail}
          </p>
        </div>
      </section>
    );
  }

  const first: Going['to'] = onCampus ? 'home' : 'campus';
  const order: Going['to'][] = first === 'home' ? ['home', 'campus'] : ['campus', 'home'];
  return (
    <section className="panel go-now" aria-labelledby="go-title">
      <div>
        <h2 id="go-title">Going now?</h2>
        <p className="note">Say how far you are from the stop and the app finds the next bus you can make.</p>
      </div>
      {asking ? (
        <Distance to={asking} stopName={stopFor(asking)?.name ?? 'the'} locating={locating} onPick={(m) => go(asking, m)} onLocate={() => locate(asking)} onClose={() => setAsking(null)} />
      ) : (
        <div className="go-now-ways">
          {order.map((to) => (
            <button key={to} className={`button${to === first ? ' primary' : ''}`} onClick={() => setAsking(to)}>
              {to === 'home' ? 'Going home now' : 'Going to campus now'}
            </button>
          ))}
        </div>
      )}
      {problem && <p className="error" role="alert">{problem}</p>}
    </section>
  );
}

function Distance({
  to,
  stopName,
  locating,
  onPick,
  onLocate,
  onClose,
}: {
  to: Going['to'];
  stopName: string;
  locating: boolean;
  onPick: (minutes: number) => void;
  onLocate: () => void;
  onClose: () => void;
}) {
  return (
    <div className="go-now-ask" role="group" aria-label={`How far you are from the ${stopName} stop`}>
      <p className="go-now-question">How far are you from the {stopName} stop?</p>
      <div className="go-now-chips">
        {CHOICES.map((minutes) => (
          <button key={minutes} className="button small" onClick={() => onPick(minutes)}>
            {minutes === 0 ? 'At the stop' : `${minutes} min`}
          </button>
        ))}
      </div>
      <div className="button-row wrap">
        <button className="button" disabled={locating} onClick={onLocate}>
          {locating ? 'Finding you…' : 'Use my location'}
        </button>
        <button className="button quiet" onClick={onClose}>
          Cancel
        </button>
      </div>
      <p className="note fine">
        {to === 'home' ? 'Today’s classes you haven’t finished are skipped. ' : ''}
        Your location, if you use it, is only used on this phone to work out the minutes. It is never sent or kept.
      </p>
    </div>
  );
}
