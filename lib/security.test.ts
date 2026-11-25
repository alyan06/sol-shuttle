import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { defaultPrefs } from './alerts.ts';
import { SESSION_COOKIE, accountIdFor, bearerMatches, sameOrigin, sessionCookie, tooManyTries, viewerId } from './auth.ts';
import { LIMITS, MAX_BODY_BYTES, RateLimiter, bucketFor, clientAddress, writeProblem } from './guard.ts';
import { defaultSchedule } from './schedule.ts';
import { seal } from './session.ts';
import { safeId } from './store.ts';
import { cleanPrefs, cleanSchedule, cleanSubscription } from './validate.ts';

/**
 * One test per way someone might try to get in. Each says what the attack is and what stops it.
 */

const ROOT = process.cwd();
const SITE = 'https://solshuttle.app';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|mjs)$/.test(name) && !name.endsWith('.test.ts') ? [full] : [];
  });
}
const SOURCE = ['app', 'components', 'lib'].flatMap((dir) => sourceFiles(path.join(ROOT, dir)));

function request(url: string, headers: Record<string, string> = {}, method = 'POST'): Request {
  return new Request(url, { method, headers });
}

// Signed-in mode, as on the live app: a session secret, and something to sign in with.
const saved = { ...process.env };
before(() => {
  process.env.SESSION_SECRET = 'test-secret-that-is-long-enough-to-matter';
  process.env.APP_PASSCODE = 'test-passcode';
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.APP_URL;
});
after(() => {
  process.env = saved;
});

