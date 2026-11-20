import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultPrefs } from './alerts.ts';
import { defaultSchedule } from './schedule.ts';
import { addSubscription, cleanOverride, cleanPrefs, cleanSchedule, cleanSubscription } from './validate.ts';

const NOW = Date.UTC(2026, 10, 9, 17);
const place = { id: 'b:COOR', name: 'Coor Hall', code: 'COOR', lat: 33.41935, lng: -111.9373 };
const block = { id: 'c1', course: 'CSE 205', placeId: 'b:COOR', startMin: 540, endMin: 615, days: [1, 3] };

describe('cleanPrefs', () => {
  it('takes sensible changes and holds numbers inside their limits', () => {
    const next = cleanPrefs(defaultPrefs, { walkMinutes: 400, bufferMinutes: -3, alertsBeforeMin: 45, stopId: 'sol', alerts: { leave: false, bogus: true } }, ['sol', 'gammage']);
    assert.deepEqual([next.walkMinutes, next.bufferMinutes, next.alertsBeforeMin, next.stopId], [30, 0, 45, 'sol']);
    assert.equal(next.alerts.leave, false);
    assert.equal('bogus' in next.alerts, false);
    assert.equal(next.alerts.atStop, true);
  });

  it('ignores what it cannot read', () => {
    assert.deepEqual(cleanPrefs(defaultPrefs, 'nonsense', ['sol']), defaultPrefs);
    const next = cleanPrefs(defaultPrefs, { walkMinutes: '7', stopId: 'mars', dailyWatch: { days: [1, 9, 'x'], startMin: 480, endMin: 600 } }, ['sol']);
    assert.equal(next.walkMinutes, 5);
    assert.equal(next.stopId, null);
    assert.deepEqual(next.dailyWatch, { days: [1], startMin: 480, endMin: 600 });
  });
});

describe('cleanSchedule', () => {
  it('keeps a well-formed schedule as it is', () => {
    const next = cleanSchedule(defaultSchedule, { places: [place], classes: [block], arriveEarlyMin: 8, paceMPerMin: 92, walkOverrides: { 'b:COOR|gammage': 7 } })!;
    assert.deepEqual(next.places, [place]);
    assert.deepEqual(next.classes, [block]);
    assert.deepEqual([next.arriveEarlyMin, next.paceMPerMin, next.walkOverrides], [8, 92, { 'b:COOR|gammage': 7 }]);
  });

  it('drops what would break the planner', () => {
    const next = cleanSchedule(defaultSchedule, {
      places: [place, { ...place, id: 'far', lat: 40.7 }, { ...place, id: 'sol' }, place],
      classes: [
        block,
        { ...block, id: 'backwards', startMin: 700, endMin: 600 },
        { ...block, id: 'nowhere', placeId: 'b:GONE' },
        { ...block, id: 'unnamed', course: '   ' },
        { ...block, id: 'visit', course: '', kind: 'visit', placeId: 'gammage' },
        { ...block, id: 'c1' },
        'junk',
      ],
      walkOverrides: { 'b:COOR|gammage': 9999, 'b:COOR|mars': 5, bad: 3 },
    })!;
    assert.deepEqual(next.places.map((p) => p.id), ['b:COOR']);
    assert.deepEqual(next.classes.map((c) => c.id), ['c1', 'visit']);
    assert.equal(next.classes[1].kind, 'visit');
    assert.deepEqual(next.walkOverrides, { 'b:COOR|gammage': 120 });
  });

  it('removes classes left without a building, and refuses things that are not schedules', () => {
    const current = cleanSchedule(defaultSchedule, { places: [place], classes: [block] })!;
    assert.deepEqual(cleanSchedule(current, { places: [] })!.classes, []);
    assert.equal(cleanSchedule(defaultSchedule, 'x'), null);
    assert.equal(cleanSchedule(defaultSchedule, { classes: 'x' }), null);
  });

  it('caps how much one person can store', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ ...block, id: `c${i}` }));
    assert.equal(cleanSchedule(defaultSchedule, { places: [place], classes: many })!.classes.length, 40);
  });
});

describe('cleanOverride', () => {
  it('lays today\'s taps over the earlier ones and forgets yesterday\'s', () => {
    const first = cleanOverride(null, { skipped: ['c1'] }, '2026-11-09', NOW)!;
    const second = cleanOverride(first, { onBusAt: NOW }, '2026-11-09', NOW)!;
    assert.deepEqual(second, { date: '2026-11-09', skipped: ['c1'], onBusAt: NOW });
    assert.deepEqual(cleanOverride(second, { homeAt: NOW }, '2026-11-10', NOW), { date: '2026-11-10', skipped: [], homeAt: NOW });
    assert.equal(cleanOverride(second, null, '2026-11-09', NOW), null);
  });

  it('refuses times that are nowhere near now', () => {
    const next = cleanOverride(null, { onBusAt: 5, outEarly: { c1: NOW - 60_000, c2: 'soon' } }, '2026-11-09', NOW)!;
    assert.equal(next.onBusAt, undefined);
    assert.deepEqual(next.outEarly, { c1: NOW - 60_000 });
  });
});

