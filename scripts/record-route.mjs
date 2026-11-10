// Logs the shuttle's GPS trail to route-data/ so stops and loop timing can be learned.
// Position fields only: the driver is never requested. Polls no faster than Samsara's own page.
import { appendFileSync } from 'node:fs';

const HOST = 'https://us6-ws.cloud.samsara.com';
// The share link's token is private to the apartment: it comes from .env.local, never from the repo.
const TOKEN = process.env.SAMSARA_SHARE_TOKEN;
if (!TOKEN) {
  console.error('Set SAMSARA_SHARE_TOKEN (npm run record loads it from .env.local).');
  process.exit(1);
}
const ORG_ID = '67687';
const POLL_MS = 15_000;
const RUN_MS = Number(process.argv[2] ?? 90) * 60_000;
const OUT = new URL(`../route-data/trail-${new Date().toISOString().slice(0, 10)}.jsonl`, import.meta.url);
const HEADERS = { 'User-Agent': 'personal-shuttle-tracker' };
const QUERY = `query FleetViewer($token: string!, $duration: int64!) {
  fleetViewerToken(token: $token) {
    devices(feature: "fleetTrackable") {
      location: fleetViewerLocation(duration: $duration) { time latitude longitude heading speed formatted }
    }
  }
}`;

let session = null;
async function openSession() {
  const res = await fetch(`${HOST}/r/auth/csrf`, { headers: HEADERS });
  const { csrf_token: csrf } = await res.json();
  session = { csrf, cookie: res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') };
}

async function poll() {
  if (!session) await openSession();
  const res = await fetch(`${HOST}/r/graphql?q=FleetViewer`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json', Accept: 'application/json', 'X-Csrf-Token': session.csrf, Cookie: session.cookie },
    body: JSON.stringify({ query: QUERY, variables: { token: TOKEN, duration: 30000 }, extensions: { route: '/o/:org_id/fleet/viewer/:token', orgId: ORG_ID } }),
  });
  if (res.status === 401 || res.status === 403) { session = null; throw new Error(`session rejected (${res.status})`); }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.output?.fleetViewerToken?.devices?.[0]?.location ?? [];
}

let lastTime = 0, saved = 0, failures = 0;
const stopAt = Date.now() + RUN_MS;
console.log(`recording for ${RUN_MS / 60000} min -> ${OUT.pathname}`);
while (Date.now() < stopAt) {
  try {
    const fresh = (await poll()).filter((p) => p.time > lastTime);
    for (const p of fresh) { appendFileSync(OUT, JSON.stringify(p) + '\n'); lastTime = p.time; saved++; }
    failures = 0;
  } catch (err) {
    failures++;
    console.log(new Date().toISOString(), 'poll failed:', err.message);
    if (failures >= 10) { console.log('stopping after 10 straight failures'); break; }
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
console.log(`done, saved ${saved} points`);
