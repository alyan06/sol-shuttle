import { CAMPUS, GYM, HOME, allPlaces, walkMinutes } from './schedule.ts';
import { formatClock, tempeDayKey, tempeMidnight, tempeWeekday } from './time.ts';
import type {
  AfterClass,
  ClassBlock,
  Evening,
  FeedStatus,
  Place,
  Prefs,
  Progress,
  Route,
  Schedule,
  Stop,
  StopEta,
  Timetable,
} from './types.ts';

const MIN = 60_000;
/** A check can land this long after the moment to leave and still count as "now". */
const LEAVE_GRACE_MS = 75_000;
/** Each loop further ahead adds this much doubt to a time worked out from the loop length. */
const DRIFT_PER_LOOP_S = 180;
const SERVICE_SLACK_MS = 5 * MIN;
/** Bus-home alerts for a class begin this long before it ends. */
const WATCH_LEAD_MS = 15 * MIN;
/** Each later bus home is announced this long before the moment to set off. */
const PING_LEAD_MS = 10 * MIN;
/** Two bus times this close are the same bus, so it's only announced once. */
const SAME_BUS_MS = 10 * MIN;
/** With nobody saying they're home, the alerts stop this long after the last class. */
const WATCH_MAX_MS = 5 * 60 * MIN;
/** A class counts as "just over" for this long. */
const JUST_OVER_MS = 2 * MIN;
/** Still worth heading to a class that started this recently. */
const LATE_START_MS = 10 * MIN;
/** A leg still waiting on a bus time this long after it could have begun is over. */
const GIVE_UP_MS = 3 * 60 * MIN;
const NOTE_LATER = 'The bus time shows up about an hour before.';
/** The leg is due but the bus isn't reporting, so "later" would be the wrong thing to say. */
const NOTE_SILENT = 'No live bus time right now. Check the map before you set off.';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type LiveBus = { status: FeedStatus; etas: StopEta[]; parked: boolean } | null;

export type BusTime = {
  /** When the bus reaches the stop. */
  at: number;
  /** Seconds of doubt either way. */
  plusMinus: number;
  source: 'live' | 'history' | 'estimate';
  /** The bus is at the stop right now. */
  here: boolean;
};

export type Leg = {
  id: string;
  kind: 'bus' | 'walk' | 'class' | 'gym';
  title: string;
  /** When to set off (bus, walk) or when it begins (class, gym). Null when no bus time is known yet. */
  start: number | null;
  end: number | null;
  /** Bus legs: the bus being aimed for, and when it gets you to the far stop. */
  bus?: BusTime & { stopId: string; arrive: number };
  /** No bus time yet: the leg can't begin before this. */
  notBefore?: number;
  /** Minutes on foot: the whole leg for a walk, the walk to the stop for a bus. */
  walkMin?: number;
  /** Where a bus leg finally gets you, for the summary line. */
  goal?: string;
  classId?: string;
  room?: string;
  place?: string;
  skipped?: boolean;
  /** The moment to leave has passed, so this bus is taken as the one being caught. */
  committed?: boolean;
  lastBus?: boolean;
  /** Class legs: the first bus home you could catch if you left after this class. */
  after?: { leaveBy: number; at: number; home: number; walkMin: number; here: boolean; source: BusTime['source'] };
  /** Homeward legs: when you're free to set off. */
  freeAt?: number;
  note?: string;
  warn?: string;
  walkInstead?: { minutes: number; leaveBy: number | null; to: string };
};

export type DayPlan = {
  date: string;
  weekday: number;
  gymDay: boolean;
  /** Classes on today's pattern, skipped or not. */
  classCount: number;
  /** On campus at some point today, so the after-class choice applies. */
  onCampus: boolean;
  afterClass: AfterClass;
  evening: Evening;
  eveningLeaveMin: number;
  /** The evening choice is in play: a gym day with no gym straight after class. */
  eveningApplies: boolean;
  service: string | null;
  legs: Leg[];
  /**
   * Where the app takes you to be for the ride home: the class that's ending or just ended, until
   * the next class starts or you say you're on the bus. Null in class, at home, or once you've said so.
   */
  homeWatch: HomeWatch | null;
};

export type HomeWatch = {
  classId: string | null;
  /** The class the ride home is measured from, or null after leaving campus by hand. */
  course: string | null;
  place: string;
  walkMin: number;
  /** When you're free to set off. */
  freeAt: number;
  /** A next class starts then, so only a bus you could leave for before it counts. */
  until: number | null;
  next: { leaveBy: number; at: number; home: number; here: boolean; source: BusTime['source'] } | null;
};

