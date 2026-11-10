// Turns the recorded GPS trail into lib/route.json: the loop's path, typical timing and stops.
// Also scores itself: each loop is held out and predicted from the others.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { angleBetween, bearing, metresBetween, projectOntoSegment } from '../lib/geo.ts';
import { etaToStop, locate } from '../lib/track.ts';

const dir = new URL('../route-data/', import.meta.url);
const ANCHOR = { lat: 33.421, lng: -111.903 }; // SoL's entrance; each departure starts a loop
const ANCHOR_RADIUS_M = 250;
const MIN_LOOP_S = 5 * 60;
const MAX_LOOP_S = 45 * 60;
const RESAMPLE_M = 20;
const MATCH_M = 60;
const PAUSE_MPH = 2;
const MIN_PAUSE_S = 25;
const STOP_CLUSTER_M = 80;
const MIN_STOP_SHARE = 0.8;
const STOP_SEARCH_M = 40;
const SPARE_S = 120; // Matches the default spare minutes: following the app gets you there this early.
const LEFT_STOP_M = 100;
const STOP_LEAD_M = 20; // A stop's time is set just before it, so it means arriving, not leaving.

// The stops are confirmed by hand. Pauses alone can't tell a stop from a red light: the bus has
// waited 20s and 5 min at the same stop, and 5 min at a signal.
const stopsFile = new URL('stops.json', dir);
const confirmedStops = existsSync(stopsFile) ? JSON.parse(readFileSync(stopsFile, 'utf8')) : [];

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];

function loadPoints() {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .flatMap((f) => readFileSync(new URL(f, dir), 'utf8').trim().split('\n').map((line) => JSON.parse(line)))
    .map((p) => ({ time: p.time, lat: p.latitude, lng: p.longitude, heading: p.heading, mph: p.speed, address: p.formatted }))
    .sort((a, b) => a.time - b.time);
}

function splitLoops(points) {
  const departures = [];
  let inside = false;
  points.forEach((p, i) => {
    const near = metresBetween(p, ANCHOR) <= ANCHOR_RADIUS_M;
    if (inside && !near) departures.push(i);
    inside = near;
  });
  const loops = [];
  for (let i = 0; i + 1 < departures.length; i++) {
    const loop = points.slice(departures[i], departures[i + 1] + 1);
    const seconds = (loop.at(-1).time - loop[0].time) / 1000;
    if (seconds >= MIN_LOOP_S && seconds <= MAX_LOOP_S) loops.push(loop);
  }
  return loops;
}

function withDistance(loop) {
  let s = 0;
  return loop.map((p, i) => {
    if (i > 0) s += metresBetween(loop[i - 1], p);
    return { ...p, s, elapsed: (p.time - loop[0].time) / 1000 };
  });
}

/** Linear lookup of `key` at a given distance along a measured loop. */
function at(measured, s, key) {
  let i = 1;
  while (i < measured.length - 1 && measured[i].s < s) i++;
  const a = measured[i - 1], b = measured[i];
  const span = b.s - a.s;
  return span === 0 ? a[key] : a[key] + ((b[key] - a[key]) * (s - a.s)) / span;
}

function pausesIn(measured) {
  // Samsara sends nothing while the bus is parked, so a pause runs until the next ping that moves.
  const pauses = [];
  let first = null;
  for (const p of measured) {
    if (p.mph < PAUSE_MPH) {
      first ??= p;
    } else if (first) {
      pauses.push({ ...first, frac: first.s / measured.at(-1).s, dwell: (p.time - first.time) / 1000 });
      first = null;
    }
  }
  return pauses.filter((p) => p.dwell >= MIN_PAUSE_S);
}

/** When one loop reached each path point, in order and going the same way. Null if it never did. */
function arrivalsAlong(measured, path) {
  let cursor = 0;
  return path.map((point, k) => {
    const next = path[Math.min(k + 1, path.length - 1)];
    const way = k + 1 < path.length ? bearing(point, next) : bearing(path[k - 1], point);
    let best = null;
    for (let i = cursor; i < measured.length; i++) {
      const p = measured[i];
      if (p.mph < PAUSE_MPH || angleBetween(p.heading, way) > 65) continue;
      const d = metresBetween(p, point);
      if (d <= MATCH_M && (!best || d < best.d)) best = { i, d };
      else if (best) break;
    }
    if (!best) return null;
    cursor = best.i;
    return measured[best.i].elapsed;
  });
}

