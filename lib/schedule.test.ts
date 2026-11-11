import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { estimateWalk, stopWalkMinutes } from './schedule.ts';

const GAMMAGE = { lat: 33.41715, lng: -111.93655 };

describe('estimateWalk', () => {
  it('times a walk across campus and across town at a steady pace', () => {
    // A point about a kilometre north-east of the stop, across campus.
    assert.equal(estimateWalk({ lat: 33.423, lng: -111.931 }, GAMMAGE, 80), 13);
    // SoL to Gammage follows the street grid: about 3.7 km.
    assert.equal(estimateWalk({ lat: 33.42134, lng: -111.90222 }, GAMMAGE, 80), 46);
    assert.equal(estimateWalk(GAMMAGE, GAMMAGE, 80), 1);
  });
});

describe('stopWalkMinutes', () => {
  it('is the walk from the apartment at SoL and a typical campus walk at Gammage', () => {
    assert.equal(stopWalkMinutes({ walkMinutes: 5 }, 'sol'), 5);
    assert.equal(stopWalkMinutes({ walkMinutes: 5 }, null), 5);
    assert.equal(stopWalkMinutes({ walkMinutes: 5 }, 'gammage'), 10);
  });
});
