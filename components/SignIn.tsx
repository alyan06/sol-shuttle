'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { post, useAccount } from './Account';

const PROBLEMS: Record<string, string> = {
  cancelled: 'Sign-in was cancelled. Nothing was saved.',
  expired: 'That sign-in took too long. Try again.',
  failed: "Google couldn't confirm it was you. Try again.",
  unavailable: "Google sign-in isn't set up on this app yet.",
};

function GoogleLogo() {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.97 8.97 0 0 0 9 0 9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

/** What a signed-out visitor sees below the live bus: what signing in gets them, and the way in. */
export function SignInCard({ title = 'Make it yours' }: { title?: string }) {
  const { signIn, reload } = useAccount();
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const problem = new URLSearchParams(window.location.search).get('signin');
    if (problem) setMessage(PROBLEMS[problem] ?? null);
  }, []);

  async function submitPasscode(event: FormEvent) {
    event.preventDefault();
    if (!code) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await post('/api/auth/passcode', { passcode: code });
      if (res.ok) return reload();
      setMessage(res.status === 429 ? 'Too many tries. Wait a minute.' : 'That passcode is wrong.');
    } catch {
      setMessage("Couldn't reach the app. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel signin" aria-labelledby="signin-title">
      <h2 id="signin-title">{title}</h2>
      <ul className="perks">
        <li>Add your classes once. Each day it picks the bus that gets you there.</li>
        <li>Your phone tells you when to leave, and which bus gets you home.</li>
        <li>Quiet outside your hours on campus.</li>
      </ul>
      {signIn?.google && (
        <a className="button google" href="/api/auth/google">
          <GoogleLogo />
          Continue with Google
        </a>
      )}
      {signIn?.passcode && (
        <form className="inline-form" onSubmit={submitPasscode}>
          <label className="field">
            <span>Passcode</span>
            <input type="password" autoComplete="current-password" value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <button className="button primary" type="submit" disabled={!code || busy}>
            {busy ? 'Checking…' : 'Unlock'}
          </button>
        </form>
      )}
      {signIn && !signIn.google && !signIn.passcode && <p className="note">Sign-in isn&apos;t set up on this app yet. The live bus above still works.</p>}
      {message && (
        <p className="error" role="alert">
          {message}
        </p>
      )}
      <p className="note">
        Signing in shares your name and email with this app and nothing else. <Link href="/privacy">How your data is used</Link> · <Link href="/terms">Terms</Link>
      </p>
    </section>
  );
}

/** A new account owes the residents' code once, so the app stays for people who live at SoL. */
export function JoinGate() {
  const { reload, signOut, view } = useAccount();
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function join(event: FormEvent) {
    event.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await post('/api/account', { join: code });
      if (res.ok) return reload();
      setMessage(res.status === 429 ? 'Too many tries. Wait a minute.' : "That isn't the residents' code.");
    } catch {
      setMessage("Couldn't reach the app. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel signin" aria-labelledby="join-title">
      <h2 id="join-title">One more step{view?.user.name ? `, ${view.user.name.split(' ')[0]}` : ''}</h2>
      <p className="note">This app is for people who live at SoL. Enter the residents&apos; code from the leasing office or a neighbour. You only do this once.</p>
      <form className="inline-form" onSubmit={join}>
        <label className="field">
          <span>Residents&apos; code</span>
          <input autoCapitalize="none" autoCorrect="off" value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        <button className="button primary" type="submit" disabled={!code.trim() || busy}>
          {busy ? 'Checking…' : 'Continue'}
        </button>
      </form>
      {message && (
        <p className="error" role="alert">
          {message}
        </p>
      )}
      <button className="button quiet" onClick={signOut}>
        Sign out
      </button>
    </section>
  );
}
