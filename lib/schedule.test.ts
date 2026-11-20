import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classesOn, estimateWalk, normalizeSchedule, stopWalkMinutes } from './schedule.ts';

const GAMMAGE = { lat: 33.41715, lng: -111.93655 };

describe('estimateWalk', () => {
  it('times a walk across campus and across town at a steady pace', () => {
    // A point about a kilometre north-east of the stop, across campus.
    assert.equal(estimateWalk({ lat: 33.423, lng: -111.931 }, GAMMAGE, 80), 13);
    // SoL to Gammage follows the street grid: about 3.7 km.
    assert.equal(estimateWalk({ lat: 33.42134, lng: -111.90222 }, GAMMAGE, 80), 46);
    assert.equal(estimateWalk(GAMMAGE, GAMMAGE, 80), 1);
  });
});

describe('stopWalkMinutes', () => {
  it('is the walk from the apartment at SoL and a typical campus walk at Gammage', () => {
    assert.equal(stopWalkMinutes({ walkMinutes: 5 }, 'sol'), 5);
    assert.equal(stopWalkMinutes({ walkMinutes: 5 }, null), 5);
    assert.equal(stopWalkMinutes({ walkMinutes: 5 }, 'gammage'), 10);
  });
});

describe('normalizeSchedule', () => {
  it('turns the old day patterns into classes with their own days, and drops the gym', () => {
    const old = {
      places: [{ id: 'p1', name: 'Coor Hall', lat: 33.4195, lng: -111.9369 }],
      patterns: [
        { id: 'mw', name: 'Monday and Wednesday', days: [1, 3], until: '2026-12-02', classes: [{ id: 'c1', course: 'CSE 205', placeId: 'p1', startMin: 540, endMin: 615 }] },
        { id: 'tth', name: 'Tuesday and Thursday', days: [2, 4], classes: [] },
      ],
      gym: { days: [1, 2], workoutMin: 75, afterClass: 'gym', evening: 'walk', eveningLeaveMin: 1020 },
      arriveEarlyMin: 8,
      paceMPerMin: 92,
      walkOverrides: { 'gammage|p1': 7 },
      override: { date: '2026-11-16', skipped: ['c1'], afterClass: 'home', gymDoneAt: 5, onBusAt: 9 },
    };
    const now = normalizeSchedule(old);
    assert.deepEqual(now.classes, [{ id: 'c1', course: 'CSE 205', placeId: 'p1', startMin: 540, endMin: 615, days: [1, 3], until: '2026-12-02' }]);
    assert.deepEqual(now.override, { date: '2026-11-16', skipped: ['c1'], onBusAt: 9 });
    assert.deepEqual([now.arriveEarlyMin, now.paceMPerMin, now.walkOverrides], [8, 92, { 'gammage|p1': 7 }]);
    assert.equal('gym' in now, false);
    assert.equal('patterns' in now, false);
  });

  it('leaves a current schedule alone and fills in a missing one', () => {
    const current = normalizeSchedule({ places: [], classes: [{ id: 'c', course: 'X', placeId: 'p', startMin: 1, endMin: 2, days: [5] }], arriveEarlyMin: 5, paceMPerMin: 80, walkOverrides: {}, override: null });
    assert.equal(current.classes[0].days[0], 5);
    assert.deepEqual(normalizeSchedule(null), { places: [], classes: [], arriveEarlyMin: 5, paceMPerMin: 80, walkOverrides: {}, override: null });
  });
});

describe('classesOn', () => {
  it('gives the day\'s blocks in order, up to their last day', () => {
    const schedule = normalizeSchedule({
      classes: [
        { id: 'late', course: 'B', placeId: 'p', startMin: 900, endMin: 960, days: [1] },
        { id: 'early', course: 'A', placeId: 'p', startMin: 540, endMin: 600, days: [1, 3], until: '2026-11-16' },
      ],
    });
    assert.deepEqual(classesOn(schedule, 1, '2026-11-16').map((c) => c.id), ['early', 'late']);
    assert.deepEqual(classesOn(schedule, 1, '2026-11-23').map((c) => c.id), ['late']);
    assert.deepEqual(classesOn(schedule, 2, '2026-11-17'), []);
  });
});

describe('normalizeSchedule keeps the choices made today', () => {
  const read = normalizeSchedule;
  it('keeps every field of the override, going now included', () => {
    const override = { date: '2026-11-20', skipped: ['c1'], leftAt: 1, leftPlaceId: 'a', replanAt: 2, outEarly: { c1: 3 }, onBusAt: 4, homeAt: 5, trips: [{ id: 't1', kind: 'arrive' as const, at: 6 }], goNow: { to: 'home' as const, at: 7, walkMin: 0 } };
    assert.deepEqual(read({ classes: [], override }).override, override);
  });
});
