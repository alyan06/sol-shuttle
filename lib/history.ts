import { tempeDayKey, tempeSecondOfDay, tempeWeekday } from './time.ts';
import type { DayLog, History, Route, Snapshot } from './types.ts';

const MOVING_MPH = 4;
const KEEP_DAYS = 56;
/** Further than this between two checks and the positions aren't one continuous drive. */
const MAX_STEP_M = 1500;

function forward(a: number, b: number, length: number): number {
  return (((b - a) % length) + length) % length;
}

export const emptyHistory: History = { days: [] };

function newDay(now: number, serviceAlreadyStarted: boolean): DayLog {
  return {
    day: tempeDayKey(now),
    weekday: tempeWeekday(now),
    firstMove: null,
    lastMove: null,
    visits: [],
    ...(serviceAlreadyStarted ? { partial: true } : {}),
  };
}

/**
 * Adds one observation to today's log: when the bus first and last moved, and each arrival at and
 * departure from a stop. Pure. Returns the day that just ended as `finished` when the date rolls over.
 */
export function recordObservation(
  today: DayLog | null,
  snapshot: Snapshot,
  route: Route,
  serviceAlreadyStarted = false,
  /** Where the bus was on the loop at the last check, to catch a stop it went through in between. */
  prevS: number | null = null,
): { today: DayLog; finished: DayLog | null } {
  const { now, ping, status, etas } = snapshot;
  const rolled = today !== null && today.day !== tempeDayKey(now);
  const finished = rolled ? today : null;
  const log: DayLog = today === null || rolled ? newDay(now, serviceAlreadyStarted) : { ...today, visits: [...today.visits] };
  const startedNow = today === null || rolled;

  if (status !== 'live' || !ping) return { today: log, finished };
  const second = tempeSecondOfDay(now);

  if (ping.mph >= MOVING_MPH) {
    log.firstMove ??= second;
    log.lastMove = second;
  }

  // Without a place on the loop there's no saying whether it left a stop, so visits stay as they are.
  if (snapshot.located === null) return { today: log, finished };

  const length = route.path.at(-1)?.s ?? 0;
  const s = snapshot.located.s;
  const step = prevS === null || length === 0 ? null : forward(prevS, s, length);

  for (const stop of route.stops) {
    const atStop = etas.find((e) => e.stopId === stop.id)?.atStop ?? false;
    const openIndex = log.visits.findIndex((v) => v.stop === stop.id && v.dep === null);
    if (atStop && openIndex === -1) {
      // Already parked here when the log began (overnight, say): the arrival time isn't known.
      log.visits.push({ stop: stop.id, arr: startedNow ? null : second, dep: null });
    } else if (!atStop && openIndex !== -1) {
      log.visits[openIndex] = { ...log.visits[openIndex], dep: second };
    } else if (!atStop && step !== null && step <= MAX_STEP_M && forward(prevS!, stop.s, length) < step) {
      // A quick stop can begin and end between two checks. The bus is now past it, so it called.
      log.visits.push({ stop: stop.id, arr: second, dep: second });
    }
  }
  return { today: log, finished };
}

/** Files a finished day. A day with no movement keeps only the fact that the bus didn't run. */
export function appendDay(history: History, day: DayLog): History {
  const slim: DayLog = day.firstMove === null ? { ...day, visits: [] } : day;
  return { days: [...history.days.filter((d) => d.day !== day.day), slim].slice(-KEEP_DAYS) };
}
