import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parkedSince } from './day.ts';
import type { Snapshot } from './types.ts';

const NOW = Date.UTC(2026, 10, 10, 23, 50);
const MIN = 60_000;
const snap = (mph: number, status: Snapshot['status'] = 'live'): Snapshot => ({
  now: NOW,
  status,
  ping: { time: NOW - 20_000, lat: 0, lng: 0, heading: 0, mph, address: '' },
  located: null,
  etas: [],
});

describe('parkedSince', () => {
  it('reports when a parked bus last moved', () => {
    assert.equal(parkedSince(snap(0), { lastMovedAt: NOW - 3 * MIN, lastSeenAt: NOW - MIN }), NOW - 3 * MIN);
  });

  it('is null for a moving or silent bus', () => {
    assert.equal(parkedSince(snap(20), { lastMovedAt: NOW - 3 * MIN, lastSeenAt: NOW - MIN }), null);
    assert.equal(parkedSince(snap(0, 'stale'), { lastMovedAt: NOW - 3 * MIN, lastSeenAt: NOW - MIN }), null);
  });

  it('does not trust notes the background check stopped keeping', () => {
    // Seen locally: the last note was from Friday, so a bus pausing at a stop read as "not running".
    assert.equal(parkedSince(snap(0), { lastMovedAt: NOW - 4 * 24 * 60 * MIN, lastSeenAt: NOW - 4 * 24 * 60 * MIN }), null);
    assert.equal(parkedSince(snap(0), { lastMovedAt: null, lastSeenAt: null }), null);
  });
});
