import { NextResponse } from 'next/server';
import { OWNER_ID, SESSION_COOKIE, clearCookie, joinCodeMatches, passcodeMatches, sameOrigin, tooManyTries, viewer } from '@/lib/auth.ts';
import { deleteUser, markJoined, moveUserData } from '@/lib/store.ts';

export const dynamic = 'force-dynamic';

type Change = {
  /** The residents' code, owed once by a new account. */
  join?: unknown;
  /** The old passcode: moves what the single-user version held into this account. */
  claim?: unknown;
};

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const user = await viewer(request);
  if (!user) return NextResponse.json({ error: 'signed-out' }, { status: 401 });
  if (tooManyTries(request, user.id)) return NextResponse.json({ error: 'slow down' }, { status: 429 });
  const change = (await request.json().catch(() => ({}))) as Change;

  if (change.join !== undefined) {
    if (!joinCodeMatches(change.join)) return NextResponse.json({ error: 'wrong code' }, { status: 401 });
    await markJoined(user.id);
    return NextResponse.json({ ok: true });
  }
  if (change.claim !== undefined) {
    if (user.id === OWNER_ID || !passcodeMatches(change.claim)) return NextResponse.json({ error: 'wrong passcode' }, { status: 401 });
    const moved = await moveUserData(OWNER_ID, user.id);
    return moved ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'nothing to bring over' }, { status: 404 });
  }
  return NextResponse.json({ error: 'nothing to do' }, { status: 400 });
}

/** Deletes the account and everything kept for it: classes, settings, and the devices alerts go to. */
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const user = await viewer(request);
  if (!user) return NextResponse.json({ error: 'signed-out' }, { status: 401 });
  await deleteUser(user.id);
  const response = NextResponse.json({ ok: true });
  response.headers.append('Set-Cookie', clearCookie(request, SESSION_COOKIE));
  return response;
}