export type PlanInput = {
  now: number;
  schedule: Schedule;
  route: Route;
  prefs: Pick<Prefs, 'walkMinutes' | 'bufferMinutes'>;
  live: LiveBus;
  timetable: Timetable | null;
  progress: Progress | null;
};

type Ctx = PlanInput & {
  midnight: number;
  places: Place[];
  home: Stop;
  campus: Stop;
  boarded: Progress['boarded'];
  /** When the bus parks for the night, if known. */
  lastMs: number | null;
  walk: (from: string, to: string) => number;
  name: (placeId: string) => string;
};

function forward(a: number, b: number, length: number): number {
  return (((b - a) % length) + length) % length;
}

/** Seconds from the bus reaching one stop to it reaching the other, waits included. */
function rideSeconds(route: Route, from: Stop, to: Stop): number {
  return forward(from.t, to.t, route.loopSeconds);
}

/**
 * Upcoming arrivals at a stop, soonest first. The live position covers the next loop or so; past
 * that it's the learned timetable, or the loop length repeated with growing doubt when there is none.
 */
export function busTimes(ctx: Pick<Ctx, 'now' | 'route' | 'live' | 'timetable' | 'prefs' | 'midnight'>, stopId: string): BusTime[] {
  const { now, route, live, timetable, midnight } = ctx;
  if (timetable?.runs === false) return [];
  const spare = ctx.prefs.bufferMinutes * 60;
  // The loop learned from one evening is the fallback; days of logged buses say what it really is.
  const loop = (timetable?.loopSec ?? route.loopSeconds) * 1000;
  const slots = timetable?.arrivals[stopId] ?? [];
  const times: BusTime[] = [];

  const eta = live && live.status === 'live' && !live.parked ? live.etas.find((e) => e.stopId === stopId) : undefined;
  if (eta) {
    const base = now + eta.seconds * 1000;
    times.push({ at: base, plusMinus: eta.atStop ? 0 : spare, source: 'live', here: eta.atStop });
    const loopsAhead = slots.length > 0 ? 1 : 3;
    for (let k = 1; k <= loopsAhead; k++) {
      times.push({ at: base + k * loop, plusMinus: spare + k * DRIFT_PER_LOOP_S, source: 'estimate', here: false });
    }
  }

  const coveredUntil = times.length > 0 ? times.at(-1)!.at + loop / 2 : now;
  for (const slot of slots) {
    const at = midnight + slot.sec * 1000;
    if (at <= coveredUntil) continue;
    times.push({ at, plusMinus: Math.max(spare, slot.sec - slot.early, slot.late - slot.sec), source: 'history', here: false });
  }
  return times;
}

/** The latest moment to be standing at the stop. A bus that's already there waits about half its usual stay. */
function beThereBy(bus: BusTime, stop: Stop): number {
  return bus.here ? bus.at + stop.dwellSeconds * 500 : bus.at - bus.plusMinus * 1000;
}

function noBusReason(ctx: Ctx, tooLate: boolean): string | null {
  if (ctx.timetable?.runs === false) return `No bus on ${DAY_NAMES[ctx.timetable.weekday]}s.`;
  if (ctx.lastMs !== null && tooLate) return `The bus finishes around ${formatClock(ctx.lastMs)}.`;
  return null;
}

/** arrive is null while the bus time isn't known; atLeast is then the soonest it could possibly be. */
type Trip = { legs: Leg[]; arrive: number | null; atLeast?: number };

