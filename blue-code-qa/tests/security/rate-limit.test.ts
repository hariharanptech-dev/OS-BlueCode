import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signedInClient, startPayment, Client, uniqueEmail, STRONG_PW } from '../helpers/harness.ts';

describe('SEC-RL rate limiting (default production limits)', () => {
  it('credential stuffing across many e-mails from one IP is throttled (20 auth req/min)', async () => {
    const t = await startApp({ limits: 'default' });
    try { const c = new Client(t.url); const codes: number[] = []; for (let i = 0; i < 30; i++) codes.push((await c.login(uniqueEmail('stuff'), 'Guess-Guess-1')).status);
      assert.equal(codes.slice(0, 20).every((s) => s === 401), true); assert.ok(codes.slice(20).every((s) => s === 429), codes.join());
      const r = await c.login(uniqueEmail('stuff')); assert.equal(r.status, 429); assert.equal(r.json.error.code, 'RATE_LIMITED'); assert.ok(Number(r.headers.get('retry-after')) >= 1);
      t.clock.advanceMinutes(1.1); assert.equal((await c.login(uniqueEmail('stuff'), 'Guess-Guess-1')).status, 401, 'window slides open again');
    } finally { await t.stop(); }
  });
  it('spoofing X-Forwarded-For does not grant a fresh bucket', async () => {
    const t = await startApp({ limits: 'default' });
    try { const c = new Client(t.url); for (let i = 0; i < 20; i++) await c.post('/api/auth/login', { json: { email: uniqueEmail('x'), password: 'Guess-Guess-1' }, headers: { 'X-Forwarded-For': `10.9.${i}.1` } });
      assert.equal((await c.post('/api/auth/login', { json: { email: uniqueEmail('x'), password: 'Guess-Guess-1' }, headers: { 'X-Forwarded-For': '8.8.8.8' } })).status, 429);
    } finally { await t.stop(); }
  });
  it('payment-initiation spam is limited per user (20/min) without affecting other users', async () => {
    const t = await startApp({ limits: { checkout: 20 } });
    try { const a = await signedInClient(t, 'rl3a'); const b = await signedInClient(t, 'rl3b'); const codes: number[] = [];
      for (let i = 0; i < 25; i++) codes.push((await a.checkout('pro_monthly')).status); assert.equal(codes.filter((s) => s === 429).length, 5, codes.join()); assert.equal((await b.checkout('pro_monthly')).status, 201);
    } finally { await t.stop(); }
  });
  it('refresh (which calls the gateway) is limited per user to protect the gateway quota', async () => {
    const t = await startApp({ limits: { refresh: 5 } });
    try { const c = await signedInClient(t, 'rl4'); const s = await startPayment(t, c); const codes: number[] = []; for (let i = 0; i < 8; i++) codes.push((await c.post(`/api/payments/${s.orderId}/refresh`)).status); assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429, 429]); assert.equal(t.gateway.verifyCalls, 5, 'throttled requests never reached the gateway');
    } finally { await t.stop(); }
  });
  it('callback flooding is limited per IP (forged-callback DoS) and the limiter does not corrupt state', async () => {
    const t = await startApp({ limits: { callback: 50 } });
    try { const c = await signedInClient(t, 'rl5'); const s = await startPayment(t, c); const bad = { ...t.gateway.callbackFor(s.txnid, 'success'), hash: 'f'.repeat(128) }; const { postCallback } = await import('../helpers/harness.ts'); const codes: number[] = [];
      for (let i = 0; i < 60; i++) codes.push((await postCallback(t, bad)).status); assert.equal(codes.filter((x) => x === 400).length, 50); assert.equal(codes.filter((x) => x === 429).length, 10); assert.equal(t.app.db.getOrder(s.orderId)!.status, 'pending');
    } finally { await t.stop(); }
  });
  it('global per-IP ceiling protects every API route', async () => {
    const t = await startApp({ limits: { global: 40 } });
    try { const c = new Client(t.url); const codes: number[] = []; for (let i = 0; i < 50; i++) codes.push((await c.get('/api/plans')).status); assert.equal(codes.filter((x) => x === 429).length, 10); assert.equal((await c.get('/')).status, 200, 'static pages are not counted against the API budget');
    } finally { await t.stop(); }
  });
});
void STRONG_PW;
