import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { advanceProgress, busHomeAlerts, headsUpAlerts, leaveAlert, planAnswer, planDay, walkAlerts, withinAlertWindow, type LiveBus, type PlanInput } from './plan.ts';
import { defaultSchedule } from './schedule.ts';
import { formatClock } from './time.ts';
import type { DayOverride, Route, Schedule, Timetable } from './types.ts';

// Monday 2026-11-09 in Tempe (UTC-7). day: 0 = Monday ... 5 = Saturday.
const T = (hour: number, minute = 0, day = 0) => Date.UTC(2026, 10, 9 + day, hour + 7, minute);
const DATES = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'];
const clock = (ms: number | null | undefined) => (ms == null ? null : formatClock(ms));

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
// SoL to Gammage is 20 min arrival to arrival; Gammage to SoL is 15.

const schedule: Schedule = {
  ...defaultSchedule,
  places: [
    { id: 'a', name: 'Brickyard', lat: 33.4236, lng: -111.9397 },
    { id: 'b', name: 'Coor Hall', lat: 33.4195, lng: -111.9369 },
  ],
  classes: [
    { id: 'c1', course: 'CSE 205', placeId: 'a', room: '210', startMin: 9 * 60, endMin: 10 * 60 + 15, days: [1, 3] },
    { id: 'c2', course: 'PHY 121', placeId: 'b', startMin: 10 * 60 + 30, endMin: 11 * 60 + 45, days: [1, 3] },
    { id: 'c3', course: 'ENG 102', placeId: 'b', startMin: 13 * 60 + 30, endMin: 14 * 60 + 45, days: [2, 4] },
  ],
  walkOverrides: {
    'a|gammage': 8,
    'b|gammage': 7,
    'a|b': 6,
    'a|sol': 52,
    'b|sol': 50,
  },
};

/** The bus reaches SoL in `solMin` minutes; Gammage follows from the loop. */
function live(solMin: number, opts: { atSol?: boolean } = {}): LiveBus {
  const sol = opts.atSol ? 0 : solMin * 60;
  return {
    status: 'live',
    parked: false,
    etas: [
      { stopId: 'sol', seconds: sol, atStop: Boolean(opts.atSol) },
      { stopId: 'gammage', seconds: (solMin * 60 + 1200) % 2100, atStop: false },
    ],
  };
}

function plan(now: number, bus: LiveBus, more: Partial<PlanInput> & { ov?: Partial<DayOverride>; day?: number } = {}) {
  const { ov, day = 0, ...rest } = more;
  const override = ov ? { date: DATES[day], skipped: [], ...ov } : null;
  return planDay({
    now,
    schedule: { ...schedule, override },
    route,
    prefs: { walkMinutes: 5, bufferMinutes: 2 },
    live: bus,
    timetable: null,
    progress: null,
    ...rest,
  });
}

const ids = (p: ReturnType<typeof planDay>) => p.legs.map((l) => l.id);
const leg = (p: ReturnType<typeof planDay>, id: string) => p.legs.find((l) => l.id === id)!;
const timetable = (over: Partial<Timetable>): Timetable => ({ weekday: 1, daysSeen: 3, runs: true, firstSec: null, lastSec: null, lastSure: true, loopSec: null, arrivals: {}, ...over });

