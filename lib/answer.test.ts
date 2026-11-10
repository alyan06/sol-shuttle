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
    assert.equal(ask(0, { ...at, parkedSince: NOW - 10 * 60_000 }).headline, 'Bus is here');
    const a = ask(0, { ...at, parkedSince: NOW - 41 * 60_000 });
    assert.equal(a.headline, 'Not running');
    assert.match(a.detail, /Parked since/);
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
