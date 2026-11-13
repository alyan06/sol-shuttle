import { etasFor, locate } from './track.ts';
import type { FeedStatus, Ping, Route, Snapshot } from './types.ts';

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

export function buildSnapshot(route: Route, pings: Ping[], now: number, prevS: number | null): Snapshot {
  const ping = pings.at(-1) ?? null;
  const located = ping ? locate(route, ping, prevS) : null;
  const used = ageCorrection(ping, now);
  const etas = etasFor(route, located).map((eta) => (eta.atStop ? eta : { ...eta, seconds: Math.max(0, eta.seconds - used) }));
  return { now, status: feedStatus(ping, now), ping, located, etas };
}
