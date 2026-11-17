import { metresBetween } from './geo.ts';
import { etasFor, locate, roughEtas } from './track.ts';
import type { Course, FeedStatus, Ping, Route, Snapshot } from './types.ts';

/** Samsara reports every ~6s while the bus moves. Past this, a position is too old to time a walk by. */
const LIVE_MS = 90_000;
/** It goes quiet while parked (over 4 min seen at stops), so a bus last seen at rest stays live for longer. */
const PARKED_LIVE_MS = 6 * 60_000;
const PARKED_MPH = 2;

export function feedStatus(ping: Ping | null, now: number): FeedStatus {
  if (!ping) return 'offline';
  const limit = ping.mph < PARKED_MPH ? PARKED_LIVE_MS : LIVE_MS;
  return now - ping.time <= limit ? 'live' : 'stale';
}

const MOVING_MPH = 4;
/** Older than this the position isn't trusted for times anyway, so the correction stops growing. */
const MAX_AGE_S = 60;

/**
 * Seconds to take off every arrival time because the position is already old. The times are
 * counted from where the bus was when it reported, but shown from now: a moving bus has used up
 * the difference. A parked one hasn't gone anywhere, so it gets no correction.
 */
export function ageCorrection(ping: Ping | null, now: number): number {
  if (!ping || ping.mph < MOVING_MPH) return 0;
  return Math.min(MAX_AGE_S, Math.max(0, (now - ping.time) / 1000));
}

/** A stopped bus is still facing the way it was last driving only if it hasn't moved on unseen. */
const COURSE_REACH_M = 150;

/** The newest moving position in the feed, or what was remembered if nothing here is moving. */
export function courseAfter(pings: Ping[], prev: Course | null): Course | null {
  for (let i = pings.length - 1; i >= 0; i--) {
    const ping = pings[i];
    if (ping.mph < MOVING_MPH) continue;
    if (prev && prev.at > ping.time) break;
    return { heading: ping.heading, at: ping.time, lat: ping.lat, lng: ping.lng };
  }
  return prev;
}

export function buildSnapshot(route: Route, pings: Ping[], now: number, prevS: number | null, prevCourse: Course | null = null): Snapshot {
  const ping = pings.at(-1) ?? null;
  const course = courseAfter(pings, prevCourse);
  const facing = ping && course && metresBetween(ping, course) <= COURSE_REACH_M ? course.heading : null;
  const located = ping ? locate(route, ping, prevS, facing) : null;
  const used = ageCorrection(ping, now);
  // Off the learned loop there's still a time to give, from distance alone.
  const timed = located ? etasFor(route, located) : ping ? roughEtas(route, ping, prevS, facing) : [];
  const etas = timed.map((eta) => (eta.atStop ? eta : { ...eta, seconds: Math.max(0, eta.seconds - used) }));
  return { now, status: feedStatus(ping, now), ping, located, etas, course };
}
