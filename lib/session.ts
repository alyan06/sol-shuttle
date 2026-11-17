import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Signed tokens for the session cookie and the short-lived sign-in state. The payload is readable
 * by anyone holding the cookie (it's only an account id and an expiry); the signature is what stops
 * it being forged.
 */

function encode(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function mac(body: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(body).digest();
}

export function seal(payload: Record<string, unknown>, secret: string, expiresAt: number): string {
  const body = encode(JSON.stringify({ ...payload, exp: expiresAt }));
  return `${body}.${encode(mac(body, secret))}`;
}

/** The payload, or null when the token is missing, tampered with, signed with another key, or expired. */
export function unseal<T extends Record<string, unknown>>(token: string | null | undefined, secret: string, now: number): T | null {
  if (!token || !secret) return null;
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) return null;
  const given = Buffer.from(signature, 'base64url');
  const expected = mac(body, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp?: number };
    return typeof payload.exp === 'number' && payload.exp > now ? payload : null;
  } catch {
    return null;
  }
}

/** Compares two secrets without giving away how much of a guess was right. */
export function sameSecret(given: string, expected: string): boolean {
  const a = createHmac('sha256', 'compare').update(given).digest();
  const b = createHmac('sha256', 'compare').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

/** The claims inside a Google ID token. It arrives straight from Google over TLS, so the claims are checked, not the signature. */
export type GoogleClaims = { iss?: string; aud?: string; sub?: string; exp?: number; nonce?: string; email?: string; email_verified?: boolean; name?: string };

export function readIdToken(idToken: string): GoogleClaims | null {
  const part = idToken.split('.')[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as GoogleClaims;
  } catch {
    return null;
  }
}

/** Why a Google sign-in can't be trusted, or null when it can. */
export function googleClaimsProblem(claims: GoogleClaims | null, clientId: string, nonce: string, now: number): string | null {
  if (!claims) return 'unreadable';
  if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') return 'issuer';
  if (claims.aud !== clientId) return 'audience';
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) return 'expired';
  if (claims.nonce !== nonce) return 'nonce';
  if (!claims.sub) return 'subject';
  if (claims.email_verified === false) return 'email';
  return null;
}
