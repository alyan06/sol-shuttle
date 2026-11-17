import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appendDay, emptyHistory, recordObservation } from './history.ts';
import { buildTimetable, typicalLoop } from './timetable.ts';
import type { DayLog, Route, Snapshot } from './types.ts';

// 2026-11-09 is a Monday. Tempe is UTC-7, so 15:00 UTC is 8:00 AM there.
const MON_8AM = Date.UTC(2026, 10, 9, 15, 0);
const MIN = 60_000;

const route: Route = {
  generatedAt: null,
  loopsObserved: 3,
  loopSeconds: 2100,
  path: [],
  stops: [
    { id: 'gammage', name: 'Gammage', lat: 0, lng: 0, s: 0, t: 600, dwellSeconds: 80 },
    { id: 'sol', name: 'SoL', lat: 0, lng: 0, s: 0, t: 1500, dwellSeconds: 500 },
  ],
};

function snap(now: number, at: string | null, opts: { mph?: number; status?: Snapshot['status']; offRoute?: boolean } = {}): Snapshot {
  return {
    now,
    status: opts.status ?? 'live',
    ping: { time: now, lat: 0, lng: 0, heading: 0, mph: opts.mph ?? (at ? 0 : 25), address: '' },
    located: opts.offRoute ? null : { s: 0, t: 0, offsetM: 0 },
    etas: opts.offRoute ? [] : route.stops.map((s) => ({ stopId: s.id, seconds: s.id === at ? 0 : 300, atStop: s.id === at })),
  };
}

function replay(steps: [number, string | null][], start: DayLog | null = null) {
  let today = start;
  for (const [minute, at] of steps) today = recordObservation(today, snap(MON_8AM + minute * MIN, at), route).today;
  return today!;
}

describe('recordObservation', () => {
  it('logs first and last movement and each stop visit', () => {
    const log = replay([[0, 'sol'], [1, null], [10, 'gammage'], [12, null], [25, 'sol'], [26, 'sol']]);
    assert.equal(log.firstMove, 8 * 3600 + 60);
    assert.equal(log.lastMove, 8 * 3600 + 12 * 60);
    assert.deepEqual(log.visits, [
      { stop: 'sol', arr: null, dep: 8 * 3600 + 60 },
      { stop: 'gammage', arr: 8 * 3600 + 600, dep: 8 * 3600 + 720 },
      { stop: 'sol', arr: 8 * 3600 + 1500, dep: null },
    ]);
  });

  it('leaves the arrival unknown for a bus already parked when the log begins', () => {
    assert.equal(replay([[0, 'sol']]).visits[0].arr, null);
  });

  it('does not close a visit on stale or off-route data', () => {
    let today = replay([[0, null], [5, 'gammage']]);
    today = recordObservation(today, snap(MON_8AM + 6 * MIN, null, { status: 'stale' }), route).today;
    today = recordObservation(today, snap(MON_8AM + 7 * MIN, null, { offRoute: true }), route).today;
    assert.equal(today.visits[0].dep, null);
  });

  it('logs a stop the bus went through between two checks', () => {
    // Seen live: a 20 second stop at Gammage fell between two 30 second checks and went unlogged.
    const looped: Route = { ...route, path: [{ lat: 0, lng: 0, s: 0, t: 0 }, { lat: 0, lng: 0, s: 9000, t: 2100 }], stops: route.stops.map((s) => ({ ...s, s: s.id === 'gammage' ? 4000 : 8600 })) };
    const moving = (now: number, s: number): Snapshot => ({ ...snap(now, null), located: { s, t: 0, offsetM: 0 } });
    let today = recordObservation(null, moving(MON_8AM, 3700), looped, false, null).today;
    today = recordObservation(today, moving(MON_8AM + 30_000, 4300), looped, false, 3700).today;
    assert.deepEqual(today.visits, [{ stop: 'gammage', arr: 8 * 3600 + 30, dep: 8 * 3600 + 30 }]);
    // Carrying on down the road adds nothing, and neither does a jump too big to be one drive.
    today = recordObservation(today, moving(MON_8AM + 60_000, 4900), looped, false, 4300).today;
    today = recordObservation(today, moving(MON_8AM + 90_000, 8900), looped, false, 4900).today;
    assert.equal(today.visits.length, 1);
  });

  it('logs when the bus did it, not when the check noticed', () => {
    // The bus set off at 8:00:10; the check that sees it runs 25 seconds later.
    const seen = MON_8AM + 35_000;
    const late: Snapshot = { ...snap(seen, null), ping: { time: MON_8AM + 10_000, lat: 0, lng: 0, heading: 0, mph: 20, address: '' } };
    assert.equal(recordObservation(null, late, route).today.firstMove, 8 * 3600 + 10);
  });

  it('notes where the bus went when it left the loop, and only while it is moving', () => {
    const off = (minute: number, mph: number): Snapshot => {
      const base = snap(MON_8AM + minute * MIN, null, { offRoute: true });
      return { ...base, ping: { ...base.ping!, lat: 33.421987, lng: -111.926812, mph } };
    };
    let today = recordObservation(null, off(0, 20), route).today;
    today = recordObservation(today, off(1, 0), route).today;
    today = recordObservation(today, off(2, 25), route).today;
    assert.deepEqual(today.detour, [
      [8 * 3600, 33.42199, -111.92681],
      [8 * 3600 + 120, 33.42199, -111.92681],
    ]);
    assert.deepEqual(today.visits, []);
  });

  it('hands back the finished day when the date changes', () => {
    const monday = replay([[0, null]]);
    const next = recordObservation(monday, snap(MON_8AM + 24 * 60 * MIN, 'sol'), route);
    assert.equal(next.finished?.day, '2026-11-09');
    assert.equal(next.today.day, '2026-11-10');
    assert.equal(next.today.weekday, 2);
  });

  it('marks a log that starts mid-service as partial', () => {
    const { today } = recordObservation(null, snap(MON_8AM, null), route, true);
    assert.equal(today.partial, true);
  });
});

