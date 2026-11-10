# SoL Shuttle

Personal PWA that replaces the apartment's Samsara share page. It answers "when should I leave for the bus?" and pushes alerts to one iPhone. Single user, no accounts. Design brief: `PRODUCT.md`.

## Run

```bash
npm run dev         # http://localhost:3240 (or preview name "sol-shuttle" from Documents/.claude/launch.json)
npm test            # alert, tracking and answer logic
npm run tick:local  # runs the alert check every 30s against the dev server
```

## How it fits together

- `lib/samsara.ts` reads the share link's `FleetViewer` GraphQL call: anonymous CSRF + cookie, then a position-only query. The browser can't call it (no CORS), so `/api/shuttle` proxies it with a 14s cache.
- `lib/route.json` is the learned loop: path, typical time per point, stops. Regenerate it with `node scripts/learn-route.mjs --write`, which reads `route-data/*.jsonl` and prints held-out accuracy. Record more with `npm run record -- <minutes>` (reads the share token from `.env.local`). Stops are hand-confirmed in `route-data/stops.json` (`heading` picks the pass on two-way streets, `holdM` covers a wait further on). The script prints pauses to help, but pauses alone can't tell a stop from a red light.
- `lib/track.ts` places a ping on the loop (heading picks the side of two-way streets, the last position decides when stopped). ETA = typical time difference around the loop.
- `lib/answer.ts` turns that into the headline. `lib/alerts.ts` is the pure alert state machine. `lib/tick.ts` runs one check and sends web push.
- Hosted: Next on Vercel, Supabase holds `shuttle_kv` and pg_cron calls `/api/tick` every 30s (`db/schema.sql`). The app reaches the table with the publishable key plus a private header, not a secret key. Vercel Hobby cron is daily only, so it can't drive this. Locally, state is in `.data/`.

## What the bus actually does (measured 2026-11-06, Friday evening)

- One loop takes about 35 min and covers 9.2 km: SoL → University west → McClintock south → Apache west → Forest north (the Gammage stop) → turnaround → Forest south → Apache east → McClintock north → University east → around the back of SoL.
- One of the first loops went University → Rural → Apache instead. The app shows "Off route" with no time on that leg.
- The loop has slack and the driver spends it in different places: 20s to 5 min at Gammage, 1 to 5 min at the Apache/McClintock light, 3 to 11 min at SoL. That's the limit on ETA accuracy, and why an ETA can drop by minutes at once. Don't treat the leave alert as a moment; it's a threshold.
- The bus waits at SoL for minutes, in up to three spots: the east driveway, the back of the property, and the University Dr curb. Which one riders board at isn't known yet, so the SoL stop starts at the driveway and `holdM` keeps "Bus is here" on until it leaves the curb. `canCatch` counts the wait.

## Live (deployed 2026-11-07)

- **App:** https://alyan-sol-shuttle.vercel.app (Vercel project `alyan-sol-shuttle`, linked in `.vercel/`). Redeploy with `npx vercel deploy --prod`.
- **Database:** shares the Supabase project **mauqa** (`cmkemrucrmmdpzzxstxx`) because the free plan's two active slots were full. The shuttle owns only `public.shuttle_kv` and the cron job `shuttle-tick`; never touch mauqa's own tables from here. Rows: `settings`, `tracking`, `tick-auth` (the timer's bearer secret).
- **Timer:** pg_cron `shuttle-tick` every 30s, which also keeps mauqa from auto-pausing. Check runs with `select status_code, created from net._http_response order by created desc limit 5`.
- **Env:** all of `.env.example` is set in Vercel production. `VAPID_SUBJECT` is the app URL (Apple rejects placeholders). The passcode is `APP_PASSCODE` in `.env.local`.
- **iPhone:** open the URL in Safari, Share → Add to Home Screen, open it from there, enter the passcode, turn on alerts.

## Rules

- Never request the driver's name or any driver field. Position fields only.
- Never poll Samsara faster than its own page does (about every 14s). Keep the cache.
- Never show a time from stale data. If `status` isn't `live`, the answer has no minutes in it.
- Don't show Samsara's `formatted` address to the user: it's often a block or two wrong. Describe position by the next stop.
- The feed is an undocumented internal endpoint. It can change or stop without warning, and the share link can be revoked. When it does, the app should say "No signal", not crash.

## Gotchas

- MapLibre 6 can't find its worker under Turbopack. `public/maplibre-gl-worker.mjs` is copied by postinstall and set with `setWorkerUrl`. It's gitignored, so a fresh clone needs `npm install`.
- MapLibre can't parse `oklch()`, so `cssColor()` in `ShuttleMap.tsx` converts tokens through a canvas.
- `web-push` and `maplibre-gl` have no default export in these versions.
- iOS web push only works from the Home Screen app, needs HTTPS, and every push must show a notification.
- Samsara sends no pings while the bus is parked (gaps over 4 min). Pause lengths run to the next moving ping, and `feedStatus` keeps a parked bus live for 6 min. It sends a heartbeat every 5 min while parked, so a bus that's done for the day still reads as `live`; `parkedUp` (20 min, from `lastMovedAt`, which only the tick updates) is what turns that into "Not running".
- Adding a file to `public/` while `next dev` runs can 404 until the next reload.