describe('getting to class', () => {
  it('picks the latest bus that still makes the first class', () => {
    // Bus at SoL 8:10, Gammage 8:30. Needed at Gammage by 8:47 (9:00 class, 5 early, 8 min walk).
    const p = plan(T(8), live(10));
    const out = leg(p, 'out');
    assert.equal(clock(out.bus!.at), '8:10 AM');
    assert.equal(clock(out.start), '8:03 AM');
    assert.equal(clock(out.bus!.arrive), '8:30 AM');
    assert.equal(clock(leg(p, 'walk-in').end), '8:38 AM');
    assert.equal(out.warn, undefined);
  });

  it('skips a bus that only makes it if nothing slips', () => {
    // Buses reach SoL at 7:51 and 8:26. The 8:26 would reach Gammage 8:46, one minute inside the
    // deadline: too tight to count on.
    const p = plan(T(7, 40), live(11));
    assert.equal(clock(leg(p, 'out').bus!.at), '7:51 AM');
  });

  it('says so when no bus makes it, and offers the walk', () => {
    const p = plan(T(8, 40), live(10));
    const out = leg(p, 'out');
    // Bus at SoL 8:50, Gammage 9:10, 8 min walk: in the room 9:18 for a 9:00 class.
    assert.equal(out.warn, 'Late for CSE 205: in the room around 9:18 AM.');
    // Walking takes 52 min, so by 8:40 it's too late to offer.
    assert.equal(out.walkInstead, undefined);
    assert.equal(leg(plan(T(7, 55), null), 'out').walkInstead!.minutes, 52);
  });

  it('calls a bus tight when it makes the class only if nothing slips', () => {
    // Bus at SoL 8:28, Gammage 8:48, in the room 8:56 for 9:00: inside the class time, outside the margin.
    const out = leg(plan(T(8, 15), live(13)), 'out');
    assert.equal(out.warn, 'Tight for CSE 205: in the room around 8:56 AM.');
  });

  it('gives no bus time for a class hours away, only when it can firm up', () => {
    const p = plan(T(8, 0, 1), live(10), { day: 1 });
    const out = leg(p, 'out');
    assert.equal(out.bus, undefined);
    assert.equal(out.start, null);
    assert.ok(out.notBefore! > T(12, 0, 1) && out.notBefore! < T(13, 0, 1));
    assert.equal(clock(out.walkInstead!.leaveBy), '12:35 PM');
  });

  it('uses the learned timetable beyond what the live bus shows', () => {
    const slots = [12 * 3600 + 40 * 60, 13 * 3600 + 15 * 60].map((sec) => ({ sec, early: sec - 120, late: sec + 120 }));
    const p = plan(T(8, 0, 1), live(10), { day: 1, timetable: timetable({ weekday: 2, arrivals: { sol: slots } }) });
    const out = leg(p, 'out');
    // 12:40 at SoL reaches Gammage 1:00, in time for 1:18. The 1:15 bus would not.
    assert.equal(clock(out.bus!.at), '12:40 PM');
    assert.equal(out.bus!.source, 'history');
  });

  it('stops planning classes after their last day', () => {
    const ended = { ...schedule, classes: schedule.classes.map((c) => ({ ...c, until: '2026-11-08' })) };
    const p = planDay({ now: T(8), schedule: ended, route, prefs: { walkMinutes: 5, bufferMinutes: 2 }, live: live(10), timetable: null, progress: null });
    assert.equal(p.classCount, 0);
    assert.deepEqual(ids(p), []);
    assert.equal(p.alertWindow, null);
    const lastDay = { ...schedule, classes: schedule.classes.map((c) => ({ ...c, until: '2026-11-09' })) };
    assert.equal(planDay({ now: T(8), schedule: lastDay, route, prefs: { walkMinutes: 5, bufferMinutes: 2 }, live: live(10), timetable: null, progress: null }).classCount, 2);
  });

  it('warns when two classes are further apart than the gap between them', () => {
    const tight = { ...schedule, walkOverrides: { ...schedule.walkOverrides, 'a|b': 20 } };
    const p = planDay({ now: T(8), schedule: tight, route, prefs: { walkMinutes: 5, bufferMinutes: 2 }, live: live(10), timetable: null, progress: null });
    assert.match(leg(p, 'class:c2').warn!, /20 min walk from Brickyard, 15 min gap/);
  });
});

