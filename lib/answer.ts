import { canCatch, parkedUp } from './alerts.ts';
import { formatClock, formatSince, tempeDayKey, tempeWeekday } from './time.ts';
import type { FeedStatus, Prefs, Route, StopEta } from './types.ts';

export type Tone = 'calm' | 'go' | 'here' | 'unknown';

export type Answer = {
  tone: Tone;
  /** Small line above the number. */
  lead: string;
  /** The thing readable at arm's length. */
  headline: string;
  detail: string;
};

type Input = {
  route: Route;
  prefs: Prefs;
  status: FeedStatus;
  eta: StopEta | null;
  now: number;
  lastSeenAt: number | null;
  /** When a currently parked bus last moved. Null while it's moving. */
  parkedSince: number | null;
  onRoute: boolean;
  /** Where a parked bus is, in words ("at SoL"), when known. */
  breakPlace?: string | null;
  /** When this weekday's usual break ends, if the bus is in one. */
  breakUntil?: number | null;
};

/** Leaving within this many seconds reads as "now"; shaving it finer would promise false precision. */
const NOW_WINDOW_SECONDS = 45;

function minutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

function lastSeenText(now: number, lastSeenAt: number | null): string {
  if (lastSeenAt === null) return 'No recent position from the bus.';
  const ago = now - lastSeenAt;
  if (ago < 3_600_000) return `Last signal ${minutes(ago / 1000)} min ago.`;
  return `Last signal at ${formatClock(lastSeenAt)}.`;
}

/** Turns the raw feed into the one thing to do. Never shows a time it can't stand behind. */
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function answerFor({ route, prefs, status, eta, now, lastSeenAt, parkedSince, breakPlace, breakUntil }: Input): Answer {
  if (status === 'offline') {
    return { tone: 'unknown', lead: 'Right now', headline: 'Not running', detail: lastSeenText(now, lastSeenAt) };
  }
  if (status === 'stale') {
    return { tone: 'unknown', lead: 'Right now', headline: 'No signal', detail: `${lastSeenText(now, lastSeenAt)} Times are paused until it reports again.` };
  }
  // It keeps reporting every 5 min while parked, so "live" alone would say "Bus is here" all night.
  if (parkedUp(parkedSince, now)) {
    // Parked since an earlier day: it hasn't started yet. Parked since earlier today: probably a break.
    if (tempeDayKey(parkedSince!) !== tempeDayKey(now)) {
      return { tone: 'unknown', lead: 'Right now', headline: 'Not running', detail: `Parked since ${formatSince(parkedSince!, now)}. Times come back when it moves.` };
    }
    const until = breakUntil ? ` On ${DAYS[tempeWeekday(now)]}s it usually starts again around ${formatClock(breakUntil)}.` : ' Times come back when it moves.';
    return { tone: 'unknown', lead: 'Probably the driver’s break', headline: 'On a break', detail: `Parked${breakPlace ? ` ${breakPlace}` : ''} since ${formatClock(parkedSince!)}.${until}` };
  }
  if (route.path.length === 0) {
    return { tone: 'unknown', lead: 'The bus is live', headline: 'Learning route', detail: 'Times appear once a full loop has been recorded.' };
  }
  const stop = route.stops.find((s) => s.id === prefs.stopId);
  if (!stop) {
    return { tone: 'unknown', lead: 'To get a time', headline: 'Pick your stop', detail: 'Choose where you catch the bus.' };
  }
  if (!eta) {
    return { tone: 'unknown', lead: 'Right now', headline: 'Off route', detail: "The bus is away from its usual area, so there's no time to give." };
  }
  // On other streets than usual the time comes from distance alone, and says so.
  const around = eta.rough ? 'roughly' : 'around';
  const roughNote = eta.rough ? ' The bus is taking a different route, so this is a rough time.' : '';
  if (eta.atStop) {
    return { tone: 'here', lead: `At ${stop.name}`, headline: 'Bus is here', detail: `If you miss it, the next one is about ${minutes(route.loopSeconds)} min later.` };
  }

  // Same lead time as the push alert, so the screen and the phone never disagree.
  const lead = (prefs.walkMinutes + prefs.bufferMinutes) * 60;
  const leaveIn = eta.seconds - lead;
  const arrival = formatClock(now + eta.seconds * 1000);
  const walkText = `${prefs.walkMinutes} min walk, ${prefs.bufferMinutes} min spare`;

  if (!canCatch(eta.seconds, stop, prefs)) {
    const nextLeave = leaveIn + route.loopSeconds;
    return {
      tone: 'calm',
      lead: 'For the next bus, leave in',
      headline: `${minutes(nextLeave)} min`,
      detail: `You'd miss the one arriving ${around} ${arrival}. ${walkText}.${roughNote}`,
    };
  }
  if (leaveIn <= NOW_WINDOW_SECONDS) {
    return { tone: 'go', lead: `Bus reaches ${stop.name} ${around} ${arrival}`, headline: 'Leave now', detail: `${walkText}.${roughNote}` };
  }
  return { tone: 'calm', lead: 'Leave in', headline: `${minutes(leaveIn)} min`, detail: `Bus reaches ${stop.name} ${around} ${arrival}. ${walkText}.${roughNote}` };
}
