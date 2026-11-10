import { canCatch, parkedUp } from './alerts.ts';
import { formatClock, formatSince } from './time.ts';
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
export function answerFor({ route, prefs, status, eta, now, lastSeenAt, parkedSince, onRoute }: Input): Answer {
  if (status === 'offline') {
    return { tone: 'unknown', lead: 'Right now', headline: 'Not running', detail: lastSeenText(now, lastSeenAt) };
  }
  if (status === 'stale') {
    return { tone: 'unknown', lead: 'Right now', headline: 'No signal', detail: `${lastSeenText(now, lastSeenAt)} Times are paused until it reports again.` };
  }
  // It keeps reporting every 5 min while parked, so "live" alone would say "Bus is here" all night.
  if (parkedUp(parkedSince, now)) {
    return { tone: 'unknown', lead: 'Right now', headline: 'Not running', detail: `Parked since ${formatSince(parkedSince!, now)}. Times come back when it moves.` };
  }
  if (route.path.length === 0) {
    return { tone: 'unknown', lead: 'The bus is live', headline: 'Learning route', detail: 'Times appear once a full loop has been recorded.' };
  }
  const stop = route.stops.find((s) => s.id === prefs.stopId);
  if (!stop) {
    return { tone: 'unknown', lead: 'To get a time', headline: 'Pick your stop', detail: 'Choose where you catch the bus.' };
  }
  if (!onRoute || !eta) {
    return { tone: 'unknown', lead: 'Right now', headline: 'Off route', detail: "The bus isn't on its usual loop, so there's no reliable time." };
  }
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
      detail: `You'd miss the one arriving around ${arrival}. ${walkText}.`,
    };
  }
  if (leaveIn <= NOW_WINDOW_SECONDS) {
    return { tone: 'go', lead: `Bus reaches ${stop.name} around ${arrival}`, headline: 'Leave now', detail: `${walkText}.` };
  }
  return { tone: 'calm', lead: 'Leave in', headline: `${minutes(leaveIn)} min`, detail: `Bus reaches ${stop.name} around ${arrival}. ${walkText}.` };
}
