/**
 * The checks every API request passes before it reaches a route: how fast one address may ask, how
 * big a request may be, and whether a change really comes from the app's own pages. Pure, so each
 * rule can be tested without a server.
 */

const MINUTE = 60_000;
/** Nothing the app sends is anywhere near this: a whole schedule is a few kilobytes. */
export const MAX_BODY_BYTES = 64 * 1024;

/**
 * Requests per minute from one address. Generous, because everyone at SoL can share the apartment's
 * one public address (and a campus network shares one between thousands). Each open app asks about
 * the bus every 15 seconds, so 240 a minute is about sixty phones at once. A bot asking faster than
 * that is turned away before it costs anything.
 */
export const LIMITS = {
  /** Reading the bus, settings and plan. */
  read: 240,
  /** Saving anything. People tap; they don't save sixty times a minute. */
  write: 60,
  /** Signing in. Each one makes a round trip to Google. */
  signin: 20,
} as const;

export type Bucket = keyof typeof LIMITS;

/** Which limit a request counts against, or null for one that has its own lock (the timer's secret). */
export function bucketFor(method: string, pathname: string): Bucket | null {
  if (pathname === '/api/tick') return null;
  if (pathname.startsWith('/api/auth/')) return 'signin';
  return method === 'GET' || method === 'HEAD' ? 'read' : 'write';
}

/**
 * The address a request came from. On Vercel `x-real-ip` is set by the platform itself and can't be
 * supplied by the caller; `x-forwarded-for` is only a fallback for other hosts.
 */
export function clientAddress(headers: Headers): string {
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  const forwarded = headers.get('x-vercel-forwarded-for') ?? headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || 'unknown';
}

/**
 * Counts requests per key over the last minute. Memory is bounded: when it fills, the keys that
 * have been quiet longest are forgotten, so a flood of new addresses can't wipe everyone's count.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly maxKeys: number;

  constructor(windowMs = MINUTE, maxKeys = 10_000) {
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  /** Records a request and says whether the key is now over `limit`. */
  over(key: string, limit: number, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs);
    recent.push(now);
    // Re-inserting moves the key to the end, so the Map's own order is oldest-first.
    this.hits.delete(key);
    this.hits.set(key, recent.length > limit + 1 ? recent.slice(-(limit + 1)) : recent);
    while (this.hits.size > this.maxKeys) this.hits.delete(this.hits.keys().next().value!);
    return recent.length > limit;
  }

  /** Seconds until the key has room again, for the Retry-After header. */
  retryAfter(key: string, now = Date.now()): number {
    const oldest = this.hits.get(key)?.[0];
    return oldest === undefined ? 0 : Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
  }

  get size(): number {
    return this.hits.size;
  }
}

/**
 * Whether the browser says this request was started by another site. Browsers set Sec-Fetch-Site
 * themselves and pages can't change it; tools that don't send it carry no one's cookies anyway.
 */
export function fromAnotherSite(headers: Headers, ownOrigins: string[]): boolean {
  const site = headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return true;
  const origin = headers.get('origin');
  return origin !== null && !ownOrigins.includes(origin);
}

/** Why a request that changes something should be refused before it reaches its route, or null. */
export function writeProblem(method: string, headers: Headers, ownOrigins: string[]): { status: number; error: string } | null {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
  if (fromAnotherSite(headers, ownOrigins)) return { status: 403, error: 'forbidden' };
  const length = Number(headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return { status: 413, error: 'too large' };
  // A plain HTML form on another site can only send form or text bodies; insisting on JSON means a
  // change can only come from the app's own code. Every write the app makes is JSON.
  const type = headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return { status: 415, error: 'json only' };
  return null;
}
