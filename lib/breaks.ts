import { metresBetween } from './geo.ts';
import { CAMPUS, HOME } from './schedule.ts';
import type { BreakPlace, BusBreak, DayLog, Route } from './types.ts';

/**
 * The driver's breaks. In the middle of the day, standing still for 10 minutes or more is taken as
 * a break (Alyan's rule, 2026-11-17): a red light or a long wait at a stop is shorter. Seen so far:
 * a while at SoL, then parked a little east of SoL along University Dr, then back to SoL. Nothing
 * says for certain it's a break, so the app only ever calls it "probably".
 */
export const MIN_BREAK_S = 10 * 60;
const AT_STOP_M = 250;
const EAST_RANGE_M = 2000;
/** Breaks on different days that start this close together are the same break. */
const SAME_BREAK_S = 30 * 60;
const MIN_DAYS = 2;

type Point = { lat: number; lng: number };

/** Where a stopped bus is, in the words a rider would use. */
export function breakPlace(at: Point, route: Route): BreakPlace {
  const sol = route.stops.find((stop) => stop.id === HOME);
  const campus = route.stops.find((stop) => stop.id === CAMPUS);
  if (sol && metresBetween(at, sol) <= AT_STOP_M) return 'sol';
  if (campus && metresBetween(at, campus) <= AT_STOP_M) return 'gammage';
  // The spot it goes to "ahead of SoL, to the right": about 800 m east along University Dr.
  if (sol && at.lng > sol.lng + 0.002 && metresBetween(at, sol) <= EAST_RANGE_M) return 'east';
  return 'elsewhere';
}

export function placeText(place: BreakPlace): string {
  return { sol: 'at SoL', gammage: 'at Gammage', east: 'just east of SoL', elsewhere: 'off its route' }[place];
}

/**
 * The breaks in a logged day. Days logged before breaks were recorded still show the part spent
 * waiting at a stop, as a long visit there.
 */
export function breaksOf(day: DayLog): BusBreak[] {
  if (day.breaks) return day.breaks;
  return day.visits
    .filter((visit) => visit.arr !== null && visit.dep !== null && day.firstMove !== null && visit.arr > day.firstMove && visit.dep - visit.arr >= MIN_BREAK_S)
    .map((visit) => ({ from: visit.arr!, to: visit.dep!, place: visit.stop === HOME ? 'sol' : visit.stop === CAMPUS ? 'gammage' : 'elsewhere' }));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Breaks that come back at about the same time on most logged days of one weekday: the usual start and end. */
export function usualBreaks(days: DayLog[]): { from: number; to: number }[] {
  const ran = days.filter((day) => day.firstMove !== null);
  if (ran.length < MIN_DAYS) return [];
  const tagged = ran.flatMap((day, index) => breaksOf(day).map((item) => ({ ...item, day: index }))).sort((a, b) => a.from - b.from);
  const groups: (typeof tagged)[] = [];
  for (const item of tagged) {
    const group = groups.at(-1);
    if (group && item.from - group[0].from <= SAME_BREAK_S && !group.some((other) => other.day === item.day)) group.push(item);
    else groups.push([item]);
  }
  return groups
    .filter((group) => group.length >= MIN_DAYS && group.length / ran.length >= 0.5)
    .map((group) => ({ from: median(group.map((item) => item.from)), to: median(group.map((item) => item.to)) }));
}
