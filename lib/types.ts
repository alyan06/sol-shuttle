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

export type StopEta = { stopId: string; seconds: number; atStop: boolean };

export type Snapshot = {
  now: number;
  status: FeedStatus;
  ping: Ping | null;
  located: Located | null;
  etas: StopEta[];
};

export type AlertPrefs = {
  leave: boolean;
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
  arrivals: Record<string, TimetableSlot[]>;
};

export type Place = { id: string; name: string; lat: number; lng: number };

/** A class meeting. Times are minutes after midnight in Tempe. */
export type ClassBlock = { id: string; course: string; placeId: string; room?: string; startMin: number; endMin: number };

export type Pattern = {
  id: string;
  name: string;
  days: number[];
  classes: ClassBlock[];
  /** Last day these classes meet, as YYYY-MM-DD in Tempe. After it the pattern is ignored. */
  until?: string;
};

export type AfterClass = 'gym' | 'home';
export type Evening = 'bus' | 'walk' | 'skip';

export type GymPlan = {
  days: number[];
  workoutMin: number;
  /** Usual choice after the last class on a gym day. */
  afterClass: AfterClass;
  /** Usual way to get to the gym after going home first, or on a day with no classes. */
  evening: Evening;
  eveningLeaveMin: number;
};

/** Today's one-off choices. Ignored once the date changes. */
export type DayOverride = {
  date: string;
  skipped: string[];
  afterClass?: AfterClass;
  evening?: Evening;
  eveningLeaveMin?: number;
  /** Left campus early from this place at this time. */
  leftAt?: number;
  leftPlaceId?: string;
  gymDoneAt?: number;
  /** "Plan again from now": buses committed to before this are forgotten. */
  replanAt?: number;
};

export type Schedule = {
  places: Place[];
  patterns: Pattern[];
  gym: GymPlan;
  /** Minutes to be in the room before class starts. */
  arriveEarlyMin: number;
  /** Walking pace in metres a minute. */
  paceMPerMin: number;
  /** Walk minutes that replace the estimate, keyed by the two place ids sorted and joined with "|". */
  walkOverrides: Record<string, number>;
  override: DayOverride | null;
};

/** Bus legs taken as boarded once their bus has come, so the plan doesn't jump to the next bus. */
export type Progress = { date: string; boarded: Record<string, { at: number; arrive: number; since: number }> };
