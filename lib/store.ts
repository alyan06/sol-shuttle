import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultPrefs, initialAlertState } from './alerts.ts';
import { emptyHistory } from './history.ts';
import { defaultSchedule } from './schedule.ts';
import type { AlertState, DayLog, History, Ping, Prefs, Progress, Schedule } from './types.ts';

export type PushSubscriptionJson = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type Settings = {
  prefs: Prefs;
  watchUntil: number | null;
  subscriptions: PushSubscriptionJson[];
};

/** Held apart from Settings so the background tick and the app never overwrite each other. */
export type Tracking = AlertState & {
  lastPing: Ping | null;
  /** Today's bus log, filed into history when the date changes. */
  today: DayLog | null;
  progress: Progress | null;
  /** The stop the leave and arrival alerts are currently about. */
  alertStopId: string | null;
  /** Plan alerts already sent today, as "date:id". */
  planFired: string[];
};

const DEFAULTS: { settings: Settings; tracking: Tracking; history: History; schedule: Schedule } = {
  settings: { prefs: defaultPrefs, watchUntil: null, subscriptions: [] },
  tracking: { ...initialAlertState, lastPing: null, today: null, progress: null, alertStopId: null, planFired: [] },
  history: emptyHistory,
  schedule: defaultSchedule,
};

type Key = keyof typeof DEFAULTS;
type Value<K extends Key> = (typeof DEFAULTS)[K];

const DATA_DIR = path.join(process.cwd(), '.data');

async function fileGet(key: Key): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path.join(DATA_DIR, `${key}.json`), 'utf8'));
  } catch {
    return null;
  }
}

async function filePut(key: Key, value: unknown) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(path.join(DATA_DIR, `${key}.json`), JSON.stringify(value, null, 2));
}

function supabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const storeKey = process.env.SHUTTLE_STORE_KEY;
  if (!url || !key || !storeKey) return null;
  // The publishable key alone reads nothing: row security on shuttle_kv also requires this header.
  return { url: `${url}/rest/v1/shuttle_kv`, headers: { apikey: key, 'x-shuttle-key': storeKey } };
}

async function remoteGet(db: NonNullable<ReturnType<typeof supabase>>, key: Key): Promise<unknown> {
  const res = await fetch(`${db.url}?key=eq.${key}&select=value`, { headers: db.headers, cache: 'no-store' });
  if (!res.ok) throw new Error(`Store read failed: HTTP ${res.status}`);
  const rows = (await res.json()) as { value: unknown }[];
  return rows[0]?.value ?? null;
}

async function remotePut(db: NonNullable<ReturnType<typeof supabase>>, key: Key, value: unknown) {
  const res = await fetch(db.url, {
    method: 'POST',
    headers: { ...db.headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ key, value }),
  });
  if (!res.ok) throw new Error(`Store write failed: HTTP ${res.status}`);
}

export async function load<K extends Key>(key: K): Promise<Value<K>> {
  const db = supabase();
  const saved = db ? await remoteGet(db, key) : await fileGet(key);
  return { ...DEFAULTS[key], ...(saved as object | null) } as Value<K>;
}

export async function save<K extends Key>(key: K, value: Value<K>) {
  const db = supabase();
  await (db ? remotePut(db, key, value) : filePut(key, value));
  cache.delete(key);
}

const cache = new Map<Key, { at: number; value: unknown }>();

/** For rows that change rarely (history grows once a day): skips the read while a recent copy is held. */
export async function loadCached<K extends Key>(key: K, maxAgeMs: number): Promise<Value<K>> {
  const held = cache.get(key);
  if (held && Date.now() - held.at < maxAgeMs) return held.value as Value<K>;
  const value = await load(key);
  cache.set(key, { at: Date.now(), value });
  return value;
}