/** Where a confirmed stop sits on the loop. Heading picks the right pass on two-way streets. */
function placeOnPath(stop, path) {
  let best = null;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i], b = path[i + 1];
    const { fraction, distanceM } = projectOntoSegment(stop, a, b);
    if (distanceM > STOP_SEARCH_M) continue;
    if (stop.heading !== undefined && angleBetween(stop.heading, bearing(a, b)) > 65) continue;
    if (!best || distanceM < best.distanceM) best = { s: a.s + (b.s - a.s) * fraction, distanceM };
  }
  if (!best) throw new Error(`${stop.name} isn't on the recorded loop`);
  return best.s;
}

function secondsParkedNear(measured, places) {
  let seconds = 0;
  for (let i = 0; i + 1 < measured.length; i++) {
    const p = measured[i];
    if (p.mph < PAUSE_MPH && places.some((place) => metresBetween(p, place) <= 60)) seconds += (measured[i + 1].time - p.time) / 1000;
  }
  return seconds;
}

function buildRoute(loops) {
  const measured = loops.map(withDistance);
  const reference = [...measured].sort((a, b) => a.at(-1).elapsed - b.at(-1).elapsed)[Math.floor(measured.length / 2)];
  const length = reference.at(-1).s;
  const loopSeconds = median(measured.map((m) => m.at(-1).elapsed));

  const path = [];
  for (let s = 0; s <= length; s += RESAMPLE_M) path.push({ lat: at(reference, s, 'lat'), lng: at(reference, s, 'lng'), s });
  path.push({ lat: reference.at(-1).lat, lng: reference.at(-1).lng, s: length });

  // Typical time to reach each point, by place. Comparing loops by distance driven drifts, because
  // parked GPS jitter adds distance, and a loop on another street simply has no time for that point.
  const arrivals = measured.map((m) => arrivalsAlong(m, path));
  let latest = 0;
  path.forEach((p, k) => {
    const seen = arrivals.map((a) => a[k]).filter((v) => v !== null);
    if (seen.length > 0) latest = Math.min(loopSeconds, Math.max(latest, median(seen)));
    p.t = latest;
  });
  path.at(-1).t = loopSeconds;
  const typicalTimeAt = (s) => {
    const i = Math.max(1, path.findIndex((p) => p.s >= s));
    const a = path[i - 1], b = path[i];
    return a.t + ((b.t - a.t) * (s - a.s)) / Math.max(1, b.s - a.s);
  };

  // A stop is a place the bus pauses on nearly every loop. Red lights don't catch it every time.
  const clusters = [];
  measured.forEach((m, loopIndex) => {
    for (const pause of pausesIn(m)) {
      const home = clusters.find((c) => Math.abs(median(c.items.map((x) => x.frac)) - pause.frac) * length <= STOP_CLUSTER_M);
      if (home) home.items.push({ ...pause, loopIndex });
      else clusters.push({ items: [{ ...pause, loopIndex }] });
    }
  });

  const candidates = clusters.map(({ items }) => {
    const frac = median(items.map((x) => x.frac));
    return {
      lat: median(items.map((x) => x.lat)),
      lng: median(items.map((x) => x.lng)),
      s: frac * length,
      t: typicalTimeAt(frac * length),
      dwellSeconds: Math.round(median(items.map((x) => x.dwell))),
      share: new Set(items.map((x) => x.loopIndex)).size / loops.length,
      address: items[0].address.split(', Tempe')[0],
    };
  });

  const stops = confirmedStops.map((stop) => {
    const s = placeOnPath(stop, path);
    const span = path.filter((p) => p.s >= s && p.s <= s + (stop.holdM ?? 0));
    const dwells = measured.map((m) => secondsParkedNear(m, [stop, ...span]));
    return { ...stop, s, t: typicalTimeAt(Math.max(0, s - STOP_LEAD_M)), dwellSeconds: Math.round(median(dwells)) };
  });

  return {
    route: {
      generatedAt: new Date().toISOString(),
      loopsObserved: loops.length,
      loopSeconds: Math.round(loopSeconds),
      path: path.map((p) => ({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6), s: Math.round(p.s), t: Math.round(p.t) })),
      stops: stops
        .sort((a, b) => a.s - b.s)
        .map(({ id, name, lat, lng, s, t, dwellSeconds, holdM }) => ({ id, name, lat, lng, s: Math.round(s), t: Math.round(t), dwellSeconds, ...(holdM ? { holdM } : {}) })),
    },
    candidates,
  };
}

