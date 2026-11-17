'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import type { PlanChange } from '@/app/api/plan/route';
import { ALERTS_AFTER_MIN, ALERTS_BEFORE_MIN } from '@/lib/plan.ts';
import { currentSubscription } from '@/lib/push-client.ts';
import { applyTheme, storedTheme, type ThemeChoice } from '@/lib/theme.ts';
import { formatClock, inputToMinute, minuteToInput } from '@/lib/time.ts';
import type { AlertPrefs, DailyWatch, Schedule } from '@/lib/types.ts';
import { post, useAccount } from './Account';
import { TopBar } from './AppShell';
import { DayPicker, Segmented, Stepper, Toggle } from './controls';
import { JoinGate, SignInCard } from './SignIn';

const ALERTS: { key: keyof AlertPrefs; label: string; hint: string }[] = [
  { key: 'leave', label: 'Time to leave', hint: 'A heads-up, then the moment to go, for each bus in your plan' },
  { key: 'afterClass', label: 'Bus home after class', hint: 'From 15 min before each class ends, then every bus after your last one' },
  { key: 'atStop', label: 'Bus at my stop', hint: 'When the bus you’re catching pulls in and out' },
  { key: 'notRunning', label: 'Not running', hint: 'If the bus goes quiet or stops moving during service' },
  { key: 'firstLast', label: 'First and last bus', hint: 'When service starts, and when the last loop is under way' },
];

const PACES = [
  { value: 70, label: 'Easy' },
  { value: 80, label: 'Steady' },
  { value: 92, label: 'Brisk' },
];
const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
const DEFAULT_WINDOW: DailyWatch = { days: [1, 2, 3, 4, 5], startMin: 8 * 60, endMin: 10 * 60 };

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

type Support = 'checking' | 'ready' | 'install' | 'unsupported';

function detectSupport(): Support {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (ios && !standalone) return 'install';
  return 'serviceWorker' in navigator && 'PushManager' in window ? 'ready' : 'unsupported';
}

