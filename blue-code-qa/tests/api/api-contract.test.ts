import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startApp, signedInClient, Client, uniqueEmail, STRONG_PW, type TestApp } from '../helpers/harness.ts';
import type { Order } from '../../src/reference/types.ts';

let t: TestApp;
before(async () => { t = await startApp(); });
after(async () => { await t.stop(); });
const anon = () => new Client(t.url);
const shape = (r: { json: any }) => { assert.deepEqual(Object.keys(r.json).sort(), ['error']); assert.deepEqual(Object.keys(r.json.error).filter((k) => k !== 'fields').sort(), ['code', 'message', 'requestId']); assert.match(r.json.error.requestId, /^[0-9a-f-]{36}$/); };

describe('A-01 protocol hygiene', () => {
  it('health endpoint is minimal and leaks no configuration', async () => {
    const r = await anon().get('/api/health'); assert.equal(r.status, 200); assert.deepEqual(r.json, { status: 'ok' });
    assert.ok(!r.text.includes(t.config.payuKey) && !r.text.includes(t.config.payuSalt));
  });
  it('unknown routes → 404 JSON in the standard error shape', async () => { const r = await anon().get('/api/nope'); assert.equal(r.status, 404); assert.equal(r.json.error.code, 'NOT_FOUND'); shape(r); });
  it('wrong method on a known route → 405 (not 404, not 500)', async () => { const r = await anon().request('DELETE', '/api/plans'); assert.equal(r.status, 405); assert.equal(r.json.error.code, 'METHOD_NOT_ALLOWED'); });
  it('malformed JSON → 400 VALIDATION_FAILED, not a 500', async () => { const r = await anon().post('/api/auth/login', { rawBody: '{"email": ' }); assert.equal(r.status, 400); assert.equal(r.json.error.code, 'VALIDATION_FAILED'); shape(r); });
  it('wrong content type → 415', async () => { const r = await anon().post('/api/auth/login', { rawBody: 'email=a&password=b', contentType: 'text/plain' }); assert.equal(r.status, 415); });
  it('form-encoded body on a JSON-only endpoint → 415 (blocks cross-site HTML-form CSRF)', async () => { const r = await anon().post('/api/auth/login', { form: { email: 'a@b.co', password: 'x' } }); assert.equal(r.status, 415); });
  it('oversized JSON → 413', async () => { const r = await anon().post('/api/auth/login', { rawBody: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(30_000) }) }); assert.equal(r.status, 413); assert.equal(r.json.error.code, 'PAYLOAD_TOO_LARGE'); });
  it('every response carries a request id header', async () => { const r = await anon().get('/api/plans'); assert.match(r.headers.get('x-request-id')!, /^[0-9a-f-]{36}$/); });
  it('API responses are never cacheable', async () => { for (const p of ['/api/plans', '/api/health', '/api/nope']) assert.equal((await anon().get(p)).headers.get('cache-control'), 'no-store'); });
  it('plans endpoint is public and returns server-owned prices', async () => { const r = await anon().get('/api/plans'); assert.equal(r.status, 200); assert.deepEqual(r.json.plans.map((p: any) => p.id), ['starter_monthly', 'pro_monthly', 'pro_yearly']); });
  it('static path traversal attempts never reach the filesystem', async () => {
    for (const p of ['/static/../../package.json', '/static/..%2f..%2fpackage.json', '/static/%2e%2e/%2e%2e/etc/passwd', '/static/app.js/../../../package.json', '/..%2fpackage.json', '/static/..\\..\\package.json']) {
      const r = await anon().get(p); assert.ok(r.status === 404 || r.status === 200 && r.text.includes('use strict'), `${p} → ${r.status}`); assert.ok(!r.text.includes('"name": "blue-code-qa"'), p);
    }
  });
});

