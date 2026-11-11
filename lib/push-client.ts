/**
 * Browser-side push lookups that can't take the page down with them.
 *
 * iPhone Safari only has the Push API inside a Home Screen app. In an ordinary Safari tab a
 * service worker can be registered but `registration.pushManager` is undefined, so reaching
 * through it throws. Every lookup here answers "no subscription" instead.
 */

type PushLike = { getSubscription(): Promise<{ endpoint: string; unsubscribe?(): Promise<boolean> } | null> };
type RegistrationLike = { pushManager?: PushLike };
type NavigatorLike = { serviceWorker?: { getRegistration(): Promise<RegistrationLike | undefined> } };

export async function currentSubscription(nav: NavigatorLike) {
  try {
    const registration = await nav.serviceWorker?.getRegistration();
    return (await registration?.pushManager?.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/** This device's push endpoint, or null when it has none or can't have one. */
export async function subscriptionEndpoint(nav: NavigatorLike): Promise<string | null> {
  return (await currentSubscription(nav))?.endpoint ?? null;
}
