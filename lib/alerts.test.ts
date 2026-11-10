import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultPrefs, evaluate, expectedServiceEnd, initialAlertState, isWatching } from './alerts.ts';
import type { AlertState, Ping, Prefs, Route, Snapshot } from './types.ts';

const MIN = 60_000;
// Friday 2026-11-06, 10:00 in Tempe.
const T0 = Date.UTC(2026, 10, 6, 17, 0);

const route: Route = {
  generatedAt: null,
  loopsObserved: 3,
  loopSeconds: 1800,
  path: [],
  stops: [{ id: 'home', name: 'SoL', lat: 0, lng: 0, s: 0, t: 0, dwellSeconds: 120 }],
};
const prefs: Prefs = { ...defaultPrefs, stopId: 'home', walkMinutes: 5, bufferMinutes: 2 };

function ping(time: number, mph = 25): Ping {
  return { time, lat: 33.4, lng: -111.9, heading: 90, mph, address: 'x' };
}

function snap(now: number, seconds: number | null, opts: { mph?: number; atStop?: boolean; status?: Snapshot['status'] } = {}): Snapshot {
  return {
    now,
    status: opts.status ?? 'live',
    ping: opts.status === 'offline' ? null : ping(now, opts.mph ?? 25),
    located: { s: 100, t: 100, offsetM: 1 },
    etas: seconds === null ? [] : [{ stopId: 'home', seconds, atStop: opts.atStop ?? false }],
  };
}

function run(state: AlertState, snapshot: Snapshot, watching = true, p = prefs) {
  return evaluate({ snapshot, route, prefs: p, state, watching });
}

const kinds = (r: { events: { kind: string }[] }) => r.events.map((e) => e.kind);
const inService: AlertState = { ...initialAlertState, firstBusDay: '2026-11-06', lastMovedAt: T0 - MIN, lastSeenAt: T0 - MIN };

describe('time to leave', () => {
  it('fires once when the bus comes inside walk plus buffer', () => {
    const a = run(inService, snap(T0, 600));
    assert.deepEqual(kinds(a), []);
    const b = run(a.state, snap(T0 + MIN, 400));
    assert.deepEqual(kinds(b), ['leave']);
    const c = run(b.state, snap(T0 + 2 * MIN, 340));
    assert.deepEqual(kinds(c), []);
  });

  it('still fires when the ETA drops past the trigger and under the walk at once', () => {
    // Seen live: the bus cleared a long light and the ETA fell from 8.5 to 4 min between checks.
    const a = run(inService, snap(T0, 510));
    assert.deepEqual(kinds(a), []);
    assert.deepEqual(kinds(run(a.state, snap(T0 + MIN, 240))), ['leave']);
  });

  it('does not tell you to leave for a bus you can no longer reach', () => {
    assert.deepEqual(kinds(run(inService, snap(T0, 150))), []);
  });

  it('re-arms for the next loop', () => {
    const fired = run(inService, snap(T0, 400));
    const passed = run(fired.state, snap(T0 + 10 * MIN, 1500));
    assert.equal(passed.state.leaveFired, false);
    assert.deepEqual(kinds(run(passed.state, snap(T0 + 30 * MIN, 400))), ['leave']);
  });

  it('stays silent outside a watch, and does not fire late when the watch starts mid-approach', () => {
    const unwatched = run(inService, snap(T0, 400), false);
    assert.deepEqual(kinds(unwatched), []);
    assert.deepEqual(kinds(run(unwatched.state, snap(T0 + 10_000, 390), true)), []);
  });

  it('uses no ETA from stale data', () => {
    assert.deepEqual(kinds(run(inService, snap(T0, 400, { status: 'stale' }))), []);
  });
});

describe('at my stop', () => {
  it('reports arrival then departure, once each', () => {
    const a = run(inService, snap(T0, 0, { atStop: true, mph: 0 }));
    assert.deepEqual(kinds(a), ['arrived']);
    const b = run(a.state, snap(T0 + 10_000, 0, { atStop: true, mph: 0 }));
    assert.deepEqual(kinds(b), []);
    const c = run(b.state, snap(T0 + MIN, 1750));
    assert.deepEqual(kinds(c), ['departed']);
  });
});