describe('push subscriptions', () => {
  const keys = { p256dh: 'p', auth: 'a' };

  it('accepts the real push services and nothing else', () => {
    assert.ok(cleanSubscription({ endpoint: 'https://web.push.apple.com/abc', keys }));
    assert.ok(cleanSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys }));
    // The server posts to this address, so it must never be somewhere of an attacker's choosing.
    assert.equal(cleanSubscription({ endpoint: 'https://example.com/hook', keys }), null);
    assert.equal(cleanSubscription({ endpoint: 'http://web.push.apple.com/abc', keys }), null);
    assert.equal(cleanSubscription({ endpoint: 'https://push.apple.com.evil.example/abc', keys }), null);
    assert.equal(cleanSubscription({ endpoint: 'not a url', keys }), null);
    assert.equal(cleanSubscription({ endpoint: 'https://web.push.apple.com/abc' }), null);
  });

  it('keeps one entry per device and at most five devices', () => {
    let list = [] as ReturnType<typeof addSubscription>;
    for (let i = 0; i < 7; i++) list = addSubscription(list, { endpoint: `https://web.push.apple.com/${i}`, keys });
    list = addSubscription(list, { endpoint: 'https://web.push.apple.com/6', keys });
    assert.deepEqual(list.map((s) => s.endpoint.at(-1)), ['2', '3', '4', '5', '6']);
  });
});

describe('one-off trips', () => {
  // NOW is 10:00 AM in Tempe on 2026-11-09.
  const HOUR = 3_600_000;
  const trip = (id: string, at: number, kind = 'arrive') => ({ id, kind, at });

  it('accepts a trip later today, on a five-minute mark', () => {
    const next = cleanOverride(null, { trips: [trip('a', NOW + HOUR + 70_000)] }, '2026-11-09', NOW)!;
    assert.deepEqual(next.trips, [{ id: 'a', kind: 'arrive', at: NOW + HOUR }]);
  });

  it('refuses a time that has passed, another day, or a kind it does not know', () => {
    const next = cleanOverride(null, { trips: [trip('past', NOW - 60_000), trip('tomorrow', NOW + 20 * HOUR), trip('odd', NOW + HOUR, 'teleport'), 'junk'] }, '2026-11-09', NOW)!;
    assert.equal(next.trips, undefined);
  });

  it('keeps a trip already planned once its time has come, and allows it to be removed', () => {
    const planned = cleanOverride(null, { trips: [trip('a', NOW + HOUR)] }, '2026-11-09', NOW)!;
    const later = NOW + 2 * HOUR;
    const more = cleanOverride(planned, { trips: [trip('a', NOW + HOUR), trip('b', later + HOUR, 'leave-campus')] }, '2026-11-09', later)!;
    assert.deepEqual(more.trips!.map((item) => item.id), ['a', 'b']);
    assert.equal(cleanOverride(more, { trips: [] }, '2026-11-09', later)!.trips, undefined);
  });

  it('caps a day at four', () => {
    const many = Array.from({ length: 9 }, (_, i) => trip(`t${i}`, NOW + (i + 1) * 600_000));
    assert.equal(cleanOverride(null, { trips: many }, '2026-11-09', NOW)!.trips!.length, 4);
  });
});

describe('cleanOverride: going now', () => {
  const DAY = '2026-11-09';
  const AT = Date.UTC(2026, 10, 9, 19);
  it('keeps a real "going now" and drops one with a made-up time or distance', () => {
    assert.deepEqual(cleanOverride(null, { goNow: { to: 'home', at: AT, walkMin: 3 } }, DAY, AT)!.goNow, { to: 'home', at: AT, walkMin: 3 });
    assert.equal(cleanOverride(null, { goNow: { to: 'home', at: AT - 3_600_000, walkMin: 3 } }, DAY, AT)!.goNow, undefined);
    assert.equal(cleanOverride(null, { goNow: { to: 'home', at: AT, walkMin: 2.5 } }, DAY, AT)!.goNow, undefined);
    assert.equal(cleanOverride(null, { goNow: { to: 'work', at: AT, walkMin: 2 } }, DAY, AT)!.goNow, undefined);
    const set = cleanOverride(null, { goNow: { to: 'campus', at: AT, walkMin: 0 } }, DAY, AT);
    assert.equal(cleanOverride(set, { goNow: null }, DAY, AT)!.goNow, undefined);
  });
});
