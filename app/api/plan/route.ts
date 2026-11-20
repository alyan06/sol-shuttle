import { NextResponse } from 'next/server';
import { sameOrigin, viewer } from '@/lib/auth.ts';
import { saveUserPart } from '@/lib/store.ts';
import { tempeDayKey } from '@/lib/time.ts';
import type { DayOverride, Schedule } from '@/lib/types.ts';
import { cleanOverride, cleanSchedule } from '@/lib/validate.ts';

export const dynamic = 'force-dynamic';

export type PlanChange = {
  /** Replaces whole top-level parts of the schedule: buildings, classes, walking settings. */
  schedule?: Partial<Omit<Schedule, 'override'>>;
  /** Merged into today's choices. Null clears them. */
  override?: (Partial<Omit<DayOverride, 'date' | 'goNow'>> & { goNow?: DayOverride['goNow'] | null }) | null;
};

const refuse = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function GET(request: Request) {
  const user = await viewer(request);
  if (!user) return refuse('signed-out', 401);
  if (!user.joined) return refuse('join', 403);
  return NextResponse.json({ schedule: user.schedule });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return refuse('forbidden', 403);
  const user = await viewer(request);
  if (!user) return refuse('signed-out', 401);
  if (!user.joined) return refuse('join', 403);
  const change = (await request.json().catch(() => null)) as { schedule?: unknown; override?: unknown } | null;
  if (!change) return refuse('unreadable', 400);
  let schedule = user.schedule;

  if (change.schedule !== undefined) {
    const cleaned = cleanSchedule(schedule, change.schedule);
    if (!cleaned) return refuse('not a schedule', 400);
    schedule = { ...cleaned, override: schedule.override };
  }
  if (change.override !== undefined) {
    const now = Date.now();
    schedule = { ...schedule, override: cleanOverride(schedule.override, change.override, tempeDayKey(now), now) };
  }
  await saveUserPart(user.id, 'schedule', schedule);
  return NextResponse.json({ schedule });
}
