'use client';

import { useMemo, useState } from 'react';
import { serviceState, tripSlots } from '@/lib/service.ts';
import type { QuickTrip as Trip, Timetable } from '@/lib/types.ts';
import { Segmented } from './controls';

const MIN = 60_000;
const MAX_TRIPS = 4;

const KINDS: { value: Trip['kind']; label: string; ask: string; hint: string }[] = [
  { value: 'arrive', label: 'Arrive by', ask: 'Get to the campus stop between', hint: 'Picks the latest bus that gets you there by the end of that window, and says so if none can.' },
  { value: 'leave-home', label: 'Leave SoL', ask: 'Leave SoL between', hint: 'Picks the first bus you can catch from the start of that window. No promise about when you arrive.' },
  { value: 'leave-campus', label: 'Head home', ask: 'Leave campus between', hint: 'Picks the first bus home you can reach from the start of that window, allowing a 10 min walk to the stop.' },
];

type Props = {
  now: number;
  /** What's known about the bus's hours today. Null until loaded, or for a signed-out visitor. */
  timetable: Timetable | null;
  /** Trips already planned today. */
  count: number;
  onAdd: (trip: Trip) => void;
};

/** Plans one bus trip for later today: no need to set up a class for a one-off. */
export default function QuickTrip({ now, timetable, count, onAdd }: Props) {
  const [kind, setKind] = useState<Trip['kind']>('arrive');
  const [picked, setPicked] = useState<number | null>(null);

  // Quarter-hour windows later today, inside the bus's hours. Only the minute matters, so the
  // list isn't rebuilt on every tick of the clock.
  const slots = useMemo(
    () => tripSlots(now, kind, timetable),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Math.floor(now / MIN), kind, timetable],
  );
  const service = serviceState(now, timetable);

  // The choice stays put while it's still on offer; otherwise it falls to about half an hour out.
  const fallback = slots.find((slot) => slot.at >= now + 30 * MIN) ?? slots[0];
  const chosen = slots.find((slot) => slot.at === picked) ?? fallback;
  const choice = KINDS.find((item) => item.value === kind)!;
  const full = count >= MAX_TRIPS;

  if (!chosen) {
    // Nothing left to plan for today: a weekend, or the bus has finished.
    return (
      <section className="panel quick" aria-labelledby="quick-title">
        <div>
          <h2 id="quick-title">Plan a trip today</h2>
          <p className="note">{service.open ? 'The bus is on its last loop, so there is nothing left to plan for today.' : `${service.headline}. ${service.detail}`}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel quick" aria-labelledby="quick-title">
      <div>
        <h2 id="quick-title">Plan a trip today</h2>
        <p className="note">For a one-off, without adding a class. You get the same alerts.</p>
      </div>
      <Segmented<Trip['kind']> label="What kind of trip" options={KINDS} value={kind} onPick={setKind} />
      <div className="quick-row">
        <label className="field">
          <span>{choice.ask}</span>
          <select value={chosen.at} onChange={(event) => setPicked(Number(event.target.value))}>
            {slots.map((slot) => (
              <option key={slot.at} value={slot.at}>
                {slot.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button primary"
          disabled={full}
          onClick={() => onAdd({ id: `t${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`, kind, at: chosen.at })}
        >
          Plan it
        </button>
      </div>
      <p className="note fine">{full ? 'That’s the most trips for one day. Remove one from Today to plan another.' : choice.hint}</p>
    </section>
  );
}
