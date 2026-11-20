'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { POLICY_ID, POLICY_SUMMARY, POLICY_UPDATED } from '@/lib/policy.ts';

const KEY = 'shuttle-policy-seen';

/** Tells a signed-in person, once on each device, that the privacy page changed in a way that matters. */
export default function PolicyNotice() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      setShow(localStorage.getItem(KEY) !== POLICY_ID);
    } catch {
      // Storage blocked: show it, since it can't be remembered as read.
      setShow(true);
    }
  }, []);

  if (!show) return null;

  function dismiss() {
    try {
      localStorage.setItem(KEY, POLICY_ID);
    } catch {
      // Nothing to do: it shows again next time.
    }
    setShow(false);
  }

  return (
    <section className="callout policy-notice" aria-labelledby="policy-title">
      <p id="policy-title">
        <strong>Privacy page updated {POLICY_UPDATED}.</strong> {POLICY_SUMMARY}
      </p>
      <div className="button-row wrap">
        <Link className="button small" href="/privacy">
          Read it
        </Link>
        <button className="button small quiet" onClick={dismiss}>
          Got it
        </button>
      </div>
    </section>
  );
}
