import { defaultPrefs, evaluate } from './alerts.ts';
import { timetableToday } from './day.ts';
import { appendDay, recordObservation } from './history.ts';
import { pushConfigured, sendPush } from './push.ts';
import routeData from './route.json';
import { fetchPings } from './samsara.ts';
import { hasPlan } from './schedule.ts';
import { buildSnapshot } from './snapshot.ts';
import { listUsers, load, loadUser, save, saveUserPart } from './store.ts';
import { tempeDayKey } from './time.ts';
import type { Route, UserState } from './types.ts';
import { userTick } from './user-tick.ts';

export const route = routeData as Route;

function sameState(a: UserState, b: UserState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** One background check: read the feed once, log the bus, then run every person's plan and alert rules and push anything new. */
export async function runTick(now = Date.now()): Promise<{ status: string; people: number; sent: string[] }> {
  const [pings, tracking, everyone] = await Promise.all([fetchPings(), load('tracking'), listUsers()]);
  const snapshot = buildSnapshot(route, pings, now, tracking.prevS, tracking.course ?? null);
  const date = tempeDayKey(now);

  // The bus's own history, for learning its timetable.
  const startedBeforeLogging = tracking.today === null && tracking.firstBusDay === date;
  const { today, finished } = recordObservation(tracking.today, snapshot, route, startedBeforeLogging, tracking.prevS);
  if (finished) await save('history', appendDay(await load('history'), finished));

  // The bus's memory moves on the same way whoever is asking, so it's worked out once, for nobody.
  const bus = evaluate({ snapshot, route, prefs: { ...defaultPrefs, stopId: null }, state: tracking, watching: false }).state;
  await save('tracking', { ...tracking, ...bus, leaveFired: false, wasAtStop: false, lastPing: snapshot.ping ?? tracking.lastPing, today });

  const people = everyone.filter((user) => user.joined);
  const timetable = people.some((user) => hasPlan(user.schedule, date)) ? await timetableToday(tracking, now) : null;
  const canPush = pushConfigured();
  // Only the kinds are reported back: the caller keeps its replies for a while, and alert text names people's classes.
  const sent: string[] = [];

  await Promise.all(
    people.map(async (user) => {
      try {
        const result = userTick({ now, snapshot, route, tracking, timetable, user });
        if (!sameState(user.state, result.state)) await saveUserPart(user.id, 'state', result.state);
        if (result.sending.length === 0 || !canPush || user.settings.subscriptions.length === 0) return;
        sent.push(...result.sending.map((event) => event.kind));
        const gone = new Set<string>();
        for (const event of result.sending) {
          for (const endpoint of await sendPush(user.settings.subscriptions, event)) gone.add(endpoint);
        }
        if (gone.size > 0) {
          const fresh = await loadUser(user.id);
          if (fresh) await saveUserPart(user.id, 'settings', { ...fresh.settings, subscriptions: fresh.settings.subscriptions.filter((s) => !gone.has(s.endpoint)) });
        }
      } catch (error) {
        // One person's trouble (a bad saved schedule, a push service down) must not cost everyone else their alerts.
        console.error('tick failed for one account', error);
      }
    }),
  );
  return { status: snapshot.status, people: people.length, sent };
}
