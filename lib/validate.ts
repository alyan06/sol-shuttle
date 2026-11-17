import { CAMPUS, HOME } from './schedule.ts';
import type { PushSubscriptionJson } from './store.ts';
import { tempeDayKey } from './time.ts';
import type { AlertPrefs, ClassBlock, DailyWatch, DayOverride, Place, Prefs, QuickTrip, Schedule } from './types.ts';

/**
 * Everything a browser sends is checked here before it's stored. Anyone with an account can post
 * anything, and what's stored is later read by the background check for every person at once, so a
 * malformed schedule must never get as far as the database.
 */

const MAX_BLOCKS = 40;
const MAX_PLACES = 40;
const MAX_TEXT = 60;
const MAX_DEVICES = 5;
const MAX_TRIPS = 4;
const TRIP_KINDS = ['arrive', 'leave-home', 'leave-campus'];
const FIVE_MIN = 300_000;
/** Generously around Tempe: a building anywhere else is a mistake or mischief. */
const BOX = { south: 33.3, north: 33.52, west: -112.05, east: -111.8 };
/** The push services browsers actually use. The server posts to these addresses, so nothing else is allowed. */
const PUSH_HOSTS = [/\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function whole(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : null;
}

function text(value: unknown, max = MAX_TEXT): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '';
}

function id(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_:\-]{1,40}$/.test(value) ? value : null;
}

function days(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6))].sort();
}

function dayKey(value: unknown): string | undefined {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

/** A change to someone's preferences, laid over what they have. Anything unreadable is left as it was. */
export function cleanPrefs(current: Prefs, change: unknown, stopIds: string[]): Prefs {
  if (!isObject(change)) return current;
  const next: Prefs = { ...current, alerts: { ...current.alerts } };
  if ('stopId' in change) next.stopId = typeof change.stopId === 'string' && stopIds.includes(change.stopId) ? change.stopId : null;
  next.walkMinutes = whole(change.walkMinutes, 1, 30) ?? current.walkMinutes;
  next.bufferMinutes = whole(change.bufferMinutes, 0, 10) ?? current.bufferMinutes;
  next.alertsBeforeMin = whole(change.alertsBeforeMin, 15, 240) ?? current.alertsBeforeMin;
  next.alertsAfterMin = whole(change.alertsAfterMin, 15, 240) ?? current.alertsAfterMin;
  if (next.alertsBeforeMin === undefined) delete next.alertsBeforeMin;
  if (next.alertsAfterMin === undefined) delete next.alertsAfterMin;
  if (isObject(change.alerts)) {
    for (const key of ['leave', 'afterClass', 'atStop', 'notRunning', 'firstLast'] satisfies (keyof AlertPrefs)[]) {
      if (typeof change.alerts[key] === 'boolean') next.alerts[key] = change.alerts[key];
    }
  }
  if ('dailyWatch' in change) next.dailyWatch = cleanDailyWatch(change.dailyWatch);
  return next;
}

function cleanDailyWatch(value: unknown): DailyWatch | null {
  if (!isObject(value)) return null;
  const startMin = whole(value.startMin, 0, 1439);
  const endMin = whole(value.endMin, 0, 1439);
  return startMin === null || endMin === null ? null : { days: days(value.days), startMin, endMin };
}

function cleanPlace(value: unknown): Place | null {
  if (!isObject(value)) return null;
  const placeId = id(value.id);
  const name = text(value.name);
  const { lat, lng } = value;
  if (!placeId || !name || placeId === HOME || placeId === CAMPUS) return null;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !(lat > BOX.south && lat < BOX.north && lng > BOX.west && lng < BOX.east)) return null;
  const code = text(value.code, 12);
  return { id: placeId, name, lat, lng, ...(code ? { code } : {}) };
}

function cleanBlock(value: unknown, placeIds: Set<string>): ClassBlock | null {
  if (!isObject(value)) return null;
  const blockId = id(value.id);
  const startMin = whole(value.startMin, 0, 1439);
  const endMin = whole(value.endMin, 0, 1439);
  const placeId = id(value.placeId);
  if (!blockId || startMin === null || endMin === null || endMin <= startMin || !placeId || !placeIds.has(placeId)) return null;
  const visit = value.kind === 'visit';
  const course = text(value.course);
  // A class has to be called something; a visit can go unnamed.
  if (!course && !visit) return null;
  const room = text(value.room, 20);
  const until = dayKey(value.until);
  return { id: blockId, course, placeId, startMin, endMin, days: days(value.days), ...(room ? { room } : {}), ...(until ? { until } : {}), ...(visit ? { kind: 'visit' as const } : {}) };
}

/**
 * The parts of a schedule a person edits, laid over what they have. Returns null when what was sent
 * isn't a schedule at all. Blocks that point at a building that isn't in the list are dropped.
 */
