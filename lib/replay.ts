import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Ping } from './types.ts';

/**
 * Development only: plays a recorded trip back as if it were happening now, so the map can be
 * worked on when the bus isn't running. Turned on by SHUTTLE_REPLAY (npm run dev:replay).
 */
const TRAIL = 'route-data/trail-2026-11-06.jsonl';
/** Where in the recording to begin: a few minutes in, with the bus on the move. */
const SKIP_MS = 6 * 60_000;
const WINDOW_MS = 30_000;

let trail: Ping[] | null = null;
const began = Date.now();

export function replaying(): boolean {
  return Boolean(process.env.SHUTTLE_REPLAY);
}

export async function replayPings(now = Date.now()): Promise<Ping[]> {
  trail ??= (await readFile(path.join(process.cwd(), TRAIL), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { time: number; latitude: number; longitude: number; heading: number; speed: number })
    .map((p) => ({ time: p.time, lat: p.latitude, lng: p.longitude, heading: p.heading, mph: p.speed, address: '' }));
  const first = trail[0].time + SKIP_MS;
  const span = trail[trail.length - 1].time - first;
  const playhead = first + ((now - began) % span);
  const shift = now - playhead;
  return trail.filter((p) => p.time <= playhead && p.time > playhead - WINDOW_MS).map((p) => ({ ...p, time: p.time + shift }));
}
