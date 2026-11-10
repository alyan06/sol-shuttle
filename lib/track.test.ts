import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { etaToStop, locate } from './track.ts';
import type { Ping, Route, Stop } from './types.ts';

// Out along a street heading east and back along the same street heading west.
const LAT = 33.4147;
const EAST = -111.92;
const WEST = -111.93;
const HALF = 926; // metres between WEST and EAST at this latitude
const stopA: Stop = { id: 'a', name: 'A', lat: LAT, lng: WEST, s: 0, t: 0, dwellSeconds: 60 };
const stopB: Stop = { id: 'b', name: 'B', lat: LAT, lng: EAST, s: HALF, t: 300, dwellSeconds: 60 };
const route: Route = {
  generatedAt: null,
  loopsObserved: 2,
  loopSeconds: 600,
  path: [
    { lat: LAT, lng: WEST, s: 0, t: 0 },
    { lat: LAT, lng: EAST, s: HALF, t: 300 },
    { lat: LAT, lng: WEST, s: HALF * 2, t: 600 },
  ],
  stops: [stopA, stopB],
};

function ping(lng: number, heading: number, mph = 25): Ping {
  return { time: 0, lat: LAT, lng, heading, mph, address: '' };
}

const MIDDLE = (EAST + WEST) / 2;

describe('locate', () => {
  it('uses heading to pick the correct side of a two-way street', () => {
    assert.ok(Math.abs(locate(route, ping(MIDDLE, 90), null)!.s - HALF / 2) < 10);
    assert.ok(Math.abs(locate(route, ping(MIDDLE, 270), null)!.s - HALF * 1.5) < 10);
  });

  it('uses the last position when stopped, since heading means nothing then', () => {
    const stopped = ping(MIDDLE, 0, 0);
    assert.ok(Math.abs(locate(route, stopped, HALF * 1.45)!.s - HALF * 1.5) < 10);
    assert.ok(Math.abs(locate(route, stopped, HALF * 0.45)!.s - HALF / 2) < 10);
  });

  it('returns null when the bus is off the known route', () => {
    assert.equal(locate(route, { ...ping(MIDDLE, 90), lat: LAT + 0.01 }, null), null);
  });

  it('returns null before a route has been learned', () => {
    assert.equal(locate({ ...route, path: [] }, ping(MIDDLE, 90), null), null);
  });
});

describe('etaToStop', () => {
  it('counts forward around the loop, not straight-line', () => {
    const located = locate(route, ping(MIDDLE, 90), null)!;
    assert.ok(Math.abs(etaToStop(route, located, stopB).seconds - 150) < 5);
    assert.ok(Math.abs(etaToStop(route, located, stopA).seconds - 450) < 5);
  });

  it('wraps past the end of the loop', () => {
    const located = locate(route, ping(MIDDLE, 270), null)!;
    assert.ok(Math.abs(etaToStop(route, located, stopA).seconds - 150) < 5);
    assert.ok(Math.abs(etaToStop(route, located, stopB).seconds - 450) < 5);
  });

  it('reports at-stop with zero wait', () => {
    const eta = etaToStop(route, { s: HALF + 20, t: 306, offsetM: 2 }, stopB);
    assert.deepEqual(eta, { stopId: 'b', seconds: 0, atStop: true });
  });

  it('keeps a bus waiting further on at the stop, then counts the next loop once past', () => {
    const holding: Stop = { ...stopB, holdM: 130 };
    assert.equal(etaToStop(route, { s: HALF + 120, t: 340, offsetM: 2 }, holding).atStop, true);
    const gone = etaToStop(route, { s: HALF + 140, t: 345, offsetM: 2 }, holding);
    assert.equal(gone.atStop, false);
    assert.ok(gone.seconds > 500);
  });

  it('does not stretch the approach to a stop that holds', () => {
    const holding: Stop = { ...stopB, holdM: 130 };
    assert.equal(etaToStop(route, { s: HALF - 120, t: 260, offsetM: 2 }, holding).atStop, false);
  });
});