/** Home to campus. With a deadline it's the latest bus that still makes it; without, the first one after readyAt. */
function outbound(ctx: Ctx, o: { id: string; readyAt: number; deadline: number | null; goal: string; walkTo: string; walkBy: number | null; startsAt?: number }): Trip {
  const { now, route, home, campus } = ctx;
  const ride = rideSeconds(route, home, campus) * 1000;
  const walkHome = ctx.prefs.walkMinutes;
  const walkAll = ctx.walk(HOME, o.walkTo);
  const walkInstead = { minutes: walkAll, leaveBy: o.walkBy === null ? null : o.walkBy - walkAll * MIN, to: ctx.name(o.walkTo) };
  // Walking is only worth offering while there's still time to do it.
  const canWalk = walkInstead.leaveBy === null || walkInstead.leaveBy >= now;
  const base = { id: o.id, kind: 'bus' as const, title: 'Bus to campus', walkMin: walkHome, goal: o.goal };

  const done = ctx.boarded[o.id];
  if (done) {
    const bus = { at: done.at, plusMinus: 0, source: 'live' as const, here: false, stopId: HOME, arrive: done.arrive };
    return { legs: [{ ...base, start: done.at - walkHome * MIN, end: done.arrive, bus, committed: true }], arrive: done.arrive };
  }

  const earliest = Math.max(o.readyAt, now);
  // The last loop leaves SoL about one trip-home's worth before the bus parks.
  const lastBoard = ctx.lastMs === null ? Infinity : ctx.lastMs - home.t * 1000 + SERVICE_SLACK_MS;
  const options = busTimes(ctx, HOME)
    .filter((bus) => bus.at <= lastBoard)
    .map((bus) => ({ bus, leaveAt: beThereBy(bus, home) - walkHome * MIN, arrive: bus.at + ride }))
    .filter((x) => x.leaveAt >= earliest - LEAVE_GRACE_MS);

  const loop = route.loopSeconds * 1000;
  const worstArrive = (x: (typeof options)[number]) => x.arrive + x.bus.plusMinus * 1000;
  const onTime = o.deadline === null ? [] : options.filter((x) => worstArrive(x) <= o.deadline!);
  // The latest on-time bus is only the answer if one loop later would be late. Otherwise the right
  // bus is further ahead than anything known yet.
  const latest = onTime.at(-1);
  const beyondView = latest !== undefined && worstArrive(latest) + loop <= o.deadline!;
  const pick = o.deadline === null ? options[0] : beyondView ? undefined : (latest ?? options[0]);

  if (!pick) {
    const reason = beyondView ? null : noBusReason(ctx, earliest + walkHome * MIN > lastBoard);
    if (reason) {
      const start = o.walkBy === null ? o.readyAt : walkInstead.leaveBy!;
      const leg: Leg = { id: o.id, kind: 'walk', title: `Walk to ${ctx.name(o.walkTo)}`, start, end: start + walkAll * MIN, walkMin: walkAll, warn: reason };
      return { legs: [leg], arrive: null };
    }
    const notBefore = o.deadline === null ? o.readyAt : o.deadline - ride - walkHome * MIN - loop;
    const note = notBefore <= now + 5 * MIN ? NOTE_SILENT : NOTE_LATER;
    return { legs: [{ ...base, start: null, end: null, notBefore, note, ...(canWalk ? { walkInstead } : {}) }], arrive: null };
  }

  const late = o.deadline !== null && pick.arrive + pick.bus.plusMinus * 1000 > o.deadline;
  const inRoom = late ? pick.arrive + (o.walkBy! - o.deadline!) : 0;
  // On time if nothing slips is "tight"; after the class has begun is "late".
  const verdict = late && o.startsAt !== undefined && inRoom <= o.startsAt ? `Tight for ${o.goal}` : `Late for ${o.goal}`;
  const leg: Leg = {
    ...base,
    start: pick.leaveAt,
    end: pick.arrive,
    bus: { ...pick.bus, stopId: HOME, arrive: pick.arrive },
    ...(late ? { warn: `${verdict}: in the room around ${formatClock(inRoom)}.`, ...(canWalk ? { walkInstead } : {}) } : {}),
  };
  return { legs: [leg], arrive: pick.arrive };
}

/** Campus to home: the first bus that can be reached from where you are, or the walk if there's none. */
/** Buses home that can still be reached after a given walk to the campus stop, soonest first. */
function homeBuses(ctx: Ctx, readyAt: number, walkToStop: number) {
  const ride = rideSeconds(ctx.route, ctx.campus, ctx.home) * 1000;
  const earliest = Math.max(readyAt, ctx.now);
  const lastHome = ctx.lastMs === null ? Infinity : ctx.lastMs + SERVICE_SLACK_MS;
  return busTimes(ctx, CAMPUS)
    .filter((bus) => bus.at + ride <= lastHome)
    .map((bus) => ({ bus, leaveAt: beThereBy(bus, ctx.campus) - walkToStop * MIN, arrive: bus.at + ride }))
    .filter((x) => x.leaveAt >= earliest - LEAVE_GRACE_MS);
}

