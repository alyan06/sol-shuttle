'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlanChange } from '@/app/api/plan/route';
import buildingList from '@/lib/buildings.json';
import { CAMPUS, allPlaces, walkKey, walkMinutes } from '@/lib/schedule.ts';
import { formatMinute, inputToMinute, minuteToInput } from '@/lib/time.ts';
import type { ClassBlock, Place, Route, Schedule } from '@/lib/types.ts';
import { post, useAccount } from './Account';
import { TopBar } from './AppShell';
import { DayPicker, Stepper } from './controls';
import { JoinGate, SignInCard } from './SignIn';

type Building = { code: string; name: string; lat: number; lng: number };
const BUILDINGS = buildingList as Building[];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

/** A stable id for a building from ASU's list. Codes repeat (two wings share one), so the name is folded in. */
function buildingId(building: Building): string {
  let hash = 0;
  for (const char of building.name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `b:${building.code}-${hash.toString(36)}`.slice(0, 40);
}

function daysLabel(days: number[]): string {
  if (days.length === 0) return 'No days yet';
  if (days.join() === '1,2,3,4,5') return 'Weekdays';
  if (days.length === 7) return 'Every day';
  return days.map((day) => DAY_SHORT[day]).join(', ');
}

/** The first other block that shares a day and overlaps in time, if any. */
function overlap(block: ClassBlock, all: ClassBlock[]): { other: ClassBlock; day: number } | null {
  for (const other of all) {
    if (other.id === block.id) continue;
    const day = block.days.find((d) => other.days.includes(d));
    if (day !== undefined && block.startMin < other.endMin && other.startMin < block.endMin) return { other, day };
  }
  return null;
}

type Draft = ClassBlock & { isNew: boolean; walkMin: number | null; place: Place | null };

function BuildingSearch({ own, allowStop, onPick, onBack }: { own: Place[]; allowStop: boolean; onPick: (place: Place | null) => void; onBack: () => void }) {
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = useMemo(() => {
    if (words.length === 0) return BUILDINGS;
    const scored = BUILDINGS.flatMap((building) => {
      const name = building.name.toLowerCase();
      const code = building.code.toLowerCase();
      if (!words.every((word) => name.includes(word) || code.startsWith(word))) return [];
      // What's printed on a class schedule is the code, so a code match comes first.
      return [{ building, rank: code === words[0] ? 0 : code.startsWith(words[0]) ? 1 : 2 }];
    });
    return scored.sort((a, b) => a.rank - b.rank).map((entry) => entry.building);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  const custom = own.filter((place) => !place.id.startsWith('b:') && (words.length === 0 || words.every((word) => place.name.toLowerCase().includes(word))));

  return (
    <div className="picker">
      <div className="picker-head">
        <button type="button" className="button quiet small" onClick={onBack}>
          Back
        </button>
        <label className="field grow">
          <span className="visually-hidden">Search ASU buildings</span>
          <input ref={input} type="search" value={query} placeholder="Search by name or code, like COOR" enterKeyHint="search" onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      <ul className="picker-list">
        {allowStop && words.length === 0 && (
          <li>
            <button type="button" onClick={() => onPick(null)}>
              <span>The Gammage stop</span>
              <small>No walk</small>
            </button>
          </li>
        )}
        {custom.map((place) => (
          <li key={place.id}>
            <button type="button" onClick={() => onPick(place)}>
              <span>{place.name}</span>
              <small>Yours</small>
            </button>
          </li>
        ))}
        {matches.map((building) => (
          <li key={`${building.code}:${building.name}`}>
            <button type="button" onClick={() => onPick({ id: buildingId(building), name: building.name, code: building.code, lat: building.lat, lng: building.lng })}>
              <span>{building.name}</span>
              <small>{building.code}</small>
            </button>
          </li>
        ))}
        {matches.length === 0 && custom.length === 0 && <li className="picker-empty">No Tempe campus building matches that. Try the code from your class schedule.</li>}
      </ul>
    </div>
  );
}

export default function ScheduleEditor({ route }: { route: Route }) {
  const account = useAccount();
  const joined = account.status === 'ready' && account.view!.user.joined;
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!joined) return;
    let cancelled = false;
    fetch('/api/plan', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { schedule: Schedule };
        if (!cancelled) {
          setSchedule(body.schedule);
          setStatus('ready');
        }
      })
      .catch(() => !cancelled && setStatus('failed'));
    return () => {
      cancelled = true;
    };
  }, [joined]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (draft && !element.open) element.showModal();
    if (!draft && element.open) element.close();
  }, [draft]);

  const places = useMemo(() => (schedule ? allPlaces(schedule, route) : []), [schedule, route]);
  const sorted = useMemo(
    () => [...(schedule?.classes ?? [])].sort((a, b) => (a.days[0] ?? 7) - (b.days[0] ?? 7) || a.startMin - b.startMin),
    [schedule],
  );

  function open(block: ClassBlock | null, kind: 'class' | 'visit' = 'class') {
    setMessage(null);
    setPicking(false);
    if (block) {
      const place = schedule!.places.find((p) => p.id === block.placeId) ?? null;
      setDraft({ ...block, isNew: false, walkMin: null, place });
      return;
    }
    const last = sorted.filter((c) => (c.kind ?? 'class') === kind).at(-1);
    const startMin = kind === 'class' ? 9 * 60 : 10 * 60;
    setDraft({
      id: newId('c'),
      course: '',
      placeId: kind === 'visit' ? CAMPUS : '',
      startMin,
      endMin: startMin + (kind === 'class' ? 75 : 120),
      days: last?.days ?? (kind === 'class' ? [1, 3] : [5]),
      ...(kind === 'visit' ? { kind: 'visit' as const } : {}),
      isNew: true,
      walkMin: null,
      place: null,
    });
  }

  const edit = (change: Partial<Draft>) => setDraft((current) => current && { ...current, ...change });

  /** Sends the whole schedule with one block added, changed or removed. Buildings nothing meets in are dropped. */
  async function commit(classes: ClassBlock[], extraPlace: Place | null, walk: { placeId: string; minutes: number } | null) {
    if (!schedule) return;
    setSaving(true);
    setMessage(null);
    const known = new Map(schedule.places.map((place) => [place.id, place]));
    if (extraPlace) known.set(extraPlace.id, extraPlace);
    const used = new Set(classes.map((block) => block.placeId));
    const nextPlaces = [...known.values()].filter((place) => used.has(place.id));
    const walkOverrides = { ...schedule.walkOverrides };
    if (walk) walkOverrides[walkKey(CAMPUS, walk.placeId)] = walk.minutes;
    try {
      const body: PlanChange = { schedule: { places: nextPlaces, classes, walkOverrides } };
      const res = await post('/api/plan', body);
      if (!res.ok) throw new Error(String(res.status));
      setSchedule(((await res.json()) as { schedule: Schedule }).schedule);
      setDraft(null);
    } catch {
      setMessage("Couldn't save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  function save() {
    if (!draft || !schedule) return;
    const visit = draft.kind === 'visit';
    if (!visit && !draft.course.trim()) return setMessage('Give the class a name, like CSE 240.');
    if (draft.days.length === 0) return setMessage('Pick at least one day.');
    if (draft.endMin <= draft.startMin) return setMessage('It has to end after it starts.');
    if (!draft.placeId) return setMessage('Choose the building it meets in.');
    const { isNew: _new, walkMin, place, ...block } = draft;
    const rest = schedule.classes.filter((c) => c.id !== block.id);
    const walk = walkMin !== null && block.placeId !== CAMPUS ? { placeId: block.placeId, minutes: walkMin } : null;
    commit([...rest, { ...block, course: block.course.trim() }], place, walk);
  }

  if (account.status !== 'ready' || !joined) {
    return (
      <main className="page">
        <TopBar />
        <header className="page-head">
          <h1>Classes</h1>
          <p>When you need to be on campus. The bus there and back is planned around it.</p>
        </header>
        <div className="stack">
          {account.status === 'signed-out' && <SignInCard title="Sign in to add your classes" />}
          {account.status === 'ready' && <JoinGate />}
          {account.status === 'loading' && <p className="note">Loading…</p>}
          {account.status === 'failed' && (
            <button className="button" onClick={account.reload}>
              Couldn&apos;t load your account. Try again
            </button>
          )}
        </div>
      </main>
    );
  }

  const draftPlaceName = draft ? (draft.placeId === CAMPUS ? 'The Gammage stop' : (draft.place?.name ?? places.find((p) => p.id === draft.placeId)?.name ?? '')) : '';
  const estimate = draft && schedule && draft.placeId && draft.placeId !== CAMPUS ? walkMinutes(schedule, draft.place ? [...places, draft.place] : places, CAMPUS, draft.placeId) : null;

  return (
    <main className="page">
      <TopBar />
      <header className="page-head">
        <h1>Classes</h1>
        <p>When you need to be on campus. The bus there and back is planned around it.</p>
      </header>

      <div className="stack">
        {status === 'loading' && <p className="note">Loading your classes…</p>}
        {status === 'failed' && <p className="error">Couldn&apos;t load your classes. Reload to try again.</p>}

        {status === 'ready' && schedule && (
          <>
            {sorted.length === 0 ? (
              <section className="panel empty">
                <h2>Nothing here yet</h2>
                <p className="note">Add each class with its days, times and building. On those days the app picks the bus that gets you there, and tells you which one gets you home.</p>
              </section>
            ) : (
              <ul className="blocks">
                {sorted.map((block) => {
                  const clash = overlap(block, sorted);
                  const place = block.placeId === CAMPUS ? 'Gammage stop' : (places.find((p) => p.id === block.placeId)?.name ?? 'No building');
                  const walk = block.placeId === CAMPUS ? null : walkMinutes(schedule, places, CAMPUS, block.placeId);
                  return (
                    <li key={block.id}>
                      <button className="block" onClick={() => open(block)}>
                        <span className="block-top">
                          <strong>{block.course || 'On campus'}</strong>
                          <span className="block-days">{daysLabel(block.days)}</span>
                        </span>
                        <span className="block-line">
                          {formatMinute(block.startMin)} to {formatMinute(block.endMin)}
                        </span>
                        <span className="block-line muted">
                          {[place, block.room].filter(Boolean).join(', ')}
                          {walk !== null && ` · ${walk} min from the stop`}
                          {block.until && ` · until ${block.until}`}
                        </span>
                        {clash && (
                          <span className="block-warn">
                            Overlaps {clash.other.course || 'another time'} on {DAY_NAMES[clash.day]}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="button-row wrap">
              <button className="button primary" onClick={() => open(null, 'class')}>
                Add a class
              </button>
              <button className="button" onClick={() => open(null, 'visit')}>
                Add other time on campus
              </button>
            </div>
            <p className="note fine">Other time on campus is for anything that isn&apos;t a class: the library, a job, a club. You get the same bus there, bus home and alerts.</p>
          </>
        )}
      </div>

      <dialog ref={dialog} className="sheet" onClose={() => setDraft(null)} aria-labelledby="sheet-title">
        {draft && picking && (
          <BuildingSearch
            own={schedule?.places ?? []}
            allowStop={draft.kind === 'visit'}
            onBack={() => setPicking(false)}
            onPick={(place) => {
              edit({ placeId: place?.id ?? CAMPUS, place, walkMin: null });
              setPicking(false);
            }}
          />
        )}
        {draft && !picking && (
          <form
            className="sheet-form"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <h2 id="sheet-title">{draft.isNew ? (draft.kind === 'visit' ? 'Time on campus' : 'New class') : draft.course || 'Time on campus'}</h2>

            <label className="field">
              <span>{draft.kind === 'visit' ? 'What for (optional)' : 'Class'}</span>
              <input value={draft.course} maxLength={60} placeholder={draft.kind === 'visit' ? 'Library' : 'CSE 240'} onChange={(e) => edit({ course: e.target.value })} />
            </label>

            <div className="field">
              <span>Days</span>
              <DayPicker label="Days" days={draft.days} onChange={(days) => edit({ days })} />
            </div>

            <div className="pair">
              <label className="field">
                <span>{draft.kind === 'visit' ? 'Be there by' : 'Starts'}</span>
                <input type="time" value={minuteToInput(draft.startMin)} onChange={(e) => e.target.value && edit({ startMin: inputToMinute(e.target.value) })} />
              </label>
              <label className="field">
                <span>{draft.kind === 'visit' ? 'Head back at' : 'Ends'}</span>
                <input type="time" value={minuteToInput(draft.endMin)} onChange={(e) => e.target.value && edit({ endMin: inputToMinute(e.target.value) })} />
              </label>
            </div>

            <div className="field">
              <span>Building</span>
              <button type="button" className="button select" onClick={() => setPicking(true)}>
                {draftPlaceName || 'Choose a building'}
              </button>
            </div>

            {draft.kind !== 'visit' && (
              <label className="field">
                <span>Room (optional)</span>
                <input value={draft.room ?? ''} maxLength={20} placeholder="210" onChange={(e) => edit({ room: e.target.value || undefined })} />
              </label>
            )}

            {estimate !== null && (
              <div className="setting">
                <span>
                  Walk from the Gammage stop
                  <small>{draft.walkMin === null ? 'Our estimate. Correct it once you’ve walked it.' : 'Your own time.'}</small>
                </span>
                <Stepper label="Walk from the Gammage stop" value={draft.walkMin ?? estimate} unit="min" min={1} max={40} onChange={(walkMin) => edit({ walkMin })} />
              </div>
            )}

            <label className="field">
              <span>Last day it meets (optional)</span>
              <input type="date" value={draft.until ?? ''} onChange={(e) => edit({ until: e.target.value || undefined })} />
            </label>

            {message && (
              <p className="error" role="alert">
                {message}
              </p>
            )}

            <div className="sheet-actions">
              {!draft.isNew && (
                <button type="button" className="button danger" disabled={saving} onClick={() => commit(schedule!.classes.filter((c) => c.id !== draft.id), null, null)}>
                  Delete
                </button>
              )}
              <button type="button" className="button quiet" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button type="submit" className="button primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </main>
  );
}
