import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runsOn, serviceHours, serviceState, tripSlots, tripWindow } from './service.ts';
import { formatClock } from './time.ts';

// Monday 2026-11-09 in Tempe (UTC-7). day: 0 = Monday ... 5 = Saturday, 6 = Sunday.
const T = (hour: number, minute = 0, day = 0) => Date.UTC(2026, 10, 9 + day, hour + 7, minute);
const learned = { runs: true, firstSec: 6 * 3600 + 59 * 60, lastSec: 18 * 3600 + 59 * 60 };

describe('when the bus runs', () => {
  it('is Monday to Friday unless the log has shown otherwise', () => {
    assert.equal(runsOn(1, null), true);
    assert.equal(runsOn(6, null), false);
    assert.equal(runsOn(0, null), false);
    // A holiday Monday the log has learned about, or a Saturday it has seen the bus on.
    assert.equal(runsOn(1, { runs: false, firstSec: null, lastSec: null }), false);
    assert.equal(runsOn(6, { runs: true, firstSec: null, lastSec: null }), true);
  });

  it('keeps its hours to quarter hours, from the log when there is one', () => {
    assert.deepEqual(serviceHours(null), { firstSec: 7 * 3600, lastSec: 19 * 3600 });
    assert.deepEqual(serviceHours(learned), { firstSec: 6 * 3600 + 45 * 60, lastSec: 19 * 3600 });
  });

  it('says there is no bus on a weekend, and when the next one is', () => {
    const saturday = serviceState(T(10, 0, 5), null);
    assert.deepEqual(saturday, { open: false, headline: 'No bus today', detail: 'The shuttle runs Monday to Friday, about 7:00 AM to 7:00 PM. The next bus is on Monday around 7:00 AM.' });
    const sunday = serviceState(T(10, 0, 6), null);
    assert.equal(sunday.open, false);
    assert.match((sunday as { detail: string }).detail, /The next bus is tomorrow around 7:00 AM/);
  });

  it('says so before the first bus and after the last, and nothing in between', () => {
    assert.deepEqual(serviceState(T(3), null), { open: false, headline: 'Not running yet', detail: 'The first bus is around 7:00 AM.' });
    assert.deepEqual(serviceState(T(12), null), { open: true });
    // A quarter of an hour either side is still the bus's day: the first and last loops drift.
    assert.deepEqual(serviceState(T(6, 50), null), { open: true });
    assert.deepEqual(serviceState(T(19, 10), null), { open: true });
    const evening = serviceState(T(21, 0, 4), null);
    assert.deepEqual(evening, { open: false, headline: 'Done for today', detail: 'The last bus parks around 7:00 PM. The next bus is on Monday around 7:00 AM.' });
  });
});

describe('slots for a one-off trip', () => {
  const labels = (now: number, kind: 'arrive' | 'leave-home' | 'leave-campus') => tripSlots(now, kind, null).map((slot) => slot.label);

  it('are quarter-hour windows inside the bus\'s hours, never the small hours', () => {
    const all = labels(T(3), 'arrive');
    assert.equal(all[0], '7:00 to 7:15 AM');
    assert.equal(all.at(-1), '6:45 to 7:00 PM');
    assert.equal(all.length, 48);
    assert.ok(all.includes('11:45 AM to 12:00 PM'));
  });

  it('offer nothing that has already gone', () => {
    // 3:07 PM. Arriving in the 3:00 to 3:15 window is still possible; leaving at 3:00 is not.
    assert.equal(labels(T(15, 7), 'arrive')[0], '3:00 to 3:15 PM');
    assert.equal(labels(T(15, 7), 'leave-home')[0], '3:15 to 3:30 PM');
    // 3:12 PM: three minutes isn't enough to act on.
    assert.equal(labels(T(15, 12), 'arrive')[0], '3:15 to 3:30 PM');
  });

  it('plan arriving to the end of the window and leaving from its start', () => {
    const arrive = tripSlots(T(15, 7), 'arrive', null)[0];
    assert.equal(formatClock(arrive.at), '3:15 PM');
    const leave = tripSlots(T(15, 7), 'leave-campus', null)[0];
    assert.equal(formatClock(leave.at), '3:15 PM');
    assert.equal(tripWindow({ id: 'a', kind: 'arrive', at: arrive.at }), '3:00 to 3:15 PM');
    assert.equal(tripWindow({ id: 'b', kind: 'leave-campus', at: leave.at }), '3:15 to 3:30 PM');
  });

  it('are empty on a weekend and once the bus has finished', () => {
    assert.deepEqual(labels(T(10, 0, 5), 'arrive'), []);
    assert.deepEqual(labels(T(19, 30), 'leave-home'), []);
  });
});