function homeward(ctx: Ctx, o: { id: string; from: string; readyAt: number }): Trip {
  const { now, route, home, campus } = ctx;
  const ride = rideSeconds(route, campus, home) * 1000;
  const walkToStop = ctx.walk(o.from, CAMPUS);
  const walkHome = ctx.prefs.walkMinutes;
  const walkAll = ctx.walk(o.from, HOME);
  const base = { id: o.id, kind: 'bus' as const, title: 'Bus home', walkMin: walkToStop, goal: 'Home', freeAt: o.readyAt };

  const done = ctx.boarded[o.id];
  if (done) {
    const bus = { at: done.at, plusMinus: 0, source: 'live' as const, here: false, stopId: CAMPUS, arrive: done.arrive };
    const end = done.arrive + walkHome * MIN;
    return { legs: [{ ...base, start: done.at - walkToStop * MIN, end, bus, committed: true }], arrive: end };
  }

  const earliest = Math.max(o.readyAt, now);
  const lastHome = ctx.lastMs === null ? Infinity : ctx.lastMs + SERVICE_SLACK_MS;
  const options = homeBuses(ctx, o.readyAt, walkToStop);
  const pick = options[0];

  if (!pick) {
    const walkInstead = { minutes: walkAll, leaveBy: null, to: 'home' };
    const reason = noBusReason(ctx, earliest + walkToStop * MIN + ride > lastHome);
    if (reason) {
      const start = o.readyAt;
      const leg: Leg = { id: o.id, kind: 'walk', title: 'Walk home', start, end: start + walkAll * MIN, walkMin: walkAll, warn: reason };
      return { legs: [leg], arrive: leg.end };
    }
    const atLeast = earliest + walkToStop * MIN + ride + walkHome * MIN;
    const note = o.readyAt <= now + 5 * MIN ? NOTE_SILENT : NOTE_LATER;
    return { legs: [{ ...base, start: null, end: null, notBefore: o.readyAt, note, walkInstead }], arrive: null, atLeast };
  }

  const end = pick.arrive + walkHome * MIN;
  const lastBus = ctx.lastMs !== null && options.length === 1 && pick.bus.at + route.loopSeconds * 1000 + ride > lastHome;
  const leg: Leg = {
    ...base,
    start: pick.leaveAt,
    end,
    bus: { ...pick.bus, stopId: CAMPUS, arrive: pick.arrive },
    ...(lastBus ? { lastBus: true } : {}),
    ...(earliest + walkAll * MIN <= end ? { note: `Walking gets you home just as soon (${walkAll} min).` } : {}),
  };
  return { legs: [leg], arrive: end };
}

function walkLeg(id: string, title: string, start: number, minutes: number): Leg {
  return { id, kind: 'walk', title, start, end: start + minutes * MIN, walkMin: minutes };
}

function gymLeg(start: number, schedule: Schedule, doneAt: number | undefined): Leg {
  const planned = start + schedule.gym.workoutMin * MIN;
  return { id: 'gym', kind: 'gym', title: 'Gym', start, end: doneAt !== undefined && doneAt >= start ? doneAt : planned };
}

