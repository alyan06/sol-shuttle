import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ageCorrection, buildSnapshot, courseAfter, feedStatus } from './snapshot.ts';
import type { Course, Ping, Route } from './types.ts';

const NOW = 1_000_000_000;
const ping = (ageSeconds: number, mph: number): Ping => ({ time: NOW - ageSeconds * 1000, lat: 33.42, lng: -111.9, heading: 0, mph, address: '' });

describe('feedStatus', () => {
  it('is offline with no ping at all', () => {
    assert.equal(feedStatus(null, NOW), 'offline');
  });

  it('goes stale quickly when a moving bus stops reporting', () => {
    assert.equal(feedStatus(ping(60, 25), NOW), 'live');
    assert.equal(feedStatus(ping(120, 25), NOW), 'stale');
  });

  it('stays live through the silence of a parked bus', () => {
    assert.equal(feedStatus(ping(270, 0), NOW), 'live');
  });

  it('gives up on a parked bus eventually', () => {
    assert.equal(feedStatus(ping(400, 0), NOW), 'stale');
  });
});

describe('ageCorrection', () => {
  it('takes the age of the position off the times for a moving bus', () => {
    assert.equal(ageCorrection(ping(15, 25), NOW), 15);
  });

  it('leaves a parked bus alone: it has not gone anywhere since it reported', () => {
    assert.equal(ageCorrection(ping(200, 0), NOW), 0);
  });

  it('stops growing once the position is too old to trust, and handles no position', () => {
    assert.equal(ageCorrection(ping(300, 25), NOW), 60);
    assert.equal(ageCorrection(null, NOW), 0);
  });
});

describe('which way the bus was driving', () => {
  const at = (time: number, lng: number, heading: number, mph: number): Ping => ({ time, lat: 33.4147, lng, heading, mph, address: '' });

  it('is the newest moving position, and is kept while the bus is stopped', () => {
    const feed = [at(1000, -111.925, 88, 20), at(2000, -111.9249, 91, 12), at(3000, -111.9249, 0, 0)];
    assert.deepEqual(courseAfter(feed, null), { heading: 91, at: 2000, lat: 33.4147, lng: -111.9249 });
    const kept: Course = { heading: 91, at: 2000, lat: 33.4147, lng: -111.9249 };
    assert.equal(courseAfter([at(4000, -111.9249, 0, 0)], kept), kept);
    // An older feed can't overwrite something newer already remembered.
    assert.equal(courseAfter([at(1000, -111.925, 88, 20)], kept), kept);
    assert.equal(courseAfter([], null), null);
  });

  // Out east along a street and back west along the same one.
  const WEST = -111.93;
  const EAST = -111.92;
  const route: Route = {
    generatedAt: null,
    loopsObserved: 2,
    loopSeconds: 600,
    path: [
      { lat: 33.4147, lng: WEST, s: 0, t: 0 },
      { lat: 33.4147, lng: EAST, s: 926, t: 300 },
      { lat: 33.4147, lng: WEST, s: 1852, t: 600 },
    ],
    stops: [{ id: 'a', name: 'A', lat: 33.4147, lng: WEST, s: 0, t: 0, dwellSeconds: 60 }],
  };
  const waiting = at(NOW, -111.925, 0, 0);

  it('places a stopped bus on the side of the road it was driving on', () => {
    const westbound: Course = { heading: 270, at: NOW - 40_000, lat: 33.4147, lng: -111.9248 };
    const snap = buildSnapshot(route, [waiting], NOW, 400, westbound);
    assert.ok(Math.abs(snap.located!.s - 1389) < 5);
    assert.equal(snap.course, westbound);
  });

  it('forgets it once the bus has moved on unseen', () => {
    const elsewhere: Course = { heading: 270, at: NOW - 600_000, lat: 33.4147, lng: -111.921 };
    assert.ok(Math.abs(buildSnapshot(route, [waiting], NOW, 400, elsewhere).located!.s - 463) < 5);
  });
});
