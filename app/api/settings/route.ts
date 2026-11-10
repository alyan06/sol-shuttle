import { NextResponse } from 'next/server';
import { expectedServiceEnd, isWatching } from '@/lib/alerts.ts';
import { allowed, passcodeRequired } from '@/lib/auth.ts';
import { pushConfigured, sendPush } from '@/lib/push.ts';
import { load, save, type PushSubscriptionJson } from '@/lib/store.ts';
import { tempeWeekday } from '@/lib/time.ts';
import type { Prefs } from '@/lib/types.ts';

export const dynamic = 'force-dynamic';

const MAX_WATCH_MINUTES = 240;

type Change = {
  prefs?: Partial<Prefs>;
  watchMinutes?: number;
  subscribe?: PushSubscriptionJson;
  unsubscribe?: string;
  test?: boolean;
};

async function view(endpoint: string | null) {
  const [settings, tracking] = await Promise.all([load('settings'), load('tracking')]);
  const now = Date.now();
  return {
    prefs: settings.prefs,
    watchUntil: settings.watchUntil,
    watching: isWatching(now, settings.watchUntil, settings.prefs.dailyWatch),
    subscribed: endpoint ? settings.subscriptions.some((s) => s.endpoint === endpoint) : false,
    pushKey: pushConfigured() ? process.env.VAPID_PUBLIC_KEY : null,
    passcodeRequired: passcodeRequired(),
    serviceEndMinute: expectedServiceEnd(tracking, tempeWeekday(now)),
  };
}

export type SettingsView = Awaited<ReturnType<typeof view>>;

export async function GET(request: Request) {
  // Settings say where and when one person catches the bus, so reading them needs the passcode too.
  if (!allowed(request)) return NextResponse.json({ error: 'locked' }, { status: 401 });
  return NextResponse.json(await view(new URL(request.url).searchParams.get('endpoint')));
}

export async function POST(request: Request) {
  if (!allowed(request)) return NextResponse.json({ error: 'wrong passcode' }, { status: 401 });
  const change = (await request.json()) as Change;
  const settings = await load('settings');

  if (change.prefs) settings.prefs = { ...settings.prefs, ...change.prefs };
  if (change.watchMinutes !== undefined) {
    const minutes = Math.min(change.watchMinutes, MAX_WATCH_MINUTES);
    settings.watchUntil = minutes > 0 ? Date.now() + minutes * 60_000 : null;
  }
  if (change.subscribe) {
    const { endpoint } = change.subscribe;
    settings.subscriptions = [...settings.subscriptions.filter((s) => s.endpoint !== endpoint), change.subscribe];
  }
  if (change.unsubscribe) {
    settings.subscriptions = settings.subscriptions.filter((s) => s.endpoint !== change.unsubscribe);
  }
  await save('settings', settings);

  if (change.test) {
    if (!pushConfigured()) return NextResponse.json({ error: 'push is not set up' }, { status: 503 });
    await sendPush(settings.subscriptions, {
      kind: 'leave',
      title: 'Alerts are working',
      body: 'This is how shuttle alerts will look on this phone.',
    });
  }
  return NextResponse.json(await view(change.subscribe?.endpoint ?? null));
}
