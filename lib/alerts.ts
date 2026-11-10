import { formatClock, tempeDayKey, tempeMinuteOfDay, tempeWeekday } from './time.ts';
import type { AlertEvent, AlertState, DailyWatch, Prefs, Route, Snapshot, Stop } from './types.ts';

const MINUTE = 60_000;
const MOVING_MPH = 4;
/** Idle this long and the next movement counts as service starting. */
const SERVICE_GAP_MS = 180 * MINUTE;
const OUTAGE_NO_SIGNAL_MS = 10 * MINUTE;
const OUTAGE_NOT_MOVING_MS = 20 * MINUTE;
/** The leave alert re-arms once the bus is this far past the lead time, so it fires once per approach. */
const REARM_MARGIN_SECONDS = 120;
const MIN_END_SAMPLES = 2;
const MAX_END_SAMPLES = 6;

export const defaultPrefs: Prefs = {
  stopId: null,
  walkMinutes: 5,
  bufferMinutes: 2,
  alerts: { leave: true, atStop: true, notRunning: true, firstLast: true },
  dailyWatch: null,
};

export const initialAlertState: AlertState = {
  leaveFired: false,
  wasAtStop: false,
  lastMovedAt: null,
  lastSeenAt: null,
  outageSince: null,
  firstBusDay: null,
  lastLoopDay: null,
  serviceEnds: {},
  prevS: null,
};