describe('after class', () => {
  it('takes the first bus home that can be reached after the last class', () => {
    // Bus reaches Gammage 11:55. Leave Coor Hall at 11:46 for a 7 min walk and 2 spare.
    const p = plan(T(11, 40), live(30));
    const back = leg(p, 'back');
    assert.equal(clock(back.bus!.at), '11:55 AM');
    assert.equal(clock(back.start), '11:46 AM');
    assert.equal(clock(back.end), '12:15 PM');
    assert.equal(back.bus!.stopId, 'gammage');
    assert.deepEqual(ids(p).slice(-1), ['back']);
  });

  it('plans from the previous class when the last one is skipped', () => {
    const p = plan(T(9, 30), live(5), { ov: { skipped: ['c2'] } });
    assert.equal(leg(p, 'class:c2').skipped, true);
    assert.ok(leg(p, 'back').start! >= T(10, 15) - 75_000);
    assert.equal(leg(p, 'back').walkMin, 8);
  });

  it('replans from the moment of leaving campus early', () => {
    const p = plan(T(9, 40), live(14), { ov: { skipped: ['c1', 'c2'], leftAt: T(9, 40), leftPlaceId: 'a' } });
    assert.ok(!ids(p).includes('out'));
    // Bus reaches Gammage 10:14; with an 8 min walk and 2 spare, leave by 10:04.
    assert.equal(clock(leg(p, 'back').start), '10:04 AM');
  });

  it('is the class and the bus home once you are there', () => {
    const p = plan(T(14, 30, 3), live(35), { day: 3 });
    assert.deepEqual(ids(p), ['class:c3', 'back']);
  });
});

describe('time on campus that is not a class', () => {
  // Friday: no classes, but at the library from 10:00 to 1:00.
  const visit = { id: 'v1', course: 'Library', placeId: 'b', startMin: 10 * 60, endMin: 13 * 60, days: [5], kind: 'visit' as const };
  const withVisit = (now: number, bus: LiveBus, block = visit) =>
    planDay({ now, schedule: { ...schedule, classes: [...schedule.classes, block] }, route, prefs: { walkMinutes: 5, bufferMinutes: 2 }, live: bus, timetable: null, progress: null });

  it('gets a bus there and a bus back, like a class', () => {
    // Friday 9:00. Bus reaches SoL 9:10, Gammage 9:30, 7 min walk: there 9:37 for 9:55.
    const p = withVisit(T(9, 0, 4), live(10));
    assert.deepEqual(ids(p), ['out', 'walk-in', 'class:v1', 'back']);
    assert.equal(leg(p, 'out').goal, 'Library');
    assert.equal(leg(p, 'class:v1').visit, true);
    assert.equal(leg(p, 'walk-in').note, 'There about 23 min early.');
    assert.deepEqual([clock(p.alertWindow!.from), clock(p.alertWindow!.until)], ['8:00 AM', '2:00 PM']);
  });

  it('needs no walk when it is at the stop itself', () => {
    const p = withVisit(T(9, 0, 4), live(10), { ...visit, course: '', placeId: 'gammage' });
    assert.deepEqual(ids(p), ['out', 'class:v1', 'back']);
    assert.equal(leg(p, 'class:v1').title, 'On campus');
    assert.equal(leg(p, 'out').goal, 'campus');
  });

  it('counts whatever ends last as the end of the day', () => {
    // Monday, staying on at Coor Hall until 4:00 after the two classes.
    const p = withVisit(T(8), live(10), { ...visit, days: [1], startMin: 12 * 60, endMin: 16 * 60 });
    assert.equal(clock(p.alertWindow!.until), '5:00 PM');
    assert.equal(leg(p, 'back').freeAt, T(16));
  });
});

describe('alert hours each person sets', () => {
  const prefs = { walkMinutes: 5, bufferMinutes: 2, alertsBeforeMin: 45, alertsAfterMin: 150 };

  it('moves the window', () => {
    const window = plan(T(8), live(10), { prefs }).alertWindow!;
    assert.deepEqual([clock(window.from), clock(window.until)], ['8:15 AM', '2:15 PM']);
  });

  it('keeps announcing buses home for as long as the window stays open', () => {
    assert.ok(plan(T(13, 30), live(20), { prefs }).homeWatch);
    assert.equal(plan(T(14, 20), live(20), { prefs }).homeWatch, null);
  });
});

