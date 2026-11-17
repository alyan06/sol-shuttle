import { angleBetween, bearing, metresBetween, projectOntoSegment } from './geo.ts';
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

/** Whether a place on the loop counts as being at this stop: just before it, or anywhere it waits. */
function withinStop(s: number, stop: Stop, length: number): boolean {
  return forward(s, stop.s, length) <= (stop.leadM ?? AT_STOP_M) || forward(stop.s, s, length) <= (stop.holdM ?? AT_STOP_M);
}

/**
 * Places a GPS ping on the loop. The route runs both ways down some streets, so heading picks
 * the right side while moving. A stopped bus reports no heading: `facing`, the way it was last
 * driving, does the same job, and continuity with the last position decides the rest.
 */
export function locate(route: Route, ping: Ping, prevS: number | null, facing: number | null = null): Located | null {
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
    const along = bearing(a, b);
    if (moving && angleBetween(ping.heading, along) > MAX_HEADING_DIFF) continue;

    const s = a.s + (b.s - a.s) * fraction;
    // Seen live: back from a detour and waiting at a red light, the bus was put on the far side of
    // the road, heading out again. At a stop it turns and pulls in however it likes, so no check there.
    const wrongWay = !moving && facing !== null && angleBetween(facing, along) > MAX_HEADING_DIFF;
    if (wrongWay && !route.stops.some((stop) => withinStop(s, stop, length))) continue;
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
  const atStop = withinStop(located.s, stop, length);
  const seconds = atStop ? 0 : forward(located.t, stop.t, route.loopSeconds);
  return { stopId: stop.id, seconds, atStop };
}

export function etasFor(route: Route, located: Located | null): StopEta[] {
  return located ? route.stops.map((stop) => etaToStop(route, located, stop)) : [];
}

/** This far outside the area the loop covers, the bus isn't on a detour: it has gone somewhere else. */
const DETOUR_MARGIN_M = 500;
const NEAR_STOP_M = 60;
const M_PER_DEG = 111_320;
/**
 * On a detour the estimate leans fast. Measured twice: back along University Dr the bus beat the
 * usual pace by about 30%, and out via Rural it was slower. A time that's too early costs a short
 * wait at the stop; one that's too late costs the bus.
 */
const DETOUR_PACE = 1.25;
/**
 * Near a stop and driving away from it at speed, the bus isn't coming to it, whatever the loop
 * order says. Seen live: it left SoL the back way for a break and was shown as arriving.
 * Further out, heading away for a block is just how streets go.
 */
const LEAVING_MPH = 10;
const LEAVING_FROM_M = 100;
const LEAVING_TO_M = 800;
const LEAVING_ANGLE = 120;

/** Metres by road between two points on a street grid: along one street, then along the other. */
function gridMetres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const northSouth = Math.abs(a.lat - b.lat) * M_PER_DEG;
  const eastWest = Math.abs(a.lng - b.lng) * M_PER_DEG * Math.cos((a.lat * Math.PI) / 180);
  return northSouth + eastWest;
}

/** The bus's usual pace between stops, lights and turns included, in metres a second. */
function cruiseSpeed(route: Route): number {
  const length = route.path[route.path.length - 1].s;
  const waiting = route.stops.reduce((sum, stop) => sum + stop.dwellSeconds, 0);
  return length / Math.max(60, route.loopSeconds - waiting);
}

/**
 * Arrival times for a bus that has left the learned loop but is still in the area: the driver
 * took other streets. The next stop is whichever follows the last place it was on the loop; the
 * time to it is the distance by road at a little over the bus's usual pace. The stop after that adds the usual
 * time between the two. Rough by nature, and marked so. Empty when the bus is somewhere else
 * entirely, or driving away from the stop it would be due at.
 */
export function roughEtas(route: Route, ping: Ping, prevS: number | null, facing: number | null = null): StopEta[] {
  const { path, stops } = route;
  if (path.length < 2 || stops.length === 0) return [];

  const lats = path.map((p) => p.lat);
  const lngs = path.map((p) => p.lng);
  const latMargin = DETOUR_MARGIN_M / M_PER_DEG;
  const lngMargin = latMargin / Math.cos((ping.lat * Math.PI) / 180);
  const inArea =
    ping.lat >= Math.min(...lats) - latMargin &&
    ping.lat <= Math.max(...lats) + latMargin &&
    ping.lng >= Math.min(...lngs) - lngMargin &&
    ping.lng <= Math.max(...lngs) + lngMargin;
  if (!inArea) return [];

  const ordered = [...stops].sort((a, b) => a.s - b.s);
  const heading = ping.mph >= MOVING_MPH ? ping.heading : facing;
  let next: Stop;
  if (prevS !== null) {
    next = ordered.find((stop) => stop.s > prevS) ?? ordered[0];
  } else if (heading !== null) {
    // No memory of where it left the loop: it's heading for the stop it's pointing at.
    next = [...ordered].sort((a, b) => angleBetween(heading, bearing(ping, a)) - angleBetween(heading, bearing(ping, b)))[0];
  } else {
    next = [...ordered].sort((a, b) => metresBetween(ping, a) - metresBetween(ping, b))[0];
  }

  const metres = metresBetween(ping, next);
  const leaving = ping.mph >= LEAVING_MPH && metres > LEAVING_FROM_M && metres < LEAVING_TO_M && angleBetween(ping.heading, bearing(ping, next)) > LEAVING_ANGLE;
  if (leaving) return [];

  const atNext = metres <= NEAR_STOP_M;
  const toNext = atNext ? 0 : gridMetres(ping, next) / (cruiseSpeed(route) * DETOUR_PACE);
  return ordered.map((stop) => ({
    stopId: stop.id,
    seconds: stop === next ? toNext : toNext + forward(next.t, stop.t, route.loopSeconds),
    atStop: stop === next && atNext,
    rough: true as const,
  }));
}
