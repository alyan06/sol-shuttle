import { NextResponse } from 'next/server';
import { allowed } from '@/lib/auth.ts';
import { load, save } from '@/lib/store.ts';
import { tempeDayKey } from '@/lib/time.ts';
import type { DayOverride, Schedule } from '@/lib/types.ts';

export const dynamic = 'force-dynamic';

export type PlanChange = {
  /** Replaces whole top-level parts of the schedule: places, patterns, gym and so on. */
  schedule?: Partial<Omit<Schedule, 'override'>>;
  /** Merged into today's choices. Null clears them. */
  override?: Partial<Omit<DayOverride, 'date'>> | null;
};

const locked = () => NextResponse.json({ error: 'locked' }, { status: 401 });

export async function GET(request: Request) {
  if (!allowed(request)) return locked();
  return NextResponse.json({ schedule: await load('schedule') });
}

export async function POST(request: Request) {
  if (!allowed(request)) return locked();
  const change = (await request.json()) as PlanChange;
  let schedule = await load('schedule');

  if (change.schedule) schedule = { ...schedule, ...change.schedule, override: schedule.override };
  if (change.override === null) {
    schedule.override = null;
  } else if (change.override) {
    const date = tempeDayKey(Date.now());
    const today = schedule.override?.date === date ? schedule.override : { date, skipped: [] };
    schedule.override = { ...today, ...change.override, date };
  }
  await save('schedule', schedule);
  return NextResponse.json({ schedule });
}