/** Works out today: which bus makes the first class, every walk in between, and the way home. */
export function planDay(input: PlanInput): DayPlan {
  const { now, schedule, route } = input;
  const date = tempeDayKey(now);
  const weekday = tempeWeekday(now);
  const midnight = tempeMidnight(now);
  const at = (minute: number) => midnight + minute * MIN;
  const ov = schedule.override?.date === date ? schedule.override : null;
  const skipped = new Set(ov?.skipped ?? []);
  const places = allPlaces(schedule, route);
  const home = route.stops.find((s) => s.id === HOME);
  const campus = route.stops.find((s) => s.id === CAMPUS);

  const classes: ClassBlock[] = schedule.patterns
    .filter((p) => p.days.includes(weekday) && (!p.until || date <= p.until))
    .flatMap((p) => p.classes)
    .sort((a, b) => a.startMin - b.startMin);
  const taken = classes.filter((c) => !skipped.has(c.id));
  const gymDay = schedule.gym.days.includes(weekday);
  const afterClass = ov?.afterClass ?? (gymDay ? schedule.gym.afterClass : 'home');
  const evening = ov?.evening ?? schedule.gym.evening;
  const eveningLeaveMin = ov?.eveningLeaveMin ?? schedule.gym.eveningLeaveMin;
  const leftEarly = ov?.leftAt !== undefined && ov.leftPlaceId !== undefined;
  const onCampus = taken.length > 0 || leftEarly;

  const plan: DayPlan = {
    date,
    weekday,
    gymDay,
    classCount: classes.length,
    onCampus,
    afterClass,
    evening,
    eveningLeaveMin,
    eveningApplies: gymDay && !(onCampus && afterClass === 'gym'),
    service: null,
    legs: [],
    homeWatch: null,
  };
  if (!home || !campus) return plan;

  const timetable = input.timetable;
  const ctx: Ctx = {
    ...input,
    midnight,
    places,
    home,
    campus,
    boarded: {},
    lastMs: timetable?.lastSec == null ? null : midnight + timetable.lastSec * 1000,
    walk: (from, to) => walkMinutes(schedule, places, from, to),
    name: (id) => places.find((p) => p.id === id)?.name ?? 'class',
  };
  // A class that let out early ends when it actually ended.
  const endOf = (c: ClassBlock) => {
    const out = ov?.outEarly?.[c.id];
    return out !== undefined && out >= at(c.startMin) && out < at(c.endMin) ? out : at(c.endMin);
  };
  if (input.progress?.date === date) {
    for (const [id, entry] of Object.entries(input.progress.boarded)) {
      // Finishing at the gym, or asking to plan again, drops a bus committed to before that.
      const stale = entry.since <= (ov?.replanAt ?? 0) || (id.startsWith('back') && entry.since <= (ov?.gymDoneAt ?? 0));
      if (!stale) ctx.boarded[id] = entry;
    }
  }
  if (timetable?.runs === false) plan.service = `No bus on ${DAY_NAMES[weekday]}s, going by the last ${timetable.daysSeen}.`;
  else if (ctx.lastMs !== null) plan.service = `Last bus parks around ${formatClock(ctx.lastMs)}${timetable?.lastSure ? '' : ' (seen once)'}.`;

  const legs: Leg[] = [];

  // Getting to the first class that can still be made.
  const target = taken.find((c) => at(c.startMin) > now - LATE_START_MS);
  if (!leftEarly && target && (ctx.boarded.out || target === taken[0] || endOf(taken[0]) < now)) {
    const inRoomBy = at(target.startMin) - schedule.arriveEarlyMin * MIN;
    const toRoom = ctx.walk(CAMPUS, target.placeId);
    const trip = outbound(ctx, { id: 'out', readyAt: 0, deadline: inRoomBy - toRoom * MIN, goal: target.course, walkTo: target.placeId, walkBy: inRoomBy, startsAt: at(target.startMin) });
    legs.push(...trip.legs);
    if (trip.arrive !== null) {
      const early = Math.round((at(target.startMin) - trip.arrive) / MIN) - toRoom;
      const walkIn = walkLeg('walk-in', `Walk to ${ctx.name(target.placeId)}`, trip.arrive, toRoom);
      if (early > 0) walkIn.note = `In the room about ${early} min before ${target.course}.`;
      legs.push(walkIn);
    }
  }

  let previous: ClassBlock | null = null;
  for (const c of classes) {
    const leg: Leg = {
      id: `class:${c.id}`,
      kind: 'class',
      title: c.course,
      start: at(c.startMin),
      end: endOf(c),
      classId: c.id,
      place: ctx.name(c.placeId),
      ...(c.room ? { room: c.room } : {}),
      ...(skipped.has(c.id) ? { skipped: true } : {}),
    };
    if (!leg.skipped && previous && previous.placeId !== c.placeId) {
      const gap = c.startMin - previous.endMin;
      const between = ctx.walk(previous.placeId, c.placeId);
      if (between > gap) leg.warn = `${between} min walk from ${ctx.name(previous.placeId)}, ${gap} min gap.`;
      else leg.note = `${between} min walk from ${ctx.name(previous.placeId)}.`;
    }
    // The ride home if you left after this class, while there's a bus time to go on.
    if (!leg.skipped && leg.end! > now - JUST_OVER_MS) {
      const toStop = ctx.walk(c.placeId, CAMPUS);
      const first = homeBuses(ctx, leg.end!, toStop)[0];
      if (first) {
        leg.after = { leaveBy: first.leaveAt, at: first.bus.at, home: first.arrive + ctx.prefs.walkMinutes * MIN, walkMin: toStop, here: first.bus.here, source: first.bus.source };
      }
    }
    if (!leg.skipped) previous = c;
    legs.push(leg);
  }

  const eveningFlow = (homeAt: number | null) => {
    if (evening === 'skip') return;
    const leave = Math.max(at(eveningLeaveMin), homeAt ?? 0);
    if (evening === 'walk') {
      const gym = gymLeg(leave + ctx.walk(HOME, GYM) * MIN, schedule, ov?.gymDoneAt);
      legs.push(walkLeg('walk-out', 'Walk to the gym', leave, ctx.walk(HOME, GYM)), gym, walkLeg('walk-back', 'Walk home', gym.end!, ctx.walk(GYM, HOME)));
      return;
    }
    const trip = outbound(ctx, { id: 'out2', readyAt: leave, deadline: null, goal: 'Gym', walkTo: GYM, walkBy: null });
    legs.push(...trip.legs);
    let gymStart: number | null = null;
    if (trip.arrive !== null) {
      const toGym = ctx.walk(CAMPUS, GYM);
      legs.push(walkLeg('walk-gym2', 'Walk to the gym', trip.arrive, toGym));
      gymStart = trip.arrive + toGym * MIN;
    } else if (trip.legs[0].kind === 'walk') {
      // No bus out, so the walk leg already ends at the gym.
      gymStart = trip.legs[0].end;
    }
    if (gymStart === null) return;
    const gym = gymLeg(gymStart, schedule, ov?.gymDoneAt);
    legs.push(gym, ...homeward(ctx, { id: 'back2', from: GYM, readyAt: gym.end! }).legs);
  };

  // Said "I'm on the bus" or "I'm home": the campus part of the day is over.
  const headedHome = ov?.homeAt ?? ov?.onBusAt;
  if (onCampus && headedHome !== undefined) {
    const homeTime = ov?.homeAt ?? ov!.onBusAt! + rideSeconds(route, campus, home) * 1000 + input.prefs.walkMinutes * MIN;
    if (gymDay && ov?.gymDoneAt === undefined) eveningFlow(homeTime);
  } else if (onCampus) {
    const last = taken.at(-1);
    let cursor = leftEarly ? { placeId: ov!.leftPlaceId!, at: ov!.leftAt! } : { placeId: last!.placeId, at: endOf(last!) };
    if (afterClass === 'gym') {
      const toGym = ctx.walk(cursor.placeId, GYM);
      const gym = gymLeg(cursor.at + toGym * MIN, schedule, ov?.gymDoneAt);
      legs.push(walkLeg('walk-gym', 'Walk to the gym', cursor.at, toGym), gym);
      cursor = { placeId: GYM, at: gym.end! };
    }
    const trip = homeward(ctx, { id: 'back', from: cursor.placeId, readyAt: cursor.at });
    legs.push(...trip.legs);
    if (gymDay && afterClass === 'home') eveningFlow(trip.arrive ?? trip.atLeast ?? null);
  } else if (gymDay) {
    eveningFlow(null);
  }

  // The ride home is watched from the class that's ending or just ended. Nothing is assumed about
  // the gym or about having left: it stays on that class until the next one starts, and after the
  // last class it carries on until you say you're on the bus or home.
  if (onCampus && headedHome === undefined) {
    let anchor: { classId: string | null; course: string | null; placeId: string; freeAt: number; until: number | null } | null = null;
    if (leftEarly) {
      anchor = { classId: null, course: null, placeId: ov!.leftPlaceId!, freeAt: ov!.leftAt!, until: null };
    } else {
      const index = taken.findLastIndex((c) => endOf(c) - WATCH_LEAD_MS <= now);
      if (index !== -1) {
        const c = taken[index];
        const following = taken[index + 1];
        anchor = { classId: c.id, course: c.course, placeId: c.placeId, freeAt: endOf(c), until: following ? at(following.startMin) : null };
      }
    }
    const over = anchor !== null && (anchor.until !== null ? now >= anchor.until : now > anchor.freeAt + WATCH_MAX_MS);
    if (anchor && !over) {
      const walkMin = ctx.walk(anchor.placeId, CAMPUS);
      const first = homeBuses(ctx, anchor.freeAt, walkMin)[0];
      const usable = first && (anchor.until === null || first.leaveAt < anchor.until);
      plan.homeWatch = {
        classId: anchor.classId,
        course: anchor.course,
        place: ctx.name(anchor.placeId),
        walkMin,
        freeAt: anchor.freeAt,
        until: anchor.until,
        next: usable ? { leaveBy: first.leaveAt, at: first.bus.at, home: first.arrive + input.prefs.walkMinutes * MIN, here: first.bus.here, source: first.bus.source } : null,
      };
    }
  }

  // Classes stay on the timeline all day; a walk or ride that's over drops off.
  plan.legs = legs.filter((leg) => {
    if (leg.kind === 'class') return true;
    if (leg.end !== null) return leg.end >= now;
    return (leg.notBefore ?? Infinity) > now - GIVE_UP_MS;
  });
  return plan;
}