export function isWatching(now: number, watchUntil: number | null, daily: DailyWatch | null): boolean {
  if (watchUntil !== null && now < watchUntil) return true;
  if (!daily?.days.includes(tempeWeekday(now))) return false;
  const minute = tempeMinuteOfDay(now);
  return minute >= daily.startMin && minute < daily.endMin;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Typical end of service for a weekday in minutes after midnight, or null until enough days are seen. */
export function expectedServiceEnd(state: AlertState, weekday: number): number | null {
  const samples = state.serviceEnds[weekday] ?? [];
  return samples.length >= MIN_END_SAMPLES ? median(samples) : null;
}

function recordServiceEnd(state: AlertState, endedAt: number): Record<string, number[]> {
  const weekday = tempeWeekday(endedAt);
  const samples = [...(state.serviceEnds[weekday] ?? []), tempeMinuteOfDay(endedAt)].slice(-MAX_END_SAMPLES);
  return { ...state.serviceEnds, [weekday]: samples };
}

type Input = {
  snapshot: Snapshot;
  route: Route;
  prefs: Prefs;
  state: AlertState;
  watching: boolean;
};

/** One tick of the alert rules. Pure: takes the last state, returns what to send and the next state. */
export function evaluate({ snapshot, route, prefs, state, watching }: Input): { events: AlertEvent[]; state: AlertState } {
  const { now, ping, status, etas } = snapshot;
  const events: AlertEvent[] = [];
  const next: AlertState = { ...state, prevS: snapshot.located?.s ?? state.prevS };

  const seenFresh = ping !== null && status !== 'offline';
  const moving = seenFresh && ping.mph >= MOVING_MPH;
  if (seenFresh) next.lastSeenAt = ping.time;

  // Service start. Checked before lastMovedAt updates so the idle gap is still measurable.
  const resumedAfterGap = moving && (state.lastMovedAt === null || now - state.lastMovedAt >= SERVICE_GAP_MS);
  if (resumedAfterGap) {
    if (state.lastMovedAt !== null) next.serviceEnds = recordServiceEnd(state, state.lastMovedAt);
    const today = tempeDayKey(now);
    if (prefs.alerts.firstLast && state.lastMovedAt !== null && state.firstBusDay !== today) {
      events.push({ kind: 'first-bus', title: 'Shuttle is running', body: `First movement today at ${formatClock(now)}.` });
    }
    next.firstBusDay = today;
    next.outageSince = null;
  }
  if (moving) next.lastMovedAt = now;

  // Outage only applies once today's service has started and before its usual end.
  const today = tempeDayKey(now);
  const inService = next.firstBusDay === today && !isPastServiceEnd(state, now);
  const silentFor = next.lastSeenAt === null ? 0 : now - next.lastSeenAt;
  const stillFor = next.lastMovedAt === null ? 0 : now - next.lastMovedAt;
  const outage = inService && (silentFor >= OUTAGE_NO_SIGNAL_MS || stillFor >= OUTAGE_NOT_MOVING_MS);

  if (outage && state.outageSince === null) {
    next.outageSince = now;
    if (prefs.alerts.notRunning) {
      const body =
        silentFor >= OUTAGE_NO_SIGNAL_MS
          ? `No signal from the bus for ${Math.round(silentFor / MINUTE)} minutes.`
          : `The bus hasn't moved for ${Math.round(stillFor / MINUTE)} minutes.`;
      events.push({ kind: 'not-running', title: 'Shuttle may not be running', body });
    }
  } else if (moving && state.outageSince !== null) {
    next.outageSince = null;
    if (prefs.alerts.notRunning && !resumedAfterGap) {
      events.push({ kind: 'running-again', title: 'Shuttle is moving again', body: 'Times are back to normal estimates.' });
    }
  }

  // Last loop, once this weekday's usual end of service is known.
  const end = expectedServiceEnd(next, tempeWeekday(now));
  if (end !== null && route.loopSeconds > 0 && next.firstBusDay === today && state.lastLoopDay !== today) {
    const minute = tempeMinuteOfDay(now);
    if (minute >= end - route.loopSeconds / 60 && minute < end) {
      next.lastLoopDay = today;
      if (prefs.alerts.firstLast) {
        events.push({ kind: 'last-loop', title: 'Last loop is probably under way', body: 'Service usually ends around now on this day.' });
      }
    }
  }

  // Everything below is about the chosen stop.
  const stop = route.stops.find((s) => s.id === prefs.stopId);
  const eta = etas.find((e) => e.stopId === prefs.stopId);
  if (!stop || !eta || status !== 'live') return { events, state: next };

  const leadSeconds = (prefs.walkMinutes + prefs.bufferMinutes) * 60;
  if (eta.seconds > leadSeconds + REARM_MARGIN_SECONDS) next.leaveFired = false;
  // ETAs can drop by minutes at once when the bus clears a long light, so this is a threshold, not a
  // moment. The bus also waits at the stop, which keeps a late start catchable.
  if (!eta.atStop && eta.seconds <= leadSeconds && canCatch(eta.seconds, stop, prefs) && !next.leaveFired) {
    next.leaveFired = true;
    if (watching && prefs.alerts.leave) {
      const minutes = Math.max(1, Math.round(eta.seconds / 60));
      events.push({ kind: 'leave', title: 'Time to leave', body: `Bus reaches ${stop.name} in about ${minutes} min.` });
    }
  }

  if (eta.atStop !== state.wasAtStop) {
    next.wasAtStop = eta.atStop;
    if (watching && prefs.alerts.atStop) {
      events.push(
        eta.atStop
          ? { kind: 'arrived', title: `Bus is at ${stop.name}`, body: 'It just pulled in.' }
          : { kind: 'departed', title: `Bus left ${stop.name}`, body: 'It just pulled out.' },
      );
    }
  }

  return { events, state: next };
}

/** Whether you could still board: the walk has to fit inside the time left plus the bus's wait. */
export function canCatch(etaSeconds: number, stop: Stop, prefs: Prefs): boolean {
  return etaSeconds + stop.dwellSeconds >= prefs.walkMinutes * 60;
}

/** Parked this long, it's on a break or done for the day, even though the feed still says live. */
export function parkedUp(parkedSince: number | null, now: number): boolean {
  return parkedSince !== null && now - parkedSince >= OUTAGE_NOT_MOVING_MS;
}

function isPastServiceEnd(state: AlertState, now: number): boolean {
  const end = expectedServiceEnd(state, tempeWeekday(now));
  return end !== null && tempeMinuteOfDay(now) >= end;
}
