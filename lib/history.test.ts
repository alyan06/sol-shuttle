import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appendDay, emptyHistory, recordObservation } from './history.ts';
import { buildTimetable } from './timetable.ts';
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
