'use client';

import { useMemo, useState } from 'react';
import { formatClock, tempeMidnight } from '@/lib/time.ts';
import type { QuickTrip as Trip } from '@/lib/types.ts';
import { Segmented } from './controls';

const MIN = 60_000;
const SLOT_MIN = 15;
/** The soonest a trip can be planned for: time to read the answer and get to the door. */
const SOONEST_MIN = 5;
const MAX_TRIPS = 4;

const KINDS: { value: Trip['kind']; label: string; ask: string; hint: string }[] = [
  { value: 'arrive', label: 'Arrive by', ask: 'Be at the campus stop by', hint: 'Picks the latest bus that still gets you there, and says so if none can.' },
  { value: 'leave-home', label: 'Leave SoL', ask: 'Leave SoL at', hint: 'Picks the first bus you can catch after that. No promise about when you arrive.' },
  { value: 'leave-campus', label: 'Head home', ask: 'Leave campus at', hint: 'Picks the first bus home you can reach after that, allowing a 10 min walk to the stop.' },
];

type Props = {
  now: number;
  /** Trips already planned today. */
  count: number;
  onAdd: (trip: Trip) => void;
};

/** Plans one bus trip for later today: no need to set up a class for a one-off. */
export default function QuickTrip({ now, count, onAdd }: Props) {
  const [kind, setKind] = useState<Trip['kind']>('arrive');
  const [picked, setPicked] = useState<number | null>(null);

  // Quarter-hour slots from a few minutes from now to the end of today. Past times simply aren't offered.
  const slots = useMemo(() => {
    const midnight = tempeMidnight(now);
    const first = Math.ceil((now + SOONEST_MIN * MIN - midnight) / (SLOT_MIN * MIN));
    const list: number[] = [];
    for (let slot = first; slot < (24 * 60) / SLOT_MIN; slot++) list.push(midnight + slot * SLOT_MIN * MIN);
    return list;
    // Only the quarter-hour matters, so the list isn't rebuilt on every tick of the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Math.floor(now / (SLOT_MIN * MIN))]);

  // The choice stays put while it's still on offer; otherwise it falls to about half an hour out.
  const fallback = slots.find((slot) => slot >= now + 30 * MIN) ?? slots[0];
  const at = picked !== null && slots.includes(picked) ? picked : fallback;
  const choice = KINDS.find((item) => item.value === kind)!;
  const full = count >= MAX_TRIPS;

  if (slots.length === 0) return null;

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
          <select value={at} onChange={(event) => setPicked(Number(event.target.value))}>
            {slots.map((slot) => (
              <option key={slot} value={slot}>
                {formatClock(slot)}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button primary"
          disabled={full}
          onClick={() => onAdd({ id: `t${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`, kind, at })}
        >
          Plan it
        </button>
      </div>
      <p className="note fine">{full ? 'That’s the most trips for one day. Remove one from Today to plan another.' : choice.hint}</p>
    </section>
  );
}
