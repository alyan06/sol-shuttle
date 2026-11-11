'use client';

import Link from 'next/link';
import { busLine, type DayPlan, type Leg } from '@/lib/plan.ts';
import { HERE_MAX_WALK_MIN } from '@/lib/schedule.ts';
import { formatClock, inputToMinute, minuteToInput } from '@/lib/time.ts';
import type { AfterClass, DayOverride, Evening, Route, Schedule } from '@/lib/types.ts';
import type { Here } from './useHere';

export type OverrideChange = Partial<Omit<DayOverride, 'date'>> | null;

type Props = {
  plan: DayPlan;
  schedule: Schedule;
  route: Route;
  now: number;
  here: Here;
  onChange: (change: OverrideChange) => void;
};

const MIN = 60_000;
const AFTER_CLASS: { value: AfterClass; label: string }[] = [
  { value: 'gym', label: 'Gym' },
  { value: 'home', label: 'Home' },
];
const EVENING: { value: Evening; label: string }[] = [
  { value: 'bus', label: 'Bus' },
  { value: 'walk', label: 'Walk' },
  { value: 'skip', label: 'Skip' },
];

function Choice<T extends string>({ label, options, value, onPick }: { label: string; options: { value: T; label: string }[]; value: T; onPick: (value: T) => void }) {
  return (
    <div className="choice" role="group" aria-label={label}>
      <span className="choice-label">{label}</span>
      <div className="segmented">
        {options.map((option) => (
          <button key={option.value} aria-pressed={option.value === value} onClick={() => onPick(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function detail(leg: Leg, route: Route): string {
  if (leg.kind === 'bus') {
    const walk = leg.walkInstead ? ` On foot: ${leg.walkInstead.minutes} min${leg.walkInstead.leaveBy ? `, leave by ${formatClock(leg.walkInstead.leaveBy)}` : ''}.` : '';
    const stop = leg.bus && leg.walkMin ? ` ${leg.walkMin} min walk ${leg.fromHere ? 'from where you are' : 'to the stop'}.` : '';
    return `${busLine(leg, route)}${stop}${leg.lastBus ? ' Last bus today.' : ''}${walk}`;
  }
  if (leg.kind === 'walk') return `${leg.walkMin} min, there by ${formatClock(leg.end!)}.`;
  if (leg.kind === 'gym') return `Until about ${formatClock(leg.end!)}.`;
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

export default function Timeline({ plan, schedule, route, now, here, onChange }: Props) {
  const override = schedule.override?.date === plan.date ? schedule.override : null;
  const skipped = override?.skipped ?? [];
  const classes = plan.legs.filter((leg) => leg.kind === 'class');
  const taken = classes.filter((leg) => !leg.skipped);
  const leftEarly = override?.leftAt !== undefined;
  const inClass = leftEarly ? undefined : taken.find((leg) => leg.start! <= now && now < leg.end!);
  const laterClasses = inClass ? taken.filter((leg) => leg.start! >= inClass.end!) : [];
  const onCampusNow = !leftEarly && taken.length > 0 && now >= taken[0].start! - 20 * MIN && now < taken.at(-1)!.end!;
  const committed = plan.legs.some((leg) => leg.committed);
  // Going home after the class you're in only needs saying when something else was planned after it.
  const canHeadHome = inClass && (laterClasses.length > 0 || plan.afterClass === 'gym');
  // The walk from the phone's position is not a choice, so it doesn't count as something to reset.
  const { here: _here, ...choices } = override ?? {};
  const hasChoices = override !== null && (skipped.length > 0 || Object.keys(choices).some((key) => key !== 'date' && key !== 'skipped'));
  const hereMinutes = here.reading && here.reading.walkMin <= HERE_MAX_WALK_MIN ? here.reading.walkMin : null;

  function toggleSkip(classId: string) {
    onChange({ skipped: skipped.includes(classId) ? skipped.filter((id) => id !== classId) : [...skipped, classId] });
  }

  function leaveCampus() {
    const last = taken.filter((leg) => leg.end! <= now).at(-1) ?? taken[0];
    const block = schedule.patterns.flatMap((p) => p.classes).find((c) => c.id === last.classId);
    const unfinished = classes.filter((leg) => leg.end! > now).map((leg) => leg.classId!);
    onChange({ skipped: [...new Set([...skipped, ...unfinished])], leftAt: now, leftPlaceId: block?.placeId, afterClass: 'home' });
  }

  function homeAfterThisClass() {
    onChange({ skipped: [...new Set([...skipped, ...laterClasses.map((leg) => leg.classId!)])], afterClass: 'home' });
  }

  function classIsOut(classId: string) {
    onChange({ outEarly: { ...(override?.outEarly ?? {}), [classId]: now } });
  }

  return (
    <section className="section" aria-labelledby="today-title">
      <div className="section-head">
        <h2 id="today-title">Today</h2>
        <Link className="text-link" href="/schedule">
          Edit schedule
        </Link>
      </div>

      {plan.onCampus && plan.gymDay && !leftEarly && (
        <Choice label="After class" options={AFTER_CLASS} value={plan.afterClass} onPick={(afterClass) => onChange({ afterClass })} />
      )}
      {plan.eveningApplies && (
        <div className="choice-row">
          <Choice label={plan.onCampus ? 'Gym later' : 'Gym'} options={EVENING} value={plan.evening} onPick={(evening) => onChange({ evening })} />
          {plan.evening !== 'skip' && (
            <label className="field inline">
              <span>Leave home at</span>
              <input
                type="time"
                value={minuteToInput(plan.eveningLeaveMin)}
                onChange={(e) => e.target.value && onChange({ eveningLeaveMin: inputToMinute(e.target.value) })}
              />
            </label>
          )}
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
                <div className="leg-body">
                  <p className="leg-title">{leg.title}</p>
                  <p className="leg-detail">{detail(leg, route)}</p>
                  {leg.note && (leg.kind !== 'bus' || leg.bus) && <p className="leg-detail">{leg.note}</p>}
                  {home && <p className="leg-detail">{home}</p>}
                  {leg.warn && <p className="leg-warn">{leg.warn}</p>}
                </div>
                {inProgress && !leftEarly && (
                  <button className="button small" onClick={() => classIsOut(leg.classId!)}>
                    Class is out
                  </button>
                )}
                {leg.kind === 'class' && leg.start! > now && !leftEarly && (
                  <button className="button small" aria-pressed={Boolean(leg.skipped)} onClick={() => toggleSkip(leg.classId!)}>
                    {leg.skipped ? 'Skipped' : 'Skip'}
                  </button>
                )}
                {leg.kind === 'gym' && state === 'now' && (
                  <button className="button small" onClick={() => onChange({ gymDoneAt: now })}>
                    I'm done
                  </button>
                )}
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

      {plan.onCampus && here.status === 'off' && (
        <div className="setup">
          <p className="note">Time the walk to Gammage from where you are, not from the classroom. Only the minutes are saved, never your location.</p>
          <button className="button" onClick={here.enable}>
            Use my location
          </button>
        </div>
      )}
      {plan.onCampus && here.status === 'on' && hereMinutes !== null && <p className="note">From where you are, Gammage is about {hereMinutes} min on foot.</p>}
      {plan.onCampus && here.status === 'denied' && (
        <p className="note">Location is blocked for this app, so walks to Gammage are timed from your classroom. You can allow it in Settings, under Safari or Shuttle, then Location.</p>
      )}
      {plan.service && <p className="note">{plan.service}</p>}
    </section>
  );
}
