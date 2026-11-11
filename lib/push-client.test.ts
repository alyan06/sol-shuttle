import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { subscriptionEndpoint } from './push-client.ts';

describe('subscriptionEndpoint', () => {
  it('returns the endpoint when the device is subscribed', async () => {
    const nav = { serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => ({ endpoint: 'https://push.example/abc' }) } }) } };
    assert.equal(await subscriptionEndpoint(nav), 'https://push.example/abc');
  });

  it('survives an iPhone Safari tab: a registered service worker with no pushManager', async () => {
    // Seen on a real phone: reaching through the missing pushManager threw, settings never loaded,
    // and the passcode box never appeared.
    const nav = { serviceWorker: { getRegistration: async () => ({}) } };
    assert.equal(await subscriptionEndpoint(nav), null);
  });

  it('survives no service worker support, no registration, and lookups that reject', async () => {
    assert.equal(await subscriptionEndpoint({}), null);
    assert.equal(await subscriptionEndpoint({ serviceWorker: { getRegistration: async () => undefined } }), null);
    const rejecting = { serviceWorker: { getRegistration: async () => { throw new Error('blocked'); } } };
    assert.equal(await subscriptionEndpoint(rejecting), null);
    const broken = { serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => { throw new Error('denied'); } } }) } };
    assert.equal(await subscriptionEndpoint(broken), null);
  });
});
