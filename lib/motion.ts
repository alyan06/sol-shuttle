import { bearing } from './geo.ts';
import type { RoutePoint } from './types.ts';

/** Further ahead than this in one update isn't driving, it's a gap in the feed: jump instead of gliding. */
const MAX_GLIDE_M = 900;
/** A target this little behind is GPS wobble or a slight overshoot. Hold still rather than reverse. */
const HOLD_BACK_M = 150;

export type Move =
  /** Drive forward this many metres along the loop. */
  | { kind: 'glide'; metres: number }
  /** Stay where the marker is. */
  | { kind: 'hold' }
  /** Too far to be one drive: appear at the new place. */
  | { kind: 'jump' };

function forward(a: number, b: number, length: number): number {
  return (((b - a) % length) + length) % length;
}

/**
 * How the marker should get from where it's drawn to where the bus now is. A bus only drives
 * forward round its loop, so the marker never backs up: a little behind means wait there.
 */
export function moveTo(shownS: number | null, targetS: number, length: number): Move {
  if (shownS === null || length <= 0) return { kind: 'jump' };
  const ahead = forward(shownS, targetS, length);
  if (ahead <= MAX_GLIDE_M) return ahead < 1 ? { kind: 'hold' } : { kind: 'glide', metres: ahead };
  return length - ahead <= HOLD_BACK_M ? { kind: 'hold' } : { kind: 'jump' };
}

/** The spot on the loop a given distance along it, and which way the road runs there. */
export function pointAt(path: RoutePoint[], s: number): { lat: number; lng: number; bearing: number } {
  const length = path[path.length - 1].s;
  const wrapped = ((s % length) + length) % length;
  // Path points are evenly spaced, so start near the right index and walk to it.
  let i = Math.min(path.length - 2, Math.floor((wrapped / length) * (path.length - 1)));
  while (i > 0 && path[i].s > wrapped) i--;
  while (i < path.length - 2 && path[i + 1].s <= wrapped) i++;
  const a = path[i];
  const b = path[i + 1];
  const span = b.s - a.s;
  const f = span === 0 ? 0 : (wrapped - a.s) / span;
  return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f, bearing: bearing(a, b) };
}

/** The stretch of road from one place on the loop forward to another, for drawing. */
export function stretch(path: RoutePoint[], fromS: number, toS: number): [number, number][] {
  const length = path[path.length - 1].s;
  const span = forward(fromS, toS, length);
  const start = pointAt(path, fromS);
  const end = pointAt(path, fromS + span);
  const from = ((fromS % length) + length) % length;
  const inside = path.filter((p) => forward(from, p.s, length) < span && forward(from, p.s, length) > 0);
  inside.sort((a, b) => forward(from, a.s, length) - forward(from, b.s, length));
  const line: [number, number][] = [[start.lng, start.lat], ...inside.map((p): [number, number] => [p.lng, p.lat]), [end.lng, end.lat]];
  // The loop's last point and first point are the same place.
  return line.filter((point, i) => i === 0 || point[0] !== line[i - 1][0] || point[1] !== line[i - 1][1]);
}

/** Turns the short way round from one compass bearing to another, so 350 to 10 is +20, not -340. */
export function turnToward(from: number, to: number): number {
  const delta = ((((to - from) % 360) + 540) % 360) - 180;
  return from + delta;
}
