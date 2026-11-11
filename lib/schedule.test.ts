import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { estimateWalk, freshHere, stopWalkMinutes } from './schedule.ts';

const NOW = Date.UTC(2026, 10, 11, 21, 0);
const MIN = 60_000;
const GAMMAGE = { lat: 33.41715, lng: -111.93655 };
const override = (walkMin: number, ageMin: number) => ({ date: '2026-11-11', skipped: [], here: { walkMin, at: NOW - ageMin * MIN } });

describe('estimateWalk', () => {
  it('times a walk across campus and across town at a steady pace', () => {
    // A point about a kilometre north-east of the stop, across campus.
    assert.equal(estimateWalk({ lat: 33.423, lng: -111.931 }, GAMMAGE, 80), 13);
    // SoL to Gammage follows the street grid: about 3.7 km.
    assert.equal(estimateWalk({ lat: 33.42134, lng: -111.90222 }, GAMMAGE, 80), 46);
    assert.equal(estimateWalk(GAMMAGE, GAMMAGE, 80), 1);
  });
});

describe('freshHere', () => {
  it('trusts a recent reading from on campus', () => {
    assert.deepEqual(freshHere(override(6, 2), NOW), { walkMin: 6, at: NOW - 2 * MIN });
  });

  it('drops one that is old, from off campus, from the future, or missing', () => {
    assert.equal(freshHere(override(6, 11), NOW), null);
    assert.equal(freshHere(override(43, 1), NOW), null);
    assert.equal(freshHere(override(6, -5), NOW), null);
    assert.equal(freshHere(null, NOW), null);
    assert.equal(freshHere({ date: '2026-11-11', skipped: [] }, NOW), null);
  });
});

describe('stopWalkMinutes', () => {
  const prefs = { walkMinutes: 5 };

  it('is always the walk from the apartment when catching the bus at SoL', () => {
    assert.equal(stopWalkMinutes(prefs, 'sol', override(9, 1), NOW), 5);
    assert.equal(stopWalkMinutes(prefs, null, null, NOW), 5);
  });

  it('is the walk from where you are when catching it at Gammage, or ten minutes when unknown', () => {
    assert.equal(stopWalkMinutes(prefs, 'gammage', override(9, 1), NOW), 9);
    assert.equal(stopWalkMinutes(prefs, 'gammage', override(9, 30), NOW), 10);
    assert.equal(stopWalkMinutes(prefs, 'gammage', null, NOW), 10);
  });
});