export function cleanSchedule(current: Schedule, change: unknown): Schedule | null {
  if (!isObject(change)) return null;
  const next: Schedule = { ...current };
  if ('places' in change) {
    if (!Array.isArray(change.places)) return null;
    const seen = new Set<string>();
    next.places = change.places.slice(0, MAX_PLACES).flatMap((raw) => {
      const place = cleanPlace(raw);
      if (!place || seen.has(place.id)) return [];
      seen.add(place.id);
      return [place];
    });
  }
  const placeIds = new Set([CAMPUS, ...next.places.map((place) => place.id)]);
  if ('classes' in change) {
    if (!Array.isArray(change.classes)) return null;
    const seen = new Set<string>();
    next.classes = change.classes.slice(0, MAX_BLOCKS).flatMap((raw) => {
      const block = cleanBlock(raw, placeIds);
      if (!block || seen.has(block.id)) return [];
      seen.add(block.id);
      return [block];
    });
  } else {
    next.classes = next.classes.filter((block) => placeIds.has(block.placeId));
  }
  next.arriveEarlyMin = whole(change.arriveEarlyMin, 0, 30) ?? current.arriveEarlyMin;
  next.paceMPerMin = whole(change.paceMPerMin, 50, 120) ?? current.paceMPerMin;
  if ('walkOverrides' in change) {
    if (!isObject(change.walkOverrides)) return null;
    const known = new Set([HOME, ...placeIds]);
    next.walkOverrides = Object.fromEntries(
      Object.entries(change.walkOverrides).flatMap(([key, value]) => {
        const minutes = whole(value, 1, 120);
        const [a, b, extra] = key.split('|');
        return minutes !== null && extra === undefined && known.has(a) && known.has(b) ? [[key, minutes]] : [];
      }),
    );
  }
  return next;
}

/** Today's taps, laid over the ones already made today. */
export function cleanOverride(current: DayOverride | null, change: unknown, date: string, now: number): DayOverride | null {
  if (change === null) return null;
  if (!isObject(change)) return current;
  const today: DayOverride = current?.date === date ? current : { date, skipped: [] };
  const next: DayOverride = { ...today, date };
  // A time someone taps is "now", give or take a clock that's a little off. Nothing else makes sense.
  const moment = (value: unknown) => (typeof value === 'number' && Math.abs(value - now) < 12 * 3_600_000 ? value : undefined);
  if (Array.isArray(change.skipped)) next.skipped = [...new Set(change.skipped.flatMap((value) => id(value) ?? []))].slice(0, MAX_BLOCKS);
  for (const key of ['leftAt', 'replanAt', 'onBusAt', 'homeAt'] as const) {
    if (key in change) {
      const value = moment(change[key]);
      if (value === undefined) delete next[key];
      else next[key] = value;
    }
  }
  if ('leftPlaceId' in change) {
    const place = id(change.leftPlaceId);
    if (place) next.leftPlaceId = place;
    else delete next.leftPlaceId;
  }
  if (Array.isArray(change.trips)) {
    const had = new Map((today.trips ?? []).map((trip) => [trip.id, trip]));
    const seen = new Set<string>();
    next.trips = change.trips.flatMap((raw): QuickTrip[] => {
      if (!isObject(raw)) return [];
      const tripId = id(raw.id);
      if (!tripId || seen.has(tripId)) return [];
      seen.add(tripId);
      // A trip already planned stays as it was, even once its time has come.
      const kept = had.get(tripId);
      if (kept) return [kept];
      if (typeof raw.at !== 'number' || !TRIP_KINDS.includes(raw.kind as string)) return [];
      const at = Math.round(raw.at / FIVE_MIN) * FIVE_MIN;
      // A new one has to be later today: nobody can plan for a time that has gone, or for another day.
      if (at <= now || tempeDayKey(at) !== date) return [];
      return [{ id: tripId, kind: raw.kind as QuickTrip['kind'], at }];
    }).slice(0, MAX_TRIPS);
    if (next.trips.length === 0) delete next.trips;
  }
  if (isObject(change.outEarly)) {
    next.outEarly = Object.fromEntries(
      Object.entries(change.outEarly)
        .slice(0, MAX_BLOCKS)
        .flatMap(([key, value]) => (id(key) && moment(value) !== undefined ? [[key, value as number]] : [])),
    );
  }
  return next;
}

/** A push subscription from a real browser, or null. The endpoint must be one of the known push services. */
export function cleanSubscription(value: unknown): PushSubscriptionJson | null {
  if (!isObject(value) || typeof value.endpoint !== 'string' || !isObject(value.keys)) return null;
  const { p256dh, auth } = value.keys;
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > 200 || auth.length > 100) return null;
  let url: URL;
  try {
    url = new URL(value.endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || value.endpoint.length > 1000 || !PUSH_HOSTS.some((host) => host.test(url.hostname))) return null;
  return { endpoint: value.endpoint, keys: { p256dh, auth } };
}

export function addSubscription(list: PushSubscriptionJson[], subscription: PushSubscriptionJson): PushSubscriptionJson[] {
  return [...list.filter((s) => s.endpoint !== subscription.endpoint), subscription].slice(-MAX_DEVICES);
}
