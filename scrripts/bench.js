/**
 * Simple load benchmark for the report (Section e).
 * Run with:  BASE=http://localhost:3000 npm run bench
 */
const BASE = process.env.BASE || 'http://localhost:3000';

async function register(label) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
  const r = await fetch(BASE + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', name: label }),
  });
  return r.json();
}

async function report(token, i) {
  const t0 = performance.now();
  const r = await fetch(BASE + '/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      type: i % 2 ? 'LOST' : 'FOUND',
      title: `Benchmark item ${i} - ${Math.random().toString(36).slice(2, 8)}`,
      description: 'synthetic load-test item',
      category: 'Electronics',
      location: 'Library',
    }),
  });
  const dt = performance.now() - t0;
  if (!r.ok) throw new Error('status ' + r.status);
  return dt;
}

async function run(clients, perClient) {
  console.log(`\n▶ ${clients} clients × ${perClient} reports = ${clients * perClient} requests`);
  const tokens = await Promise.all(
    Array.from({ length: clients }, (_, i) => register('bench' + i).then(d => d.access))
  );

  const t0 = performance.now();
  const lat = [];
  let ok = 0, fail = 0;

  await Promise.all(tokens.map(async (tok) => {
    for (let i = 0; i < perClient; i++) {
      try { lat.push(await report(tok, i)); ok++; }
      catch { fail++; }
    }
  }));

  const total = (performance.now() - t0) / 1000;
  lat.sort((a, b) => a - b);
  const avg = lat.reduce((a, b) => a + b, 0) / lat.length;
  const p95 = lat[Math.floor(lat.length * 0.95)];

  console.log(`  ✓ ok=${ok}  fail=${fail}`);
  console.log(`  ⏱  total=${total.toFixed(2)}s  throughput=${(ok / total).toFixed(1)} req/s`);
  console.log(`  📊 avg=${avg.toFixed(0)}ms  p95=${p95?.toFixed(0)}ms`);
}

(async () => {
  await run(5, 10);
  await run(20, 10);
})().catch(e => { console.error(e); process.exit(1); });
