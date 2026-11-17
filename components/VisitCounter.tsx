'use client';

import { Analytics, type BeforeSendEvent } from '@vercel/analytics/next';

/**
 * Vercel Web Analytics: page views only, no cookies, nothing that names a person. Query strings
 * are dropped before anything is sent, so a sign-in error or anything else in a URL never leaves.
 */
function pathOnly(event: BeforeSendEvent): BeforeSendEvent {
  const url = new URL(event.url);
  return { ...event, url: url.origin + url.pathname };
}

export default function VisitCounter() {
  return <Analytics beforeSend={pathOnly} />;
}
