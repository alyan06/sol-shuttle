import { NextResponse } from 'next/server';
import { appOrigin, googleConfigured, startOauth } from '@/lib/auth.ts';

export const dynamic = 'force-dynamic';

/** Sends the browser to Google to sign in. Only the basics are asked for: who you are, and your email. */
export async function GET(request: Request) {
  if (!googleConfigured()) return NextResponse.redirect(new URL('/?signin=unavailable', appOrigin(request)));
  const { state, nonce, cookie } = startOauth(request);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${appOrigin(request)}/api/auth/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    prompt: 'select_account',
  }).toString();
  const response = NextResponse.redirect(url);
  response.headers.append('Set-Cookie', cookie);
  return response;
}
