import { NextResponse } from 'next/server';
import { allowed } from '@/lib/auth.ts';
import { parkedSince, timetableToday } from '@/lib/day.ts';
import { fetchPings } from '@/lib/samsara.ts';
import { buildSnapshot } from '@/lib/snapshot.ts';
import { load } from '@/lib/store.ts';
import { route } from '@/lib/tick.ts';
import type { Ping, Progress, Schedule, Snapshot, Timetable } from '@/lib/types.ts';

export const dynamic = 'force-dynamic';

let prevS: number | null = null;

/** The owner's day: only sent with the passcode. The bus position itself is public. */
export type PrivateDay = { schedule: Schedule; timetable: Timetable; progress: Progress | null };

export type ShuttleResponse = Snapshot & {
  lastSeen: Ping | null;
  parkedSince: number | null;
  feedError: boolean;
  private: PrivateDay | null;
};

export async function GET(request: Request) {
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

  let day: PrivateDay | null = null;
  if (allowed(request)) {
    const [schedule, timetable] = await Promise.all([load('schedule'), timetableToday(tracking, now)]);
    day = { schedule, timetable, progress: tracking.progress };
  }

  const body: ShuttleResponse = { ...snapshot, lastSeen, parkedSince: parkedSince(snapshot, tracking), feedError, private: day };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