describe('service limits', () => {
  const ends7pm = timetable({ lastSec: 19 * 3600 });

  it('sends you home on foot when class ends after the last bus', () => {
    // Thursday 2:50 PM, class over at 2:45, and the bus parks at 3:00.
    const p = plan(T(14, 50, 3), live(25), { day: 3, timetable: timetable({ weekday: 4, lastSec: 15 * 3600 }) });
    const back = leg(p, 'back');
    assert.equal(back.kind, 'walk');
    assert.equal(back.title, 'Walk home');
    assert.match(back.warn!, /bus finishes around 3:00 PM/);
  });

  it('marks the last bus home', () => {
    const p = plan(T(18, 5, 3), live(25), { day: 3, timetable: { ...ends7pm, weekday: 4 } });
    // Buses reach Gammage 6:15 and 6:50. 6:50 gets home 7:05; the one after would be past the end.
    assert.equal(leg(p, 'back').lastBus, undefined);
    const later = plan(T(18, 20, 3), live(10), { day: 3, timetable: { ...ends7pm, weekday: 4 } });
    assert.equal(clock(leg(later, 'back').bus!.at), '6:50 PM');
    assert.equal(leg(later, 'back').lastBus, true);
  });

  it('walks both ways on a day the bus does not run', () => {
    const p = plan(T(7), null, { timetable: timetable({ weekday: 1, runs: false }) });
    assert.deepEqual(ids(p), ['out', 'class:c1', 'class:c2', 'back']);
    assert.equal(leg(p, 'out').kind, 'walk');
    assert.match(leg(p, 'out').warn!, /No bus on Mondays/);
    assert.equal(leg(p, 'back').kind, 'walk');
    assert.match(p.service!, /No bus on Mondays/);
  });

  it('has nothing to plan on a day without classes', () => {
    assert.deepEqual(ids(plan(T(10, 0, 4), live(5), { day: 4 })), []);
  });

  it('trusts no time from a bus that is parked up or silent', () => {
    const parked: LiveBus = { ...live(10)!, parked: true };
    assert.equal(leg(plan(T(8), parked), 'out').bus, undefined);
    assert.equal(leg(plan(T(8), { ...live(10)!, status: 'stale' }), 'out').bus, undefined);
  });
});

describe('committing to a bus', () => {
  it('keeps the bus being caught once the moment to leave has passed', () => {
    const before = plan(T(8, 2), live(8));
    assert.equal(advanceProgress(null, before, T(8, 2)).committed.length, 0);

    // 8:03:30: half a minute past the moment to leave. The bus is still the 8:10.
    const now = T(8, 3) + 30_000;
    const at = plan(now, live(6.5));
    const step = advanceProgress(null, at, now);
    assert.deepEqual(step.committed.map((l) => l.id), ['out']);

    // Five minutes later the 8:10 can no longer be reached from home, but the plan doesn't jump.
    const walking = plan(T(8, 8), live(2), { progress: step.progress });
    assert.equal(leg(walking, 'out').committed, true);
    assert.equal(clock(leg(walking, 'out').bus!.at), '8:10 AM');
    assert.equal(advanceProgress(step.progress, walking, T(8, 8)).committed.length, 0);
  });

  it('drops the committed bus when asked to plan again', () => {
    const now = T(8, 3) + 30_000;
    const { progress } = advanceProgress(null, plan(now, live(6.5)), now);
    const again = plan(T(8, 6), live(4), { progress, ov: { replanAt: T(8, 6) } });
    assert.equal(leg(again, 'out').committed, undefined);
    assert.match(leg(again, 'out').warn!, /Late for CSE 205/);
  });

  it('forgets yesterday', () => {
    const stale = { date: '2026-11-08', boarded: { out: { at: 1, arrive: 2, since: 1 } } };
    assert.equal(leg(plan(T(8), live(10), { progress: stale }), 'out').committed, undefined);
  });

  it('writes the alert for the moment to leave', () => {
    const alert = leaveAlert(leg(plan(T(8, 3), live(7)), 'out'), route);
    assert.equal(alert.title, 'Leave home now for CSE 205');
    assert.match(alert.body, /Bus reaches SoL around 8:10 AM, Gammage by 8:30 AM\. 5 min walk to the stop\./);
  });

  it('nudges about the walking deadline once when there is no bus time', () => {
    const p = plan(T(12, 28, 1), null, { day: 1 });
    const alerts = walkAlerts(p, T(12, 28, 1), []);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0].body, /leave by 12:35 PM \(50 min\)/);
    assert.equal(walkAlerts(p, T(12, 28, 1), [`${p.date}:walk:out`]).length, 0);
    assert.equal(walkAlerts(p, T(11, 0, 1), []).length, 0);
  });
});

