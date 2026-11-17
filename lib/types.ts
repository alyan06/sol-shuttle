export type Ping = {
  time: number;
  lat: number;
  lng: number;
  heading: number;
  mph: number;
  address: string;
};

/** A point on the learned loop. s = metres from loop start, t = typical seconds from loop start. */
export type RoutePoint = { lat: number; lng: number; s: number; t: number };

export type Stop = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  s: number;
  t: number;
  dwellSeconds: number;
  /** Metres past the stop the bus can still be boarded, when it waits a little further on. */
  holdM?: number;
  /** How far before the stop the bus may already be waiting, in metres along the loop. */
  leadM?: number;
};

export type Route = {
  generatedAt: string | null;
  loopsObserved: number;
  loopSeconds: number;
  path: RoutePoint[];
  stops: Stop[];
};

export type Located = { s: number; t: number; offsetM: number };

export type FeedStatus = 'live' | 'stale' | 'offline';

export type StopEta = {
  stopId: string;
  seconds: number;
  atStop: boolean;
  /** Worked out from distance alone, because the bus is on roads the route wasn't learned on. */
  rough?: true;
};

/**
 * Which way the bus was last seen driving, and where. A stopped bus reports no heading, so this
 * is what says which side of the road it's waiting on.
 */
export type Course = { heading: number; at: number; lat: number; lng: number };

export type Snapshot = {
  now: number;
  status: FeedStatus;
  ping: Ping | null;
  located: Located | null;
  etas: StopEta[];
  course?: Course | null;
};

export type AlertPrefs = {
  leave: boolean;
  /** After each class: the bus home, when one can be caught soon. Missing on older saves means on. */
  afterClass?: boolean;
  atStop: boolean;
  notRunning: boolean;
  firstLast: boolean;
};

export type DailyWatch = { days: number[]; startMin: number; endMin: number };

export type Prefs = {
  stopId: string | null;
  walkMinutes: number;
  bufferMinutes: number;
  alerts: AlertPrefs;
  /** Recurring watch window in Tempe local time, minutes after midnight. */
  dailyWatch: DailyWatch | null;
  /** Alerts run from this many minutes before the first thing on campus to this many after the last. Missing means 120 and 60. */
  alertsBeforeMin?: number;
  alertsAfterMin?: number;
};

export type AlertState = {
  leaveFired: boolean;
  wasAtStop: boolean;
  lastMovedAt: number | null;
  lastSeenAt: number | null;
  outageSince: number | null;
  firstBusDay: string | null;
  lastLoopDay: string | null;
  /** Observed end of service per weekday, minutes after midnight. Newest last. */
  serviceEnds: Record<string, number[]>;
  prevS: number | null;
  course?: Course | null;
};

export type AlertKind =
  | 'plan'
  | 'leave'
  | 'arrived'
  | 'departed'
  | 'not-running'
  | 'running-again'
  | 'first-bus'
  | 'last-loop';

export type AlertEvent = { kind: AlertKind; title: string; body: string };

/** One stop visit in a day's log. Times are seconds after midnight in Tempe; null = not observed. */
export type Visit = { stop: string; arr: number | null; dep: number | null };

export type DayLog = {
  day: string;
  weekday: number;
  firstMove: number | null;
  lastMove: number | null;
  visits: Visit[];
  /** Logging began after service had started, so firstMove isn't the real first bus. */
  partial?: true;
  /** Where the bus went when it left the learned route: [second of day, lat, lng]. Kept for a week, to learn the detour from. */
  detour?: [number, number, number][];
};

export type History = { days: DayLog[] };

/** A run that recurs at about the same time: typical, earliest and latest arrival seen. */
export type TimetableSlot = { sec: number; early: number; late: number };

export type Timetable = {
  weekday: number;
  daysSeen: number;
  /** Whether the bus runs on this weekday. Null until enough days are seen. */
  runs: boolean | null;
  firstSec: number | null;
  /** Earliest end of service seen, when the bus parks for the night. */
  lastSec: number | null;
  lastSure: boolean;
  /** Typical seconds between one bus and the next at the same stop, from every logged day. Null until there are enough. */
  loopSec: number | null;
  arrivals: Record<string, TimetableSlot[]>;
};

/** A building on campus. `code` is ASU's own short name for it, as printed on a class schedule. */
export type Place = { id: string; name: string; lat: number; lng: number; code?: string };

/**
 * Time on campus: a class, or any other stretch someone wants to be there for ("visit"). Times are
 * minutes after midnight in Tempe. The bus there is planned for the start, the bus home from the end.
 */
export type ClassBlock = {
  id: string;
  course: string;
  placeId: string;
  room?: string;
  startMin: number;
  endMin: number;
  /** Weekdays it happens on, 0 = Sunday. */
  days: number[];
  /** Last day it happens, as YYYY-MM-DD in Tempe. After it the block is ignored. */
  until?: string;
  kind?: 'class' | 'visit';
};

/**
 * A trip planned for today only, from the home screen. "arrive" is a promise to be at the campus
 * stop by a time; the two "leave" kinds only say when someone can set off, with no promise about
 * when they get there.
 */
export type QuickTrip = { id: string; kind: 'arrive' | 'leave-home' | 'leave-campus'; at: number };

/** Today's one-off choices. Ignored once the date changes. */
export type DayOverride = {
  date: string;
  skipped: string[];
  /** Left campus early from this place at this time. */
  leftAt?: number;
  leftPlaceId?: string;
  /** "Plan again from now": buses committed to before this are forgotten. */
  replanAt?: number;
  /** Classes that let out early today, by class id, and when. */
  outEarly?: Record<string, number>;
  /** "I'm on the bus" and "I'm home": either one ends the bus-home alerts for the day. */
  onBusAt?: number;
  homeAt?: number;
  /** One-off trips planned for today. */
  trips?: QuickTrip[];
};

export type Schedule = {
  places: Place[];
  classes: ClassBlock[];
  /** Minutes to be in the room before class starts. */
  arriveEarlyMin: number;
  /** Walking pace in metres a minute. */
  paceMPerMin: number;
  /** Walk minutes that replace the estimate, keyed by the two place ids sorted and joined with "|". */
  walkOverrides: Record<string, number>;
  override: DayOverride | null;
};

/** What the alert check remembers about one person between runs. */
export type UserState = {
  leaveFired: boolean;
  wasAtStop: boolean;
  /** The stop the leave and arrival alerts are currently about. */
  alertStopId: string | null;
  progress: Progress | null;
  /** Plan alerts already sent today, as "date:id". */
  planFired: string[];
};

/** Bus legs taken as boarded once their bus has come, so the plan doesn't jump to the next bus. */
export type Progress = { date: string; boarded: Record<string, { at: number; arrive: number; since: number }> };
