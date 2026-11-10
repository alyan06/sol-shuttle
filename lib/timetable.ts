import type { DayLog, Timetable, TimetableSlot } from './types.ts';

/** Arrivals on different days within this many seconds count as the same scheduled run. */
const SAME_RUN_S = 6 * 60;
const MIN_DAYS = 2;
/** A run has to show up on this share of the days seen before it's trusted. */
const MIN_SHARE = 0.6;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Groups arrival times from several days into runs that recur at about the same time. */
function recurringRuns(perDay: number[][]): TimetableSlot[] {
  const tagged = perDay.flatMap((times, day) => times.map((sec) => ({ sec, day }))).sort((a, b) => a.sec - b.sec);
  const groups: { sec: number; day: number }[][] = [];
  for (const item of tagged) {
    const group = groups.at(-1);
    // A second arrival from the same day can't be the same run, however close it is.
    if (group && item.sec - group.at(-1)!.sec <= SAME_RUN_S && !group.some((g) => g.day === item.day)) group.push(item);
    else groups.push([item]);
  }
  return groups
    .filter((g) => g.length >= MIN_DAYS && g.length / perDay.length >= MIN_SHARE)
    .map((g) => ({ sec: Math.round(median(g.map((x) => x.sec))), early: g[0].sec, late: g.at(-1)!.sec }));
}

/**
 * What the bus usually does on one weekday, from logged days. Everything stays null until at least
 * two days of that weekday have been seen, so nothing is promised from a single sample.
 * `seenEnds` are end-of-service minutes the alert engine noted before logging began.
 */
export function buildTimetable(days: DayLog[], weekday: number, seenEnds: number[] = []): Timetable {
  const same = days.filter((d) => d.weekday === weekday);
  const ran = same.filter((d) => d.firstMove !== null);
  const runs = same.length < MIN_DAYS ? null : ran.length / same.length >= 0.5;

  const firsts = ran.filter((d) => !d.partial).map((d) => d.firstMove!);
  const lasts = [...ran.map((d) => d.lastMove!), ...seenEnds.map((minute) => minute * 60)];

  const arrivals: Timetable['arrivals'] = {};
  if (ran.length >= MIN_DAYS) {
    const stops = new Set(ran.flatMap((d) => d.visits.map((v) => v.stop)));
    for (const stop of stops) {
      const perDay = ran.map((d) => d.visits.filter((v) => v.stop === stop && v.arr !== null).map((v) => v.arr!));
      const slots = recurringRuns(perDay);
      if (slots.length > 0) arrivals[stop] = slots;
    }
  }

  return {
    weekday,
    daysSeen: same.length,
    runs,
    firstSec: firsts.length >= MIN_DAYS ? Math.round(median(firsts)) : null,
    // The earliest end seen, not the typical one: the cost of trusting a late bus is a long walk home.
    lastSec: lasts.length > 0 ? Math.min(...lasts) : null,
    lastSure: lasts.length >= MIN_DAYS,
    arrivals,
  };
}