describe('planAnswer', () => {
  it('counts down to leaving, then says go', () => {
    const early = planAnswer(plan(T(8), live(10)), route, T(8))!;
    assert.deepEqual([early.lead, early.headline, early.tone], ['Leave in', '3 min', 'calm']);
    const go = planAnswer(plan(T(8, 3), live(7)), route, T(8, 3))!;
    assert.deepEqual([go.headline, go.tone], ['Leave now', 'go']);
  });

  it('says what follows the class you are in', () => {
    const a = planAnswer(plan(T(9, 30), live(5)), route, T(9, 30))!;
    assert.equal(a.lead, 'In CSE 205 until');
    assert.equal(a.headline, '10:15 AM');
    assert.match(a.detail, /Then PHY 121 at 10:30 AM/);
  });

  it('gives a not-before time when the bus is too far off to know', () => {
    const a = planAnswer(plan(T(8, 0, 1), live(10), { day: 1 }), route, T(8, 0, 1))!;
    assert.equal(a.lead, 'Bus to campus, not before');
    assert.match(a.detail, /To walk instead, leave by 12:35 PM/);
  });

  it('does not say "later" for a ride that is due while the bus is silent', () => {
    // Thursday 2:50 PM, class over at 2:45, no live bus.
    const a = planAnswer(plan(T(14, 50, 3), null, { day: 3 }), route, T(14, 50, 3))!;
    assert.equal(a.headline, 'No time yet');
    assert.match(a.detail, /No live bus time right now/);
  });

  it('is empty once the day is done', () => {
    assert.equal(planAnswer(plan(T(21, 0, 3), null, { day: 3 }), route, T(21, 0, 3)), null);
  });
});

