'use client';

import Link from 'next/link';
import { busLine, type DayPlan, type Leg } from '@/lib/plan.ts';
import { formatClock } from '@/lib/time.ts';
import type { DayOverride, Route, Schedule } from '@/lib/types.ts';

export type OverrideChange = Partial<Omit<DayOverride, 'date'>> | null;

type Props = {
  plan: DayPlan;
  schedule: Schedule;
  route: Route;
  now: number;
  onChange: (change: OverrideChange) => void;
};

const MIN = 60_000;

const ICONS: Record<Leg['kind'], React.ReactNode> = {
  bus: (
    <svg viewBox="0 0 20 20" aria-hidden>
      <rect x="3.5" y="3" width="13" height="11.5" rx="3" />
      <path d="M3.5 9.5h13M6.5 17v-2.5M13.5 17v-2.5" />
    </svg>
  ),
  walk: (
    <svg viewBox="0 0 20 20" aria-hidden>
      <circle cx="11" cy="3.8" r="1.6" />
      <path d="M10.5 7.5 8 10.5l2.5 2.2.8 4.3M10.5 7.5l2.2 2.3 2.8.7M8.3 13.5 6 17" />
    </svg>
  ),
  class: (
    <svg viewBox="0 0 20 20" aria-hidden>
      <path d="M2.5 8 10 4.5 17.5 8 10 11.5z" />
      <path d="M5.5 9.8v3.4c1.2 1.1 2.7 1.7 4.5 1.7s3.3-.6 4.5-1.7V9.8" />
    </svg>
  ),
};

function detail(leg: Leg, route: Route): string {
  if (leg.kind === 'bus') {
    const stop = leg.bus && leg.walkMin ? ` ${leg.walkMin} min walk to the stop.` : '';
    return `${busLine(leg, route)}${stop}${leg.lastBus ? ' Last bus today.' : ''}`;
  }
  if (leg.kind === 'walk') return `${leg.walkMin} min, there by ${formatClock(leg.end!)}.`;
  const where = [leg.place, leg.room].filter(Boolean).join(', ');
  return leg.skipped ? 'Skipped today.' : `${where ? `${where}. ` : ''}Until ${formatClock(leg.end!)}.`;
}

/** The ride home if you left after this class. Shown while the class is still to come or just over. */
function busHomeAfter(leg: Leg): string | null {
  if (!leg.after || leg.skipped) return null;
  const { leaveBy, at, here } = leg.after;
  return here ? 'Bus home is at Gammage now.' : `Bus home after this: leave by ${formatClock(leaveBy)} for the ${formatClock(at)} bus.`;
}

function stateOf(leg: Leg, now: number): 'past' | 'now' | 'later' {
  if (leg.skipped || (leg.end !== null && leg.end <= now)) return 'past';
  if (leg.committed || (leg.start !== null && leg.start <= now)) return 'now';
  return 'later';
}

