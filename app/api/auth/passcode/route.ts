import { NextResponse } from 'next/server';
import { OWNER_ID, passcodeMatches, sameOrigin, sessionCookie, signInWays, tooManyTries } from '@/lib/auth.ts';
import { ensureUser } from '@/lib/store.ts';

export const dynamic = 'force-dynamic';

/** The owner's way in from before Google sign-in existed. Switched off once Google is set up. */
export async function POST(request: Request) {
  if (!sameOrigin(request) || !signInWays().passcode) return NextResponse.json({ error: 'unavailable' }, { status: 403 });
  if (tooManyTries(request)) return NextResponse.json({ error: 'slow down' }, { status: 429 });
  const { passcode } = (await request.json().catch(() => ({}))) as { passcode?: unknown };
  if (!passcodeMatches(passcode)) return NextResponse.json({ error: 'wrong passcode' }, { status: 401 });
  await ensureUser({ id: OWNER_ID, name: 'Owner' });
  const response = NextResponse.json({ ok: true });
  response.headers.append('Set-Cookie', sessionCookie(request, OWNER_ID));
  return response;
}