describe('the ride home, class by class', () => {
  // live(n): the bus reaches SoL in n minutes and Gammage 20 minutes after that, on a 35 minute loop.
  const keys = (p: ReturnType<typeof planDay>, alerts: { id: string }[]) => alerts.map((a) => `${p.date}:${a.id}`);

  it('shows the first bus home after every class on its row', () => {
    const p = plan(T(10), live(10));
    const after = leg(p, 'class:c1').after!;
    assert.deepEqual([clock(after.leaveBy), clock(after.at), clock(after.home), after.walkMin], ['10:20 AM', '10:30 AM', '10:50 AM', 8]);
  });

  it('starts from the first class 15 minutes before it ends, measured from its building', () => {
    assert.equal(plan(T(9, 59), live(11)).homeWatch, null);
    const p = plan(T(10), live(10));
    const watch = p.homeWatch!;
    assert.deepEqual([watch.course, watch.place, watch.walkMin, clock(watch.until)], ['CSE 205', 'Brickyard', 8, '10:30 AM']);
    const [alert] = busHomeAlerts(p, T(10), []);
    assert.equal(alert.title, 'After CSE 205: bus home 10:30 AM');
    assert.equal(alert.body, 'Leave Brickyard by 10:20 AM, 8 min walk. It reaches Gammage around 10:30 AM, home about 10:50 AM.');
    assert.deepEqual(busHomeAlerts(p, T(10), keys(p, [alert])), []);
  });

  it('says nothing for a bus you could not leave for before the next class', () => {
    // Bus reaches Gammage 10:49: leaving at 10:39 is after PHY 121 starts.
    const p = plan(T(10, 16), live(13));
    assert.equal(p.homeWatch!.next, null);
    assert.deepEqual(busHomeAlerts(p, T(10, 16), []), []);
  });

  it('goes quiet once the next class starts, then moves to that class and its building', () => {
    assert.equal(plan(T(10, 31), live(5)).homeWatch, null);
    assert.equal(plan(T(11, 29), live(5)).homeWatch, null);
    const watch = plan(T(11, 30), live(15)).homeWatch!;
    assert.deepEqual([watch.course, watch.place, watch.walkMin, watch.until], ['PHY 121', 'Coor Hall', 7, null]);
  });

  it('after the last class announces every bus until told otherwise', () => {
    // Nobody has said they left. Buses reach Gammage 11:55, 12:30, 1:05.
    const first = plan(T(11, 31), live(4));
    const a = busHomeAlerts(first, T(11, 31), []);
    assert.equal(a[0].title, 'After PHY 121: bus home 11:55 AM');
    let fired = keys(first, a);

    // 11:50: that bus can no longer be reached, and the 12:30 isn't close yet.
    const waiting = plan(T(11, 50), live(20));
    assert.equal(clock(waiting.homeWatch!.next!.at), '12:30 PM');
    assert.deepEqual(busHomeAlerts(waiting, T(11, 50), fired), []);

    // 12:12: ten minutes before the moment to leave for the 12:30.
    const second = plan(T(12, 12), live(33));
    const b = busHomeAlerts(second, T(12, 12), fired);
    assert.equal(b[0].title, 'After PHY 121: bus home 12:30 PM');
    fired = [...fired, ...keys(second, b)];
    assert.deepEqual(busHomeAlerts(plan(T(12, 14), live(31)), T(12, 14), fired), []);

    // Still measured from Coor Hall, an hour on.
    assert.equal(plan(T(12, 44), live(1)).homeWatch!.walkMin, 7);

    // 12:47: more than an hour after class. The 1:05 bus is not announced.
    const late = plan(T(12, 47), live(33));
    assert.equal(late.homeWatch, null);
    assert.deepEqual(busHomeAlerts(late, T(12, 47), fired), []);
  });

  it('never takes the ride home as caught on its own', () => {
    const p = plan(T(11, 47), live(23));
    assert.ok(leg(p, 'back').start! <= T(11, 47));
    assert.deepEqual(advanceProgress(null, p, T(11, 47)).committed, []);
  });

  it('stops when you say you are on the bus', () => {
    const p = plan(T(12, 0), live(20), { ov: { onBusAt: T(11, 56) } });
    assert.equal(p.homeWatch, null);
    assert.deepEqual(ids(p), ['class:c1', 'class:c2']);
    assert.deepEqual(busHomeAlerts(p, T(12, 0), []), []);
  });

  it('stops when you say you are home', () => {
    const p = plan(T(12, 30), live(20), { ov: { homeAt: T(12, 30) } });
    assert.equal(p.homeWatch, null);
    assert.deepEqual(ids(p), ['class:c1', 'class:c2']);
  });

  it('gives up by itself an hour after the last class', () => {
    assert.ok(plan(T(12, 40), live(20)).homeWatch);
    assert.equal(plan(T(12, 50), live(20)).homeWatch, null);
  });
});

