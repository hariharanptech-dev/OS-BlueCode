import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signedInClient, startPayment, postCallback, Client, uniqueEmail, STRONG_PW, orderOf, type TestApp } from '../helpers/harness.ts';

let t: TestApp;
before(async () => { t = await startApp(); });
after(async () => { await t.stop(); });
const EVIL = 'https://evil.example';

describe('SEC-CSRF cookie-authenticated state changes need a token AND a trusted origin', () => {
  it('login CSRF: cross-origin login is refused', async () => {
    const c = new Client(t.url); const e = uniqueEmail('cs1'); await c.register(e); const r = await c.post('/api/auth/login', { json: { email: e, password: STRONG_PW }, origin: EVIL }); assert.equal(r.status, 403); assert.equal(r.json.error.code, 'FORBIDDEN_ORIGIN'); assert.equal(c.jar.size, 0);
  });
  it('registration from a foreign origin is refused; the "null" origin too', async () => {
    assert.equal((await new Client(t.url).post('/api/auth/register', { json: { name: 'A', email: uniqueEmail('cs2'), password: STRONG_PW }, origin: EVIL })).status, 403);
    assert.equal((await new Client(t.url).post('/api/auth/login', { json: { email: 'a@b.co', password: 'x' }, origin: 'null' })).status, 403);
  });
  it('checkout without a CSRF token → 403 and no order is created', async () => {
    const c = await signedInClient(t, 'cs3'); const r = await c.post('/api/payments/checkout', { csrf: null, json: { planId: 'pro_monthly', customer: { firstname: 'A', email: 'a@b.co', phone: '9876543210' } } });
    assert.equal(r.status, 403); assert.equal(r.json.error.code, 'CSRF_FAILED'); assert.equal(t.app.db.allOrders().filter((o) => o.userId === c.userId).length, 0);
  });
  it('wrong, empty, truncated or other-session CSRF tokens are refused', async () => {
    const a = await signedInClient(t, 'cs4a'); const b = await signedInClient(t, 'cs4b');
    for (const tok of ['wrong', 'x'.repeat(200), a.csrfToken!.slice(0, -1), b.csrfToken!]) { const r = await a.checkout('pro_monthly'); void r; const rr = await a.post('/api/payments/checkout', { csrf: tok, json: { planId: 'pro_monthly', customer: { firstname: 'A', email: 'a@b.co', phone: '9876543210' } } }); assert.equal(rr.status, 403, tok.slice(0, 10)); }
  });
  it('a valid token from a foreign origin is still refused', async () => {
    const c = await signedInClient(t, 'cs5'); const r = await c.post('/api/payments/checkout', { origin: EVIL, json: { planId: 'pro_monthly', customer: { firstname: 'A', email: 'a@b.co', phone: '9876543210' } } }); assert.equal(r.status, 403);
  });
  it('logout and refresh are CSRF-protected (cannot be forced cross-site)', async () => {
    const c = await signedInClient(t, 'cs6'); const s = await startPayment(t, c);
    assert.equal((await c.post('/api/auth/logout', { csrf: null })).status, 403); assert.equal((await c.post(`/api/payments/${s.orderId}/refresh`, { csrf: null })).status, 403); assert.equal((await c.get('/api/auth/me')).status, 200, 'still signed in');
  });
  it('safe (GET) requests do not require tokens', async () => { const c = await signedInClient(t, 'cs7'); assert.equal((await c.get('/api/subscription', { csrf: null })).status, 200); });
  it('payment callbacks are CSRF-EXEMPT by design (PayU posts cross-site) but still require a valid hash', async () => {
    const c = await signedInClient(t, 'cs8'); const s = await startPayment(t, c); t.gateway.settle(s.txnid, 'success');
    assert.equal((await postCallback(t, t.gateway.callbackFor(s.txnid, 'success', { wrongSalt: true }), { origin: EVIL })).status, 400);
    assert.equal((await postCallback(t, t.gateway.callbackFor(s.txnid, 'success'), { origin: EVIL })).status, 303); assert.equal(orderOf(t, s.orderId).status, 'success');
  });
  it('CSRF failures are logged as security events', async () => { assert.ok(t.sink.records().some((r) => r['event'] === 'csrf.rejected')); });
});

