import { NextResponse } from 'next/server';
import { OAUTH_COOKIE, appOrigin, clearCookie, finishOauth, googleConfigured, joinCodeRequired, sessionCookie } from '@/lib/auth.ts';
import { googleClaimsProblem, readIdToken } from '@/lib/session.ts';
import { ensureUser } from '@/lib/store.ts';

export const dynamic = 'force-dynamic';

/** Google sends the browser back here. The code is swapped for who they are, and the app's own session begins. */
export async function GET(request: Request) {
  const origin = appOrigin(request);
  const fail = (why: string) => {
    const response = NextResponse.redirect(new URL(`/?signin=${why}`, origin));
    response.headers.append('Set-Cookie', clearCookie(request, OAUTH_COOKIE));
    return response;
  };
  if (!googleConfigured()) return fail('unavailable');

  const params = new URL(request.url).searchParams;
  const started = finishOauth(request);
  const code = params.get('code');
  if (params.get('error')) return fail('cancelled');
  if (!started || !code || params.get('state') !== started.state) return fail('expired');

  let idToken: string | undefined;
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${origin}/api/auth/callback`,
        grant_type: 'authorization_code',
      }),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`token exchange answered ${res.status}`);
    idToken = ((await res.json()) as { id_token?: string }).id_token;
  } catch (error) {
    console.error('google sign-in failed', error);
    return fail('failed');
  }

  const claims = idToken ? readIdToken(idToken) : null;
  const problem = googleClaimsProblem(claims, process.env.GOOGLE_CLIENT_ID!, started.nonce, Date.now());
  if (problem || !claims?.sub) {
    console.error('google sign-in refused:', problem);
    return fail('failed');
  }

  const id = `g_${claims.sub.replace(/[^0-9a-z]/gi, '').toLowerCase()}`;
  await ensureUser({ id, email: claims.email ?? null, name: claims.name ?? null, joined: !joinCodeRequired() });
  const response = NextResponse.redirect(new URL('/', origin));
  response.headers.append('Set-Cookie', sessionCookie(request, id));
  response.headers.append('Set-Cookie', clearCookie(request, OAUTH_COOKIE));
  return response;
}