describe('A-02 error responses are consistent and safe', () => {
  it('401 / 404 / 400 / 405 share one shape', async () => {
    const c = await signedInClient(t, 'a02');
    for (const r of [await anon().get('/api/subscription'), await c.get('/api/payments/' + randomUUID()), await c.post('/api/payments/checkout', { json: {} }), await anon().request('PUT', '/api/plans')]) shape(r);
  });
  it('validation errors list field paths but never echo values', async () => {
    const r = await anon().post('/api/auth/register', { json: { name: '<script>alert(1)</script>', email: 'not-an-email', password: 'x' } });
    assert.equal(r.status, 400); assert.ok(r.json.error.fields.length >= 2); assert.ok(!r.text.includes('<script>')); assert.ok(!r.text.includes('not-an-email'));
  });
  it('user-facing messages contain no technical detail', async () => {
    const r = await anon().get('/api/payments/not-a-uuid'); assert.doesNotMatch(r.text, /(stack|trace|\bat [A-Za-z.]+\(|node_modules|\.ts:|sql|exception)/i);
  });
});

describe('A-03 authentication endpoints', () => {
  it('register → 201 with no password material in the response', async () => {
    const r = await anon().register(uniqueEmail('a03'), 'Ravi Kumar'); assert.equal(r.status, 201); assert.deepEqual(Object.keys(r.json.user).sort(), ['email', 'id', 'name']); assert.ok(!/password|hash|scrypt/i.test(r.text));
  });
  it('duplicate email → 409 generic message', async () => {
    const e = uniqueEmail('a03b'); await anon().register(e); const r = await anon().register(e); assert.equal(r.status, 409); assert.equal(r.json.error.code, 'EMAIL_UNAVAILABLE');
  });
  it('email is case-insensitive', async () => { const e = uniqueEmail('a03c'); await anon().register(e); assert.equal((await anon().register(e.toUpperCase())).status, 409); const c = anon(); assert.equal((await c.login(e.toUpperCase())).status, 200); });
  it('weak passwords are refused with a helpful, non-echoing message', async () => {
    for (const pw of ['short1', 'alllettersnodigits', 'password123']) { const r = await anon().register(uniqueEmail('a03d'), 'Asha', pw); assert.equal(r.status, 400); assert.ok(r.json.error.fields.some((f: any) => f.path === 'password')); assert.ok(!r.text.includes(pw)); }
  });
  it('login failure message is identical for unknown email and wrong password (no user enumeration)', async () => {
    const e = uniqueEmail('a03e'); await anon().register(e);
    const a = await anon().login(e, 'Wrong-Password-1'); const b = await anon().login(uniqueEmail('ghost'), 'Wrong-Password-1');
    assert.equal(a.status, 401); assert.equal(b.status, 401); assert.equal(a.json.error.message, b.json.error.message); assert.equal(a.json.error.code, b.json.error.code);
  });
  it('/me requires a session and returns the CSRF token', async () => {
    assert.equal((await anon().get('/api/auth/me')).status, 401); const c = await signedInClient(t, 'a03f'); const r = await c.get('/api/auth/me'); assert.equal(r.status, 200); assert.equal(r.json.csrfToken, c.csrfToken); assert.equal(r.json.user.id, c.userId);
  });
  it('logout destroys the server-side session', async () => {
    const c = await signedInClient(t, 'a03g'); const stolen = new Client(t.url); stolen.jar.set([...c.jar.keys()][0]!, [...c.jar.values()][0]!);
    assert.equal((await stolen.get('/api/auth/me')).status, 200); assert.equal((await c.post('/api/auth/logout')).status, 200);
    assert.equal((await stolen.get('/api/auth/me')).status, 401, 'a copied cookie is useless after logout'); assert.equal((await c.get('/api/auth/me')).status, 401);
  });
});

describe('A-04 billing history pagination (large histories)', () => {
  it('paginates 1,000 orders with stable ordering, bounded page size and correct totals', async () => {
    const c = await signedInClient(t, 'a04'); const base = Date.parse('2025-01-01T00:00:00Z');
    const rows: Order[] = Array.from({ length: 1000 }, (_, i) => ({ id: randomUUID(), userId: c.userId!, planId: 'starter_monthly', txnid: 'BCSEED' + String(i).padStart(14, '0'), amount: '499.00', currency: 'INR', status: 'failed', idempotencyKey: null, customer: { firstname: 'A', email: 'a@b.co', phone: '9876543210' }, mihpayid: null, needsReview: false, renewal: false, createdAt: new Date(base + i * 60_000).toISOString(), updatedAt: '', completedAt: null }));
    t.app.db._seedOrders(rows);
    const p1 = (await c.get('/api/payments?page=1&pageSize=100')).json; assert.equal(p1.total, 1000); assert.equal(p1.items.length, 100); assert.equal(p1.items[0].reference, 'BCSEED' + '999'.padStart(14, '0'));
    const seen = new Set<string>(); for (let p = 1; p <= 10; p++) for (const it of (await c.get(`/api/payments?page=${p}&pageSize=100`)).json.items) seen.add(it.id);
    assert.equal(seen.size, 1000, 'pages are disjoint and complete');
    assert.equal((await c.get('/api/payments?page=11&pageSize=100')).json.items.length, 0, 'past-the-end page is empty, not an error');
    assert.equal((await c.get('/api/payments')).json.items.length, 20, 'default page size');
  });
  it('pagination parameters are strictly validated', async () => {
    const c = await signedInClient(t, 'a04b');
    for (const q of ['page=0', 'page=-1', 'pageSize=101', 'pageSize=abc', 'page=1.5', 'page=1&page=2', 'pageSize=10&pageSize=1000', 'sort=desc', "page=1'--", 'page=99999999999']) { const r = await c.get(`/api/payments?${q}`); assert.equal(r.status, 400, q); shape(r); }
  });
  it("one user's history never includes another user's orders", async () => {
    const a = await signedInClient(t, 'a04c'); const b = await signedInClient(t, 'a04d'); await a.checkout('pro_monthly');
    assert.equal((await b.get('/api/payments')).json.total, 0); assert.equal((await a.get('/api/payments')).json.total, 1);
  });
});
void STRONG_PW;