describe('appendDay', () => {
  it('keeps a no-service day as just that fact, and replaces a repeated date', () => {
    const idle: DayLog = { day: '2026-11-08', weekday: 0, firstMove: null, lastMove: null, visits: [{ stop: 'sol', arr: null, dep: null }] };
    const history = appendDay(appendDay(emptyHistory, idle), idle);
    assert.equal(history.days.length, 1);
    assert.deepEqual(history.days[0].visits, []);
  });
});

describe('detours in the history', () => {
  it('keeps the path for the newest week only', () => {
    let history = emptyHistory;
    for (let i = 1; i <= 9; i++) {
      history = appendDay(history, { day: `2026-11-${String(i).padStart(2, '0')}`, weekday: i % 7, firstMove: 25200, lastMove: 68400, visits: [], detour: [[30000, 33.4, -111.9]] });
    }
    assert.deepEqual(history.days.map((d) => Boolean(d.detour)), [false, false, true, true, true, true, true, true, true]);
    assert.equal(history.days[0].firstMove, 25200);
  });
});

describe('buildTimetable', () => {
  const day = (date: string, weekday: number, arrivals: number[], last = 19 * 3600): DayLog => ({
    day: date,
    weekday,
    firstMove: 7 * 3600,
    lastMove: last,
    visits: arrivals.map((arr) => ({ stop: 'gammage', arr, dep: arr + 80 })),
  });
  const idle = (date: string, weekday: number): DayLog => ({ day: date, weekday, firstMove: null, lastMove: null, visits: [] });

  it('promises nothing from a single day', () => {
    const t = buildTimetable([day('a', 1, [30000])], 1);
    assert.equal(t.runs, null);
    assert.equal(t.firstSec, null);
    assert.deepEqual(t.arrivals, {});
  });

  it('finds runs that recur at about the same time and ignores one-offs', () => {
    const t = buildTimetable([day('a', 1, [30000, 32100, 40000]), day('b', 1, [30120, 32000]), day('c', 1, [29900, 32300])], 1);
    assert.equal(t.runs, true);
    assert.deepEqual(t.arrivals.gammage, [
      { sec: 30000, early: 29900, late: 30120 },
      { sec: 32100, early: 32000, late: 32300 },
    ]);
  });

  it('learns that a weekday has no service', () => {
    assert.equal(buildTimetable([idle('a', 6), idle('b', 6)], 6).runs, false);
  });

  it('uses the earliest end of service seen, including ends noted before logging began', () => {
    const t = buildTimetable([day('a', 1, [], 19 * 3600 + 300)], 1, [1141]);
    assert.equal(t.lastSec, 1141 * 60);
    assert.equal(t.lastSure, true);
  });

  it('ignores the first bus of a partial day', () => {
    const partial: DayLog = { ...day('a', 1, []), firstMove: 16 * 3600, partial: true };
    const t = buildTimetable([partial, day('b', 1, []), day('c', 1, [])], 1);
    assert.equal(t.firstSec, 7 * 3600);
  });
});

