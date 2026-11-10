import { parkedUp } from './alerts.ts';
import type { LiveBus } from './plan.ts';
import { loadCached, type Tracking } from './store.ts';
import { buildTimetable } from './timetable.ts';
import { tempeWeekday } from './time.ts';
import type { Snapshot, Timetable } from './types.ts';

const HISTORY_MAX_AGE_MS = 10 * 60_000;
const PARKED_MPH = 2;
/** The background check notes each movement. If it hasn't seen the bus lately, its notes are out of date. */
const NOTES_FRESH_MS = 12 * 60_000;

/** What's known about today's weekday. History only grows once a day, so a held copy is fine. */
export async function timetableToday(tracking: Tracking, now: number): Promise<Timetable> {
  const history = await loadCached('history', HISTORY_MAX_AGE_MS);
  const weekday = tempeWeekday(now);
  let ends = tracking.serviceEnds[weekday] ?? [];
  if (ends.length === 0 && weekday >= 1 && weekday <= 5) {
    // Nothing seen for this weekday yet: borrow the earliest weekday end as a single, unsure sample.
    const others = [1, 2, 3, 4, 5].flatMap((day) => tracking.serviceEnds[day] ?? []);
    if (others.length > 0) ends = [Math.min(...others)];
  }
  return buildTimetable(history.days, weekday, ends);
}

type Notes = Pick<Tracking, 'lastMovedAt' | 'lastSeenAt'>;

/**
 * When a bus that's parked right now last moved, or null while it's moving or silent. Also null
 * when the background check has stopped keeping notes: an old "last moved" would call a bus
 * that only just pulled up "not running".
 */
export function parkedSince(snapshot: Snapshot, notes: Notes): number | null {
  const parked = snapshot.status === 'live' && snapshot.ping && snapshot.ping.mph < PARKED_MPH;
  const fresh = notes.lastSeenAt !== null && snapshot.now - notes.lastSeenAt <= NOTES_FRESH_MS;
  return parked && fresh ? notes.lastMovedAt : null;
}

/** The live bus as the planner sees it. A bus parked up for a break gives no times worth planning on. */
export function liveBus(snapshot: Snapshot, notes: Notes): LiveBus {
  return { status: snapshot.status, etas: snapshot.etas, parked: parkedUp(parkedSince(snapshot, notes), snapshot.now) };
}