/** Predicts each held-out loop from the others and compares with when the bus really arrived. */
function holdOut(loops, points) {
  const errors = [];
  let pings = 0, unplaced = 0;
  loops.forEach((loop, index) => {
    const { route } = buildRoute(loops.filter((_, i) => i !== index));
    let prevS = null;
    for (const ping of loop) {
      pings++;
      const located = locate(route, ping, prevS);
      if (!located) {
        unplaced++;
        continue;
      }
      prevS = located.s;
      for (const stop of route.stops) {
        const eta = etaToStop(route, located, stop);
        if (eta.atStop || eta.seconds < 120 || eta.seconds > 900) continue;
        const arrival = points.find((p) => p.time > ping.time + 60_000 && metresBetween(p, stop) <= 60);
        if (!arrival) continue;
        // The bus has really gone once it's well clear of everywhere it waits at this stop.
        const span = [stop, ...route.path.filter((p) => p.s >= stop.s && p.s <= stop.s + (stop.holdM ?? 0))];
        const gone = points.find((p) => p.time > arrival.time && span.every((place) => metresBetween(p, place) > LEFT_STOP_M));
        const youArrive = ping.time + (eta.seconds - SPARE_S) * 1000;
        errors.push({ stop: stop.name, error: eta.seconds - (arrival.time - ping.time) / 1000, missed: gone ? youArrive > gone.time : false, wait: gone ? (gone.time - arrival.time) / 1000 : null });
      }
    }
  });
  return { errors, pings, unplaced };
}

const points = loadPoints();
const loops = splitLoops(points);
console.log(`${points.length} points, ${loops.length} complete loops`);
if (loops.length < 2) {
  console.log('Need at least 2 complete loops.');
  process.exit(1);
}
loops.forEach((l, i) => console.log(`  loop ${i + 1}: ${Math.round((l.at(-1).time - l[0].time) / 60000)} min`));

const { route, candidates } = buildRoute(loops);
console.log(`\nLoop: ${(route.path.at(-1).s / 1000).toFixed(1)} km, typically ${Math.round(route.loopSeconds / 60)} min`);
console.log('\nPauses (share of loops, typical dwell, minutes into loop):');
for (const c of candidates.sort((a, b) => a.s - b.s)) {
  console.log(`  ${c.share >= MIN_STOP_SHARE ? 'often' : '     '} ${String(Math.round(c.share * 100)).padStart(3)}%  ${String(c.dwellSeconds).padStart(4)}s  +${(c.t / 60).toFixed(1).padStart(4)}  ${c.lat.toFixed(5)},${c.lng.toFixed(5)}  ${c.address}`);
}

console.log('\nStops:');
for (const s of route.stops) console.log(`  ${s.name}: +${(s.t / 60).toFixed(1)} min, typically parked ${s.dwellSeconds}s`);

if (loops.length >= 3 && route.stops.length > 0) {
  const { errors, pings, unplaced } = holdOut(loops, points);
  console.log(`\nHeld-out accuracy, predictions 2 to 15 min ahead (${errors.length} samples):`);
  for (const name of [...new Set(errors.map((e) => e.stop))]) {
    const own = errors.filter((e) => e.stop === name);
    const abs = own.map((e) => Math.abs(e.error));
    const missed = own.filter((e) => e.missed).length / own.length;
    const waits = own.map((e) => e.wait).filter((w) => w !== null);
    console.log(`  ${name}: typical error ${Math.round(percentile(abs, 0.5))}s, 90% within ${Math.round(percentile(abs, 0.9))}s, shortest wait there ${Math.round(Math.min(...waits))}s, would have missed it ${Math.round(missed * 100)}% of the time (${own.length} samples)`);
  }
  console.log(`  ${pings - unplaced} of ${pings} pings placed on the route`);
}

if (process.argv.includes('--write')) {
  writeFileSync(new URL('../lib/route.json', import.meta.url), JSON.stringify(route) + '\n');
  console.log('\nWrote lib/route.json');
}
