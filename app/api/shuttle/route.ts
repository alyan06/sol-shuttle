import { NextResponse } from 'next/server';
import { viewer } from '@/lib/auth.ts';
import { parkedSince, timetableToday } from '@/lib/day.ts';
import { fetchPings } from '@/lib/samsara.ts';
import { hasClasses } from '@/lib/schedule.ts';
import { buildSnapshot } from '@/lib/snapshot.ts';
import { loadCached } from '@/lib/store.ts';
import { route } from '@/lib/tick.ts';
import type { Course, Ping, Progress, Schedule, Snapshot, Timetable } from '@/lib/types.ts';

export const dynamic = 'force-dynamic';

/** Many phones ask at once, and the bus's memory only changes with each background check. */
const TRACKING_MAX_AGE_MS = 5_000;

let prevS: number | null = null;
let course: Course | null = null;

/** The signed-in person's day. The bus position itself is public. */
export type PrivateDay = { schedule: Schedule; timetable: Timetable | null; progress: Progress | null };

export type ShuttleResponse = Snapshot & {
  lastSeen: Ping | null;
  parkedSince: number | null;
  feedError: boolean;
  /** The last few reported positions, oldest first, as [lng, lat]: where the bus has just been. */
  trail: [number, number][];
  /** Metres along the loop where the bus was last on it. On a detour, that's where it left. */
  lastS: number | null;
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

  // The alert check sees the bus every 30 seconds whether or not this page is open, so its memory
  // of which way the bus was driving is used when it's newer than this server's own.
  const tracking = await loadCached('tracking', TRACKING_MAX_AGE_MS);
  const remembered = tracking.course && (!course || tracking.course.at > course.at) ? tracking.course : course;
  const snapshot = buildSnapshot(route, pings, now, prevS ?? tracking.prevS, remembered);
  prevS = snapshot.located?.s ?? prevS ?? tracking.prevS;
  course = snapshot.course ?? course;

  // With no fresh ping, the last position the alert check stored still tells the app where the bus was.
  const lastSeen = snapshot.ping ?? tracking.lastPing;

  let day: PrivateDay | null = null;
  const user = await viewer(request);
  if (user?.joined) {
    const timetable = hasClasses(user.schedule) ? await timetableToday(tracking, now) : null;
    day = { schedule: user.schedule, timetable, progress: user.state.progress };
  }

  const body: ShuttleResponse = {
    ...snapshot,
    lastSeen,
    parkedSince: parkedSince(snapshot, tracking),
    feedError,
    trail: pings.map((ping) => [ping.lng, ping.lat]),
    lastS: prevS,
    private: day,
  };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
