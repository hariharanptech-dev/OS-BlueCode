import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startApp, signedInClient, startPayment, completePayment, Client, orderOf, type TestApp } from '../helpers/harness.ts';

let t: TestApp;
before(async () => { t = await startApp(); });
after(async () => { await t.stop(); });
const strip = (j: any) => JSON.stringify({ ...j, error: { ...j.error, requestId: 'x' } });

describe('SEC-AZ authorization: users can only touch their own data', () => {
  it("cannot read another user's payment (404, indistinguishable from a non-existent id)", async () => {
    const a = await signedInClient(t, 'az1a'); const b = await signedInClient(t, 'az1b'); const s = await startPayment(t, a);
    const foreign = await b.get(`/api/payments/${s.orderId}`); const missing = await b.get(`/api/payments/${randomUUID()}`);
    assert.equal(foreign.status, 404); assert.equal(missing.status, 404); assert.equal(strip(foreign.json), strip(missing.json), 'no oracle for which ids exist');
    assert.ok(!foreign.text.includes(s.txnid) && !foreign.text.includes('1499') && !foreign.text.includes('499'));
  });
  it("cannot refresh (trigger gateway verification for) another user's order", async () => {
    const a = await signedInClient(t, 'az2a'); const b = await signedInClient(t, 'az2b'); const s = await startPayment(t, a); t.gateway.settle(s.txnid, 'success');
    const calls = t.gateway.verifyCalls; const r = await b.post(`/api/payments/${s.orderId}/refresh`);
    assert.equal(r.status, 404); assert.equal(t.gateway.verifyCalls, calls, 'no gateway call on behalf of a stranger'); assert.equal(orderOf(t, s.orderId).status, 'pending');
  });
  it("cannot see another user's subscription or billing history by manipulating ids in query or body", async () => {
    const a = await signedInClient(t, 'az3a'); const b = await signedInClient(t, 'az3b'); await completePayment(t, a, 'success');
    for (const q of [`?userId=${a.userId}`, `?user=${a.userId}`, `?user_id=${a.userId}&id=${a.userId}`, `?userId[]=${a.userId}`]) {
      assert.equal((await b.get(`/api/subscription${q}`)).json.history.length, 0, q); assert.equal((await b.get(`/api/payments${q}`)).status === 400 || (await b.get(`/api/payments${q}`)).json.total === 0, true, q);
    }
    assert.equal((await b.post('/api/payments/checkout', { json: { planId: 'pro_monthly', userId: a.userId, customer: { firstname: 'A', email: 'a@b.co', phone: '9876543210' } } })).status, 400);
  });
  it("checkout always binds the order to the SESSION user, never to a user supplied by the client", async () => {
    const a = await signedInClient(t, 'az4a'); const b = await signedInClient(t, 'az4b');
    const r = await b.checkout('pro_monthly', { customer: { firstname: 'A', email: a.email!, phone: '9876543210' } }); // pretend to be A in customer details
    assert.equal(orderOf(t, r.json.orderId).userId, b.userId);
  });
  it('every protected endpoint rejects anonymous callers', async () => {
    const anon = new Client(t.url); const id = randomUUID();
    for (const [m, p] of [['GET', '/api/auth/me'], ['GET', '/api/subscription'], ['GET', '/api/payments'], ['GET', `/api/payments/${id}`], ['POST', `/api/payments/${id}/refresh`], ['POST', '/api/payments/checkout'], ['POST', '/api/auth/logout']] as const) {
      const r = await anon.request(m, p, { json: m === 'POST' ? {} : undefined }); assert.equal(r.status, 401, `${m} ${p}`); assert.equal(r.json.error.code, 'AUTH_REQUIRED');
    }
  });
  it('forged / malformed session cookies are rejected, not treated as anonymous-with-privileges or errors', async () => {
    for (const v of ['', 'x', 'A'.repeat(43), '../../etc/passwd', "' OR 1=1--", '%00', 'a'.repeat(5000)]) {
      const c = new Client(t.url); c.jar.set('bc_sid', v); const r = await c.get('/api/subscription'); assert.equal(r.status, 401, JSON.stringify(v).slice(0, 30));
    }
  });
  it("another user's session token cannot be guessed by incrementing / replaying the format", async () => {
    const a = await signedInClient(t, 'az7'); const tok = [...a.jar.values()][0]!;
    const c = new Client(t.url); c.jar.set('bc_sid', tok.slice(0, -1) + (tok.endsWith('A') ? 'B' : 'A')); assert.equal((await c.get('/api/auth/me')).status, 401);
  });
  it('order ids are random v4 UUIDs (non-enumerable)', async () => {
    const ids = new Set<string>(); for (let i = 0; i < 20; i++) { const c = await signedInClient(t, 'az8'); ids.add((await c.checkout('starter_monthly')).json.orderId); }
    assert.equal(ids.size, 20); for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('malformed order ids (SQLi, traversal, null byte, oversize) → 404, never 500', async () => {
    const c = await signedInClient(t, 'az9');
    for (const id of ["1' OR '1'='1", '../../etc/passwd', '%00', 'x'.repeat(500), '1;DROP TABLE orders', '%27%20OR%201%3D1', 'null', 'undefined', '-1']) { const r = await c.get(`/api/payments/${encodeURIComponent(id)}`); assert.equal(r.status, 404, id); }
    assert.equal((await c.get('/api/payments/%E0%A4%A')).status, 404, 'invalid percent-encoding does not crash');
  });
  it('expired sessions lose access immediately', async () => {
    const c = await signedInClient(t, 'az10'); t.clock.advanceMinutes(31);
    const r = await c.get('/api/subscription'); assert.equal(r.status, 401); assert.equal(r.json.error.code, 'SESSION_EXPIRED'); assert.match(r.headers.get('set-cookie') ?? '', /Max-Age=0/);
  });
});
