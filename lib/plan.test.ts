import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { advanceProgress, afterClassAlerts, headsUpAlerts, leaveAlert, planAnswer, planDay, saidAfterClass, walkAlerts, type LiveBus, type PlanInput } from './plan.ts';
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
  patterns: [
    {
      id: 'mw',
      name: 'MW',
      days: [1, 3],
      classes: [
        { id: 'c1', course: 'CSE 205', placeId: 'a', room: '210', startMin: 9 * 60, endMin: 10 * 60 + 15 },
        { id: 'c2', course: 'MAT 267', placeId: 'b', startMin: 10 * 60 + 30, endMin: 11 * 60 + 45 },
      ],
    },
    { id: 'tth', name: 'TTh', days: [2, 4], classes: [{ id: 'c3', course: 'ENG 102', placeId: 'b', startMin: 13 * 60 + 30, endMin: 14 * 60 + 45 }] },
  ],
  gym: { days: [1, 2, 3, 5, 6], workoutMin: 75, afterClass: 'gym', evening: 'walk', eveningLeaveMin: 17 * 60 },
  walkOverrides: {
    'a|gammage': 8,
    'b|gammage': 7,
    'a|b': 6,
    'a|gym': 12,
    'b|gym': 10,
    'gammage|gym': 9,
    'gym|sol': 45,
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
const timetable = (over: Partial<Timetable>): Timetable => ({ weekday: 1, daysSeen: 3, runs: true, firstSec: null, lastSec: null, lastSure: true, arrivals: {}, ...over });

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

  it('never plans the evening gym trip before you could be home', () => {
    // No bus time for the ride home yet, so home is "not before" class end plus the trip.
    const late = { ...schedule, gym: { ...schedule.gym, eveningLeaveMin: 11 * 60 } };
    const p = planDay({ now: T(8), schedule: { ...late, override: { date: DATES[0], skipped: [], afterClass: 'home' } }, route, prefs: { walkMinutes: 5, bufferMinutes: 2 }, live: null, timetable: null, progress: null });
    // Class ends 11:45, 7 min to Gammage, 15 min ride, 5 min walk home.
    assert.equal(clock(leg(p, 'walk-out').start), '12:12 PM');
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
    const ended = { ...schedule, patterns: schedule.patterns.map((p) => ({ ...p, until: '2026-11-08' })) };
    const p = planDay({ now: T(8), schedule: ended, route, prefs: { walkMinutes: 5, bufferMinutes: 2 }, live: live(10), timetable: null, progress: null });
    assert.equal(p.classCount, 0);
    // Still a gym day, so the evening trip remains.
    assert.deepEqual(ids(p), ['walk-out', 'gym', 'walk-back']);
    const lastDay = { ...schedule, patterns: schedule.patterns.map((p) => ({ ...p, until: '2026-11-09' })) };
    assert.equal(planDay({ now: T(8), schedule: lastDay, route, prefs: { walkMinutes: 5, bufferMinutes: 2 }, live: live(10), timetable: null, progress: null }).classCount, 2);
  });

  it('warns when two classes are further apart than the gap between them', () => {
    const tight = { ...schedule, walkOverrides: { ...schedule.walkOverrides, 'a|b': 20 } };
    const p = planDay({ now: T(8), schedule: tight, route, prefs: { walkMinutes: 5, bufferMinutes: 2 }, live: live(10), timetable: null, progress: null });
    assert.match(leg(p, 'class:c2').warn!, /20 min walk from Brickyard, 15 min gap/);
  });
});

