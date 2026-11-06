import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signedInClient, startPayment, postCallback, Client, uniqueEmail, STRONG_PW, type TestApp } from '../helpers/harness.ts';

let t: TestApp;
before(async () => { t = await startApp(); });
after(async () => { await t.stop(); });

const SQLI = ["' OR '1'='1", "'; DROP TABLE users;--", "1' UNION SELECT salt FROM config--", '" OR ""="', "admin'--", '1; SELECT pg_sleep(5)', "\\'; EXEC xp_cmdshell('dir')--"];
const XSS = ['<script>window.__x=1</script>', '<img src=x onerror=window.__x=1>', '"><svg onload=window.__x=1>', 'javascript:window.__x=1', '{{constructor.constructor("window.__x=1")()}}'];
const noServerError = (r: { status: number }, what: string) => assert.ok(r.status < 500, `${what} → ${r.status}`);

describe('SEC-INJ SQL-injection style input never causes errors or data exposure', () => {
  it('login / register fields', async () => {
    for (const p of SQLI) { const c = new Client(t.url);
      noServerError(await c.post('/api/auth/login', { json: { email: p, password: p } }), 'login'); noServerError(await c.post('/api/auth/register', { json: { name: p, email: p, password: p } }), 'register');
      assert.equal((await c.post('/api/auth/login', { json: { email: `${p}@x.co`, password: p } })).status === 200, false); }
  });
  it('password field containing SQL is treated as opaque data (and a normal login still works)', async () => {
    const e = uniqueEmail('inj1'); const pw = "Pa55'; DROP TABLE users;--xyz"; const c = new Client(t.url); assert.equal((await c.register(e, 'Asha', pw)).status, 201); assert.equal((await c.login(e, pw)).status, 200);
  });
  it('path, query and header inputs', async () => {
    const c = await signedInClient(t, 'inj2');
    for (const p of SQLI) {
      noServerError(await c.get('/api/payments/' + encodeURIComponent(p)), 'path'); noServerError(await c.get('/api/payments?page=' + encodeURIComponent(p)), 'query'); noServerError(await c.checkout(p), 'planId');
      noServerError(await c.post('/api/payments/checkout', { headers: { 'Idempotency-Key': p.replace(/[^\x20-\x7e]/g, '') || 'x' }, json: { planId: 'pro_monthly', customer: { firstname: 'A', email: 'a@b.co', phone: '9876543210' } } }), 'idem');
    }
  });
  it('callback fields (even with a VALID hash over hostile values) are rejected cleanly and change nothing', async () => {
    const c = await signedInClient(t, 'inj3'); const s = await startPayment(t, c); const before = JSON.stringify(t.app.db.allOrders().map((o) => [o.id, o.status]));
    for (const p of SQLI) for (const field of ['txnid', 'udf1', 'productinfo', 'email', 'firstname', 'mihpayid']) { const r = await postCallback(t, t.gateway.callbackFor(s.txnid, 'success', { resign: { [field]: p } })); assert.ok(r.status === 400 || r.status === 303, `${field}: ${r.status}`); noServerError(r, field); }
    assert.equal(JSON.stringify(t.app.db.allOrders().map((o) => [o.id, o.status])), before, 'no state change');
  });
});

describe('SEC-XSS', () => {
  it('hostile names are rejected by the API (cannot be stored and later rendered)', async () => {
    for (const p of XSS) { const r = await new Client(t.url).register(uniqueEmail('xss'), p); assert.equal(r.status, 400, p); const c = await signedInClient(t, 'xss2'); assert.equal((await c.checkout('pro_monthly', { customer: { firstname: p, email: 'a@b.co', phone: '9876543210' } })).status, 400, p); }
  });
  it('API errors and 404s never reflect attacker-controlled input', async () => {
    const c = await signedInClient(t, 'xss3');
    for (const p of XSS) { for (const r of [await c.get('/api/' + encodeURIComponent(p)), await c.get('/api/payments/' + encodeURIComponent(p)), await new Client(t.url).post('/api/auth/login', { json: { email: p, password: p } })]) { assert.ok(!r.text.includes('<script') && !r.text.includes('onerror') && !r.text.includes('onload'), p); assert.match(r.headers.get('content-type') ?? '', /application\/json/); } }
  });
  it('mock hosted-payment page HTML-escapes everything it prints', async () => {
    const r = await new Client(t.url).request('POST', '/__mock-payu/pay', { form: { key: '"><script>x</script>', hash: 'x' } }); assert.equal(r.status, 400); assert.ok(!r.text.includes('<script>x'));
  });
  it('JSON responses are served as application/json with nosniff (cannot be sniffed into HTML)', async () => { const r = await new Client(t.url).get('/api/plans'); assert.match(r.headers.get('content-type')!, /^application\/json/); assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); });
});

