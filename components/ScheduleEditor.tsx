'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { PlanChange } from '@/app/api/plan/route';
import { CAMPUS, GYM, HOME, allPlaces, walkKey, walkMinutes } from '@/lib/schedule.ts';
import { inputToMinute, minuteToInput } from '@/lib/time.ts';
import type { AfterClass, ClassBlock, Evening, Pattern, Place, Route, Schedule } from '@/lib/types.ts';
import { storePasscode, storedPasscode } from './useSettings';

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PACES = [
  { value: 70, label: 'Easy' },
  { value: 80, label: 'Steady' },
  { value: 92, label: 'Brisk' },
];
/** Roughly the Tempe campus, so a building search can't wander off to another city. */
const CAMPUS_BOX = '-111.946,33.4275,-111.924,33.4105';

type Found = { name: string; where: string; lat: number; lng: number };

const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

async function findBuilding(query: string): Promise<Found[]> {
  const pasted = query.match(/^\s*(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/);
  if (pasted) return [{ name: 'Pasted location', where: '', lat: Number(pasted[1]), lng: Number(pasted[2]) }];
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({ q: query, format: 'json', limit: '5', viewbox: CAMPUS_BOX, bounded: '1' }).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  const rows = (await res.json()) as { display_name: string; lat: string; lon: string }[];
  return rows.map((row) => {
    // "Hayden Library, 300, East Orange Mall, Tempe, ...": the name, then the street past any house number.
    const [name, ...rest] = row.display_name.split(',').map((part) => part.trim());
    return { name, where: rest.find((part) => !/^\d+$/.test(part)) ?? '', lat: Number(row.lat), lng: Number(row.lon) };
  });
}

function DayPicker({ label, days, onChange }: { label: string; days: number[]; onChange: (days: number[]) => void }) {
  return (
    <div className="days" role="group" aria-label={label}>
      {DAYS.map((letter, day) => (
        <button
          key={DAY_NAMES[day]}
          type="button"
          className="day"
          aria-label={DAY_NAMES[day]}
          aria-pressed={days.includes(day)}
          onClick={() => onChange(days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort())}
        >
          {letter}
        </button>
      ))}
    </div>
  );
}

function Stepper({ value, unit, min, max, step = 1, onChange, label }: { value: number; unit: string; min: number; max: number; step?: number; onChange: (value: number) => void; label: string }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" className="button" aria-label="Less" disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}>
        −
      </button>
      <output>
        {value} {unit}
      </output>
      <button type="button" className="button" aria-label="More" disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}>
        +
      </button>
    </div>
  );
}

