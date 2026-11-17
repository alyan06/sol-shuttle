import { metresBetween } from './geo.ts';

/** A position as the map wants it: [lng, lat]. */
export type TrailPoint = [number, number];

const at = (point: TrailPoint) => ({ lng: point[0], lat: point[1] });

export function trailLength(trail: TrailPoint[]): number {
  let total = 0;
  for (let i = 1; i < trail.length; i++) total += metresBetween(at(trail[i - 1]), at(trail[i]));
  return total;
}

/**
 * The path just driven, newest point last, with one more point on the end. The far end is cut back
 * so the whole trail is never longer than `maxMetres`: it follows the bus like a wake.
 */
export function extendTrail(trail: TrailPoint[], point: TrailPoint, maxMetres: number, minStepM = 2): TrailPoint[] {
  const last = trail.at(-1);
  if (last && metresBetween(at(last), at(point)) < minStepM) return trail;
  const next = [...trail, point];
  let extra = trailLength(next) - maxMetres;
  while (extra > 0 && next.length > 1) {
    const first = metresBetween(at(next[0]), at(next[1]));
    if (first <= extra) {
      next.shift();
      extra -= first;
    } else {
      // Slide the oldest point along its segment instead of dropping it, so the end doesn't jump.
      const f = extra / first;
      next[0] = [next[0][0] + (next[1][0] - next[0][0]) * f, next[0][1] + (next[1][1] - next[0][1]) * f];
      extra = 0;
    }
  }
  return next;
}
