import { NextResponse } from 'next/server';
import { expectedServiceEnd, isWatching } from '@/lib/alerts.ts';
import { OWNER_ID, joinCodeRequired, sameOrigin, signInWays, viewer } from '@/lib/auth.ts';
import { pushConfigured, sendPush } from '@/lib/push.ts';
import { loadCached, saveUserPart, type User } from '@/lib/store.ts';
import { route } from '@/lib/tick.ts';
import { tempeWeekday } from '@/lib/time.ts';
import { addSubscription, cleanPrefs, cleanSubscription } from '@/lib/validate.ts';

export const dynamic = 'force-dynamic';

const MAX_WATCH_MINUTES = 240;

type Change = {
  prefs?: unknown;
  watchMinutes?: unknown;
  subscribe?: unknown;
  unsubscribe?: unknown;
  test?: unknown;
};

async function view(user: User, endpoint: string | null) {
  const tracking = await loadCached('tracking', 5_000);
  const now = Date.now();
  const { settings } = user;
  return {
    user: {
      name: user.name,
      email: user.email,
      /** False while a new account still owes the residents' code. */
      joined: user.joined,
      /** Someone who used the passcode version can bring what it held into their Google account. */
      canClaim: user.id !== OWNER_ID && Boolean(process.env.APP_PASSCODE),
    },
    prefs: settings.prefs,
    watchUntil: settings.watchUntil,
    watching: isWatching(now, settings.watchUntil, settings.prefs.dailyWatch),
    subscribed: endpoint ? settings.subscriptions.some((s) => s.endpoint === endpoint) : false,
    devices: settings.subscriptions.length,
    pushKey: pushConfigured() ? process.env.VAPID_PUBLIC_KEY : null,
    serviceEndMinute: expectedServiceEnd(tracking, tempeWeekday(now)),
  };
}

export type SettingsView = Awaited<ReturnType<typeof view>>;
/** What a signed-out browser is told: how it can sign in. */
export type SignedOut = { error: 'signed-out'; signIn: ReturnType<typeof signInWays>; joinCode: boolean };

function signedOut() {
  const body: SignedOut = { error: 'signed-out', signIn: signInWays(), joinCode: joinCodeRequired() };
  return NextResponse.json(body, { status: 401 });
}

export async function GET(request: Request) {
  // Settings say where and when one person catches the bus, so only that person reads them.
  const user = await viewer(request);
  if (!user) return signedOut();
  return NextResponse.json(await view(user, new URL(request.url).searchParams.get('endpoint')));
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const user = await viewer(request);
  if (!user) return signedOut();
  if (!user.joined) return NextResponse.json({ error: 'join' }, { status: 403 });
  const change = (await request.json().catch(() => ({}))) as Change;
  const settings = { ...user.settings };

  if (change.prefs !== undefined) settings.prefs = cleanPrefs(settings.prefs, change.prefs, route.stops.map((stop) => stop.id));
  if (typeof change.watchMinutes === 'number' && Number.isFinite(change.watchMinutes)) {
    const minutes = Math.min(change.watchMinutes, MAX_WATCH_MINUTES);
    settings.watchUntil = minutes > 0 ? Date.now() + minutes * 60_000 : null;
  }
  const subscription = change.subscribe === undefined ? null : cleanSubscription(change.subscribe);
  if (change.subscribe !== undefined && !subscription) return NextResponse.json({ error: 'bad subscription' }, { status: 400 });
  if (subscription) settings.subscriptions = addSubscription(settings.subscriptions, subscription);
  if (typeof change.unsubscribe === 'string') {
    settings.subscriptions = settings.subscriptions.filter((s) => s.endpoint !== change.unsubscribe);
  }
  await saveUserPart(user.id, 'settings', settings);

  if (change.test === true) {
    if (!pushConfigured()) return NextResponse.json({ error: 'push is not set up' }, { status: 503 });
    await sendPush(settings.subscriptions, {
      kind: 'leave',
      title: 'Alerts are working',
      body: 'This is how shuttle alerts will look on this phone.',
    });
  }
  return NextResponse.json(await view({ ...user, settings }, subscription?.endpoint ?? null));
}