describe('typicalLoop', () => {
  const day = (arrivals: number[], firstMove = 7 * 3600): DayLog => ({ day: 'a', weekday: 4, firstMove, lastMove: 19 * 3600, visits: arrivals.map((arr) => ({ stop: 'sol', arr, dep: arr + 240 })) });
  const every = (minutes: number, count: number, from = 7 * 3600 + 600) => Array.from({ length: count }, (_, i) => from + i * minutes * 60);

  it('is the usual gap between one bus and the next at a stop', () => {
    assert.equal(typicalLoop([day(every(30, 9))]), 30 * 60);
  });

  it('does not count a break as a loop', () => {
    const withBreak = [...every(30, 5), ...every(30, 5, 7 * 3600 + 600 + 4 * 1800 + 55 * 60)];
    assert.equal(typicalLoop([day(withBreak)]), 30 * 60);
  });

  it('ignores a parked bus "arriving" before the first run, and waits for enough buses', () => {
    assert.equal(typicalLoop([day([49 * 60, ...every(30, 8)])]), 30 * 60);
    assert.equal(typicalLoop([day(every(30, 4))]), null);
  });
});

describe('breaks in the log', async () => {
  const { breaksOf, usualBreaks, breakPlace } = await import('./breaks.ts');
  const loop: Route = {
    generatedAt: null,
    loopsObserved: 1,
    loopSeconds: 2100,
    path: [],
    stops: [
      { id: 'sol', name: 'SoL', lat: 33.42134, lng: -111.90222, s: 0, t: 0, dwellSeconds: 500 },
      { id: 'gammage', name: 'Gammage', lat: 33.41715, lng: -111.93655, s: 0, t: 0, dwellSeconds: 80 },
    ],
  };
  const DAY = Date.UTC(2026, 10, 17, 7); // midnight in Tempe
  const at = (sec: number, lat: number, lng: number, mph: number): Snapshot => ({
    now: DAY + sec * 1000 + 5000,
    status: 'live',
    ping: { time: DAY + sec * 1000, lat, lng, heading: 90, mph, address: '' },
    located: null,
    etas: [],
  });

  it('logs standing still 10 minutes in the middle of the day as a break, with where', () => {
    let day = recordObservation(null, at(12 * 3600 + 57 * 60, 33.42, -111.92, 20), loop).today;
    // Moving at 12:58, parked east of SoL from 12:59, moving again at 1:40.
    day = recordObservation(day, at(12 * 3600 + 58 * 60, 33.4224, -111.897, 20), loop).today;
    day = recordObservation(day, at(12 * 3600 + 59 * 60, 33.4224, -111.8943, 0), loop).today;
    day = recordObservation(day, at(13 * 3600 + 20 * 60, 33.4224, -111.8943, 0), loop).today;
    day = recordObservation(day, at(13 * 3600 + 40 * 60, 33.4224, -111.8944, 15), loop).today;
    assert.deepEqual(day.breaks, [{ from: 12 * 3600 + 58 * 60, to: 13 * 3600 + 40 * 60, place: 'east' }]);
    // A few minutes at a light is not a break.
    day = recordObservation(day, at(13 * 3600 + 44 * 60, 33.42, -111.91, 0), loop).today;
    day = recordObservation(day, at(13 * 3600 + 47 * 60, 33.42, -111.91, 20), loop).today;
    assert.equal(day.breaks!.length, 1);
  });

  it('names the places the bus stops for breaks', () => {
    assert.equal(breakPlace({ lat: 33.4214, lng: -111.9024 }, loop), 'sol');
    assert.equal(breakPlace({ lat: 33.4224, lng: -111.8943 }, loop), 'east');
    assert.equal(breakPlace({ lat: 33.4172, lng: -111.9366 }, loop), 'gammage');
    assert.equal(breakPlace({ lat: 33.40, lng: -111.95 }, loop), 'elsewhere');
  });

  it('finds breaks in days logged before breaks were recorded, from long waits at a stop', () => {
    const old = { day: '2026-11-16', weekday: 1, firstMove: 25000, lastMove: 68000, visits: [{ stop: 'sol', arr: 46680, dep: 47900 }, { stop: 'sol', arr: 50000, dep: 50300 }] };
    assert.deepEqual(breaksOf(old), [{ from: 46680, to: 47900, place: 'sol' }]);
  });

  it('learns a break that comes back on most days of a weekday', () => {
    const day = (start: number, end: number) => ({ day: 'x', weekday: 1, firstMove: 25000, lastMove: 68000, visits: [], breaks: [{ from: start, to: end, place: 'sol' as const }] });
    assert.deepEqual(usualBreaks([day(46800, 49200), day(47400, 49800), day(46500, 48900)]), [{ from: 46800, to: 49200 }]);
    assert.deepEqual(usualBreaks([day(46800, 49200)]), []);
  });
});