describe('1. typing /admin', () => {
  it('finds nothing: the app has no admin pages, roles or hidden tools', () => {
    const routes = execSync('git ls-files app', { encoding: 'utf8' }).split('\n');
    assert.equal(routes.filter((file) => /admin|debug|internal|dashboard/i.test(file)).length, 0);
    for (const file of SOURCE) assert.doesNotMatch(readFileSync(file, 'utf8'), /\b(isAdmin|role\s*[:=]\s*['"]admin)/, file);
  });
});

describe('2. changing an id in the address', () => {
  it('has no route that takes an account id from the address or the body', () => {
    for (const file of SOURCE.filter((f) => f.includes(`${path.sep}api${path.sep}`))) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /searchParams\.get\(['"](id|uid|user|userId|account)['"]\)/, file);
    }
  });

  it('only believes the signed cookie, and refuses one edited to name someone else', () => {
    const good = sessionCookie(request(SITE), 'g_111').split(';')[0];
    assert.equal(viewerId(request(SITE, { cookie: good })), 'g_111');

    const [, signature] = good.split('=')[1].split('.');
    const body = Buffer.from(JSON.stringify({ uid: 'owner', exp: Date.now() + 86_400_000 })).toString('base64url');
    assert.equal(viewerId(request(SITE, { cookie: `${SESSION_COOKIE}=${body}.${signature}` })), null);
    // Signed, but with a key that isn't the app's.
    const elsewhere = seal({ uid: 'owner' }, 'some-other-key', Date.now() + 86_400_000);
    assert.equal(viewerId(request(SITE, { cookie: `${SESSION_COOKIE}=${elsewhere}` })), null);
    assert.equal(viewerId(request(SITE)), null);
  });
});

describe('3. finding a key in the browser', () => {
  it('sends the browser no secret: the only public setting is the contact email', () => {
    const publicNames = new Set(SOURCE.flatMap((file) => readFileSync(file, 'utf8').match(/NEXT_PUBLIC_[A-Z_]+/g) ?? []));
    assert.deepEqual([...publicNames], ['NEXT_PUBLIC_CONTACT_EMAIL']);
  });

  it('keeps every secret out of code that runs in the browser', () => {
    const secrets = /SAMSARA_SHARE_TOKEN|VAPID_PRIVATE_KEY|TICK_SECRET|SHUTTLE_STORE_KEY|APP_PASSCODE|SESSION_SECRET|SUPABASE_PUBLISHABLE_KEY|GOOGLE_CLIENT_SECRET|JOIN_CODE/;
    for (const file of SOURCE) {
      const text = readFileSync(file, 'utf8');
      if (/^['"]use client['"]/.test(text.trimStart())) assert.doesNotMatch(text, secrets, file);
    }
  });
});

describe('4. making yourself admin, or someone else, at sign-up', () => {
  it('gives every Google account its own g_ id, never owner or local, whatever Google sends', () => {
    for (const subject of ['owner', 'local', '../owner', "1' or '1'='1", 'id=eq.owner&select=*', '１２３']) {
      const id = accountIdFor(subject);
      assert.match(id, /^g_[0-9a-z]*$/);
      assert.notEqual(id, 'owner');
      assert.doesNotThrow(() => safeId(id));
    }
  });

  it('ignores fields nobody may set, like a role or having joined', () => {
    const prefs = cleanPrefs(defaultPrefs, { role: 'admin', joined: true, isAdmin: true, walkMinutes: 6 }, ['sol']);
    assert.equal('role' in prefs || 'joined' in prefs || 'isAdmin' in prefs, false);
    const schedule = cleanSchedule(defaultSchedule, { role: 'admin', joined: true, arriveEarlyMin: 5 })!;
    assert.equal('role' in schedule || 'joined' in schedule, false);
  });
});

describe('5. too many requests', () => {
  it('turns an address away past its limit, and lets it back after a minute', () => {
    const limiter = new RateLimiter();
    const t = 1_000_000;
    for (let i = 0; i < LIMITS.read; i++) assert.equal(limiter.over('read:1.2.3.4', LIMITS.read, t + i), false);
    assert.equal(limiter.over('read:1.2.3.4', LIMITS.read, t + 500), true);
    assert.ok(limiter.retryAfter('read:1.2.3.4', t + 500) > 0);
    // Someone else at another address is unaffected.
    assert.equal(limiter.over('read:5.6.7.8', LIMITS.read, t + 500), false);
    assert.equal(limiter.over('read:1.2.3.4', LIMITS.read, t + 61_000), false);
  });

  it('keeps its memory bounded without forgetting the address that is actually flooding', () => {
    // The old way cleared everyone's count once it held too many addresses. Now only the addresses
    // quiet the longest are forgotten, and one that keeps asking never is.
    const limiter = new RateLimiter(60_000, 100);
    for (let i = 0; i < 500; i++) {
      limiter.over(`passer-by-${i}`, 3, i);
      if (i % 10 === 0) limiter.over('bot', 3, i);
    }
    assert.ok(limiter.size <= 100);
    assert.equal(limiter.over('bot', 3, 501), true);
  });

  it('gives each kind of request its own limit, and none to the timer, which has its secret', () => {
    assert.equal(bucketFor('GET', '/api/shuttle'), 'read');
    assert.equal(bucketFor('POST', '/api/plan'), 'write');
    assert.equal(bucketFor('GET', '/api/auth/google'), 'signin');
    assert.equal(bucketFor('POST', '/api/tick'), null);
  });

  it('counts guesses at a code per account as well as per address', () => {
    // Five guesses from five different networks, one account: the sixth is refused anyway.
    for (let i = 0; i < 5; i++) assert.equal(tooManyTries(request(SITE, { 'x-real-ip': `10.0.0.${i}` }), 'g_guesser', 1e6 + i), false);
    assert.equal(tooManyTries(request(SITE, { 'x-real-ip': '10.0.0.99' }), 'g_guesser', 1e6 + 10), true);
  });

  it("uses the platform's own address header, which the caller can't fake", () => {
    assert.equal(clientAddress(new Headers({ 'x-real-ip': '1.1.1.1', 'x-forwarded-for': '9.9.9.9' })), '1.1.1.1');
    assert.equal(clientAddress(new Headers({ 'x-forwarded-for': '2.2.2.2, 3.3.3.3' })), '2.2.2.2');
    assert.equal(clientAddress(new Headers()), 'unknown');
  });

  it('refuses a request body far bigger than anything the app sends', () => {
    const headers = new Headers({ 'content-type': 'application/json', 'content-length': String(MAX_BODY_BYTES + 1) });
    assert.equal(writeProblem('POST', headers, [SITE])?.status, 413);
  });
});

describe('6. a script in a name', () => {
  it('stores it as plain text, capped in length, with control characters gone', () => {
    const name = '<script>alert(document.cookie)</script><img src=x onerror=alert(1)>\u0000';
    const place = { id: 'b:X', name, lat: 33.42, lng: -111.93 };
    const block = { id: 'c1', course: name, placeId: 'b:X', startMin: 540, endMin: 600, days: [1] };
    const schedule = cleanSchedule(defaultSchedule, { places: [place], classes: [block] })!;
    assert.equal(schedule.classes[0].course, name.replace('\u0000', '').trim().slice(0, 60));
    assert.ok(schedule.places[0].name.length <= 60);
  });

  it('never writes stored text into the page as HTML: React escapes it, and nothing bypasses that', () => {
    for (const file of SOURCE) {
      const text = readFileSync(file, 'utf8');
      const raw = text.match(/dangerouslySetInnerHTML=\{\{ __html: ([A-Za-z_]+) \}\}/g) ?? [];
      for (const use of raw) assert.match(use, /THEME_SCRIPT/, `${file} writes raw HTML`);
      assert.equal(text.includes('dangerouslySetInnerHTML') && raw.length === 0, false, file);
    }
  });
});

describe('7. finding the .env file in Git', () => {
  it('has never committed an env file, and ignores them', () => {
    const everCommitted = execSync('git log --all --pretty=format: --name-only', { encoding: 'utf8' }).split('\n');
    assert.deepEqual(everCommitted.filter((file) => /(^|\/)\.env(?!\.example$)/.test(file)), []);
    assert.match(readFileSync(path.join(ROOT, '.gitignore'), 'utf8'), /^\.env\*$/m);
  });
});

describe('8. typing a database query', () => {
  it('only lets plain account ids reach a query or a file name', () => {
    for (const evil of ["owner' or '1'='1", 'owner&select=*', 'id.neq.0', 'owner,id.neq.x', '../users/owner', 'OWNER', '', 'x'.repeat(65)]) {
      assert.throws(() => safeId(evil), /bad account id/, evil);
    }
    assert.equal(safeId('g_1234567890'), 'g_1234567890');
  });

  it('builds no SQL: the database is only reached through its REST interface with fixed table names', () => {
    const store = readFileSync(path.join(ROOT, 'lib', 'store.ts'), 'utf8');
    assert.doesNotMatch(store, /\b(select|insert|update|delete)\s+(\*|into|from)\b/i);
    for (const query of store.match(/rest\(db, `[^`]+`/g) ?? []) {
      // Every value placed in a query goes through safeId, or is one of the fixed keys.
      for (const value of query.match(/\$\{[^}]+\}/g) ?? []) assert.match(value, /safeId\(|\$\{key\}/, query);
    }
  });
});

describe('a form or script on another site', () => {
  it('cannot change anything: other origins, cross-site fetches and non-JSON bodies are refused', () => {
    const json = { 'content-type': 'application/json' };
    assert.equal(writeProblem('POST', new Headers({ ...json, origin: 'https://evil.example' }), [SITE])?.status, 403);
    assert.equal(writeProblem('POST', new Headers({ ...json, 'sec-fetch-site': 'cross-site' }), [SITE])?.status, 403);
    assert.equal(writeProblem('POST', new Headers({ 'content-type': 'text/plain', origin: SITE }), [SITE])?.status, 415);
    assert.equal(writeProblem('POST', new Headers({ 'content-type': 'application/x-www-form-urlencoded' }), [SITE])?.status, 415);
    assert.equal(writeProblem('POST', new Headers({ ...json, origin: SITE, 'sec-fetch-site': 'same-origin' }), [SITE]), null);
    assert.equal(writeProblem('GET', new Headers({ origin: 'https://evil.example' }), [SITE]), null);
    assert.equal(sameOrigin(request(SITE, { origin: 'https://evil.example' })), false);
    assert.equal(sameOrigin(request(SITE, { 'sec-fetch-site': 'cross-site' })), false);
    assert.equal(sameOrigin(request(SITE, { origin: SITE, 'sec-fetch-site': 'same-origin' })), true);
  });
});

describe('aiming the server at another address', () => {
  it('only accepts push addresses on the real push services, on their normal port', () => {
    const keys = { p256dh: 'k', auth: 'a' };
    assert.ok(cleanSubscription({ endpoint: 'https://web.push.apple.com/abc', keys }));
    assert.equal(cleanSubscription({ endpoint: 'https://web.push.apple.com:8443/abc', keys }), null);
    assert.equal(cleanSubscription({ endpoint: 'https://user:pw@fcm.googleapis.com/abc', keys }), null);
    assert.equal(cleanSubscription({ endpoint: 'https://169.254.169.254/latest', keys }), null);
  });
});

describe("the timer's secret", () => {
  it('only matches the exact bearer secret', () => {
    assert.equal(bearerMatches('Bearer s3cret', 's3cret'), true);
    assert.equal(bearerMatches('Bearer s3cre', 's3cret'), false);
    assert.equal(bearerMatches('s3cret', 's3cret'), false);
    assert.equal(bearerMatches(null, 's3cret'), false);
    assert.equal(bearerMatches('Bearer ', ''), false);
  });
});

describe('the files the app is served with', () => {
  it('sets the browser protections on every page', async () => {
    const { default: config } = await import('../next.config.ts');
    const rules = await config.headers!();
    const all = rules.find((rule) => rule.source === '/:path*')!.headers.map((h) => h.key);
    for (const header of ['Content-Security-Policy', 'X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']) assert.ok(all.includes(header), header);
    const csp = rules[0].headers.find((h) => h.key === 'Content-Security-Policy')!.value;
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.equal(config.poweredByHeader, false);
    assert.ok(existsSync(path.join(ROOT, 'proxy.ts')));
  });
});
