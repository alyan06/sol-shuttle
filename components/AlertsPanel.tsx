'use client';

import { useEffect, useState } from 'react';
import { formatClock, inputToMinute as fromTimeInput, minuteToInput as toTimeInput } from '@/lib/time.ts';
import type { AlertPrefs, DailyWatch } from '@/lib/types.ts';
import type { Settings } from './useSettings';

const ALERTS: { key: keyof AlertPrefs; label: string; hint: string; planHint?: string }[] = [
  { key: 'leave', label: 'Time to leave', hint: 'While watching', planHint: 'For each planned bus, and while watching' },
  { key: 'atStop', label: 'Bus at my stop', hint: 'While watching', planHint: 'For each planned bus, and while watching' },
  { key: 'notRunning', label: 'Not running', hint: 'Always' },
  { key: 'firstLast', label: 'First and last bus', hint: 'Always' },
];

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DEFAULT_WINDOW: DailyWatch = { days: [1, 2, 3, 4, 5], startMin: 8 * 60, endMin: 10 * 60 };

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

type Support = 'checking' | 'ready' | 'install' | 'unsupported';

function detectSupport(): Support {
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (ios && !standalone) return 'install';
  return 'serviceWorker' in navigator && 'PushManager' in window ? 'ready' : 'unsupported';
}

type Props = {
  settings: Settings;
  hasStops: boolean;
  /** Today's plan is driving the alerts, so watching by hand is only for extra trips. */
  planning: boolean;
};

export default function AlertsPanel({ settings, hasStops, planning }: Props) {
  const { view, error, setError, update, setView } = settings;
  const [support, setSupport] = useState<Support>('checking');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSupport(detectSupport());
    navigator.serviceWorker?.register('/sw.js').catch(() => undefined);
  }, []);

  async function enable() {
    if (!view?.pushKey) return;
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setError('Notifications are blocked. Turn them on for Shuttle in iPhone Settings.');
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ToBytes(view.pushKey),
      });
      await update({ subscribe: subscription.toJSON() });
    } catch {
      setError("Couldn't turn on alerts on this device. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await update({ unsubscribe: subscription.endpoint });
      await subscription.unsubscribe();
    }
    setView((prev) => prev && { ...prev, subscribed: false });
    setBusy(false);
  }

  if (!view) return null;
  const { prefs } = view;
  const watchActive = view.watchUntil !== null && view.watchUntil > Date.now();
  const daily = prefs.dailyWatch;

  function setDaily(change: Partial<DailyWatch>) {
    update({ prefs: { dailyWatch: { ...(daily ?? DEFAULT_WINDOW), ...change } } });
  }

  return (
    <section className="section" aria-labelledby="alerts-title">
      <h2 id="alerts-title">Alerts</h2>

      {support === 'install' && (
        <p className="callout">
          To get alerts on iPhone, tap Share in Safari, then <strong>Add to Home Screen</strong>, and open Shuttle from there.
        </p>
      )}
      {support === 'unsupported' && <p className="callout">This browser can't receive push alerts.</p>}
      {support === 'ready' && !view.pushKey && (
        <p className="callout">Push isn't set up on the server yet, so alerts can't be delivered.</p>
      )}
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

      <div className="watch">
        <div>
          <h3>{watchActive ? 'Watching the bus' : view.watching ? 'Watching on schedule' : 'Not watching'}</h3>
          <p className="note">
            {watchActive
              ? `Until ${formatClock(view.watchUntil!)}.`
              : planning
                ? 'Your planned buses alert on their own. Watch for a trip that is not in the plan.'
                : 'Leave and arrival alerts only fire while watching, so a loop every half hour stays quiet.'}
          </p>
        </div>
        <button
          className="button"
          aria-pressed={watchActive}
          disabled={!hasStops}
          onClick={() => update({ watchMinutes: watchActive ? 0 : 60 })}
        >
          {watchActive ? 'Stop' : 'Watch 1 hour'}
        </button>
      </div>

      <fieldset className="group">
        <legend>Your walk to the stop</legend>
        <div className="stepper">
          <button
            className="button"
            aria-label="One minute less"
            disabled={prefs.walkMinutes <= 1}
            onClick={() => update({ prefs: { walkMinutes: prefs.walkMinutes - 1 } })}
          >
            −
          </button>
          <output>{prefs.walkMinutes} min</output>
          <button
            className="button"
            aria-label="One minute more"
            disabled={prefs.walkMinutes >= 30}
            onClick={() => update({ prefs: { walkMinutes: prefs.walkMinutes + 1 } })}
          >
            +
          </button>
        </div>
      </fieldset>

      <fieldset className="group">
        <legend>Send me</legend>
        {ALERTS.map(({ key, label, hint, planHint }) => (
          <label className="toggle" key={key}>
            <span>
              {label}
              <small>{planning && planHint ? planHint : hint}</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={prefs.alerts[key]}
              onChange={(e) => update({ prefs: { alerts: { ...prefs.alerts, [key]: e.target.checked } } })}
            />
          </label>
        ))}
        {prefs.alerts.firstLast && view.serviceEndMinute === null && (
          <p className="note">The last-bus alert starts once a few days of service have been seen.</p>
        )}
      </fieldset>

      <fieldset className="group">
        <legend>Watch automatically</legend>
        <label className="toggle">
          <span>On a weekly schedule</span>
          <input
            type="checkbox"
            role="switch"
            checked={daily !== null}
            onChange={(e) => update({ prefs: { dailyWatch: e.target.checked ? DEFAULT_WINDOW : null } })}
          />
        </label>
        {daily && (
          <>
            <div className="days">
              {DAYS.map((letter, day) => (
                <button
                  key={DAY_NAMES[day]}
                  className="day"
                  aria-label={DAY_NAMES[day]}
                  aria-pressed={daily.days.includes(day)}
                  onClick={() =>
                    setDaily({
                      days: daily.days.includes(day) ? daily.days.filter((d) => d !== day) : [...daily.days, day],
                    })
                  }
                >
                  {letter}
                </button>
              ))}
            </div>
            <div className="times">
              <label className="field">
                <span>From</span>
                <input
                  type="time"
                  value={toTimeInput(daily.startMin)}
                  onChange={(e) => e.target.value && setDaily({ startMin: fromTimeInput(e.target.value) })}
                />
              </label>
              <label className="field">
                <span>Until</span>
                <input
                  type="time"
                  value={toTimeInput(daily.endMin)}
                  onChange={(e) => e.target.value && setDaily({ endMin: fromTimeInput(e.target.value) })}
                />
              </label>
            </div>
          </>
        )}
      </fieldset>
    </section>
  );
}
