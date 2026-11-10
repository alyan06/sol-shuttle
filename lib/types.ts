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
  | 'leave'
  | 'arrived'
  | 'departed'
  | 'not-running'
  | 'running-again'
  | 'first-bus'
  | 'last-loop';

export type AlertEvent = { kind: AlertKind; title: string; body: string };