/** Bus legs whose moment to leave has just passed: from here on they're the bus being caught. */
export function advanceProgress(progress: Progress | null, plan: DayPlan, now: number): { progress: Progress; committed: Leg[] } {
  const current: Progress = progress?.date === plan.date ? progress : { date: plan.date, boarded: {} };
  const committed = plan.legs.filter((leg) => leg.kind === 'bus' && leg.id !== 'back' && leg.bus && !leg.committed && leg.start !== null && now >= leg.start);
  if (committed.length === 0) return { progress: current, committed };
  const boarded = { ...current.boarded };
  for (const leg of committed) boarded[leg.id] = { at: leg.bus!.at, arrive: leg.bus!.arrive, since: now };
  return { progress: { date: plan.date, boarded }, committed };
}

function about(bus: BusTime): string {
  return bus.source === 'live' ? 'around' : 'roughly';
}

/** One line on a bus leg: where the bus is caught and where it gets you. */
export function busLine(leg: Leg, route: Route): string {
  if (!leg.bus) return leg.note ?? '';
  const stop = route.stops.find((s) => s.id === leg.bus!.stopId)?.name ?? 'the stop';
  const far = route.stops.find((s) => s.id !== leg.bus!.stopId)?.name ?? 'the other end';
  const when = leg.bus.here ? `Bus is at ${stop} now` : `Bus reaches ${stop} ${about(leg.bus)} ${formatClock(leg.bus.at)}`;
  return `${when}, ${far} by ${formatClock(leg.bus.arrive)}.`;
}