describe('SEC-CORS', () => {
  it('foreign origins get no CORS headers (browser blocks the read)', async () => {
    const r = await new Client(t.url).get('/api/plans', { origin: EVIL }); assert.equal(r.headers.get('access-control-allow-origin'), null); assert.equal(r.headers.get('access-control-allow-credentials'), null);
  });
  it('allow-listed origin is echoed exactly (never "*") with credentials and Vary: Origin', async () => {
    const r = await new Client(t.url).get('/api/plans'); assert.equal(r.headers.get('access-control-allow-origin'), t.url); assert.equal(r.headers.get('access-control-allow-credentials'), 'true'); assert.match(r.headers.get('vary') ?? '', /Origin/);
  });
  it('never uses a wildcard origin on any endpoint', async () => {
    for (const p of ['/api/plans', '/api/health', '/api/nope', '/api/auth/me']) { for (const o of [EVIL, t.url, 'null']) assert.notEqual((await new Client(t.url).get(p, { origin: o })).headers.get('access-control-allow-origin'), '*'); }
  });
  it('prefix / suffix / scheme-confusion lookalike origins are rejected', async () => {
    for (const o of [t.url + '.evil.example', t.url.replace('http:', 'https:'), t.url + '/', 'http://127.0.0.1.evil.example', t.url.toUpperCase()]) assert.equal((await new Client(t.url).get('/api/plans', { origin: o })).headers.get('access-control-allow-origin'), null, o);
  });
  it('preflight from a foreign origin is denied; from the app origin is approved with a tight method/header list', async () => {
    const bad = await new Client(t.url).request('OPTIONS', '/api/payments/checkout', { origin: EVIL, headers: { 'Access-Control-Request-Method': 'POST' } }); assert.equal(bad.status, 403); assert.equal(bad.headers.get('access-control-allow-methods'), null);
    const ok = await new Client(t.url).request('OPTIONS', '/api/payments/checkout', { origin: t.url, headers: { 'Access-Control-Request-Method': 'POST' } }); assert.equal(ok.status, 204);
    assert.equal(ok.headers.get('access-control-allow-methods'), 'GET,POST,OPTIONS'); assert.ok(!/\*/.test(ok.headers.get('access-control-allow-headers') ?? ''));
  });
});

describe('SEC-HDR security headers and frontend CSP compliance', () => {
  const paths = ['/', '/login', '/pricing', '/dashboard', '/static/app.js', '/api/plans', '/api/nope'];
  it('every response has the full header set', async () => {
    for (const p of paths) { const h = (await new Client(t.url).get(p)).headers;
      assert.equal(h.get('x-content-type-options'), 'nosniff', p); assert.equal(h.get('x-frame-options'), 'DENY', p); assert.ok(h.get('referrer-policy'), p); assert.ok(h.get('permissions-policy'), p); assert.ok(h.get('content-security-policy'), p); assert.equal(h.get('cross-origin-opener-policy'), 'same-origin', p); }
  });
  it('CSP forbids inline/eval/wildcard sources and framing; form-action is restricted', async () => {
    const csp = (await new Client(t.url).get('/')).headers.get('content-security-policy')!;
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*/);
    for (const d of csp.split(';').map((x) => x.trim())) if (/data:/.test(d)) assert.ok(d.startsWith('img-src'), `data: allowed outside img-src: ${d}`); for (const d of ["default-src 'self'", "script-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'"]) assert.ok(csp.includes(d), d);
  });
  it('production-style config adds the PayU origin to form-action and HSTS; sandbox/mock does not widen anything else', async () => {
    const s = await startApp({ config: { cookieSecure: true, payuBaseUrl: 'https://secure.payu.in/_payment' } });
    try { const h = (await new Client(s.url).get('/')).headers; assert.match(h.get('content-security-policy')!, /form-action 'self' https:\/\/secure\.payu\.in(;|$)/); assert.ok(h.get('strict-transport-security')); } finally { await s.stop(); }
  });
  it('HTML pages contain no inline scripts, inline styles or inline event handlers (CSP-clean, XSS-resistant)', async () => {
    for (const p of ['/', '/register', '/login', '/pricing', '/checkout', '/payment/result', '/dashboard']) {
      const html = (await new Client(t.url).get(p)).text; assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, `${p} inline script`); assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${p} inline handler`); assert.doesNotMatch(html, /\sstyle\s*=/i, `${p} inline style`); assert.doesNotMatch(html, /javascript:/i, p);
    }
  });
  it('client script never uses dangerous sinks (innerHTML / eval / document.write)', async () => {
    const js = (await new Client(t.url).get('/static/app.js')).text; assert.doesNotMatch(js, /\.innerHTML|\.outerHTML|insertAdjacentHTML|eval\(|new Function|document\.write/);
  });
  it('responses do not advertise server technology', async () => { const h = (await new Client(t.url).get('/')).headers; assert.equal(h.get('x-powered-by'), null); assert.equal(h.get('server'), null); });
  it('mock-PayU routes exist only when explicitly enabled', async () => {
    const s = await startApp({ config: { mockPayuUi: false } }); try { assert.equal((await new Client(s.url).request('POST', '/__mock-payu/pay', { form: { a: 'b' } })).status, 404); } finally { await s.stop(); }
  });
});
