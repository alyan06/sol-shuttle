import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extendTrail, trailLength, type TrailPoint } from './trail.ts';

// Points along a street running east, about 93 m apart.
const east = (n: number): TrailPoint => [-111.93 + n * 0.001, 33.42];

describe('the trail behind the bus', () => {
  it('grows as the bus moves and ignores a point that is no move at all', () => {
    let trail: TrailPoint[] = [];
    trail = extendTrail(trail, east(0), 500);
    trail = extendTrail(trail, east(1), 500);
    assert.equal(trail.length, 2);
    assert.equal(extendTrail(trail, east(1), 500), trail);
    assert.ok(Math.abs(trailLength(trail) - 93) < 1);
  });

  it('never gets longer than its limit, and shortens smoothly from the far end', () => {
    let trail: TrailPoint[] = [];
    for (let n = 0; n <= 10; n++) trail = extendTrail(trail, east(n), 300);
    assert.ok(Math.abs(trailLength(trail) - 300) < 0.5);
    // The newest point is always the bus.
    assert.deepEqual(trail.at(-1), east(10));
    // The oldest point sits part-way along a segment, not on a recorded position.
    assert.ok(trail[0][0] > east(6)[0] && trail[0][0] < east(7)[0]);
  });
});
