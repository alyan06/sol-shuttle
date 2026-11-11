# SoL Shuttle

Personal PWA that replaces the apartment's Samsara share page. It answers "when should I leave for the bus?", plans the class day around the bus (which bus makes the first class, every walk, gym or home after), and pushes alerts to one iPhone. Single user, no accounts. Design brief: `PRODUCT.md`. Public repo: github.com/alyan06/sol-shuttle.

## Run

```bash
npm run dev         # http://localhost:3240 on local file storage (.data/), no passcode. Preview name "sol-shuttle".
npm run dev:locked  # same, with the passcode "letmein" to exercise the lock
npm run dev:hosted  # against the hosted database: live settings, real alerts. Rarely what you want.
npm test            # planner, timetable, history, alerts, tracking and answer logic
npm run tick:local  # runs the alert check every 30s against the dev server (needs TICK_SECRET as a bearer)
```

## How it fits together

- `lib/samsara.ts` reads the share link's `FleetViewer` GraphQL call: anonymous CSRF + cookie, then a position-only query. The browser can't call it (no CORS), so `/api/shuttle` proxies it with a 14s cache.
- `lib/route.json` is the learned loop: path, typical time per point, stops. Regenerate it with `node scripts/learn-route.mjs --write`, which reads `route-data/*.jsonl` and prints held-out accuracy. Record more with `npm run record -- <minutes>` (reads the share token from `.env.local`). Stops are hand-confirmed in `route-data/stops.json` (`heading` picks the pass on two-way streets, `holdM` covers a wait further on). The script prints pauses to help, but pauses alone can't tell a stop from a red light.
- `lib/track.ts` places a ping on the loop (heading picks the side of two-way streets, the last position decides when stopped). ETA = typical time difference around the loop.
- `lib/answer.ts` turns that into the headline. `lib/alerts.ts` is the pure alert state machine. `lib/tick.ts` runs one check and sends web push.
- **Bus history → timetable.** Each tick, `lib/history.ts` logs the day (first and last movement, every stop arrival and departure) into `tracking.today`; at midnight it's filed into the `history` row (8 weeks kept). `lib/timetable.ts` turns same-weekday days into recurring runs, first and last bus, and "does it run at all". It promises nothing below two days of a weekday.
- **Day planner.** `lib/plan.ts` is pure: `planDay` takes the schedule, today's choices, the live bus and the timetable and returns legs (bus, walk, class, gym). Bus times come from the live position for the next loop or so, then the timetable, then the loop length repeated with growing doubt; beyond that the leg says "no time yet" and gives the walking deadline. `advanceProgress` commits to a bus the moment its leave time passes (so the plan doesn't jump to the next bus while he's walking to the stop), and that commit is what sends the leave alert, once per leg. `lib/schedule.ts` holds the fixed places (SoL, Gammage, the gym) and walk estimates.
- **The ride home is watched class by class** (, ). From 15 min before a class ends, the ride home is measured from that class's building. If a next class follows, only a bus he could leave for before it counts, and the watch goes quiet when that class starts, then moves to it. After the last class every bus is announced (about 10 min before the moment to go) until he taps "I'm on the bus" or "I'm home" ( / ), or 5 hours pass. Nothing is assumed: not that he left, not that he went to the gym. The first ride home () is therefore never auto-committed.  ends a class early.  warns 8 to 25 min before it's time to leave home.
- **No location.** Live location was tried for one evening and dropped at Alyan's request: where he is comes from the schedule. Don't reintroduce geolocation unasked. Watching Gammage by hand uses a flat 10 min walk ().
- **Where the plan runs.** The tick builds it for alerts; the browser builds the same plan from `/api/shuttle`'s `private` payload so taps on Today show at once. Today's choices (skip, gym or home, evening mode, left early, done at gym, replan) live in `schedule.override` and expire with the date.
- **Private vs public.** The bus position is public. Settings, schedule and plan need the `x-passcode` header on reads and writes (`lib/auth.ts`). The schedule exists only in the `schedule` row, never in the repo: this repo is public.
- Hosted: Next on Vercel, Supabase holds `shuttle_kv` and pg_cron calls `/api/tick` every 30s (`db/schema.sql`). The app reaches the table with the publishable key plus a private header, not a secret key. Vercel Hobby cron is daily only, so it can't drive this. Locally, state is in `.data/`.

## What the bus actually does (measured 2026-11-06, Friday evening)

