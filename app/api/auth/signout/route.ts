import { NextResponse } from 'next/server';
import { SESSION_COOKIE, clearCookie, sameOrigin } from '@/lib/auth.ts';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const response = NextResponse.json({ ok: true });
  response.headers.append('Set-Cookie', clearCookie(request, SESSION_COOKIE));
  return response;
}