describe('not running', () => {
  it('alerts after 20 still minutes during service, then says when it recovers', () => {
    const a = run({ ...inService, lastMovedAt: T0 - 21 * MIN }, snap(T0, 900, { mph: 0 }));
    assert.deepEqual(kinds(a), ['not-running']);
    const b = run(a.state, snap(T0 + MIN, 900, { mph: 0 }));
    assert.deepEqual(kinds(b), []);
    assert.deepEqual(kinds(run(b.state, snap(T0 + 2 * MIN, 880))), ['running-again']);
  });

  it('alerts when the signal disappears during service', () => {
    const state = { ...inService, lastMovedAt: T0 - 11 * MIN, lastSeenAt: T0 - 11 * MIN };
    const r = run(state, snap(T0, null, { status: 'offline' }));
    assert.deepEqual(kinds(r), ['not-running']);
    assert.match(r.events[0].body, /No signal/);
  });

  it('stays quiet overnight, before service has started today', () => {
    const state = { ...initialAlertState, firstBusDay: '2026-11-05', lastMovedAt: T0 - 600 * MIN, lastSeenAt: T0 - 600 * MIN };
    assert.deepEqual(kinds(run(state, snap(T0, null, { status: 'offline' }))), []);
  });

  it('stays quiet after the usual end of service', () => {
    const state = { ...inService, lastMovedAt: T0 - 30 * MIN, serviceEnds: { 5: [540, 545, 550] } };
    assert.deepEqual(kinds(run(state, snap(T0, 900, { mph: 0 }))), []);
  });
});

describe('first and last bus', () => {
  it('announces the first movement of the day and records when service ended', () => {
    const yesterdayEnd = T0 - 14 * 60 * MIN;
    const state = { ...initialAlertState, firstBusDay: '2026-11-05', lastMovedAt: yesterdayEnd, lastSeenAt: yesterdayEnd };
    const r = run(state, snap(T0, 900));
    assert.deepEqual(kinds(r), ['first-bus']);
    assert.equal(r.state.firstBusDay, '2026-11-06');
    assert.equal(Object.values(r.state.serviceEnds).flat().length, 1);
    assert.deepEqual(kinds(run(r.state, snap(T0 + MIN, 880))), []);
  });

  it('does not treat a short layover as a new service day', () => {
    assert.deepEqual(kinds(run({ ...inService, lastMovedAt: T0 - 15 * MIN }, snap(T0, 900))), []);
  });

  it('warns once inside the final loop, only after enough days are seen', () => {
    // 10:00 is minute 600; a 30 minute loop before a 10:20 end puts this tick in the final loop.
    const known = { ...inService, serviceEnds: { 5: [620, 620] } };
    assert.equal(expectedServiceEnd(known, 5), 620);
    const r = run(known, snap(T0, 900));
    assert.deepEqual(kinds(r), ['last-loop']);
    assert.deepEqual(kinds(run(r.state, snap(T0 + MIN, 880))), []);
    assert.deepEqual(kinds(run({ ...inService, serviceEnds: { 5: [620] } }, snap(T0, 900))), []);
  });
});

describe('prefs and watch windows', () => {
  it('respects a switched-off alert while keeping its state correct', () => {
    const p = { ...prefs, alerts: { ...prefs.alerts, leave: false } };
    const r = run(inService, snap(T0, 400), true, p);
    assert.deepEqual(kinds(r), []);
    assert.equal(r.state.leaveFired, true);
  });

  it('honours manual watches and weekly windows in Tempe time', () => {
    const daily = { days: [5], startMin: 9 * 60, endMin: 11 * 60 };
    assert.equal(isWatching(T0, null, daily), true);
    assert.equal(isWatching(T0, null, { ...daily, days: [1] }), false);
    assert.equal(isWatching(T0, null, { ...daily, endMin: 10 * 60 }), false);
    assert.equal(isWatching(T0, T0 + MIN, null), true);
    assert.equal(isWatching(T0, T0 - MIN, null), false);
  });
});
