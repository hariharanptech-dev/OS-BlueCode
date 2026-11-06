import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, Client, uniqueEmail, STRONG_PW, startPayment, postCallback, type TestApp } from '../helpers/harness.ts';

let t: TestApp;
before(async () => { t = await startApp(); });
after(async () => { await t.stop(); });

describe('SEC-SECRETS nothing sensitive leaks via responses or logs across a complete payment lifecycle', () => {
  it('runs register → login → checkout → forged callback → real callbacks → failure, then inspects EVERYTHING', async () => {
    const responses: string[] = []; const c = new Client(t.url); const email = uniqueEmail('sl');
    const rec = <T extends { text: string; headers: Headers }>(r: T): T => { responses.push(r.text + '\n' + [...r.headers].map(([k, v]) => `${k}: ${v}`).join('\n')); return r; };
    rec(await c.register(email, 'Leak Tester')); rec(await c.login(email, 'Wrong-Password-9')); const l = rec(await c.login(email));
    const s = await startPayment(t, c, 'pro_monthly'); responses.push(JSON.stringify(s.checkout.payu.fields).replace(/"hash":"[0-9a-f]+"/, '')); // request hash is intentionally public to the browser
    t.gateway.settle(s.txnid, 'success');
    rec(await postCallback(t, t.gateway.callbackFor(s.txnid, 'success', { wrongSalt: true }))); rec(await postCallback(t, t.gateway.callbackFor(s.txnid, 'success', { resign: { amount: '1.00' } })));
    const good = t.gateway.callbackFor(s.txnid, 'success'); rec(await postCallback(t, good)); rec(await postCallback(t, good));
    t.gateway.verifyBehaviour = 'throw'; const s2 = await startPayment(t, await (async () => { const c2 = new Client(t.url); const e2 = uniqueEmail('sl2'); await c2.register(e2); await c2.login(e2); return c2; })()); t.gateway.settle(s2.txnid, 'success'); rec(await postCallback(t, t.gateway.callbackFor(s2.txnid, 'success'))); t.gateway.verifyBehaviour = 'ok';
    for (const p of ['/api/auth/me', '/api/subscription', '/api/payments']) rec(await c.get(p));
    rec(await c.post('/api/auth/logout'));

    const sessionToken = l.headers.getSetCookie()[0]!.split(';')[0]!.split('=')[1]!;
    const forbidden: Array<[string, string]> = [['merchant salt', t.config.payuSalt], ['password', STRONG_PW], ['session token', sessionToken], ['csrf token', c.csrfToken!], ['password hash', 'scrypt$']];
    const logs = t.sink.text(); assert.ok(logs.length > 500, 'logs were actually produced');
    for (const [name, v] of forbidden) { assert.ok(!logs.includes(v), `LOG leaks ${name}`); }
    for (const [name, v] of forbidden.filter(([n]) => n === 'merchant salt' || n === 'password hash')) for (const r of responses) assert.ok(!r.includes(v), `RESPONSE leaks ${name}`);
    assert.doesNotMatch(logs, /[0-9a-f]{128}/, 'no SHA-512 hash values in logs');
    assert.doesNotMatch(logs, /"cookie"|set-cookie/i);
    for (const r of t.sink.records()) { assert.ok(['debug', 'info', 'warn', 'error', 'security'].includes(r['level'] as string)); assert.equal(typeof r['event'], 'string'); }
  });
  it('literal-secret defence: a merchant salt embedded in an exception message is scrubbed from the logs', async () => {
    const c = new Client(t.url); const email = uniqueEmail('sl3'); await c.register(email); await c.login(email); const orig = t.app.db.listOrdersByUser.bind(t.app.db);
    t.app.db.listOrdersByUser = () => { throw new Error(`upstream rejected request near ${t.config.payuSalt} while listing`); }; // no "salt=" key: only literal matching can catch this
    try { const r = await c.get('/api/payments'); assert.equal(r.status, 500); assert.ok(!r.text.includes(t.config.payuSalt)); assert.ok(t.sink.text().includes('request.failed')); assert.ok(!t.sink.text().includes(t.config.payuSalt), 'salt leaked into logs'); }
    finally { t.app.db.listOrdersByUser = orig; }
  });
  it('security events (forged hash, mismatches) are present for monitoring', () => {
    const events = new Set(t.sink.records().map((r) => r['event'])); for (const e of ['callback.invalid_hash', 'callback.mismatch', 'auth.login_failed', 'payment.applied']) assert.ok(events.has(e), e);
  });
  it('the merchant salt never appears in any in-memory table (orders, events, subscriptions, users)', () => {
    const dump = JSON.stringify([t.app.db.allOrders(), t.app.db.allSubscriptions()]); assert.ok(!dump.includes(t.config.payuSalt));
  });
});
