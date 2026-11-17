import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultPrefs, initialAlertState } from './alerts.ts';
import { defaultSchedule } from './schedule.ts';
import { defaultSettings, initialUserState, type Tracking, type User } from './store.ts';
import { userTick } from './user-tick.ts';
import type { Route, Schedule, Snapshot } from './types.ts';

// Monday 2026-11-09 in Tempe (UTC-7).
const T = (hour: number, minute = 0, second = 0) => Date.UTC(2026, 10, 9, hour + 7, minute, second);

const route: Route = {
  generatedAt: null,
  loopsObserved: 3,
  loopSeconds: 2100,
  path: [],
  stops: [
    { id: 'gammage', name: 'Gammage', lat: 33.41715, lng: -111.93655, s: 0, t: 600, dwellSeconds: 80 },
    { id: 'sol', name: 'SoL', lat: 33.42134, lng: -111.90222, s: 0, t: 1500, dwellSeconds: 500 },
  ],
};

/** A live bus that reaches SoL in `solMin` minutes and Gammage 20 minutes after that. */
function snapshot(now: number, solMin: number): Snapshot {
  return {
    now,
    status: 'live',
    ping: { time: now - 5000, lat: 33.42, lng: -111.92, heading: 90, mph: 20, address: '' },
    located: { s: 100, t: 100, offsetM: 0 },
    etas: [
      { stopId: 'sol', seconds: solMin * 60, atStop: false },
      { stopId: 'gammage', seconds: (solMin * 60 + 1200) % 2100, atStop: false },
    ],
  };
}

const tracking: Tracking = { ...initialAlertState, lastMovedAt: T(7, 59), lastSeenAt: T(7, 59), firstBusDay: '2026-11-09', lastPing: null, today: null };

const place = { id: 'a', name: 'Brickyard', lat: 33.4236, lng: -111.9397 };
const withClass = (startMin: number, id: string): Schedule => ({
  ...defaultSchedule,
  places: [place],
  classes: [{ id, course: 'CSE 205', placeId: 'a', startMin, endMin: startMin + 75, days: [1] }],
  walkOverrides: { 'a|gammage': 8, 'a|sol': 52 },
});

const person = (schedule: Schedule, more: Partial<User['settings']> = {}): Pick<User, 'settings' | 'schedule' | 'state'> => ({
  settings: { ...defaultSettings, ...more },
  schedule,
  state: initialUserState,
});

describe('one person\'s share of a check', () => {
  it('sends the moment to leave once, and remembers the bus being caught', () => {
    // 9:00 class. Bus at SoL 8:10: leave at 8:03.
    const early = userTick({ now: T(8, 2), snapshot: snapshot(T(8, 2), 8), route, tracking, timetable: null, user: person(withClass(540, 'c1')) });
    assert.deepEqual(early.sending, []);

    const now = T(8, 3, 30);
    const due = userTick({ now, snapshot: snapshot(now, 6.5), route, tracking, timetable: null, user: { ...person(withClass(540, 'c1')), state: early.state } });
    assert.deepEqual(due.sending.map((e) => e.title), ['Leave home now for CSE 205']);
    assert.equal(due.state.progress!.boarded.out.at, T(8, 10));
    assert.equal(due.state.alertStopId, 'sol');

    const again = userTick({ now: now + 30_000, snapshot: snapshot(now + 30_000, 6), route, tracking, timetable: null, user: { ...person(withClass(540, 'c1')), state: due.state } });
    assert.deepEqual(again.sending, []);
  });

  it('gives two people with different classes different answers from the same bus', () => {
    const now = T(8, 3, 30);
    const bus = snapshot(now, 6.5);
    const morning = userTick({ now, snapshot: bus, route, tracking, timetable: null, user: person(withClass(540, 'c1')) });
    // Someone whose class is at 3 PM hears nothing at 8 in the morning.
    const afternoon = userTick({ now, snapshot: bus, route, tracking, timetable: null, user: person(withClass(900, 'c2')) });
    assert.equal(morning.sending.length, 1);
    assert.deepEqual(afternoon.sending, []);
    assert.equal(afternoon.state.progress!.boarded.out, undefined);
  });

  it('respects each person\'s own alert switches and hours', () => {
    const now = T(8, 3, 30);
    const bus = snapshot(now, 6.5);
    const off = person(withClass(540, 'c1'), { prefs: { ...defaultPrefs, alerts: { ...defaultPrefs.alerts, leave: false } } });
    assert.deepEqual(userTick({ now, snapshot: bus, route, tracking, timetable: null, user: off }).sending, []);
    // Alerts set to start only 30 minutes before class: 8:03 is too early for a 9:00 class.
    const narrow = person(withClass(540, 'c1'), { prefs: { ...defaultPrefs, alertsBeforeMin: 30 } });
    assert.deepEqual(userTick({ now, snapshot: bus, route, tracking, timetable: null, user: narrow }).sending, []);
  });

  it('stays silent for someone with no classes who is not watching', () => {
    const now = T(8, 3, 30);
    const idle = userTick({ now, snapshot: snapshot(now, 2), route, tracking, timetable: null, user: person(defaultSchedule, { prefs: { ...defaultPrefs, stopId: 'sol' } }) });
    assert.deepEqual(idle.sending, []);
    // Watching by hand, the same bus is announced.
    const watching = userTick({ now, snapshot: snapshot(now, 2), route, tracking, timetable: null, user: person(defaultSchedule, { prefs: { ...defaultPrefs, stopId: 'sol' }, watchUntil: now + 600_000 }) });
    assert.deepEqual(watching.sending.map((e) => e.kind), ['leave']);
  });
});
