import { NextResponse, type NextRequest } from 'next/server';
import { LIMITS, RateLimiter, bucketFor, clientAddress, writeProblem } from '@/lib/guard.ts';

/**
 * Runs before every API route. It turns away a bot asking too fast, a request that's too big, and a
 * change started by another site, so none of them reach a route, the database or the bus feed.
 * Each route still checks who is signed in for itself: this is the outer door, not the lock.
 */

const limiter = new RateLimiter();

function ownOrigins(request: NextRequest): string[] {
  return [request.nextUrl.origin, process.env.APP_URL?.replace(/\/$/, '')].filter((o): o is string => Boolean(o));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const bucket = bucketFor(request.method, pathname);
  if (bucket) {
    const key = `${bucket}:${clientAddress(request.headers)}`;
    if (limiter.over(key, LIMITS[bucket])) {
      return NextResponse.json(
        { error: 'slow down' },
        { status: 429, headers: { 'Retry-After': String(limiter.retryAfter(key)), 'Cache-Control': 'no-store' } },
      );
    }
  }
  // The timer is called by the database, not a browser, and has its own secret.
  if (pathname !== '/api/tick') {
    const problem = writeProblem(request.method, request.headers, ownOrigins(request));
    if (problem) return NextResponse.json({ error: problem.error }, { status: problem.status, headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
