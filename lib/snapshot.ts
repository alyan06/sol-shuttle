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

export function buildSnapshot(route: Route, pings: Ping[], now: number, prevS: number | null): Snapshot {
  const ping = pings.at(-1) ?? null;
  const located = ping ? locate(route, ping, prevS) : null;
  return { now, status: feedStatus(ping, now), ping, located, etas: etasFor(route, located) };
}
