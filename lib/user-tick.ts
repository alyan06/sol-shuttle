import { evaluate, isWatching } from './alerts.ts';
import { liveBus } from './day.ts';
import { advanceProgress, busHomeAlerts, headsUpAlerts, leaveAlert, planDay, walkAlerts, withinAlertWindow, type DayPlan } from './plan.ts';
import { CAMPUS, HOME, hasPlan, stopWalkMinutes } from './schedule.ts';
import type { Tracking, User } from './store.ts';
import { tempeDayKey } from './time.ts';
import type { AlertEvent, AlertState, Prefs, Route, Snapshot, Timetable, UserState } from './types.ts';

const MIN = 60_000;
/** Arrival alerts follow a bus being caught from a while before it's due until a little after. */
const FOLLOW_BEFORE_MS = 30 * MIN;
const FOLLOW_AFTER_MS = 10 * MIN;

type UserTickInput = {
  now: number;
  snapshot: Snapshot;
  route: Route;
  /** The bus's memory as it stood before this check. */
  tracking: Tracking;
  timetable: Timetable | null;
  user: Pick<User, 'settings' | 'schedule' | 'state'>;
};

/**
 * One person's share of a check: their plan for today, the alerts it calls for, and what to
 * remember for next time. Pure, so a hundred people cost a hundred of these and one look at the bus.
 */
export function userTick({ now, snapshot, route, tracking, timetable, user }: UserTickInput): { sending: AlertEvent[]; state: UserState } {
  const { settings, schedule, state } = user;
  const date = tempeDayKey(now);
  const events: AlertEvent[] = [];

  // Today's plan: which bus is being caught, and the pushes for the moments to leave.
  let progress = state.progress;
  const planFired = state.planFired.filter((key) => key.startsWith(date));
  let followStop: string | null = null;
  let plan: DayPlan | null = null;
  if (hasPlan(schedule, date)) {
    plan = planDay({ now, schedule, route, prefs: settings.prefs, live: liveBus(snapshot, tracking), timetable, progress });
    const step = advanceProgress(progress, plan, now);
    progress = step.progress;
    const once = (alerts: { id: string; title: string; body: string }[]) => {
      for (const alert of alerts) {
        events.push({ kind: 'plan', title: alert.title, body: alert.body });
        planFired.push(`${date}:${alert.id}`);
      }
    };
    // The ride home, from the class that's ending or just ended, bus by bus until they're on one.
    if (settings.prefs.alerts.afterClass !== false) once(busHomeAlerts(plan, now, planFired));
    if (settings.prefs.alerts.leave) {
      for (const leg of step.committed) events.push({ kind: 'plan', ...leaveAlert(leg, route) });
      once(headsUpAlerts(plan, route, now, planFired));
      once(walkAlerts(plan, now, planFired));
    }
    const due = plan.legs.find((leg) => leg.committed && leg.bus && now >= leg.bus.at - FOLLOW_BEFORE_MS && now < leg.bus.at + FOLLOW_AFTER_MS);
    const justNow = step.committed[0];
    followStop = (justNow ?? due)?.bus?.stopId ?? null;
    // Close to a bus home they could be walking to: say when it pulls in at Gammage.
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
  const watchingByHand = isWatching(now, settings.watchUntil, settings.prefs.dailyWatch);
  const watching = followStop !== null || watchingByHand;
  let alertState: AlertState = { ...tracking, leaveFired: state.leaveFired, wasAtStop: state.wasAtStop };
  if (state.alertStopId !== prefs.stopId) {
    // A different stop: start from where the bus is now, so the switch itself announces nothing.
    const atStop = snapshot.etas.find((e) => e.stopId === prefs.stopId)?.atStop ?? false;
    alertState = { ...alertState, leaveFired: false, wasAtStop: atStop };
  }
  const result = evaluate({ snapshot, route, prefs, state: alertState, watching });
  events.push(...result.events);

  return {
    // Everything is still worked out and remembered, so nothing fires late when the window opens.
    // Only what's sent to the phone is held to the hours around their time on campus.
    sending: withinAlertWindow(events, plan, now, watchingByHand),
    state: { leaveFired: result.state.leaveFired, wasAtStop: result.state.wasAtStop, alertStopId: prefs.stopId, progress, planFired },
  };
}