export type PlanAlert = { id: string; title: string; body: string };

/** The push for a leg at its moment to leave. */
export function leaveAlert(leg: Leg, route: Route): PlanAlert {
  const origin = leg.bus!.stopId === HOME ? 'Leave home now' : 'Head to the bus now';
  const walk = leg.walkMin ? ` ${leg.walkMin} min walk to the stop.` : '';
  const last = leg.lastBus ? ' This is the last bus today.' : '';
  return { id: leg.id, title: leg.goal && leg.goal !== 'Home' ? `${origin} for ${leg.goal}` : origin, body: `${busLine(leg, route)}${walk}${last}` };
}

/** Pushes for legs with no bus time: the walking deadline, a little ahead of it. */
export function walkAlerts(plan: DayPlan, now: number, fired: string[]): PlanAlert[] {
  return plan.legs
    .filter((leg) => leg.kind === 'bus' && !leg.bus && leg.walkInstead?.leaveBy != null)
    .filter((leg) => now >= leg.walkInstead!.leaveBy! - 10 * MIN && now < leg.walkInstead!.leaveBy! + 5 * MIN)
    .filter((leg) => !fired.includes(`${plan.date}:walk:${leg.id}`))
    .map((leg) => ({
      id: `walk:${leg.id}`,
      title: `No bus time yet for ${leg.goal}`,
      body: `To walk to ${leg.walkInstead!.to}, leave by ${formatClock(leg.walkInstead!.leaveBy!)} (${leg.walkInstead!.minutes} min).`,
    }));
}

/**
 * Bus-home alerts. The first comes up to 15 minutes before the class ends, for a bus you could set
 * off for soon after it. After the last class every later bus is announced too, a few minutes
 * before the moment to go, until you say you're on one. Each bus is announced once.
 */
export function busHomeAlerts(plan: DayPlan, now: number, fired: string[]): PlanAlert[] {
  const watch = plan.homeWatch;
  const next = watch?.next;
  if (!watch || !next) return [];
  const announced = fired.flatMap((key) => {
    const match = key.match(/:bus:(\d+)$/);
    return match ? [Number(match[1]) * MIN] : [];
  });
  if (announced.some((at) => Math.abs(at - next.at) < SAME_BUS_MS)) return [];

  // Early, while class is still on, only for a bus you'd leave for soon after it ends.
  const early = now < watch.freeAt && next.leaveBy <= watch.freeAt + WATCH_LEAD_MS;
  if (!early && now < next.leaveBy - PING_LEAD_MS) return [];

  const from = watch.course ? `After ${watch.course}` : 'From campus';
  const go = next.leaveBy - now <= MIN ? 'Leave now' : `Leave ${watch.place} by ${formatClock(next.leaveBy)}`;
  const bus = next.here ? 'It is at Gammage now' : `It reaches Gammage ${next.source === 'live' ? 'around' : 'roughly'} ${formatClock(next.at)}`;
  return [
    {
      id: `bus:${Math.round(next.at / MIN)}`,
      title: `${from}: bus home ${next.here ? 'now' : formatClock(next.at)}`,
      body: `${go}, ${watch.walkMin} min walk. ${bus}, home about ${formatClock(next.home)}.`,
    },
  ];
}

