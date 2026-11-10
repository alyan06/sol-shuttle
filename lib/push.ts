import { sendNotification, setVapidDetails } from 'web-push';
import type { PushSubscriptionJson } from './store.ts';
import type { AlertEvent } from './types.ts';

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

/** Sends to every device and returns the endpoints the push service says are gone. */
export async function sendPush(subscriptions: PushSubscriptionJson[], event: AlertEvent): Promise<string[]> {
  if (!pushConfigured()) throw new Error('Push keys are not set');
  setVapidDetails(process.env.VAPID_SUBJECT!, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);

  const payload = JSON.stringify({ title: event.title, body: event.body, tag: event.kind });
  const gone: string[] = [];
  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await sendNotification(subscription, payload, { TTL: 120, urgency: 'high' });
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(subscription.endpoint);
        else console.error('push failed', status ?? error);
      }
    }),
  );
  return gone;
}
