import { NextResponse } from 'next/server';
import { runTick } from '@/lib/tick.ts';

export const dynamic = 'force-dynamic';

function authorized(request: Request): boolean {
  const secret = process.env.TICK_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production';
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await runTick());
  } catch (error) {
    console.error('tick failed', error);
    return NextResponse.json({ error: 'tick failed' }, { status: 502 });
  }
}