/** A heads-up some minutes before it's time to leave home, so the leave alert isn't the first you hear of it. */
export function headsUpAlerts(plan: DayPlan, route: Route, now: number, fired: string[]): PlanAlert[] {
  return plan.legs
    .filter((leg) => leg.kind === 'bus' && leg.bus && leg.bus.stopId === HOME && !leg.committed && leg.start !== null)
    .filter((leg) => leg.start! - now > 8 * MIN && leg.start! - now <= 25 * MIN)
    .filter((leg) => !fired.includes(`${plan.date}:soon:${leg.id}`))
    .map((leg) => ({
      id: `soon:${leg.id}`,
      title: `Leave at ${formatClock(leg.start!)} for ${leg.goal}`,
      body: `${busLine(leg, route)}${leg.warn ? ` ${leg.warn}` : ''}`,
    }));
}

export type PlanAnswer = { tone: 'calm' | 'go' | 'here' | 'unknown'; lead: string; headline: string; detail: string };

function inMinutes(ms: number): string {
  return `${Math.max(1, Math.round(ms / MIN))} min`;
}

/** The one line at the top of the screen: what to do next, from today's plan. Null when the plan has nothing left. */
export function planAnswer(plan: DayPlan, route: Route, now: number): PlanAnswer | null {
  const legs = plan.legs.filter((leg) => !leg.skipped && (leg.end === null || leg.end > now));
  const leg = legs[0];
  if (!leg) return null;
  const after = legs[1];
  const afterName = after?.kind === 'class' ? after.title : after?.title.toLowerCase();
  const then = after ? ` Then ${afterName}${after.start ? ` at ${formatClock(after.start)}` : ''}.` : '';

  if (leg.kind === 'bus') {
    if (!leg.bus) {
      const walk = leg.walkInstead?.leaveBy ? ` To walk instead, leave by ${formatClock(leg.walkInstead.leaveBy)} (${leg.walkInstead.minutes} min).` : '';
      const detail = `${leg.note ?? ''}${walk}`;
      if (leg.notBefore !== undefined && leg.notBefore - now > 30 * MIN) {
        return { tone: 'calm', lead: `${leg.title}, not before`, headline: formatClock(leg.notBefore), detail };
      }
      return { tone: 'unknown', lead: leg.title, headline: 'No time yet', detail };
    }
    const line = `${busLine(leg, route)}${leg.lastBus ? ' Last bus today.' : ''}${leg.warn ? ` ${leg.warn}` : ''}`;
    if (leg.committed) {
      const riding = now >= leg.bus.at;
      return { tone: 'calm', lead: riding ? 'On the bus' : 'On your way', headline: riding ? `${formatClock(leg.bus.arrive)}` : `Bus ${formatClock(leg.bus.at)}`, detail: line };
    }
    const wait = leg.start! - now;
    const from = leg.bus.stopId === HOME ? 'Leave' : 'Head to the bus';
    if (leg.bus.here && wait <= 45_000) return { tone: 'here', lead: leg.title, headline: 'Bus is here', detail: line };
    if (wait <= 45_000) return { tone: 'go', lead: leg.title, headline: `${from} now`, detail: line };
    const far = wait > 90 * MIN;
    return { tone: 'calm', lead: far ? `${from} at` : `${from} in`, headline: far ? formatClock(leg.start!) : inMinutes(wait), detail: line };
  }

  if (leg.kind === 'class') {
    if (leg.start! > now) {
      return { tone: 'calm', lead: `${leg.title} at`, headline: formatClock(leg.start!), detail: [leg.place, leg.room].filter(Boolean).join(', ') + '.' };
    }
    const home = leg.after ? ` To go home after this: leave by ${formatClock(leg.after.leaveBy)} for the ${formatClock(leg.after.at)} bus.` : '';
    return { tone: 'calm', lead: `In ${leg.title} until`, headline: formatClock(leg.end!), detail: `${then}${home}`.trim() };
  }

  if (leg.kind === 'gym') {
    if (leg.start! > now) return { tone: 'calm', lead: 'Gym at', headline: formatClock(leg.start!), detail: then.trim() };
    return { tone: 'calm', lead: 'At the gym until about', headline: formatClock(leg.end!), detail: then.trim() };
  }

  const walking = leg.start! <= now;
  const warn = leg.warn ? `${leg.warn} ` : '';
  if (walking) return { tone: 'calm', lead: leg.title, headline: `${leg.walkMin} min`, detail: `${warn}There by ${formatClock(leg.end!)}.` };
  const wait = leg.start! - now;
  return {
    tone: wait <= 45_000 ? 'go' : 'calm',
    lead: `${leg.title} ${wait > 90 * MIN ? 'at' : 'in'}`,
    headline: wait > 90 * MIN ? formatClock(leg.start!) : inMinutes(wait),
    detail: `${warn}${leg.walkMin} min on foot, there by ${formatClock(leg.end!)}.`,
  };
}
