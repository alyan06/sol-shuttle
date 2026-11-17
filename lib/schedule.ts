import type { ClassBlock, DayOverride, Place, Prefs, Route, Schedule } from './types.ts';

/** The two bus stops. Home is the apartment's; campus is where everyone gets off. */
export const HOME = 'sol';
export const CAMPUS = 'gammage';

export const defaultSchedule: Schedule = {
  places: [],
  classes: [],
  arriveEarlyMin: 5,
  paceMPerMin: 80,
  walkOverrides: {},
  override: null,
};

export function hasClasses(schedule: Schedule): boolean {
  return schedule.classes.length > 0;
}

/** What's on for a given day, earliest first. */
export function classesOn(schedule: Schedule, weekday: number, date: string): ClassBlock[] {
  return schedule.classes.filter((c) => c.days.includes(weekday) && (!c.until || date <= c.until)).sort((a, b) => a.startMin - b.startMin);
}

type OldPattern = { days?: number[]; until?: string; classes?: Omit<ClassBlock, 'days'>[] };

/**
 * A saved schedule in today's shape. Older saves grouped classes under day patterns and carried a
 * gym plan; both are folded away here, so nothing stored has to be rewritten by hand.
 */
export function normalizeSchedule(saved: unknown): Schedule {
  const raw = (saved ?? {}) as Partial<Schedule> & { patterns?: OldPattern[] };
  const fromPatterns = (raw.patterns ?? []).flatMap((pattern) =>
    (pattern.classes ?? []).map((block) => ({ ...block, days: pattern.days ?? [], ...(pattern.until ? { until: pattern.until } : {}) })),
  );
  const classes = (Array.isArray(raw.classes) ? raw.classes : fromPatterns).map((block) => ({ ...block, days: block.days ?? [] }));
  let override: DayOverride | null = null;
  if (raw.override && typeof raw.override.date === 'string') {
    const { date, skipped, leftAt, leftPlaceId, replanAt, outEarly, onBusAt, homeAt } = raw.override;
    const kept = { leftAt, leftPlaceId, replanAt, outEarly, onBusAt, homeAt };
    override = { date, skipped: skipped ?? [], ...Object.fromEntries(Object.entries(kept).filter(([, value]) => value !== undefined)) };
  }
  return {
    places: Array.isArray(raw.places) ? raw.places : [],
    classes,
    arriveEarlyMin: raw.arriveEarlyMin ?? defaultSchedule.arriveEarlyMin,
    paceMPerMin: raw.paceMPerMin ?? defaultSchedule.paceMPerMin,
    walkOverrides: raw.walkOverrides ?? {},
    override,
  };
}

/** Every place the planner can walk between: the stops, then the buildings in the schedule. */
export function allPlaces(schedule: Schedule, route: Route): Place[] {
  const stops = route.stops.map(({ id, name, lat, lng }) => ({ id, name, lat, lng }));
  return [...stops, ...schedule.places];
}

export function walkKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

/**
 * Minutes on foot between two places. Streets here are a grid, so a long walk goes round two sides
 * of the rectangle; campus has diagonal malls, so a short one is nearer the straight line plus a
 * quarter. The estimate is the shorter of the two, and a measured time in walkOverrides always wins.
 */
export function walkMinutes(schedule: Schedule, places: Place[], fromId: string, toId: string): number {
  if (fromId === toId) return 0;
  const measured = schedule.walkOverrides[walkKey(fromId, toId)];
  if (measured !== undefined) return measured;
  const from = places.find((p) => p.id === fromId);
  const to = places.find((p) => p.id === toId);
  if (!from || !to) return 0;
  return estimateWalk(from, to, schedule.paceMPerMin);
}

type Point = { lat: number; lng: number };

/** The same estimate between any two points. */
export function estimateWalk(from: Point, to: Point, paceMPerMin: number): number {
  const northSouth = Math.abs(from.lat - to.lat) * 111_320;
  const eastWest = Math.abs(from.lng - to.lng) * 111_320 * Math.cos((from.lat * Math.PI) / 180);
  const metres = Math.min(northSouth + eastWest, Math.hypot(northSouth, eastWest) * 1.25);
  return Math.max(1, Math.ceil(metres / paceMPerMin));
}

/** Walk to the campus stop when no class says where you are. */
const CAMPUS_WALK_DEFAULT_MIN = 10;

/** Minutes on foot to the stop being watched by hand: from the apartment for SoL, a typical campus walk for Gammage. */
export function stopWalkMinutes(prefs: Pick<Prefs, 'walkMinutes'>, stopId: string | null): number {
  return stopId === CAMPUS ? CAMPUS_WALK_DEFAULT_MIN : prefs.walkMinutes;
}