describe('SEC-INJ other injection classes', () => {
  it('prototype pollution payloads are rejected and do not touch Object.prototype', async () => {
    const c = await signedInClient(t, 'pp');
    for (const body of ['{"__proto__":{"admin":true},"email":"a@b.co","password":"x"}', '{"constructor":{"prototype":{"admin":true}},"email":"a@b.co","password":"x"}']) { assert.equal((await new Client(t.url).post('/api/auth/login', { rawBody: body })).status, 400); assert.equal((await c.post('/api/payments/checkout', { rawBody: body.replace('"email"', '"planId":"pro_monthly","email"') })).status, 400); }
    assert.equal(({} as any).admin, undefined);
  });
  it('NoSQL-style operator objects are rejected', async () => { for (const email of [{ $ne: null }, { $gt: '' }, ['a@b.co'], true, 1]) assert.equal((await new Client(t.url).post('/api/auth/login', { json: { email, password: 'x' } })).status, 400); });
  it('header injection attempts via Idempotency-Key are rejected by validation', async () => { const c = await signedInClient(t, 'hi'); for (const k of ['a'.repeat(8) + '%0d%0aX-Injected: 1', 'abc def ghi', 'a;b;c;d;e;f;g']) assert.equal((await c.checkout('pro_monthly', { idem: k })).status, 400); });
  it('HTTP parameter pollution on pagination is rejected', async () => { const c = await signedInClient(t, 'hpp'); assert.equal((await c.get('/api/payments?page=1&page=2')).status, 400); });
  it('duplicate JSON keys / huge nesting do not crash the server', async () => {
    const c = new Client(t.url); assert.ok((await c.post('/api/auth/login', { rawBody: '{"email":"a@b.co","email":"c@d.co","password":"x"}' })).status < 500);
    assert.ok((await c.post('/api/auth/login', { rawBody: '['.repeat(5000) + ']'.repeat(5000) })).status < 500);
  });
});

describe('SEC-LEAK internal details never reach the client', () => {
  it('database outage → 503 with a generic message; the detail appears only in server logs', async () => {
    const c = await signedInClient(t, 'lk1'); t.app.db.injectFailure('listOrdersByUser', 1);
    const r = await c.get('/api/payments'); assert.equal(r.status, 503); assert.equal(r.json.error.code, 'DB_UNAVAILABLE'); assert.doesNotMatch(r.text, /listOrdersByUser|injected|postgres|sql|connection/i);
    assert.ok(t.sink.records().some((l) => l['event'] === 'request.failed' && l['code'] === 'DB_UNAVAILABLE'), 'logged server-side');
    assert.equal((await c.get('/api/payments')).status, 200, 'recovers on the next request');
  });
  it('an unexpected exception → 500 INTERNAL_ERROR with no stack, path or message', async () => {
    const c = await signedInClient(t, 'lk2'); const orig = t.app.db.getOrder.bind(t.app.db);
    t.app.db.getOrder = () => { throw new TypeError("Cannot read properties of undefined (reading 'secret') at /srv/app/src/db.ts:42:7 password=hunter2"); };
    try { const r = await c.get('/api/payments/3f2504e0-4f89-41d3-9a0c-0305e82c3301'); assert.equal(r.status, 500); assert.equal(r.json.error.code, 'INTERNAL_ERROR'); assert.doesNotMatch(r.text, /TypeError|Cannot read|\/srv|db\.ts|hunter2|stack/); assert.deepEqual(Object.keys(r.json), ['error']);
      const logs = t.sink.text(); assert.ok(logs.includes('request.failed')); assert.ok(!logs.includes('hunter2'), 'password embedded in an error message must be scrubbed from logs');
    } finally { t.app.db.getOrder = orig; }
  });
  it('callback processing errors never expose internals to PayU or the browser', async () => {
    const c = await signedInClient(t, 'lk3'); const s = await startPayment(t, c); t.gateway.settle(s.txnid, 'success'); t.app.db.injectFailure('getOrderByTxnid', 1);
    const r = await postCallback(t, t.gateway.callbackFor(s.txnid, 'success')); assert.equal(r.status, 503); assert.doesNotMatch(r.text, /getOrderByTxnid|injected/);
  });
  it('DB failure during callback: PayU can retry (5xx) and the retry succeeds exactly once', async () => {
    const c = await signedInClient(t, 'lk4'); const s = await startPayment(t, c); t.gateway.settle(s.txnid, 'success'); const p = t.gateway.callbackFor(s.txnid, 'success'); t.app.db.injectFailure('updateOrder', 1);
    assert.equal((await postCallback(t, p, { path: '/api/payments/payu/webhook' })).status, 503);
    assert.equal(t.app.db.getOrder(s.orderId)!.status, 'pending'); assert.equal(t.app.db.allSubscriptions().filter((x) => x.paymentId === s.orderId).length, 0);
    assert.equal((await postCallback(t, p, { path: '/api/payments/payu/webhook' })).status, 200); assert.equal(t.app.db.allSubscriptions().filter((x) => x.paymentId === s.orderId).length, 1);
  });
  it('registering reveals nothing beyond a generic conflict (documented low-risk enumeration trade-off)', async () => {
    const e = uniqueEmail('lk5'); await new Client(t.url).register(e); const r = await new Client(t.url).register(e); assert.equal(r.status, 409); assert.doesNotMatch(r.text, /already|exists|registered/i);
  });
});
void STRONG_PW;
