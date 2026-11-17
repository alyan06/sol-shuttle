import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { googleClaimsProblem, readIdToken, sameSecret, seal, unseal } from './session.ts';

const NOW = 1_800_000_000_000;

describe('session tokens', () => {
  it('round-trips a payload until it expires', () => {
    const token = seal({ uid: 'g_123' }, 'secret', NOW + 1000);
    assert.equal(unseal<{ uid: string }>(token, 'secret', NOW)!.uid, 'g_123');
    assert.equal(unseal(token, 'secret', NOW + 1000), null);
  });

  it('refuses a token that was changed, signed with another key, or malformed', () => {
    const token = seal({ uid: 'g_123' }, 'secret', NOW + 1000);
    const [body, signature] = token.split('.');
    const forged = `${Buffer.from(JSON.stringify({ uid: 'owner', exp: NOW + 1000 })).toString('base64url')}.${signature}`;
    assert.equal(unseal(forged, 'secret', NOW), null);
    assert.equal(unseal(token, 'other', NOW), null);
    assert.equal(unseal(`${body}.`, 'secret', NOW), null);
    assert.equal(unseal(`${token}.x`, 'secret', NOW), null);
    assert.equal(unseal('', 'secret', NOW), null);
    assert.equal(unseal(null, 'secret', NOW), null);
    // No secret configured must never mean "anything goes".
    assert.equal(unseal(seal({ uid: 'x' }, '', NOW + 1000), '', NOW), null);
  });

  it('compares secrets of any length', () => {
    assert.equal(sameSecret('letmein', 'letmein'), true);
    assert.equal(sameSecret('letmein', 'letmeinn'), false);
    assert.equal(sameSecret('', 'letmein'), false);
  });
});

describe('Google sign-in claims', () => {
  const good = { iss: 'https://accounts.google.com', aud: 'client', sub: '42', exp: NOW / 1000 + 60, nonce: 'n', email: 'a@example.com', email_verified: true };
  const problem = (change: object) => googleClaimsProblem({ ...good, ...change }, 'client', 'n', NOW);

  it('accepts a token meant for this app, this sign-in, and still valid', () => {
    assert.equal(problem({}), null);
    assert.equal(problem({ iss: 'accounts.google.com' }), null);
  });

  it('names what is wrong otherwise', () => {
    assert.equal(problem({ iss: 'https://evil.example' }), 'issuer');
    assert.equal(problem({ aud: 'another-app' }), 'audience');
    assert.equal(problem({ exp: NOW / 1000 - 1 }), 'expired');
    assert.equal(problem({ nonce: 'replayed' }), 'nonce');
    assert.equal(problem({ sub: '' }), 'subject');
    assert.equal(problem({ email_verified: false }), 'email');
    assert.equal(googleClaimsProblem(null, 'client', 'n', NOW), 'unreadable');
  });

  it('reads the claims out of an ID token', () => {
    const idToken = `x.${Buffer.from(JSON.stringify(good)).toString('base64url')}.y`;
    assert.equal(readIdToken(idToken)!.sub, '42');
    assert.equal(readIdToken('nonsense'), null);
  });
});
