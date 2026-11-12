import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { moveTo, pointAt, stretch, turnToward } from './motion.ts';
import type { RoutePoint } from './types.ts';

// A square loop, 100 m a side, points every 20 m: east, north, west, south.
const M = 1 / 111_320;
const square: RoutePoint[] = [];
for (let s = 0; s <= 400; s += 20) {
  const side = Math.min(3, Math.floor(s / 100));
  const along = s - side * 100;
  const [x, y] = [[along, 0], [100, along], [100 - along, 100], [0, 100 - along]][side];
  square.push({ lat: y * M, lng: x * M, s, t: s });
}
const metres = (p: { lat: number; lng: number }) => [Math.round(p.lng / M), Math.round(p.lat / M)];

describe('moveTo', () => {
  it('drives forward to where the bus now is', () => {
    assert.deepEqual(moveTo(1000, 1180, 9000), { kind: 'glide', metres: 180 });
  });

  it('drives on through the end of the loop', () => {
    assert.deepEqual(moveTo(8950, 60, 9000), { kind: 'glide', metres: 110 });
  });

  it('waits rather than backing up when the bus is a little behind the marker', () => {
    assert.deepEqual(moveTo(1000, 940, 9000), { kind: 'hold' });
    assert.deepEqual(moveTo(1000, 1000, 9000), { kind: 'hold' });
  });

  it('jumps when the gap is too big to be one drive, or there is nowhere to start from', () => {
    assert.deepEqual(moveTo(1000, 4000, 9000), { kind: 'jump' });
    assert.deepEqual(moveTo(4000, 1000, 9000), { kind: 'jump' });
    assert.deepEqual(moveTo(null, 500, 9000), { kind: 'jump' });
  });
});

describe('pointAt', () => {
  it('finds the place and the way the road runs', () => {
    const east = pointAt(square, 50);
    assert.deepEqual(metres(east), [50, 0]);
    assert.equal(Math.round(east.bearing), 90);
    const north = pointAt(square, 130);
    assert.deepEqual(metres(north), [100, 30]);
    assert.equal(Math.round(north.bearing), 0);
    assert.equal(Math.round(pointAt(square, 250).bearing), 270);
    assert.equal(Math.round(pointAt(square, 350).bearing), 180);
  });

  it('wraps round the loop in both directions', () => {
    assert.deepEqual(metres(pointAt(square, 450)), [50, 0]);
    assert.deepEqual(metres(pointAt(square, -50)), [0, 50]);
  });
});

describe('stretch', () => {
  it('follows the road round a corner', () => {
    const line = stretch(square, 70, 130).map(([lng, lat]) => metres({ lat, lng }));
    assert.deepEqual(line, [[70, 0], [80, 0], [100, 0], [100, 20], [100, 30]]);
  });

  it('carries on through the end of the loop', () => {
    const line = stretch(square, 370, 30).map(([lng, lat]) => metres({ lat, lng }));
    assert.deepEqual(line, [[0, 30], [0, 20], [0, 0], [20, 0], [30, 0]]);
  });
});

describe('turnToward', () => {
  it('turns the short way round', () => {
    assert.equal(turnToward(350, 10), 370);
    assert.equal(turnToward(10, 350), -10);
    assert.equal(turnToward(90, 180), 180);
    assert.equal(turnToward(720, 90), 810);
  });
});
