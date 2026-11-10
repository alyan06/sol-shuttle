import type { Place, Route, Schedule } from './types.ts';

/** Fixed places. Home and campus are the two bus stops; the gym is Sun Devil Fitness Complex. */
export const HOME = 'sol';
export const CAMPUS = 'gammage';
export const GYM = 'gym';
const GYM_PLACE: Place = { id: GYM, name: 'Gym', lat: 33.41541, lng: -111.93195 };

export const defaultSchedule: Schedule = {
  places: [],
  patterns: [
    { id: 'mw', name: 'Monday and Wednesday', days: [1, 3], classes: [] },
    { id: 'tth', name: 'Tuesday and Thursday', days: [2, 4], classes: [] },
  ],
  gym: { days: [1, 2, 3, 5, 6], workoutMin: 75, afterClass: 'gym', evening: 'walk', eveningLeaveMin: 17 * 60 },
  arriveEarlyMin: 5,
  paceMPerMin: 80,
  walkOverrides: {},
  override: null,
};

export function hasClasses(schedule: Schedule): boolean {
  return schedule.patterns.some((p) => p.classes.length > 0);
}

/** Every place the planner can walk between: the stops, the gym, then the class buildings. */
export function allPlaces(schedule: Schedule, route: Route): Place[] {
  const stops = route.stops.map(({ id, name, lat, lng }) => ({ id, name, lat, lng }));
  return [...stops, GYM_PLACE, ...schedule.places];
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
  const northSouth = Math.abs(from.lat - to.lat) * 111_320;
  const eastWest = Math.abs(from.lng - to.lng) * 111_320 * Math.cos((from.lat * Math.PI) / 180);
  const metres = Math.min(northSouth + eastWest, Math.hypot(northSouth, eastWest) * 1.25);
  return Math.max(1, Math.ceil(metres / schedule.paceMPerMin));
}
