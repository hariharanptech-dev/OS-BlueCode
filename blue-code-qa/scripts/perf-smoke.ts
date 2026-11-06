/**
 * Performance / reliability smoke run against the REFERENCE app (in-memory DB, mocked gateway, loopback HTTP).
 * Numbers describe THIS harness on THIS machine only. They are NOT capacity figures for the real stack.
 *   node scripts/perf-smoke.ts  -> writes reports/perf.json
 */
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { startApp, signedInClient, startPayment, postCallback, Client, uniqueEmail } from '../tests/helpers/harness.ts';
import type { Order } from '../src/reference/types.ts';

const pct = (a: number[], p: number): number => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]! * 100) / 100; };
const stats = (ms: number[]) => ({ n: ms.length, p50_ms: pct(ms, 50), p95_ms: pct(ms, 95), p99_ms: pct(ms, 99), max_ms: pct(ms, 100) });
const time = async <T,>(fn: () => Promise<T>): Promise<[T, number]> => { const t0 = performance.now(); const r = await fn(); return [r, performance.now() - t0]; };

const t = await startApp(); const out: Record<string, unknown> = {};
out['environment'] = { node: process.version, cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model, platform: os.platform(), note: 'loopback HTTP, in-memory DB, mocked PayU; not representative of production' };

// 1. cheap endpoint latency (sequential)
{ const c = new Client(t.url); const ms: number[] = []; for (let i = 0; i < 300; i++) ms.push((await time(() => c.get('/api/plans')))[1]); out['GET /api/plans (300 sequential)'] = stats(ms); }

// 2. login latency (scrypt is deliberately slow)
{ const c = new Client(t.url); const e = uniqueEmail('perf'); await c.register(e); const ms: number[] = []; for (let i = 0; i < 20; i++) ms.push((await time(() => c.login(e)))[1]); out['POST /api/auth/login (20 sequential, scrypt N=16384)'] = stats(ms); }

// 3. 40 users × concurrent checkout; then each pays; 40 concurrent callbacks
const users = await Promise.all(Array.from({ length: 40 }, (_, i) => signedInClient(t, 'pf' + i)));
{ const [rs, total] = await time(() => Promise.all(users.map((u) => u.checkout('pro_monthly')))); out['40 concurrent checkouts'] = { ok: rs.every((r) => r.status === 201), total_ms: Math.round(total) };
  for (const r of rs) t.gateway.registerInitiation(r.json.payu.fields);
  for (const r of rs) t.gateway.settle(r.json.txnid, 'success');
  const lat: number[] = []; const [cbs, total2] = await time(() => Promise.all(rs.map(async (r) => { const [x, ms] = await time(() => postCallback(t, t.gateway.callbackFor(r.json.txnid, 'success'))); lat.push(ms); return x; })));
  out['40 concurrent success callbacks (distinct orders)'] = { ...stats(lat), all_303: cbs.every((x) => x.status === 303), total_ms: Math.round(total2), subscriptions: t.app.db.allSubscriptions().length }; }

// 4. 200 identical concurrent callbacks (duplicate-storm) for ONE order
{ const c = await signedInClient(t, 'storm'); const s = await startPayment(t, c); t.gateway.settle(s.txnid, 'success'); const p = t.gateway.callbackFor(s.txnid, 'success'); const v0 = t.gateway.verifyCalls;
  const [rs, total] = await time(() => Promise.all(Array.from({ length: 200 }, () => postCallback(t, p))));
  out['200 identical concurrent callbacks, one order'] = { all_303: rs.every((r) => r.status === 303), subscriptions_for_order: t.app.db.allSubscriptions().filter((x) => x.paymentId === s.orderId).length, gateway_verify_calls: t.gateway.verifyCalls - v0, total_ms: Math.round(total) }; }

// 5. large transaction history
{ const c = await signedInClient(t, 'big'); const rows: Order[] = Array.from({ length: 5000 }, (_, i) => ({ id: randomUUID(), userId: c.userId!, planId: 'starter_monthly', txnid: 'BCBIG' + String(i).padStart(15, '0'), amount: '499.00', currency: 'INR', status: 'failed', idempotencyKey: null, customer: { firstname: 'A', email: 'a@b.co', phone: '9876543210' }, mihpayid: null, needsReview: false, renewal: false, createdAt: new Date(Date.UTC(2025, 0, 1) + i * 60_000).toISOString(), updatedAt: new Date(Date.UTC(2025, 0, 1) + i * 60_000).toISOString(), completedAt: null }));
  t.app.db._seedOrders(rows); const p1: number[] = []; for (let i = 0; i < 20; i++) p1.push((await time(() => c.get('/api/payments?page=1&pageSize=100')))[1]); const p50: number[] = []; for (let i = 0; i < 20; i++) p50.push((await time(() => c.get('/api/payments?page=50&pageSize=100')))[1]);
  out['billing history, 5,000 orders, pageSize=100'] = { page1: stats(p1), page50: stats(p50), caveat: 'reference DB scans+sorts in memory (O(n)); a real DB needs an index on (user_id, created_at DESC, id)' };
  // cost of a write transaction when the table is large (reference DB snapshots all tables per transaction)
  const c2 = await signedInClient(t, 'big2'); const lat: number[] = []; for (let i = 0; i < 15; i++) { const cc = await signedInClient(t, 'bigx' + i); lat.push((await time(() => cc.checkout('starter_monthly')))[1]); } void c2;
  out['checkout latency with ~5,000+ orders in the table'] = { ...stats(lat), caveat: 'inflated by the test double snapshotting tables for rollback — NOT a property of the real DB' }; }

// 6. recovery from gateway outage: 30 stuck payments reconciled after recovery
{ const cs = await Promise.all(Array.from({ length: 30 }, (_, i) => signedInClient(t, 'rec' + i))); const ss = await Promise.all(cs.map((c) => startPayment(t, c))); t.gateway.verifyBehaviour = 'throw';
  for (const s of ss) { t.gateway.settle(s.txnid, 'success'); await postCallback(t, t.gateway.callbackFor(s.txnid, 'success')); }
  const stuck = ss.filter((s) => t.app.db.getOrder(s.orderId)!.status === 'pending').length; t.gateway.verifyBehaviour = 'ok'; t.clock.advanceMinutes(3); const [, ms] = await time(() => t.app.payments.reconcilePending());
  out['gateway outage recovery (30 payments)'] = { stuckDuringOutage: stuck, recoveredAfter: ss.filter((s) => t.app.db.getOrder(s.orderId)!.status === 'success').length, reconcile_ms: Math.round(ms) }; }

out['memoryMB'] = Math.round(process.memoryUsage().rss / 1048576);
await t.stop(); mkdirSync('reports', { recursive: true }); writeFileSync(path.join('reports', 'perf.json'), JSON.stringify({ generatedAt: new Date().toISOString(), ...out }, null, 2));
console.log(JSON.stringify(out, null, 2)); process.exit(0);
