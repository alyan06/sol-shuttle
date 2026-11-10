-- State for the hosted app. One row per key: 'settings' and 'tracking'.
create table if not exists public.shuttle_kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Only requests carrying the shuttle's private header get in, so the app never needs a key that
-- reaches the rest of the project. The hash is SHA-256 of SHUTTLE_STORE_KEY.
alter table public.shuttle_kv enable row level security;
revoke all on public.shuttle_kv from anon, authenticated;
grant select, insert, update on public.shuttle_kv to anon;

drop policy if exists "shuttle app only" on public.shuttle_kv;
create policy "shuttle app only" on public.shuttle_kv
  for all to anon
  using (encode(sha256(convert_to(coalesce(current_setting('request.headers', true)::json ->> 'x-shuttle-key', ''), 'UTF8')), 'hex') = 'de73ed943a5885b5e6ba13f6d3c14e3aa40b1a6b00a0f2908b19e034518a3c51')
  with check (encode(sha256(convert_to(coalesce(current_setting('request.headers', true)::json ->> 'x-shuttle-key', ''), 'UTF8')), 'hex') = 'de73ed943a5885b5e6ba13f6d3c14e3aa40b1a6b00a0f2908b19e034518a3c51');

-- Runs the alert check every 30 seconds. Store TICK_SECRET first as the row
-- ('tick-auth', {"bearer": "<TICK_SECRET>"}) through the app's header, so it never sits in the job text.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('shuttle-tick') where exists (select 1 from cron.job where jobname = 'shuttle-tick');

select cron.schedule(
  'shuttle-tick',
  '30 seconds',
  $$
  select net.http_post(
    url := 'https://alyan-sol-shuttle.vercel.app/api/tick',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select value ->> 'bearer' from public.shuttle_kv where key = 'tick-auth'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 20000
  );
  $$
);