function hours(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const whole = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${whole} hr` : `${whole} hr ${rest}`;
}

export function ThemePicker() {
  const [theme, setTheme] = useState<ThemeChoice>('system');
  useEffect(() => setTheme(storedTheme()), []);
  return (
    <Segmented<ThemeChoice>
      label="Appearance"
      options={THEMES}
      value={theme}
      onPick={(choice) => {
        setTheme(choice);
        applyTheme(choice);
      }}
    />
  );
}

export default function SettingsPage() {
  const account = useAccount();
  const { view, error, setError, update, setView } = account;
  const joined = account.status === 'ready' && view!.user.joined;
  const [support, setSupport] = useState<Support>('checking');
  const [busy, setBusy] = useState(false);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [passcode, setPasscode] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setSupport(detectSupport());
    navigator.serviceWorker?.register('/sw.js').catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!joined) return;
    let cancelled = false;
    fetch('/api/plan', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { schedule: Schedule } | null) => !cancelled && body && setSchedule(body.schedule))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [joined]);

  async function saveWalking(change: Pick<Partial<Schedule>, 'paceMPerMin' | 'arriveEarlyMin'>) {
    if (!schedule) return;
    const before = schedule;
    setSchedule({ ...schedule, ...change });
    try {
      const body: PlanChange = { schedule: change };
      const res = await post('/api/plan', body);
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setSchedule(before);
      setError("Couldn't save that. Check your connection and try again.");
    }
  }

  async function enable() {
    if (!view?.pushKey) return;
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setError('Notifications are blocked. Turn them on for Shuttle in your phone’s Settings.');
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(view.pushKey) });
      await update({ subscribe: subscription.toJSON() });
    } catch {
      setError("Couldn't turn on alerts on this device. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    const subscription = await currentSubscription(navigator);
    if (subscription) {
      await update({ unsubscribe: subscription.endpoint });
      await subscription.unsubscribe?.();
    }
    setView((prev) => prev && { ...prev, subscribed: false });
    setBusy(false);
  }

  async function claim(event: FormEvent) {
    event.preventDefault();
    if (!passcode) return;
    setNote(null);
    const res = await post('/api/account', { claim: passcode }).catch(() => null);
    if (res?.ok) {
      setPasscode('');
      setNote('Done. Your classes and settings are now on this account.');
      account.reload();
    } else {
      setNote(res?.status === 404 ? 'There’s nothing left to bring over.' : res?.status === 429 ? 'Too many tries. Wait a minute.' : 'That passcode is wrong.');
    }
  }

  async function deleteAccount() {
    setBusy(true);
    const subscription = await currentSubscription(navigator);
    await subscription?.unsubscribe?.().catch(() => undefined);
    const res = await post('/api/account', {}, 'DELETE').catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setConfirmDelete(false);
      account.reload();
    } else {
      setError("Couldn't delete the account. Try again.");
    }
  }

  const head = (
    <header className="page-head">
      <h1>Settings</h1>
    </header>
  );

  if (account.status !== 'ready' || !view || !joined) {
    return (
      <main className="page">
        <TopBar />
        {head}
        <div className="stack">
          {account.status === 'signed-out' && <SignInCard title="Sign in for alerts and your own settings" />}
          {account.status === 'ready' && <JoinGate />}
          {account.status === 'loading' && <p className="note">Loading…</p>}
          {account.status === 'failed' && (
            <button className="button" onClick={account.reload}>
              Couldn&apos;t load your account. Try again
            </button>
          )}
          <section className="group" aria-labelledby="look-title">
            <h2 id="look-title">Appearance</h2>
            <div className="setting">
              <span>Theme</span>
              <ThemePicker />
            </div>
          </section>
          <p className="note fine">
            <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link>
          </p>
        </div>
      </main>
    );
  }

  const { prefs } = view;
  const daily = prefs.dailyWatch;
  const before = prefs.alertsBeforeMin ?? ALERTS_BEFORE_MIN;
  const after = prefs.alertsAfterMin ?? ALERTS_AFTER_MIN;
  const setDaily = (change: Partial<DailyWatch>) => update({ prefs: { dailyWatch: { ...(daily ?? DEFAULT_WINDOW), ...change } } });

  return (
    <main className="page">
      <TopBar />
      {head}
      <div className="stack">
        <section className="group" aria-labelledby="alerts-title">
          <h2 id="alerts-title">Alerts on this phone</h2>
          {support === 'install' && (
            <p className="callout">
              To get alerts on an iPhone, open this page in Safari, tap Share, then <strong>Add to Home Screen</strong>, and open Shuttle from there.
            </p>
          )}
          {support === 'unsupported' && <p className="callout">This browser can&apos;t receive push alerts.</p>}
          {support === 'ready' && !view.pushKey && <p className="callout">Push isn&apos;t set up on the server yet, so alerts can&apos;t be delivered.</p>}
          {support === 'ready' && view.pushKey && !view.subscribed && (
            <button className="button primary" onClick={enable} disabled={busy}>
              {busy ? 'Turning on…' : 'Turn on alerts for this phone'}
            </button>
          )}
          {support === 'ready' && view.subscribed && (
            <div className="button-row">
              <button className="button" onClick={() => update({ test: true })}>
                Send a test alert
              </button>
              <button className="button quiet" onClick={disable} disabled={busy}>
                Turn off
              </button>
            </div>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="rows">
            {ALERTS.map(({ key, label, hint }) => (
              <Toggle key={key} label={label} hint={hint} checked={prefs.alerts[key] ?? true} onChange={(on) => update({ prefs: { alerts: { ...prefs.alerts, [key]: on } } })} />
            ))}
          </div>
          {prefs.alerts.firstLast && view.serviceEndMinute === null && <p className="note">The last-bus alert starts once a few days of service have been seen.</p>}
        </section>

        <section className="group" aria-labelledby="hours-title">
          <h2 id="hours-title">Quiet outside your day</h2>
          <p className="note">Alerts only come around your time on campus. Days with nothing planned are silent.</p>
          <div className="setting">
            <span>Start before your first class</span>
            <Stepper label="Alerts start before your first class" value={before} unit="" format={hours} min={30} max={240} step={15} onChange={(alertsBeforeMin) => update({ prefs: { alertsBeforeMin } })} />
          </div>
          <div className="setting">
            <span>Stop after your last class</span>
            <Stepper label="Alerts stop after your last class" value={after} unit="" format={hours} min={15} max={240} step={15} onChange={(alertsAfterMin) => update({ prefs: { alertsAfterMin } })} />
          </div>
        </section>

        <section className="group" aria-labelledby="walk-title">
          <h2 id="walk-title">Getting to the bus</h2>
          <div className="setting">
            <span>
              Your door to the SoL stop
              <small>How long the walk takes you</small>
            </span>
            <Stepper label="Walk from your apartment to the SoL stop" value={prefs.walkMinutes} unit="min" min={1} max={30} onChange={(walkMinutes) => update({ prefs: { walkMinutes } })} />
          </div>
          <div className="setting">
            <span>
              Spare time at the stop
              <small>Be there this long before the bus</small>
            </span>
            <Stepper label="Spare minutes at the stop" value={prefs.bufferMinutes} unit="min" min={0} max={10} onChange={(bufferMinutes) => update({ prefs: { bufferMinutes } })} />
          </div>
          {schedule && (
            <>
              <div className="setting">
                <span>
                  In the room before class
                  <small>Counted into which bus you need</small>
                </span>
                <Stepper label="Minutes early to class" value={schedule.arriveEarlyMin} unit="min" min={0} max={20} onChange={(arriveEarlyMin) => saveWalking({ arriveEarlyMin })} />
              </div>
              <div className="setting">
                <span>
                  Walking pace
                  <small>For the walk between the stop and your buildings</small>
                </span>
                <Segmented<number> label="Walking pace" value={schedule.paceMPerMin} options={PACES} onPick={(paceMPerMin) => saveWalking({ paceMPerMin })} />
              </div>
            </>
          )}
        </section>

        <section className="group" aria-labelledby="watch-title">
          <h2 id="watch-title">Watch a bus without a class</h2>
          <p className="note">For a regular trip that isn&apos;t in your classes. While watching, you get the leave and arrival alerts for the stop picked on Today.</p>
          <Toggle label="Watch on a weekly schedule" checked={daily !== null} onChange={(on) => update({ prefs: { dailyWatch: on ? DEFAULT_WINDOW : null } })} />
          {daily && (
            <>
              <DayPicker label="Days to watch" days={daily.days} onChange={(days) => setDaily({ days })} />
              <div className="pair">
                <label className="field">
                  <span>From</span>
                  <input type="time" value={minuteToInput(daily.startMin)} onChange={(e) => e.target.value && setDaily({ startMin: inputToMinute(e.target.value) })} />
                </label>
                <label className="field">
                  <span>Until</span>
                  <input type="time" value={minuteToInput(daily.endMin)} onChange={(e) => e.target.value && setDaily({ endMin: inputToMinute(e.target.value) })} />
                </label>
              </div>
            </>
          )}
          {view.watchUntil !== null && view.watchUntil > Date.now() && <p className="note">Watching now, until {formatClock(view.watchUntil)}.</p>}
        </section>

        <section className="group" aria-labelledby="look-title">
          <h2 id="look-title">Appearance</h2>
          <div className="setting">
            <span>Theme</span>
            <ThemePicker />
          </div>
        </section>

        <section className="group" aria-labelledby="account-title">
          <h2 id="account-title">Account</h2>
          <p className="identity">
            <strong>{view.user.name ?? 'Signed in'}</strong>
            {view.user.email && <span>{view.user.email}</span>}
          </p>
          <p className="note">
            Alerts go to {view.devices === 0 ? 'no devices yet' : view.devices === 1 ? '1 device' : `${view.devices} devices`}. Your classes are seen only by you.
          </p>
          <div className="button-row wrap">
            <button className="button" onClick={account.signOut}>
              Sign out
            </button>
            <button className="button danger" onClick={() => setConfirmDelete(true)}>
              Delete my account
            </button>
          </div>
          {confirmDelete && (
            <div className="callout danger" role="alertdialog" aria-labelledby="delete-title">
              <strong id="delete-title">Delete your account?</strong>
              <p>Your classes, settings and alert devices are erased now and can&apos;t be brought back. The live bus stays open to you.</p>
              <div className="button-row">
                <button className="button danger solid" onClick={deleteAccount} disabled={busy}>
                  {busy ? 'Deleting…' : 'Delete everything'}
                </button>
                <button className="button quiet" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </button>
              </div>
            </div>
          )}
          {view.user.canClaim && (
            <form className="inline-form" onSubmit={claim}>
              <label className="field">
                <span>Used the passcode version? Bring your classes over</span>
                <input type="password" autoComplete="off" value={passcode} placeholder="Old passcode" onChange={(e) => setPasscode(e.target.value)} />
              </label>
              <button className="button" type="submit" disabled={!passcode}>
                Bring over
              </button>
            </form>
          )}
          {note && (
            <p className="note" role="status">
              {note}
            </p>
          )}
        </section>

        <p className="note fine">
          <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link>. Not run by SoL, ASU or Samsara. Times are estimates.
        </p>
      </div>
    </main>
  );
}