export default function Timeline({ plan, schedule, route, now, onChange }: Props) {
  const override = schedule.override?.date === plan.date ? schedule.override : null;
  const skipped = override?.skipped ?? [];
  const classes = plan.legs.filter((leg) => leg.kind === 'class');
  const taken = classes.filter((leg) => !leg.skipped);
  // Left campus by hand, on the bus, or home: either way the class-time controls no longer apply.
  const leftEarly = override?.leftAt !== undefined || override?.onBusAt !== undefined || override?.homeAt !== undefined;
  const inClass = leftEarly ? undefined : taken.find((leg) => leg.start! <= now && now < leg.end!);
  const laterClasses = inClass ? taken.filter((leg) => leg.start! >= inClass.end!) : [];
  const onCampusNow = !leftEarly && taken.length > 0 && now >= taken[0].start! - 20 * MIN && now < Math.max(...taken.map((leg) => leg.end!));
  const committed = plan.legs.some((leg) => leg.committed);
  // Going home after the class you're in only needs saying when something else was planned after it.
  const canHeadHome = inClass && laterClasses.length > 0;
  const hasChoices = override !== null && (skipped.length > 0 || Object.keys(override).some((key) => key !== 'date' && key !== 'skipped'));
  const watch = plan.homeWatch;

  function toggleSkip(classId: string) {
    onChange({ skipped: skipped.includes(classId) ? skipped.filter((id) => id !== classId) : [...skipped, classId] });
  }

  function leaveCampus() {
    const last = taken.filter((leg) => leg.end! <= now).at(-1) ?? taken[0];
    const block = schedule.classes.find((c) => c.id === last.classId);
    const unfinished = classes.filter((leg) => leg.end! > now).map((leg) => leg.classId!);
    onChange({ skipped: [...new Set([...skipped, ...unfinished])], leftAt: now, leftPlaceId: block?.placeId });
  }

  function homeAfterThisClass() {
    onChange({ skipped: [...new Set([...skipped, ...laterClasses.map((leg) => leg.classId!)])] });
  }

  function classIsOut(classId: string) {
    onChange({ outEarly: { ...(override?.outEarly ?? {}), [classId]: now } });
  }

  return (
    <section className="today-plan" aria-labelledby="today-title">
      <div className="section-head">
        <h2 id="today-title">Today</h2>
        <Link className="text-link" href="/schedule">
          Edit classes
        </Link>
      </div>

      {watch && (
        <div className="ride-home">
          <p className="ride-home-lead">{watch.course ? `After ${watch.course}` : 'From campus'}</p>
          <h3>{watch.next ? (watch.next.here ? 'Bus home is at Gammage now' : `Bus home ${formatClock(watch.next.at)}`) : 'Watching for a bus home'}</h3>
          <p>
            {watch.next
              ? `Leave ${watch.place} by ${formatClock(watch.next.leaveBy)}, ${watch.walkMin} min walk. Home about ${formatClock(watch.next.home)}.`
              : watch.until
                ? `Nothing you could leave ${watch.place} for before your next class.`
                : `No bus time right now. You'll hear about each one, timed from ${watch.place}.`}
            {watch.until === null && ' Alerts for each bus keep coming until you tap one of these.'}
          </p>
          <div className="button-row">
            <button className="button" onClick={() => onChange({ onBusAt: now })}>
              I&apos;m on the bus
            </button>
            <button className="button" onClick={() => onChange({ homeAt: now })}>
              I&apos;m home
            </button>
          </div>
        </div>
      )}

      {plan.legs.length > 0 ? (
        <ol className="timeline">
          {plan.legs.map((leg) => {
            const state = stateOf(leg, now);
            const home = leg.kind === 'class' ? busHomeAfter(leg) : null;
            const inProgress = leg.kind === 'class' && !leg.skipped && leg.start! <= now && now < leg.end!;
            return (
              <li key={leg.id} className="leg" data-kind={leg.kind} data-state={state}>
                <span className="leg-time">{leg.start !== null ? formatClock(leg.start) : 'Later'}</span>
                <span className="leg-node">{ICONS[leg.kind]}</span>
                <div className="leg-body">
                  <p className="leg-title">{leg.title}</p>
                  {leg.tripLabel && <p className="leg-detail">{leg.tripLabel}</p>}
                  <p className="leg-detail">{detail(leg, route)}</p>
                  {leg.note && (leg.kind !== 'bus' || leg.bus) && <p className="leg-detail">{leg.note}</p>}
                  {home && <p className="leg-detail">{home}</p>}
                  {leg.warn && <p className="leg-warn">{leg.warn}</p>}
                  {leg.tripId && !leg.committed && (
                    <button className="button small" onClick={() => onChange({ trips: (override?.trips ?? []).filter((trip) => trip.id !== leg.tripId) })}>
                      Remove this trip
                    </button>
                  )}
                  {inProgress && !leftEarly && (
                    <button className="button small" onClick={() => classIsOut(leg.classId!)}>
                      {leg.visit ? 'Done here' : 'Class is out'}
                    </button>
                  )}
                  {leg.kind === 'class' && leg.start! > now && !leftEarly && (
                    <button className="button small" aria-pressed={Boolean(leg.skipped)} onClick={() => toggleSkip(leg.classId!)}>
                      {leg.skipped ? 'Skipped, undo' : 'Skip today'}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="note">Nothing planned for the rest of today.</p>
      )}

      {(canHeadHome || onCampusNow || committed || hasChoices) && (
        <div className="button-row wrap">
          {canHeadHome && (
            <button className="button" onClick={homeAfterThisClass}>
              Home after this class
            </button>
          )}
          {onCampusNow && !inClass && (
            <button className="button" onClick={leaveCampus}>
              Leaving campus now
            </button>
          )}
          {committed && (
            <button className="button" onClick={() => onChange({ replanAt: now })}>
              Missed it, plan again
            </button>
          )}
          {hasChoices && (
            <button className="button quiet" onClick={() => onChange(null)}>
              Reset today
            </button>
          )}
        </div>
      )}
    </section>
  );
}
