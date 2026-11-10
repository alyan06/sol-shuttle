// Prints every place the bus paused, in order, to show the shape of the loop.
// Samsara sends nothing while the bus is parked, so a pause runs until the next ping that moves.
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../route-data/', import.meta.url);
const points = readdirSync(dir)
  .filter((f) => f.endsWith('.jsonl'))
  .flatMap((f) => readFileSync(new URL(f, dir), 'utf8').trim().split('\n').map((line) => JSON.parse(line)))
  .sort((a, b) => a.time - b.time);

const clock = (ms) => new Date(ms - 7 * 3_600_000).toISOString().slice(11, 19);
const MIN_PAUSE_S = Number(process.argv[2] ?? 20);

let pause = null;
for (const p of points) {
  if (p.speed < 2) {
    pause ??= { from: p.time, address: p.formatted, lat: p.latitude, lng: p.longitude };
    continue;
  }
  if (pause) {
    const seconds = Math.round((p.time - pause.from) / 1000);
    if (seconds >= MIN_PAUSE_S) console.log(clock(pause.from), `${String(seconds).padStart(4)}s`, pause.lat.toFixed(5), pause.lng.toFixed(5), pause.address.split(', Tempe')[0]);
  }
  pause = null;
}
const last = points.at(-1);
console.log(`\n${points.length} points, ${clock(points[0].time)} to ${clock(last.time)}, now ${Math.round(last.speed)} mph at ${last.formatted.split(', Tempe')[0]}`);
