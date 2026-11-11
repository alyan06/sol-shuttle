import { evaluate, isWatching } from './alerts.ts';
import { liveBus, timetableToday } from './day.ts';
import { appendDay, recordObservation } from './history.ts';
import { advanceProgress, busHomeAlerts, headsUpAlerts, leaveAlert, planDay, walkAlerts } from './plan.ts';
import { pushConfigured, sendPush } from './push.ts';
import routeData from './route.json';
import { fetchPings } from './samsara.ts';
import { CAMPUS, HOME, hasClasses, stopWalkMinutes } from './schedule.ts';
import { buildSnapshot } from './snapshot.ts';
import { load, save } from './store.ts';
import { tempeDayKey } from './time.ts';
import type { AlertEvent, AlertState, Prefs, Route } from './types.ts';

export const route = routeData as Route;

const MIN = 60_000;
/** Arrival alerts follow a bus being caught from a while before it's due until a little after. */
const FOLLOW_BEFORE_MS = 30 * MIN;
const FOLLOW_AFTER_MS = 10 * MIN;

/** One background check: read the feed, log the bus, run the plan and alert rules, push anything new. */
export async function runTick(now = Date.now()): Promise<{ status: string; sent: AlertEvent[] }> {
  const [pings, settings, tracking, schedule] = await Promise.all([fetchPings(), load('settings'), load('tracking'), load('schedule')]);
  const snapshot = buildSnapshot(route, pings, now, tracking.prevS);
  const date = tempeDayKey(now);
  const events: AlertEvent[] = [];

  // The bus's own history, for learning its timetable.
  const startedBeforeLogging = tracking.today === null && tracking.firstBusDay === date;
  const { today, finished } = recordObservation(tracking.today, snapshot, route, startedBeforeLogging, tracking.prevS);
  if (finished) await save('history', appendDay(await load('history'), finished));

  // Today's plan: which bus is being caught, and the pushes for the moments to leave.
  let progress = tracking.progress;
  const planFired = tracking.planFired.filter((key) => key.startsWith(date));
  let followStop: string | null = null;
  if (hasClasses(schedule)) {
    const plan = planDay({
      now,
      schedule,
      route,
      prefs: settings.prefs,
      live: liveBus(snapshot, tracking),
      timetable: await timetableToday(tracking, now),
      progress,
    });
    const step = advanceProgress(progress, plan, now);
    progress = step.progress;
    const once = (alerts: { id: string; title: string; body: string }[]) => {
      for (const alert of alerts) {
        events.push({ kind: 'plan', title: alert.title, body: alert.body });
        planFired.push(`${date}:${alert.id}`);
      }
    };
    // The ride home, from the class that's ending or just ended, bus by bus until he's on one.
    if (settings.prefs.alerts.afterClass !== false) once(busHomeAlerts(plan, now, planFired));
    if (settings.prefs.alerts.leave) {
      for (const leg of step.committed) events.push({ kind: 'plan', ...leaveAlert(leg, route) });
      once(headsUpAlerts(plan, route, now, planFired));
      once(walkAlerts(plan, now, planFired));
    }
    const due = plan.legs.find((leg) => leg.committed && leg.bus && now >= leg.bus.at - FOLLOW_BEFORE_MS && now < leg.bus.at + FOLLOW_AFTER_MS);
    const justNow = step.committed[0];
    followStop = (justNow ?? due)?.bus?.stopId ?? null;
    // Close to a bus home he could be walking to: say when it pulls in at Gammage.
    const home = plan.homeWatch?.next;
    if (!followStop && home && now >= home.leaveBy - 10 * MIN && now < home.at + FOLLOW_AFTER_MS) followStop = CAMPUS;
    if (followStop !== HOME && followStop !== CAMPUS) followStop = null;
  }

  // Arrival and outage alerts. While a planned bus is due they follow its stop; the plan already
  // sent the moment to leave, so that one is switched off here.
  const prefs: Prefs = followStop
    ? { ...settings.prefs, stopId: followStop, alerts: { ...settings.prefs.alerts, leave: false } }
    : // Watching by hand: the walk depends on which stop. SoL is from the apartment, Gammage a typical walk across campus.
      { ...settings.prefs, walkMinutes: stopWalkMinutes(settings.prefs, settings.prefs.stopId) };
  const watching = followStop !== null || isWatching(now, settings.watchUntil, settings.prefs.dailyWatch);
  let alertState: AlertState = tracking;
  if (tracking.alertStopId !== prefs.stopId) {
    // A different stop: start from where the bus is now, so the switch itself announces nothing.
    const atStop = snapshot.etas.find((e) => e.stopId === prefs.stopId)?.atStop ?? false;
    alertState = { ...tracking, leaveFired: false, wasAtStop: atStop };
  }
  const result = evaluate({ snapshot, route, prefs, state: alertState, watching });
  events.push(...result.events);

  await save('tracking', {
    ...tracking,
    ...result.state,
    lastPing: snapshot.ping ?? tracking.lastPing,
    today,
    progress,
    alertStopId: prefs.stopId,
    planFired,
  });

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