describe('getting out early and heading home', () => {
  it('ends a class when it actually let out, and watches the ride home from then', () => {
    // PHY 121 lets out at 11:20 instead of 11:45. Bus reaches Gammage 11:35.
    const now = T(11, 21);
    const p = plan(now, live(29), { ov: { outEarly: { c2: T(11, 20) } } });
    assert.equal(clock(leg(p, 'class:c2').end), '11:20 AM');
    assert.equal(p.homeWatch!.freeAt, T(11, 20));
    assert.equal(busHomeAlerts(p, now, [])[0].title, 'After PHY 121: bus home 11:35 AM');
  });

  it('ignores an early finish that is not inside the class', () => {
    const p = plan(T(9, 30), live(5), { ov: { outEarly: { c1: T(8, 0) } } });
    assert.equal(clock(leg(p, 'class:c1').end), '10:15 AM');
  });

  it('goes home after the current class when the later ones are dropped', () => {
    // In CSE 205, deciding to go home after it: PHY 121 is skipped, so CSE 205 is now the last class.
    const p = plan(T(10, 5), live(5), { ov: { skipped: ['c2'] } });
    assert.equal(leg(p, 'back').freeAt, T(10, 15));
    assert.deepEqual([p.homeWatch!.course, p.homeWatch!.until], ['CSE 205', null]);
  });

  it('watches from where you left when leaving campus by hand', () => {
    const p = plan(T(9, 40), live(14), { ov: { skipped: ['c1', 'c2'], leftAt: T(9, 40), leftPlaceId: 'a' } });
    assert.deepEqual([p.homeWatch!.course, p.homeWatch!.place, p.homeWatch!.walkMin], [null, 'Brickyard', 8]);
    assert.match(busHomeAlerts(p, T(9, 55), [])[0].title, /^From campus: bus home 10:14 AM/);
  });
});

describe('before class', () => {
  it('gives a heads-up some minutes before it is time to leave home', () => {
    // 7:45. Bus reaches SoL 8:10, so leave at 8:03: 18 minutes away.
    const p = plan(T(7, 45), live(25));
    const [alert] = headsUpAlerts(p, route, T(7, 45), []);
    assert.equal(alert.title, 'Leave at 8:03 AM for CSE 205');
    assert.match(alert.body, /Bus reaches SoL around 8:10 AM, Gammage by 8:30 AM/);
    assert.equal(headsUpAlerts(p, route, T(7, 45), [`${p.date}:soon:out`]).length, 0);
  });

  it('leaves the last few minutes to the leave alert, and the far future alone', () => {
    assert.equal(headsUpAlerts(plan(T(8, 0), live(10)), route, T(8, 0), []).length, 0);
    assert.equal(headsUpAlerts(plan(T(8, 0, 1), live(10), { day: 1 }), route, T(8, 0, 1), []).length, 0);
  });

  it('says how early the bus gets you to the room', () => {
    assert.equal(leg(plan(T(8), live(10)), 'walk-in').note, 'In the room about 22 min before CSE 205.');
  });
});

describe('alerts only around time on campus', () => {
  // Monday: classes 9:00 to 11:45, so alerts run 7:00 AM to 12:45 PM.
  const all = [{ kind: 'plan' }, { kind: 'first-bus' }, { kind: 'not-running' }, { kind: 'arrived' }, { kind: 'leave' }];
  const kinds = (now: number, byHand = false, more: Parameters<typeof plan>[2] = {}) => withinAlertWindow(all, plan(now, live(10), more), now, byHand).map((e) => e.kind);

  it('runs from two hours before the first class to an hour after the last', () => {
    const window = plan(T(8), live(10)).alertWindow!;
    assert.deepEqual([clock(window.from), clock(window.until)], ['7:00 AM', '12:45 PM']);
    assert.equal(kinds(T(7, 0)).length, 5);
    assert.equal(kinds(T(10, 0)).length, 5);
    assert.equal(kinds(T(12, 45)).length, 5);
  });

  it('is silent before and after, including the first bus of the morning', () => {
    assert.deepEqual(kinds(T(6, 59)), []);
    assert.deepEqual(kinds(T(12, 46)), []);
    assert.deepEqual(kinds(T(17, 0)), []);
  });

  it('follows the classes actually being taken', () => {
    // Skipping the first class moves the start to two hours before the second.
    assert.deepEqual(kinds(T(7, 30), false, { ov: { skipped: ['c1'] } }), []);
    assert.equal(kinds(T(8, 30), false, { ov: { skipped: ['c1'] } }).length, 5);
    // A class that let out early ends the window an hour after it really ended.
    assert.deepEqual(kinds(T(12, 30), false, { ov: { outEarly: { c2: T(11, 20) } } }), []);
  });

  it('is silent all day when there are no classes, or all of them are skipped', () => {
    assert.equal(plan(T(10, 0, 4), live(10), { day: 4 }).alertWindow, null);
    assert.deepEqual(kinds(T(10, 0, 4), false, { day: 4 }), []);
    assert.deepEqual(kinds(T(10), false, { ov: { skipped: ['c1', 'c2'] } }), []);
  });

  it('still lets a watch started by hand through, for that bus only', () => {
    assert.deepEqual(kinds(T(17, 0), true), ['arrived', 'leave']);
  });

  it('changes nothing when no classes are set up at all', () => {
    assert.equal(withinAlertWindow(all, null, T(3), false).length, 5);
  });
});

