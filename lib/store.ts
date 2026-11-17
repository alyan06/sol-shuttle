import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultPrefs, initialAlertState } from './alerts.ts';
import { emptyHistory } from './history.ts';
import { normalizeSchedule } from './schedule.ts';
import type { AlertState, DayLog, History, Ping, Prefs, Schedule, UserState } from './types.ts';

export type PushSubscriptionJson = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type Settings = {
  prefs: Prefs;
  watchUntil: number | null;
  subscriptions: PushSubscriptionJson[];
};

/** What every person shares: the bus's own memory, kept by the background check. */
export type Tracking = AlertState & {
  lastPing: Ping | null;
  /** Today's bus log, filed into history when the date changes. */
  today: DayLog | null;
};

/**
 * One person. Settings, schedule and state sit in separate columns so the app (which writes the
 * first two) and the background check (which writes the third) never overwrite each other.
 */
export type User = {
  id: string;
  email: string | null;
  name: string | null;
  /** False while a new account still owes the residents' code. */
  joined: boolean;
  settings: Settings;
  schedule: Schedule;
  state: UserState;
};

export const defaultSettings: Settings = { prefs: defaultPrefs, watchUntil: null, subscriptions: [] };
export const initialUserState: UserState = { leaveFired: false, wasAtStop: false, alertStopId: null, progress: null, planFired: [] };

const DEFAULTS: { tracking: Tracking; history: History } = {
  tracking: { ...initialAlertState, lastPing: null, today: null },
  history: emptyHistory,
};

type Key = keyof typeof DEFAULTS;
type Value<K extends Key> = (typeof DEFAULTS)[K];
type Part = 'settings' | 'schedule' | 'state';
type Row = { id: string; email: string | null; name: string | null; joined: boolean; settings: unknown; schedule: unknown; state: unknown };

const DATA_DIR = path.join(process.cwd(), '.data');
const USERS_DIR = path.join(DATA_DIR, 'users');

function supabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const storeKey = process.env.SHUTTLE_STORE_KEY;
  if (!url || !key || !storeKey) return null;
  // The publishable key alone reads nothing: row security on the shuttle's tables also requires this header.
  return { base: `${url}/rest/v1`, headers: { apikey: key, 'x-shuttle-key': storeKey } };
}

type Db = NonNullable<ReturnType<typeof supabase>>;