function Segmented<T extends string | number>({ label, options, value, onPick }: { label: string; options: { value: T; label: string }[]; value: T; onPick: (value: T) => void }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={String(option.value)} type="button" aria-pressed={option.value === value} onClick={() => onPick(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export default function ScheduleEditor({ route }: { route: Route }) {
  const [passcode, setPasscode] = useState<string | null>(null);
  const [draftCode, setDraftCode] = useState('');
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [status, setStatus] = useState<'loading' | 'locked' | 'ready' | 'failed'>('loading');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [found, setFound] = useState<Found[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => setPasscode(storedPasscode()), []);

  useEffect(() => {
    if (passcode === null) return;
    let cancelled = false;
    fetch('/api/plan', { cache: 'no-store', headers: { 'x-passcode': passcode } })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) return setStatus('locked');
        if (!res.ok) throw new Error(String(res.status));
        setSchedule(((await res.json()) as { schedule: Schedule }).schedule);
        setStatus('ready');
      })
      .catch(() => !cancelled && setStatus('failed'));
    return () => {
      cancelled = true;
    };
  }, [passcode]);

  const places = useMemo(() => (schedule ? allPlaces(schedule, route) : []), [schedule, route]);

  function edit(change: Partial<Schedule>) {
    setSchedule((current) => current && { ...current, ...change });
    setDirty(true);
    setMessage(null);
  }

  function editPattern(id: string, change: Partial<Pattern>) {
    edit({ patterns: schedule!.patterns.map((p) => (p.id === id ? { ...p, ...change } : p)) });
  }

  function editClass(patternId: string, classId: string, change: Partial<ClassBlock>) {
    const pattern = schedule!.patterns.find((p) => p.id === patternId)!;
    editPattern(patternId, { classes: pattern.classes.map((c) => (c.id === classId ? { ...c, ...change } : c)) });
  }

  function addClass(pattern: Pattern) {
    const last = pattern.classes.at(-1);
    const startMin = last ? Math.min(last.endMin + 15, 22 * 60) : 9 * 60;
    const block: ClassBlock = { id: newId('c'), course: '', placeId: schedule!.places[0]?.id ?? '', startMin, endMin: startMin + 75 };
    editPattern(pattern.id, { classes: [...pattern.classes, block] });
  }

  function setWalk(a: string, b: string, minutes: number) {
    edit({ walkOverrides: { ...schedule!.walkOverrides, [walkKey(a, b)]: minutes } });
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setFound(null);
    try {
      setFound(await findBuilding(query));
    } catch {
      setMessage("Couldn't search right now. Paste the building's coordinates instead, like 33.4236, -111.9397.");
    } finally {
      setSearching(false);
    }
  }

  function addPlace(hit: Found) {
    const place: Place = { id: newId('p'), name: newName.trim() || hit.name, lat: hit.lat, lng: hit.lng };
    edit({ places: [...schedule!.places, place] });
    setFound(null);
    setQuery('');
    setNewName('');
  }

  function removePlace(id: string) {
    const used = schedule!.patterns.some((p) => p.classes.some((c) => c.placeId === id));
    if (used) return setMessage('A class still meets in that building. Move the class first.');
    edit({ places: schedule!.places.filter((p) => p.id !== id) });
  }

  async function save() {
    if (!schedule) return;
    const unplaced = schedule.patterns.flatMap((p) => p.classes).find((c) => !c.course.trim() || !c.placeId || c.endMin <= c.startMin);
    if (unplaced) return setMessage('Each class needs a name, a building, and an end time after its start.');
    setSaving(true);
    setMessage(null);
    try {
      const { override: _today, ...rest } = schedule;
      const body: PlanChange = { schedule: rest };
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-passcode': passcode ?? '' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      setDirty(false);
      setMessage('Saved.');
    } catch {
      setMessage("Couldn't save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (status === 'locked') {
    return (
      <main className="app single">
        <form
          className="section gate"
          onSubmit={(event) => {
            event.preventDefault();
            storePasscode(draftCode);
            setStatus('loading');
            setPasscode(draftCode);
          }}
        >
          <h2>Your schedule is locked</h2>
          <label className="field">
            <span>Passcode</span>
            <input type="password" autoComplete="current-password" value={draftCode} onChange={(e) => setDraftCode(e.target.value)} />
          </label>
          {passcode && <p className="error">That passcode is wrong.</p>}
          <button className="button primary" type="submit" disabled={!draftCode}>
            Unlock
          </button>
        </form>
      </main>
    );
  }

  if (status !== 'ready' || !schedule) {
    return (
      <main className="app single">
        <p className="section note">{status === 'failed' ? "Couldn't load your schedule. Reload to try again." : 'Loading your schedule…'}</p>
      </main>
    );
  }

  const { gym } = schedule;
  const walk = (a: string, b: string) => walkMinutes(schedule, places, a, b);

  return (
    <main className="app single">
      <header className="top">
        <Link className="text-link" href="/">
          Back to today
        </Link>
        <span className="freshness">{dirty ? 'Unsaved changes' : ''}</span>
      </header>
      <section className="answer">
        <h1 className="page-title">Schedule</h1>
        <p className="answer-detail">Kept in your private database, behind the passcode. It never goes into the app's public code.</p>
      </section>

      <section className="section" aria-labelledby="buildings-title">
        <h2 id="buildings-title">Buildings</h2>
        <p className="note">Add each building you have a class in. The walk from Gammage is an estimate until you correct it.</p>
        {schedule.places.length > 0 && (
          <ul className="rows">
            {schedule.places.map((place) => (
              <li key={place.id}>
                <input
                  className="bare"
                  aria-label="Building name"
                  value={place.name}
                  onChange={(e) => edit({ places: schedule.places.map((p) => (p.id === place.id ? { ...p, name: e.target.value } : p)) })}
                />
                <button type="button" className="button quiet small" onClick={() => removePlace(place.id)}>
                  Remove
                </button>
                <span className="note">Walk from Gammage</span>
                <Stepper label={`Walk from Gammage to ${place.name}`} value={walk(CAMPUS, place.id)} unit="min" min={1} max={40} onChange={(v) => setWalk(CAMPUS, place.id, v)} />
              </li>
            ))}
          </ul>
        )}
        <form className="finder" onSubmit={search}>
          <label className="field">
            <span>Find a building on campus</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Coor Hall" enterKeyHint="search" />
          </label>
          <label className="field">
            <span>Call it</span>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="COOR" />
          </label>
          <button className="button" type="submit" disabled={searching || !query.trim()}>
            {searching ? 'Searching…' : 'Find'}
          </button>
        </form>
        {found && found.length === 0 && <p className="note">Nothing on campus by that name. Try the full building name, or paste coordinates from a maps app.</p>}
        {found && found.length > 0 && (
          <ul className="results">
            {found.map((hit) => (
              <li key={`${hit.lat},${hit.lng}`}>
                <button type="button" className="button" onClick={() => addPlace(hit)}>
                  Add {hit.name}
                  {hit.where && <small> on {hit.where}</small>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {schedule.patterns.map((pattern) => (
        <section className="section" key={pattern.id} aria-label={pattern.name}>
          <h2>{pattern.name}</h2>
          <DayPicker label={`Days for ${pattern.name}`} days={pattern.days} onChange={(days) => editPattern(pattern.id, { days })} />
          {pattern.classes.map((block) => (
            <fieldset className="class-card" key={block.id}>
              <legend className="visually-hidden">{block.course || 'New class'}</legend>
              <div className="times">
                <label className="field">
                  <span>Class</span>
                  <input value={block.course} placeholder="CSE 205" onChange={(e) => editClass(pattern.id, block.id, { course: e.target.value })} />
                </label>
                <label className="field">
                  <span>Room</span>
                  <input value={block.room ?? ''} placeholder="Optional" onChange={(e) => editClass(pattern.id, block.id, { room: e.target.value || undefined })} />
                </label>
              </div>
              <label className="field">
                <span>Building</span>
                <select value={block.placeId} onChange={(e) => editClass(pattern.id, block.id, { placeId: e.target.value })}>
                  <option value="" disabled>
                    {schedule.places.length > 0 ? 'Choose a building' : 'Add a building above first'}
                  </option>
                  {schedule.places.map((place) => (
                    <option key={place.id} value={place.id}>
                      {place.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="times">
                <label className="field">
                  <span>Starts</span>
                  <input type="time" value={minuteToInput(block.startMin)} onChange={(e) => e.target.value && editClass(pattern.id, block.id, { startMin: inputToMinute(e.target.value) })} />
                </label>
                <label className="field">
                  <span>Ends</span>
                  <input type="time" value={minuteToInput(block.endMin)} onChange={(e) => e.target.value && editClass(pattern.id, block.id, { endMin: inputToMinute(e.target.value) })} />
                </label>
              </div>
              <button type="button" className="button quiet small" onClick={() => editPattern(pattern.id, { classes: pattern.classes.filter((c) => c.id !== block.id) })}>
                Remove class
              </button>
            </fieldset>
          ))}
          <button type="button" className="button" onClick={() => addClass(pattern)}>
            Add a class
          </button>
        </section>
      ))}

      <section className="section" aria-labelledby="gym-title">
        <h2 id="gym-title">Gym</h2>
        <p className="note">Sun Devil Fitness Complex. Days left off are rest days: the plan is just the bus home.</p>
        <DayPicker label="Gym days" days={gym.days} onChange={(days) => edit({ gym: { ...gym, days } })} />
        <div className="setting">
          <span>Workout length</span>
          <Stepper label="Workout length" value={gym.workoutMin} unit="min" min={20} max={180} step={5} onChange={(workoutMin) => edit({ gym: { ...gym, workoutMin } })} />
        </div>
        <div className="setting">
          <span>After class, usually</span>
          <Segmented<AfterClass>
            label="After class, usually"
            value={gym.afterClass}
            options={[
              { value: 'gym', label: 'Gym' },
              { value: 'home', label: 'Home' },
            ]}
            onPick={(afterClass) => edit({ gym: { ...gym, afterClass } })}
          />
        </div>
        <div className="setting">
          <span>From home, usually</span>
          <Segmented<Evening>
            label="Getting to the gym from home, usually"
            value={gym.evening}
            options={[
              { value: 'bus', label: 'Bus' },
              { value: 'walk', label: 'Walk' },
              { value: 'skip', label: 'Skip' },
            ]}
            onPick={(evening) => edit({ gym: { ...gym, evening } })}
          />
        </div>
        <label className="field">
          <span>Leave home for the gym at</span>
          <input type="time" value={minuteToInput(gym.eveningLeaveMin)} onChange={(e) => e.target.value && edit({ gym: { ...gym, eveningLeaveMin: inputToMinute(e.target.value) } })} />
        </label>
      </section>

      <section className="section" aria-labelledby="walking-title">
        <h2 id="walking-title">Walking</h2>
        <div className="setting">
          <span>Pace</span>
          <Segmented<number> label="Walking pace" value={schedule.paceMPerMin} options={PACES} onPick={(paceMPerMin) => edit({ paceMPerMin })} />
        </div>
        <div className="setting">
          <span>In the room before class</span>
          <Stepper label="Minutes early to class" value={schedule.arriveEarlyMin} unit="min" min={0} max={20} onChange={(arriveEarlyMin) => edit({ arriveEarlyMin })} />
        </div>
        <div className="setting">
          <span>Gammage to the gym</span>
          <Stepper label="Walk from Gammage to the gym" value={walk(CAMPUS, GYM)} unit="min" min={1} max={40} onChange={(v) => setWalk(CAMPUS, GYM, v)} />
        </div>
        <div className="setting">
          <span>Home to the gym</span>
          <Stepper label="Walk from home to the gym" value={walk(HOME, GYM)} unit="min" min={10} max={90} onChange={(v) => setWalk(HOME, GYM, v)} />
        </div>
        <p className="note">Estimates follow the street grid at your pace. A time you set here replaces the estimate.</p>
      </section>

      <div className="save-bar">
        {message && (
          <p className={message === 'Saved.' ? 'note' : 'error'} role="status">
            {message}
          </p>
        )}
        <button className="button primary" onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : dirty ? 'Save schedule' : 'Saved'}
        </button>
      </div>
    </main>
  );
}
