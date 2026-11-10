import { angleBetween, bearing, projectOntoSegment } from './geo.ts';
import type { Located, Ping, Route, Stop, StopEta } from './types.ts';

const MAX_OFF_ROUTE_M = 70;
const MOVING_MPH = 4;
const MAX_HEADING_DIFF = 65;
/** Metres along the loop within which the bus counts as being at a stop. */
export const AT_STOP_M = 50;

/** Distance forward along the loop from a to b, wrapping at the end of the loop. */
function forward(a: number, b: number, length: number): number {
  return (((b - a) % length) + length) % length;
}

/**
 * Places a GPS ping on the loop. The route runs both ways down some streets, so heading picks
 * the right side while moving, and continuity with the last position decides when stopped.
 */
export function locate(route: Route, ping: Ping, prevS: number | null): Located | null {
  const { path } = route;
  if (path.length < 2) return null;
  const length = path[path.length - 1].s;
  const moving = ping.mph >= MOVING_MPH;

  let best: (Located & { score: number }) | null = null;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const { fraction, distanceM } = projectOntoSegment(ping, a, b);
    if (distanceM > MAX_OFF_ROUTE_M) continue;
    if (moving && angleBetween(ping.heading, bearing(a, b)) > MAX_HEADING_DIFF) continue;

    const s = a.s + (b.s - a.s) * fraction;
    const t = a.t + (b.t - a.t) * fraction;
    // A little ahead of the last position is expected; a big jump is probably the wrong side.
    const jump = prevS === null ? 0 : Math.min(forward(prevS, s, length), 4 * forward(s, prevS, length));
    const score = distanceM + jump * 0.1;
    if (!best || score < best.score) best = { s, t, offsetM: distanceM, score };
  }
  return best && { s: best.s, t: best.t, offsetM: best.offsetM };
}

export function etaToStop(route: Route, located: Located, stop: Stop): StopEta {
  const length = route.path[route.path.length - 1].s;
  const atStop = forward(located.s, stop.s, length) <= AT_STOP_M || forward(stop.s, located.s, length) <= (stop.holdM ?? AT_STOP_M);
  const seconds = atStop ? 0 : forward(located.t, stop.t, route.loopSeconds);
  return { stopId: stop.id, seconds, atStop };
}

export function etasFor(route: Route, located: Located | null): StopEta[] {
  return located ? route.stops.map((stop) => etaToStop(route, located, stop)) : [];
}
