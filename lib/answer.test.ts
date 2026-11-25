import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultPrefs } from './alerts.ts';
import { answerFor } from './answer.ts';
import type { Route } from './types.ts';

const NOW = Date.UTC(2026, 10, 6, 17, 0);
const route: Route = {
  generatedAt: null,
  loopsObserved: 3,
  loopSeconds: 1800,
  path: [{ lat: 0, lng: 0, s: 0, t: 0 }, { lat: 0, lng: 1, s: 10, t: 10 }],
  stops: [{ id: 'home', name: 'SoL', lat: 0, lng: 0, s: 0, t: 0, dwellSeconds: 60 }],
};
const prefs = { ...defaultPrefs, stopId: 'home', walkMinutes: 5 };

function ask(seconds: number | null, extra: Partial<Parameters<typeof answerFor>[0]> = {}) {
  return answerFor({
    route,
    prefs,
    status: 'live',
    eta: seconds === null ? null : { stopId: 'home', seconds, atStop: false },
    now: NOW,
    lastSeenAt: NOW,
    parkedSince: null,
    onRoute: true,
    ...extra,
  });
}

describe('answerFor', () => {
  it('subtracts the walk and the spare minutes from the bus time', () => {
    const a = ask(540);
    assert.equal(a.headline, '2 min');
    assert.equal(a.tone, 'calm');
    assert.match(a.detail, /10:09/);
  });

  it('says leave now at the same moment the alert fires', () => {
    assert.equal(ask(420).headline, 'Leave now');
    assert.equal(ask(420).tone, 'go');
  });

  it('points at the next loop rather than a bus you cannot reach', () => {
    const a = ask(120);
    assert.equal(a.lead, 'For the next bus, leave in');
    assert.equal(a.headline, '25 min');
    assert.match(a.detail, /miss/);
  });

  it('counts the wait at the stop when the bus is closer than the walk', () => {
    assert.equal(ask(260).headline, 'Leave now');
  });

  it('stops saying the bus is here once it has been parked a long time', () => {
    const at = { eta: { stopId: 'home', seconds: 0, atStop: true } };
    assert.equal(ask(0, { ...at, parkedSince: NOW - 9 * 60_000 }).headline, 'Bus is here');
    // Parked 10 minutes or more in the middle of the day is probably the driver's break.
    const a = ask(0, { ...at, parkedSince: NOW - 41 * 60_000 });
    assert.equal(a.headline, 'On a break');
    assert.match(a.detail, /Parked since 9:19 AM\. Times come back when it moves\./);
    const b = ask(0, { ...at, parkedSince: NOW - 25 * 60_000, breakPlace: 'just east of SoL', breakUntil: NOW + 15 * 60_000 });
    assert.equal(b.detail, 'Parked just east of SoL since 9:35 AM. On Fridays it usually starts again around 10:15 AM.');
  });

  it('names the day when the bus parked before today', () => {
    const at = { eta: { stopId: 'home', seconds: 0, atStop: true } };
    assert.match(ask(0, { ...at, parkedSince: NOW - 20 * 3_600_000 }).detail, /Parked since (Sun|Mon|Tue|Wed|Thu|Fri|Sat) /);
  });

  it('says the bus is here', () => {
    const a = ask(0, { eta: { stopId: 'home', seconds: 0, atStop: true } });
    assert.equal(a.headline, 'Bus is here');
    assert.equal(a.tone, 'here');
  });

  it('never shows a time from old data', () => {
    const a = ask(540, { status: 'stale', lastSeenAt: NOW - 300_000 });
    assert.equal(a.headline, 'No signal');
    assert.doesNotMatch(a.headline + a.detail, /Leave/);
    assert.match(a.detail, /5 min ago/);
  });

  it('never shows a time when the bus is off its loop', () => {
    assert.equal(ask(null, { onRoute: false }).headline, 'Off route');
    // On a detour there's still a time, flagged as rough.
    const rough = ask(600, { onRoute: false, eta: { stopId: 'home', seconds: 600, atStop: false, rough: true } });
    assert.equal(rough.headline, '3 min');
    assert.match(rough.detail, /roughly .* different route, so this is a rough time/);
  });

  it('asks for a stop, and explains while the route is being learned', () => {
    assert.equal(ask(540, { prefs: { ...prefs, stopId: null } }).headline, 'Pick your stop');
    assert.equal(ask(null, { route: { ...route, path: [] } }).headline, 'Learning route');
  });

  it('reports no service plainly', () => {
    const a = ask(null, { status: 'offline', lastSeenAt: NOW - 8 * 3_600_000 });
    assert.equal(a.headline, 'Not running');
    assert.match(a.detail, /2:00/);
  });
});

describe('the last pickups (6:30 PM at SoL, from the driver)', () => {
  const sol: Route = { ...route, stops: [{ ...route.stops[0], id: 'sol' }] };
  // November 6, 2026 in Tempe (UTC-7).
  const at = (hour: number, minute: number) => Date.UTC(2026, 10, 6, hour + 7, minute);
  const askSol = (now: number, seconds: number, atStop = false) =>
    answerFor({ route: sol, prefs: { ...prefs, stopId: 'sol' }, status: 'live', eta: { stopId: 'sol', seconds, atStop }, now, lastSeenAt: now, parkedSince: null, onRoute: true });

  it('never sends anyone for a bus after the last pickup', () => {
    // 6:50 PM, the bus back at SoL around 7:03: it's going to park, not picking up.
    const a = askSol(at(18, 50), 13 * 60);
    assert.deepEqual([a.headline, a.detail], ['No more pickups', 'The last pickup at SoL is 6:30 PM, so there are no more buses from here today.']);
    assert.equal(askSol(at(18, 50), 0, true).headline, 'No more pickups');
  });

  it('says when the bus coming is the last one', () => {
    // 6:10 PM, the bus at SoL around 6:25; one loop later would be 6:55.
    const a = askSol(at(18, 10), 15 * 60);
    assert.equal(a.tone, 'calm');
    assert.match(a.detail, /It's the last pickup here today \(6:30 PM\)/);
    assert.match(askSol(at(18, 25), 0, true).detail, /This is the last pickup here today/);
  });

  it('says it is too late rather than pointing at a next bus that will not come', () => {
    const a = askSol(at(18, 25), 60);
    assert.equal(a.headline, 'Too late');
    assert.match(a.detail, /last pickup here is 6:30 PM/);
  });

  it('leaves earlier buses alone', () => {
    assert.doesNotMatch(askSol(at(17, 0), 15 * 60).detail, /last pickup/);
    assert.match(askSol(at(17, 0), 60).lead, /For the next bus/);
  });
});
