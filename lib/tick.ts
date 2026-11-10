import { evaluate, isWatching } from './alerts.ts';
import { pushConfigured, sendPush } from './push.ts';
import routeData from './route.json';
import { fetchPings } from './samsara.ts';
import { buildSnapshot } from './snapshot.ts';
import { load, save } from './store.ts';
import type { AlertEvent, Route } from './types.ts';

export const route = routeData as Route;

/** One background check: read the feed, run the alert rules, push anything new, save state. */
export async function runTick(now = Date.now()): Promise<{ status: string; sent: AlertEvent[] }> {
  const [pings, settings, tracking] = await Promise.all([fetchPings(), load('settings'), load('tracking')]);
  const snapshot = buildSnapshot(route, pings, now, tracking.prevS);
  const watching = isWatching(now, settings.watchUntil, settings.prefs.dailyWatch);
  const { events, state } = evaluate({ snapshot, route, prefs: settings.prefs, state: tracking, watching });

  await save('tracking', { ...state, lastPing: snapshot.ping ?? tracking.lastPing });

  if (events.length > 0 && pushConfigured() && settings.subscriptions.length > 0) {
    const gone = new Set<string>();
    for (const event of events) {
      for (const endpoint of await sendPush(settings.subscriptions, event)) gone.add(endpoint);
    }
    if (gone.size > 0) {
      const fresh = await load('settings');
      await save('settings', { ...fresh, subscriptions: fresh.subscriptions.filter((s) => !gone.has(s.endpoint)) });
    }
  }
  return { status: snapshot.status, sent: events };
}
