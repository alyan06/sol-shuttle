import type { Ping } from './types.ts';

const HOST = 'https://us6-ws.cloud.samsara.com';
const ORG_ID = '67687';
const CACHE_MS = 14_000;
const HEADERS = { 'User-Agent': 'personal-shuttle-tracker' };

// Position fields only. The share page also returns the driver; this app never requests it.
const QUERY = `query FleetViewer($token: string!, $duration: int64!) {
  fleetViewerToken(token: $token) {
    devices(feature: "fleetTrackable") {
      location: fleetViewerLocation(duration: $duration) { time latitude longitude heading speed formatted }
    }
  }
}`;

type RawLocation = {
  time: number;
  latitude: number;
  longitude: number;
  heading: number;
  speed: number;
  formatted: string;
};

type FeedResponse = { output?: { fleetViewerToken?: { devices?: { location?: RawLocation[] }[] } } };

function shareToken(): string {
  const value = process.env.SAMSARA_SHARE_TOKEN;
  if (!value) throw new Error('SAMSARA_SHARE_TOKEN is not set');
  return value;
}

let session: { csrf: string; cookie: string } | null = null;
let cache: { at: number; pings: Ping[] } | null = null;
let inFlight: Promise<Ping[]> | null = null;

async function openSession() {
  const res = await fetch(`${HOST}/r/auth/csrf`, { headers: HEADERS, cache: 'no-store' });
  if (!res.ok) throw new Error(`Samsara session failed: HTTP ${res.status}`);
  const { csrf_token: csrf } = (await res.json()) as { csrf_token: string };
  session = { csrf, cookie: res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') };
  return session;
}

async function request(): Promise<Response> {
  const { csrf, cookie } = session ?? (await openSession());
  return fetch(`${HOST}/r/graphql?q=FleetViewer`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      ...HEADERS,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Csrf-Token': csrf,
      Cookie: cookie,
    },
    body: JSON.stringify({
      query: QUERY,
      variables: { token: shareToken(), duration: 30_000 },
      extensions: { route: '/o/:org_id/fleet/viewer/:token', orgId: ORG_ID },
    }),
  });
}

async function load(): Promise<Ping[]> {
  let res = await request();
  if (res.status === 401 || res.status === 403) {
    session = null;
    res = await request();
  }
  if (!res.ok) throw new Error(`Samsara feed failed: HTTP ${res.status}`);
  const json = (await res.json()) as FeedResponse;
  const raw = json.output?.fleetViewerToken?.devices?.[0]?.location ?? [];
  return raw.map((p) => ({
    time: p.time,
    lat: p.latitude,
    lng: p.longitude,
    heading: p.heading,
    mph: p.speed,
    address: p.formatted,
  }));
}

/** Newest ping last. Cached so the page and the alert tick share one upstream call. */
export async function fetchPings(): Promise<Ping[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.pings;
  inFlight ??= load()
    .then((pings) => {
      cache = { at: Date.now(), pings };
      return pings;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