describe('after class', () => {
  it('goes to the gym, then the first bus reachable after the workout', () => {
    // Class ends 11:45, 10 min to the gym, 75 min workout: done 1:10 PM, at Gammage by 1:19.
    const p = plan(T(11, 50), live(25));
    assert.deepEqual(ids(p).slice(-3), ['walk-gym', 'gym', 'back']);
    assert.equal(clock(leg(p, 'gym').end), '1:10 PM');
    const back = leg(p, 'back');
    assert.ok(back.start! >= T(13, 10));
    assert.equal(back.bus!.stopId, 'gammage');
    assert.equal(back.walkMin, 9);
  });

  it('heads straight home when that is the choice', () => {
    // Bus reaches Gammage 11:55. Leave Coor Hall at 11:46 for a 7 min walk and 2 spare.
    const p = plan(T(11, 40), live(30), { ov: { afterClass: 'home' } });
    const back = leg(p, 'back');
    assert.equal(clock(back.bus!.at), '11:55 AM');
    assert.equal(clock(back.start), '11:46 AM');
    assert.equal(clock(back.end), '12:15 PM');
    assert.ok(!ids(p).includes('walk-gym'));
  });

  it('adds the evening gym trip after going home on a gym day', () => {
    const p = plan(T(11, 40), live(35), { ov: { afterClass: 'home' } });
    assert.deepEqual(ids(p).slice(-3), ['walk-out', 'gym', 'walk-back']);
    assert.equal(clock(leg(p, 'walk-out').start), '5:00 PM');
    assert.equal(leg(p, 'walk-out').walkMin, 45);
    assert.equal(p.eveningApplies, true);
  });

  it('plans from the previous class when the last one is skipped', () => {
    const p = plan(T(9, 30), live(5), { ov: { skipped: ['c2'], afterClass: 'home' } });
    assert.equal(leg(p, 'class:c2').skipped, true);
    assert.ok(leg(p, 'back').start! >= T(10, 15) - 75_000);
    assert.equal(leg(p, 'back').walkMin, 8);
  });

  it('replans from the moment of leaving campus early', () => {
    const p = plan(T(9, 40), live(14), { ov: { skipped: ['c1', 'c2'], leftAt: T(9, 40), leftPlaceId: 'a', afterClass: 'home' } });
    assert.ok(!ids(p).includes('out'));
    // Bus reaches Gammage 10:14; with an 8 min walk and 2 spare, leave by 10:04.
    assert.equal(clock(leg(p, 'back').start), '10:04 AM');
  });

  it('is just the bus home on a rest day', () => {
    const p = plan(T(14, 30, 3), live(35), { day: 3 });
    assert.equal(p.gymDay, false);
    assert.equal(p.afterClass, 'home');
    assert.deepEqual(ids(p), ['class:c3', 'back']);
  });

  it('finishes the workout when told to', () => {
    const p = plan(T(12, 40), live(25), { ov: { gymDoneAt: T(12, 40) } });
    assert.equal(clock(leg(p, 'gym').end), '12:40 PM');
    assert.ok(leg(p, 'back').start! < T(13, 10));
  });
});

