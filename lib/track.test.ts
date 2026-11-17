import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { etaToStop, locate, roughEtas } from './track.ts';
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

describe('roughEtas', () => {
  // A rectangular loop like the real one: west along the north street, back east along the south street.
  // 1 km wide, 400 m tall, stops at the east end (home, loop start) and the west end.
  const N = 33.422;
  const S = N - 400 / 111_320;
  const E = -111.905;
  const W = E - 1000 / (111_320 * Math.cos((N * Math.PI) / 180));
  const corners = [
    { lat: N, lng: E, s: 0, t: 0 },
    { lat: N, lng: W, s: 1000, t: 160 },
    { lat: S, lng: W, s: 1400, t: 224 },
    { lat: S, lng: E, s: 2400, t: 384 },
    { lat: N, lng: E, s: 2800, t: 448 },
  ];
  const west: Stop = { id: 'west', name: 'West', lat: (N + S) / 2, lng: W, s: 1200, t: 192, dwellSeconds: 60 };
  const home: Stop = { id: 'home', name: 'Home', lat: N, lng: E, s: 2790, t: 446, dwellSeconds: 120 };
  const loop: Route = { generatedAt: null, loopsObserved: 3, loopSeconds: 448 + 180, path: corners, stops: [west, home] };
  // Usual pace: 2800 m in 628 s less 180 s of waiting = 6.25 m/s.
  const at = (lat: number, lng: number, heading: number, mph = 20): Ping => ({ time: 0, lat, lng, heading, mph, address: '' });
  const midLng = (E + W) / 2;
  const midLat = (N + S) / 2;

  it('times the next stop by road distance, a little faster than the usual pace, and the one after from the usual gap', () => {
    // Left the loop after the west stop and is cutting back along a street through the middle: 500 m west of home, 200 m south.
    const etas = roughEtas(loop, at(midLat, midLng, 90), 1300);
    const toHome = etas.find((e) => e.stopId === 'home')!;
    const toWest = etas.find((e) => e.stopId === 'west')!;
    assert.ok(Math.abs(toHome.seconds - 700 / (6.25 * 1.25)) < 2);
    assert.equal(toHome.rough, true);
    // West comes after home: home's time plus the usual time from home round to west.
    assert.ok(Math.abs(toWest.seconds - (toHome.seconds + (192 - 446 + 628))) < 2);
  });

  it('goes by where the bus left the loop, not by which stop is nearer', () => {
    // Same spot, but it left the loop before the west stop: west is next, though home is no further.
    const etas = roughEtas(loop, at(midLat, midLng, 270), 300);
    assert.ok(etas.find((e) => e.stopId === 'west')!.seconds < etas.find((e) => e.stopId === 'home')!.seconds);
  });

  it('with no memory of the loop, heads for the stop the bus is pointing at', () => {
    const east = roughEtas(loop, at(midLat, midLng, 90), null);
    assert.ok(east.find((e) => e.stopId === 'home')!.seconds < east.find((e) => e.stopId === 'west')!.seconds);
    const west2 = roughEtas(loop, at(midLat, midLng, 270), null);
    assert.ok(west2.find((e) => e.stopId === 'west')!.seconds < west2.find((e) => e.stopId === 'home')!.seconds);
  });

  it('says the bus is at the stop once it is right beside it', () => {
    const etas = roughEtas(loop, at(N + 0.0002, E, 0, 3), 2000);
    assert.deepEqual(etas.find((e) => e.stopId === 'home'), { stopId: 'home', seconds: 0, atStop: true, rough: true });
  });

  it('gives no time for a bus driving away from the stop it would be due at', () => {
    // Seen live: it left home the back way for a break, and was shown as arriving in under a minute.
    const east300 = E + 300 / (111_320 * Math.cos((N * Math.PI) / 180));
    assert.deepEqual(roughEtas(loop, at(N, east300, 90, 25), 2700), []);
    // Coming back the same way, or only crawling about near the stop, it still gets a time.
    assert.ok(Math.abs(roughEtas(loop, at(N, east300, 270, 25), 2700).find((e) => e.stopId === 'home')!.seconds - 300 / (6.25 * 1.25)) < 2);
    assert.equal(roughEtas(loop, at(N, east300, 90, 5), 2700).length, 2);
    // Further out, heading away for a block is just how the streets go.
    assert.equal(roughEtas(loop, at(midLat, E, 90, 25), 300).length, 2);
  });

  it('stopped with no memory of the loop, goes by the way it was last driving', () => {
    const east = roughEtas(loop, at(midLat, midLng, 0, 0), null, 90);
    assert.ok(east.find((e) => e.stopId === 'home')!.seconds < east.find((e) => e.stopId === 'west')!.seconds);
    const west2 = roughEtas(loop, at(midLat, midLng, 0, 0), null, 270);
    assert.ok(west2.find((e) => e.stopId === 'west')!.seconds < west2.find((e) => e.stopId === 'home')!.seconds);
  });

  it('gives no time for a bus that has left the area altogether', () => {
    assert.deepEqual(roughEtas(loop, at(N + 0.02, E, 0), 1300), []);
    assert.deepEqual(roughEtas(loop, at(N, E + 0.02, 90), 1300), []);
  });
});

describe('locate, stopped', () => {
  // A stopped bus reports heading 0 whatever way it faces.
  const stopped = (lng: number) => ping(lng, 0, 0);

  it('uses the way the bus was last driving to pick the side of the road', () => {
    assert.ok(Math.abs(locate(route, stopped(MIDDLE), null, 90)!.s - HALF / 2) < 5);
    assert.ok(Math.abs(locate(route, stopped(MIDDLE), null, 270)!.s - HALF * 1.5) < 5);
  });

  it('believes that over continuity, so a bus back from a detour is not sent round again', () => {
    // Seen live: left the loop early, came back along another street, and stopped at a light on the
    // return leg. Continuity alone put it on the outbound side, 20 minutes from a stop 2 minutes away.
    assert.ok(Math.abs(locate(route, stopped(MIDDLE), 100)!.s - HALF / 2) < 5);
    assert.ok(Math.abs(locate(route, stopped(MIDDLE), 100, 270)!.s - HALF * 1.5) < 5);
  });

  it('is off the route when only the wrong side of the road is in reach', () => {
    const oneWay: Route = { ...route, path: route.path.slice(0, 2) };
    assert.equal(locate(oneWay, stopped(MIDDLE), null, 270), null);
    assert.notEqual(locate(oneWay, stopped(MIDDLE), null, null), null);
  });

  it('does not mind which way it faces at a stop, where it turns and pulls in as it likes', () => {
    const nearB = EAST - 0.0002; // about 20 m short of stop B
    assert.ok(Math.abs(locate(route, stopped(nearB), HALF - 30, 270)!.s - (HALF - 18.5)) < 5);
  });
});

describe('a stop the bus sometimes waits short of', () => {
  it('counts the bus as there from the lead distance on', () => {
    // Seen live: in the late afternoon the bus waited 110 m before the usual spot and turned round from there.
    const early: Stop = { ...stopB, leadM: 150 };
    const short = locate(route, ping(EAST - 0.0012, 90, 0), null)!; // about 110 m before B
    assert.equal(etaToStop(route, short, stopB).atStop, false);
    assert.deepEqual(etaToStop(route, short, early), { stopId: 'b', seconds: 0, atStop: true });
    const further = locate(route, ping(EAST - 0.002, 90, 0), null)!; // about 185 m before
    assert.equal(etaToStop(route, further, early).atStop, false);
  });
});