- One loop takes about 35 min and covers 9.2 km: SoL → University west → McClintock south → Apache west → Forest north (the Gammage stop) → turnaround → Forest south → Apache east → McClintock north → University east → around the back of SoL.
- One of the first loops went University → Rural → Apache instead. The app shows "Off route" with no time on that leg.
- The loop has slack and the driver spends it in different places: 20s to 5 min at Gammage, 1 to 5 min at the Apache/McClintock light, 3 to 11 min at SoL. That's the limit on ETA accuracy, and why an ETA can drop by minutes at once. Don't treat the leave alert as a moment; it's a threshold.
- The bus waits at SoL for minutes, in up to three spots: the east driveway, the back of the property, and the University Dr curb. Which one riders board at isn't known yet, so the SoL stop starts at the driveway and `holdM` keeps "Bus is here" on until it leaves the curb. `canCatch` counts the wait.

## Live (first deployed 2026-11-07, planner 2026-11-10)

- **App:** https://alyan-sol-shuttle.vercel.app (Vercel project `alyan-sol-shuttle`, linked in `.vercel/`). Redeploy with `npx vercel deploy --prod`.
- **Database:** shares the Supabase project **mauqa** (`cmkemrucrmmdpzzxstxx`) because the free plan's two active slots were full. The shuttle owns only `public.shuttle_kv` and the cron job `shuttle-tick`; never touch mauqa's own tables from here. Rows: `settings`, `tracking`, `history`, `schedule`, `tick-auth` (the timer's bearer secret).
- **Timer:** pg_cron `shuttle-tick` every 30s, which also keeps mauqa from auto-pausing. Check runs with `select status_code, created from net._http_response order by created desc limit 5`.
- **Env:** all of `.env.example` is set in Vercel production. `VAPID_SUBJECT` is the app URL (Apple rejects placeholders). The passcode is `APP_PASSCODE` in `.env.local`.
- **iPhone:** open the URL in Safari, Share → Add to Home Screen, open it from there, enter the passcode, turn on alerts.

## Rules

- Never commit the class schedule, building list or any personal times. The repo is public; they belong in the `schedule` row.
- Never put the Samsara share token in a tracked file. Scripts read it from `.env.local`.
- A plan time is only as good as its source. Keep `source` and `plusMinus` honest, pick the earlier bus when unsure, and say "no time yet" rather than guess hours ahead.
- Never request the driver's name or any driver field. Position fields only.
- Never poll Samsara faster than its own page does (about every 14s). Keep the cache.
- Never show a time from stale data. If `status` isn't `live`, the answer has no minutes in it.
- Don't show Samsara's `formatted` address to the user: it's often a block or two wrong. Describe position by the next stop.
- The feed is an undocumented internal endpoint. It can change or stop without warning, and the share link can be revoked. When it does, the app should say "No signal", not crash.

## Gotchas

- Service ends around 7 PM on weekdays and there was no movement on the one weekend watched, so "bus home, then bus back for the gym" rarely has a ride home. The planner turns those legs into walks with the reason.
- Walking SoL to campus is about 45 min (3.2 km as the crow flies, more by street), not a quick hop.
- The planner can't see where he is. A bus is taken as caught once its leave time passes; "Missed it, plan again" and "I'm done" (gym) are how he corrects it. iOS gives a PWA no background location, no step count and no buttons on notifications.
- Git Bash's `TZ=America/Phoenix date` prints UTC here. Get Tempe time from node (`Date.now() - 7h`) instead.
- MapLibre 6 can't find its worker under Turbopack. `public/maplibre-gl-worker.mjs` is copied by postinstall and set with `setWorkerUrl`. It's gitignored, so a fresh clone needs `npm install`.
- MapLibre can't parse `oklch()`, so `cssColor()` in `ShuttleMap.tsx` converts tokens through a canvas.
- `web-push` and `maplibre-gl` have no default export in these versions.
- iOS web push only works from the Home Screen app, needs HTTPS, and every push must show a notification.
- In an iPhone Safari tab (not the Home Screen app) there is no Push API: a service worker registration exists but `registration.pushManager` is undefined, and `PushManager` is not on `window`. Reaching through it once crashed the settings load, so the phone showed only the map with no passcode box. All push lookups go through `lib/push-client.ts`, which answers "no subscription" instead. Test by deleting `pushManager` from `ServiceWorkerRegistration.prototype` in a desktop browser.
- The map takes two fingers to move on touch screens (`cooperativeGestures`), so one finger scrolls the page past it.
- Samsara sends no pings while the bus is parked (gaps over 4 min). Pause lengths run to the next moving ping, and `feedStatus` keeps a parked bus live for 6 min. It sends a heartbeat every 5 min while parked, so a bus that's done for the day still reads as `live`; `parkedUp` (20 min, from `lastMovedAt`, which only the tick updates) is what turns that into "Not running".
- Adding a file to `public/` while `next dev` runs can 404 until the next reload.