async function rest(db: Db, pathAndQuery: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<unknown> {
  const res = await fetch(`${db.base}/${pathAndQuery}`, {
    method: init.method ?? 'GET',
    cache: 'no-store',
    headers: {
      ...db.headers,
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) throw new Error(`Store ${init.method ?? 'GET'} ${pathAndQuery.split('?')[0]} failed: HTTP ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2));
}

// ---------- The bus: one row per key ----------

export async function load<K extends Key>(key: K): Promise<Value<K>> {
  const db = supabase();
  let saved: unknown;
  if (db) saved = ((await rest(db, `shuttle_kv?key=eq.${key}&select=value`)) as { value: unknown }[])[0]?.value ?? null;
  else saved = await readJson(path.join(DATA_DIR, `${key}.json`));
  return { ...DEFAULTS[key], ...(saved as object | null) } as Value<K>;
}

export async function save<K extends Key>(key: K, value: Value<K>) {
  const db = supabase();
  if (db) await rest(db, 'shuttle_kv', { method: 'POST', body: { key, value }, prefer: 'resolution=merge-duplicates' });
  else await writeJson(path.join(DATA_DIR, `${key}.json`), value);
  cache.delete(key);
}

const cache = new Map<Key, { at: number; value: unknown }>();

/** Skips the read while a recent copy is held: history grows once a day, and many phones ask about the bus at once. */
export async function loadCached<K extends Key>(key: K, maxAgeMs: number): Promise<Value<K>> {
  const held = cache.get(key);
  if (held && Date.now() - held.at < maxAgeMs) return held.value as Value<K>;
  const value = await load(key);
  cache.set(key, { at: Date.now(), value });
  return value;
}

// ---------- People: one row each ----------

/** Account ids come from Google's numeric subject or are fixed words, but nothing else may reach a file name or a query. */
export function safeId(id: string): string {
  if (!/^[a-z0-9_]{1,64}$/.test(id)) throw new Error('bad account id');
  return id;
}

function toUser(row: Row): User {
  const settings = (row.settings ?? {}) as Partial<Settings>;
  return {
    id: row.id,
    email: row.email ?? null,
    name: row.name ?? null,
    joined: row.joined !== false,
    settings: {
      prefs: { ...defaultPrefs, ...settings.prefs, alerts: { ...defaultPrefs.alerts, ...settings.prefs?.alerts } },
      watchUntil: settings.watchUntil ?? null,
      subscriptions: Array.isArray(settings.subscriptions) ? settings.subscriptions : [],
    },
    schedule: normalizeSchedule(row.schedule),
    state: { ...initialUserState, ...((row.state ?? {}) as Partial<UserState>) },
  };
}

const userFile = (id: string) => path.join(USERS_DIR, `${safeId(id)}.json`);

export async function loadUser(id: string): Promise<User | null> {
  const db = supabase();
  if (db) {
    const rows = (await rest(db, `shuttle_users?id=eq.${safeId(id)}&select=*`)) as Row[];
    return rows[0] ? toUser(rows[0]) : null;
  }
  const row = (await readJson(userFile(id))) as Row | null;
  return row ? toUser(row) : null;
}

export async function listUsers(): Promise<User[]> {
  const db = supabase();
  if (db) return ((await rest(db, 'shuttle_users?select=*')) as Row[]).map(toUser);
  let names: string[] = [];
  try {
    names = (await readdir(USERS_DIR)).filter((name) => name.endsWith('.json'));
  } catch {
    // Nobody has signed in on this machine yet.
  }
  const rows = await Promise.all(names.map((name) => readJson(path.join(USERS_DIR, name)) as Promise<Row | null>));
  return rows.filter((row): row is Row => row !== null).map(toUser);
}

/** Makes the account if it isn't there yet, and returns it either way. Never overwrites an existing one. */
export async function ensureUser(account: { id: string; email?: string | null; name?: string | null; joined?: boolean }): Promise<User> {
  const existing = await loadUser(account.id);
  if (existing) return existing;
  const row: Row = {
    id: safeId(account.id),
    email: account.email ?? null,
    name: account.name ?? null,
    joined: account.joined ?? true,
    settings: defaultSettings,
    schedule: normalizeSchedule(null),
    state: initialUserState,
  };
  const db = supabase();
  if (db) {
    await rest(db, 'shuttle_users', { method: 'POST', body: row, prefer: 'resolution=ignore-duplicates' });
  } else {
    // On a development machine, carry over what the single-user version kept in .data/.
    row.settings = (await readJson(path.join(DATA_DIR, 'settings.json'))) ?? row.settings;
    row.schedule = (await readJson(path.join(DATA_DIR, 'schedule.json'))) ?? row.schedule;
    await writeJson(userFile(row.id), row);
  }
  return toUser(row);
}

async function patchUser(id: string, change: Partial<Row>) {
  const db = supabase();
  if (db) return void (await rest(db, `shuttle_users?id=eq.${safeId(id)}`, { method: 'PATCH', body: change }));
  const row = (await readJson(userFile(id))) as Row | null;
  // An account deleted a moment ago stays deleted: a late write must not bring it back.
  if (row) await writeJson(userFile(id), { ...row, ...change });
}

export function saveUserPart<P extends Part>(id: string, part: P, value: User[P]) {
  return patchUser(id, { [part]: value });
}

export function markJoined(id: string) {
  return patchUser(id, { joined: true });
}

export async function deleteUser(id: string) {
  const db = supabase();
  if (db) await rest(db, `shuttle_users?id=eq.${safeId(id)}`, { method: 'DELETE' });
  else await rm(userFile(id), { force: true });
}

/** Hands one account's settings, schedule and state to another, then removes the first. */
export async function moveUserData(fromId: string, toId: string): Promise<boolean> {
  const from = await loadUser(fromId);
  if (!from || fromId === toId) return false;
  await patchUser(toId, { settings: from.settings, schedule: from.schedule, state: from.state, joined: true });
  await deleteUser(fromId);
  return true;
}
