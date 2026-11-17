import { formatClock, formatRange, tempeMidnight, tempeSecondOfDay, tempeWeekday } from './time.ts';
import type { QuickTrip, Timetable } from './types.ts';

/**
 * When the bus runs. The days are a fact from the people who ride it (Monday to Friday, no
 * weekends); the hours are what the bus's own log shows, with round numbers until there is a log.
 * What's been learned for a weekday always wins over these.
 */
export const SERVICE_DAYS = [1, 2, 3, 4, 5];
const DEFAULT_FIRST_SEC = 7 * 3600;
const DEFAULT_LAST_SEC = 19 * 3600;
const SLOT_SEC = 15 * 60;
/** The soonest a trip can be planned for: time to read the answer and get to the door. */
const SOONEST_SEC = 5 * 60;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type Hours = Pick<Timetable, 'runs' | 'firstSec' | 'lastSec'> | null;

export function runsOn(weekday: number, timetable: Hours): boolean {
  return timetable?.runs ?? SERVICE_DAYS.includes(weekday);
}

/** First and last bus as seconds after midnight, on quarter hours: nothing about this bus is known to the minute. */
export function serviceHours(timetable: Hours): { firstSec: number; lastSec: number } {
  const first = timetable?.firstSec ?? DEFAULT_FIRST_SEC;
  const last = timetable?.lastSec ?? DEFAULT_LAST_SEC;
  return { firstSec: Math.floor(first / SLOT_SEC) * SLOT_SEC, lastSec: Math.ceil(last / SLOT_SEC) * SLOT_SEC };
}

function nextServiceDay(weekday: number): string {
  for (let ahead = 1; ahead <= 7; ahead++) {
    const day = (weekday + ahead) % 7;
    if (SERVICE_DAYS.includes(day)) return ahead === 1 ? 'tomorrow' : `on ${DAY_NAMES[day]}`;
  }
  return 'soon';
}

export type ServiceState = { open: true } | { open: false; headline: string; detail: string };

/** Whether the bus is in its working hours right now, and if not, what to tell someone who opens the app. */
export function serviceState(now: number, timetable: Hours): ServiceState {
  const weekday = tempeWeekday(now);
  const midnight = tempeMidnight(now);
  const { firstSec, lastSec } = serviceHours(timetable);
  const first = formatClock(midnight + firstSec * 1000);
  const last = formatClock(midnight + lastSec * 1000);
  const second = tempeSecondOfDay(now);
  if (!runsOn(weekday, timetable)) {
    return { open: false, headline: 'No bus today', detail: `The shuttle runs Monday to Friday, about ${first} to ${last}. The next bus is ${nextServiceDay(weekday)} around ${first}.` };
  }
  if (second < firstSec - SLOT_SEC) return { open: false, headline: 'Not running yet', detail: `The first bus is around ${first}.` };
  if (second > lastSec + SLOT_SEC) {
    return { open: false, headline: 'Done for today', detail: `The last bus parks around ${last}. The next bus is ${nextServiceDay(weekday)} around ${first}.` };
  }
  return { open: true };
}

export type TripSlot = { at: number; label: string };

/**
 * The quarter-hour slots a one-off trip can be planned for: later today, inside the bus's hours.
 * A slot is a window, not a moment, because the bus can't promise a minute. For arriving, the trip
 * is planned to its end (there by 3:15 at the latest); for leaving, from its start.
 */
export function tripSlots(now: number, kind: QuickTrip['kind'], timetable: Hours): TripSlot[] {
  if (!runsOn(tempeWeekday(now), timetable)) return [];
  const midnight = tempeMidnight(now);
  const { firstSec, lastSec } = serviceHours(timetable);
  const soonest = tempeSecondOfDay(now) + SOONEST_SEC;
  const slots: TripSlot[] = [];
  for (let start = firstSec; start + SLOT_SEC <= lastSec; start += SLOT_SEC) {
    const end = start + SLOT_SEC;
    const commitment = kind === 'arrive' ? end : start;
    if (commitment < soonest) continue;
    slots.push({ at: midnight + commitment * 1000, label: formatRange(midnight + start * 1000, midnight + end * 1000) });
  }
  return slots;
}

/** The window a planned trip stands for, to say back to the person who planned it. */
export function tripWindow(trip: QuickTrip): string {
  const span = SLOT_SEC * 1000;
  return trip.kind === 'arrive' ? formatRange(trip.at - span, trip.at) : formatRange(trip.at, trip.at + span);
}
