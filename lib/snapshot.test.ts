import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ageCorrection, feedStatus } from './snapshot.ts';
import type { Ping } from './types.ts';

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
