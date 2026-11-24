import { RateLimiter, clientAddress, fromAnotherSite } from './guard.ts';
import { randomToken, sameSecret, seal, unseal } from './session.ts';
import { ensureUser, loadUser, type User } from './store.ts';

/**
 * Who is asking. People sign in with Google; the app then keeps its own signed cookie and never
 * sees a password. On a development machine with nothing configured, everyone is one local person.
 */

export const SESSION_COOKIE = 'shuttle_session';
export const OAUTH_COOKIE = 'shuttle_signin';
/** The first account, from when the app had one user and a passcode. */
export const OWNER_ID = 'owner';
const LOCAL_ID = 'local';
const SESSION_DAYS = 180;

export type SignInWays = { google: boolean; passcode: boolean };

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** Hosted, a missing secret means no session can be made or read. Only a development machine gets a stand-in. */
function sessionSecret(): string {
  return process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'development-only');
}

/** Nothing to sign in with and nothing to protect: a development machine. */
export function openMode(): boolean {
  return !process.env.APP_PASSCODE && !googleConfigured() && process.env.NODE_ENV !== 'production';
}

/** Google is the way in. The old passcode stays only until Google is set up, so the owner is never locked out. */
export function signInWays(): SignInWays {
  return { google: googleConfigured(), passcode: Boolean(process.env.APP_PASSCODE) && !googleConfigured() };
}

/**
 * A Google account's id here. Always `g_` and Google's own subject, letters and digits only, so no
 * sign-in can ever land on the `owner` or `local` accounts, or reach a query or a file name.
 */
export function accountIdFor(googleSubject: string): string {
  return `g_${googleSubject.replace(/[^0-9a-z]/gi, '').toLowerCase()}`;
}

/** The most accounts the app will hold (`MAX_ACCOUNTS`, default 300): far more than ride one apartment's bus. */
export function maxAccounts(): number {
  const set = Number(process.env.MAX_ACCOUNTS);
  return Number.isInteger(set) && set > 0 ? set : 300;
}

export function joinCodeRequired(): boolean {
  return Boolean(process.env.JOIN_CODE);
}

export function passcodeMatches(given: unknown): boolean {
  const expected = process.env.APP_PASSCODE;
  return typeof given === 'string' && Boolean(expected) && sameSecret(given, expected!);
}

export function joinCodeMatches(given: unknown): boolean {
  const expected = process.env.JOIN_CODE;
  return typeof given === 'string' && Boolean(expected) && sameSecret(given.trim().toLowerCase(), expected!.trim().toLowerCase());
}

function cookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

/** The public address of the app: what Google sends people back to. */
export function appOrigin(request: Request): string {
  return (process.env.APP_URL ?? new URL(request.url).origin).replace(/\/$/, '');
}

function cookieFlags(request: Request, maxAgeSeconds: number): string {
  const secure = appOrigin(request).startsWith('https://') ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function sessionCookie(request: Request, userId: string, now = Date.now()): string {
  const token = seal({ uid: userId }, sessionSecret(), now + SESSION_DAYS * 86_400_000);
  return `${SESSION_COOKIE}=${token}; ${cookieFlags(request, SESSION_DAYS * 86_400)}`;
}

export function clearCookie(request: Request, name: string): string {
  return `${name}=; ${cookieFlags(request, 0)}`;
}

/** Remembers, for ten minutes, which sign-in this browser started, so a reply from Google can't be replayed or injected. */
export function startOauth(request: Request, now = Date.now()): { state: string; nonce: string; cookie: string } {
  const state = randomToken();
  const nonce = randomToken();
  const token = seal({ state, nonce }, sessionSecret(), now + 600_000);
  return { state, nonce, cookie: `${OAUTH_COOKIE}=${token}; ${cookieFlags(request, 600)}` };
}

export function finishOauth(request: Request, now = Date.now()): { state: string; nonce: string } | null {
  return unseal<{ state: string; nonce: string }>(cookie(request, OAUTH_COOKIE), sessionSecret(), now);
}

/** The signed-in account's id, or null. Reads only the cookie. */
export function viewerId(request: Request, now = Date.now()): string | null {
  if (openMode()) return LOCAL_ID;
  return unseal<{ uid: string }>(cookie(request, SESSION_COOKIE), sessionSecret(), now)?.uid ?? null;
}

/** The signed-in person, or null: not signed in, or the account has since been deleted. */
export async function viewer(request: Request): Promise<User | null> {
  const id = viewerId(request);
  if (!id) return null;
  if (id === LOCAL_ID) return ensureUser({ id: LOCAL_ID, name: 'You' });
  return loadUser(id);
}

/** A change must come from the app's own pages, not from a form or script on some other site. */
export function sameOrigin(request: Request): boolean {
  return !fromAnotherSite(request.headers, [new URL(request.url).origin, appOrigin(request)]);
}

/**
 * Slows down guessing at the passcode or the residents' code: five tries a minute per address, and
 * five a minute per account too, so a guesser can't get round it by switching networks.
 */
const guesses = new RateLimiter();
export const GUESSES_PER_MINUTE = 5;
export function tooManyTries(request: Request, accountId?: string, now = Date.now()): boolean {
  const byAddress = guesses.over(`ip:${clientAddress(request.headers)}`, GUESSES_PER_MINUTE, now);
  const byAccount = accountId ? guesses.over(`account:${accountId}`, GUESSES_PER_MINUTE, now) : false;
  return byAddress || byAccount;
}

/** The timer's "Authorization: Bearer <secret>", compared without giving away how much of a guess was right. */
export function bearerMatches(header: string | null, secret: string): boolean {
  if (!header?.startsWith('Bearer ') || !secret) return false;
  return sameSecret(header.slice('Bearer '.length), secret);
}