describe('a one-off trip planned for today', () => {
  // Friday: no classes. live(10) at 9:00 means buses reach SoL 9:10 and 9:45, Gammage 9:30 and 10:05.
  // The later bus is a loop further off, so it carries 5 minutes of doubt instead of 2.
  const trip = (kind: 'arrive' | 'leave-home' | 'leave-campus', at: number) => ({ day: 4, ov: { trips: [{ id: 't1', kind, at }] } });

  it('picks the latest bus that still gets you to campus by the time asked', () => {
    const p = plan(T(9, 0, 4), live(10), trip('arrive', T(10, 0, 4)));
    assert.deepEqual(ids(p), ['trip:t1']);
    const ride = leg(p, 'trip:t1');
    assert.deepEqual([clock(ride.start), clock(ride.bus!.at), clock(ride.bus!.arrive), ride.warn], ['9:03 AM', '9:10 AM', '9:30 AM', undefined]);
    assert.equal(ride.tripLabel, 'You asked to get to campus between 9:45 to 10:00 AM.');
    // Alerts open around the trip even though there are no classes today.
    assert.deepEqual([clock(p.alertWindow!.from), clock(p.alertWindow!.until)], ['8:00 AM', '11:00 AM']);
  });

  it('says so when no bus can get you there by then', () => {
    const ride = leg(plan(T(9, 0, 4), live(10), trip('arrive', T(9, 20, 4))), 'trip:t1');
    assert.equal(clock(ride.bus!.arrive), '9:30 AM');
    assert.equal(ride.warn, 'Late for campus: there around 9:30 AM.');
  });

  it('takes the first bus after a time to leave SoL, with no promise about arriving', () => {
    const ride = leg(plan(T(9, 0, 4), live(10), trip('leave-home', T(9, 30, 4))), 'trip:t1');
    assert.deepEqual([clock(ride.start), clock(ride.bus!.at), ride.bus!.stopId, ride.warn], ['9:35 AM', '9:45 AM', 'sol', undefined]);
  });

  it('takes the first bus home after a time to leave campus, allowing a walk to the stop', () => {
    const ride = leg(plan(T(9, 0, 4), live(10), trip('leave-campus', T(9, 40, 4))), 'trip:t1');
    assert.deepEqual([clock(ride.start), clock(ride.bus!.at), ride.bus!.stopId, ride.walkMin], ['9:50 AM', '10:05 AM', 'gammage', 10]);
  });

  it('sits in the day in the order things happen, alongside classes', () => {
    // Monday, classes 9:00 to 11:45, and a trip back to campus for 4:00 PM.
    const p = plan(T(8), live(10), { ov: { trips: [{ id: 't1', kind: 'arrive', at: T(16) }] } });
    assert.deepEqual(ids(p), ['out', 'walk-in', 'class:c1', 'class:c2', 'back', 'trip:t1']);
    assert.equal(clock(p.alertWindow!.until), '5:00 PM');
  });

  it('is committed to and alerted like any other ride', () => {
    const now = T(9, 3, 4) + 30_000;
    const p = plan(now, live(6.5), trip('arrive', T(10, 0, 4)));
    const step = advanceProgress(null, p, now);
    assert.deepEqual(step.committed.map((l) => l.id), ['trip:t1']);
    assert.equal(leaveAlert(step.committed[0], route).title, 'Leave home now for campus');
  });

  it('ignores a trip that belongs to another day', () => {
    assert.deepEqual(ids(plan(T(9, 0, 4), live(10), trip('arrive', T(10, 0, 3)))), []);
  });
});
