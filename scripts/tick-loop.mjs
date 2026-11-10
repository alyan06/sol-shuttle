// Local stand-in for the hosted scheduler: runs the alert tick every 30s against the dev server.
const URL_BASE = process.env.APP_URL ?? 'http://localhost:3240';

for (;;) {
  try {
    const res = await fetch(`${URL_BASE}/api/tick`, { method: 'POST' });
    const { status, sent = [], error } = await res.json();
    console.log(new Date().toLocaleTimeString(), error ?? status, sent.map((e) => e.kind).join(', '));
  } catch (err) {
    console.log('tick failed:', err.message);
  }
  await new Promise((resolve) => setTimeout(resolve, 30_000));
}
