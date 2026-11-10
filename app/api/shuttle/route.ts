import { NextResponse } from 'next/server';
import { fetchPings } from '@/lib/samsara.ts';
import { buildSnapshot } from '@/lib/snapshot.ts';
import { load } from '@/lib/store.ts';
import { route } from '@/lib/tick.ts';
import type { Ping, Snapshot } from '@/lib/types.ts';

export const dynamic = 'force-dynamic';

let prevS: number | null = null;

export type ShuttleResponse = Snapshot & { lastSeen: Ping | null; parkedSince: number | null; feedError: boolean };

const PARKED_MPH = 2;

export async function GET() {
  const now = Date.now();
  let pings: Ping[] = [];
  let feedError = false;
  try {
    pings = await fetchPings();
  } catch (error) {
    console.error('feed failed', error);
    feedError = true;
  }

  const snapshot = buildSnapshot(route, pings, now, prevS);
  prevS = snapshot.located?.s ?? prevS;

  // With no fresh ping, the last position the alert tick stored still tells the app where the bus was.
  const tracking = await load('tracking');
  const lastSeen = snapshot.ping ?? tracking.lastPing;
  const parkedSince = snapshot.status === 'live' && snapshot.ping && snapshot.ping.mph < PARKED_MPH ? tracking.lastMovedAt : null;
  const body: ShuttleResponse = { ...snapshot, lastSeen, parkedSince, feedError };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