describe('service limits', () => {
  const ends7pm = timetable({ lastSec: 19 * 3600 });

  it('sends you home on foot when the workout ends after the last bus', () => {
    const p = plan(T(17, 30, 4), live(5), { day: 4, ov: { evening: 'bus', eveningLeaveMin: 17 * 60 + 30 }, timetable: { ...ends7pm, weekday: 5 } });
    assert.equal(leg(p, 'out2').kind, 'bus');
    const back = leg(p, 'back2');
    assert.equal(back.kind, 'walk');
    assert.equal(back.title, 'Walk home');
    assert.match(back.warn!, /bus finishes around 7:00 PM/);
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
    const p = plan(T(16, 0, 5), null, { day: 5, ov: { evening: 'bus' }, timetable: timetable({ weekday: 6, runs: false }) });
    assert.deepEqual(ids(p), ['out2', 'gym', 'back2']);
    assert.equal(leg(p, 'out2').kind, 'walk');
    assert.match(leg(p, 'out2').warn!, /No bus on Saturdays/);
    assert.equal(leg(p, 'back2').kind, 'walk');
    assert.match(p.service!, /No bus on Saturdays/);
  });

  it('has nothing to plan when the gym is skipped on a day without classes', () => {
    assert.deepEqual(ids(plan(T(10, 0, 4), live(5), { day: 4, ov: { evening: 'skip' } })), []);
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
    assert.match(a.detail, /Then MAT 267 at 10:30 AM/);
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

describe('the bus home after each class', () => {
  // live(n): the bus reaches SoL in n minutes and Gammage 20 minutes after that, on a 35 minute loop.
  it('works out the first bus home you could catch after every class, not just the last', () => {
    // 10:00. Bus reaches Gammage 10:30. CSE 205 ends 10:15, 8 min walk, 2 spare: leave by 10:20.
    const p = plan(T(10), live(10));
    const after = leg(p, 'class:c1').after!;
    assert.deepEqual([clock(after.leaveBy), clock(after.at), clock(after.home), after.walkMin], ['10:20 AM', '10:30 AM', '10:50 AM', 8]);
    // MAT 267 ends 11:45, 7 min walk: the 11:40 bus is too early, so it's the one after.
    assert.equal(clock(leg(p, 'class:c2').after!.at), '12:15 PM');
  });

  it('nudges when a class lets out and a bus can be caught soon', () => {
    const now = T(10, 15) + 30_000;
    const p = plan(now, live(29.5));
    const [alert] = afterClassAlerts(p, now, []);
    assert.equal(alert.title, 'CSE 205 is over. Bus home 10:30 AM');
    assert.equal(alert.body, 'Leave by 10:20 AM to catch it: 8 min walk. The bus reaches Gammage around 10:30 AM, home about 10:50 AM.');
    assert.equal(afterClassAlerts(p, now, [`${p.date}:after:c1`]).length, 0);
  });

  it('stays quiet when the bus has just gone or is a long wait away', () => {
    // Bus reaches Gammage 10:49: you would not set off for another 24 minutes.
    const now = T(10, 15) + 30_000;
    assert.deepEqual(afterClassAlerts(plan(now, live(14)), now, []), []);
    assert.deepEqual(afterClassAlerts(plan(now, null), now, []), []);
  });

  it('says nothing before the class ends or long after', () => {
    assert.deepEqual(afterClassAlerts(plan(T(10, 10), live(0)), T(10, 10), []), []);
    assert.deepEqual(afterClassAlerts(plan(T(10, 20), live(25)), T(10, 20), []), []);
  });

  it('skips a class marked skipped', () => {
    const now = T(10, 15) + 30_000;
    assert.deepEqual(afterClassAlerts(plan(now, live(29.5), { ov: { skipped: ['c1'] } }), now, []), []);
  });

  it('does not repeat itself as a leave alert a minute later', () => {
    // MAT 267 ends 11:45. Bus reaches Gammage 11:55, so the moment to leave is 11:46.
    const now = T(11, 45) + 30_000;
    const p = plan(now, live(24.5), { ov: { afterClass: 'home' } });
    const fired = afterClassAlerts(p, now, []).map((a) => `${p.date}:${a.id}`);
    assert.deepEqual(fired, [`${p.date}:after:c2`]);
    assert.equal(saidAfterClass(p, leg(p, 'back'), fired), true);
    assert.equal(saidAfterClass(p, leg(p, 'back'), []), false);
  });
});

describe('getting out early and heading home', () => {
  it('ends a class when it actually let out', () => {
    // MAT 267 lets out at 11:20 instead of 11:45. Bus reaches Gammage 11:35.
    const now = T(11, 21);
    const p = plan(now, live(29), { ov: { outEarly: { c2: T(11, 20) }, afterClass: 'home' } });
    assert.equal(clock(leg(p, 'class:c2').end), '11:20 AM');
    assert.equal(leg(p, 'back').freeAt, T(11, 20));
    assert.equal(clock(leg(p, 'back').bus!.at), '11:35 AM');
    // And the nudge fires for the early finish.
    assert.equal(afterClassAlerts(p, now, []).length, 1);
  });

  it('ignores an early finish that is not inside the class', () => {
    const p = plan(T(9, 30), live(5), { ov: { outEarly: { c1: T(8, 0) } } });
    assert.equal(clock(leg(p, 'class:c1').end), '10:15 AM');
  });

  it('goes home after the current class when the later ones are dropped', () => {
    // In CSE 205, deciding to go home after it: MAT 267 is skipped, the ride home starts from 10:15.
    const p = plan(T(9, 40), live(30), { ov: { skipped: ['c2'], afterClass: 'home' } });
    assert.equal(leg(p, 'back').freeAt, T(10, 15));
    // The 9:55 bus is before class ends. The next reaches Gammage about 10:30, a loop ahead, so it
    // carries more doubt: be there by 10:25, which means leaving Brickyard at 10:17.
    assert.equal(clock(leg(p, 'back').start), '10:17 AM');
  });
});

describe('walk to the bus from where you are', () => {
  const at1150 = T(11, 50);
  const home = (here: { walkMin: number; at: number }) => leg(plan(at1150, live(30), { ov: { afterClass: 'home', here } }), 'back');

  it('uses the phone-based walk once class is over', () => {
    const back = home({ walkMin: 3, at: at1150 - 60_000 });
    assert.equal(back.walkMin, 3);
    assert.equal(back.fromHere, true);
    // Bus reaches Gammage 12:05; 3 min walk and 2 spare: leave at 12:00, not 11:56.
    assert.equal(clock(back.start), '12:00 PM');
  });

  it('falls back to the classroom walk when the reading is old, far away, or class is still on', () => {
    assert.equal(home({ walkMin: 3, at: at1150 - 20 * 60_000 }).walkMin, 7);
    assert.equal(home({ walkMin: 40, at: at1150 - 60_000 }).walkMin, 7);
    const inClass = leg(plan(T(11, 30), live(30), { ov: { afterClass: 'home', here: { walkMin: 3, at: T(11, 29) } } }), 'back');
    assert.equal(inClass.walkMin, 7);
    assert.equal(inClass.fromHere, undefined);
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
    // Gammage 8:30, 8 min walk: in the room 8:38 for a 9:00 class.
    assert.equal(leg(plan(T(8), live(10)), 'walk-in').note, 'In the room about 22 min before CSE 205.');
  });
});
