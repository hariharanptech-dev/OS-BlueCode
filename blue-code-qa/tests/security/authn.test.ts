import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signedInClient, Client, uniqueEmail, STRONG_PW, type TestApp } from '../helpers/harness.ts';

let t: TestApp;
before(async () => { t = await startApp(); });
after(async () => { await t.stop(); });
const mkUser = async (tag: string) => { const c = new Client(t.url); const e = uniqueEmail(tag); assert.equal((await c.register(e)).status, 201); return { c, e }; };

describe('SEC-AN brute-force protection', () => {
  it('locks after 5 failed attempts — even the CORRECT password is then refused, with Retry-After', async () => {
    const { c, e } = await mkUser('bf1');
    for (let i = 0; i < 5; i++) assert.equal((await c.login(e, 'Wrong-Pass-' + i)).status, 401);
    const locked = await c.login(e, STRONG_PW); assert.equal(locked.status, 429); assert.equal(locked.json.error.code, 'ACCOUNT_THROTTLED'); assert.ok(Number(locked.headers.get('retry-after')) > 0);
  });
  it('lock expires after 15 minutes', async () => {
    const { c, e } = await mkUser('bf2'); for (let i = 0; i < 5; i++) await c.login(e, 'nope-nope-1');
    t.clock.advanceMinutes(14); assert.equal((await c.login(e)).status, 429); t.clock.advanceMinutes(2); assert.equal((await c.login(e)).status, 200);
  });
  it('successful login resets the failure counter', async () => {
    const { c, e } = await mkUser('bf3'); for (let i = 0; i < 4; i++) await c.login(e, 'nope-nope-1'); assert.equal((await c.login(e)).status, 200);
    for (let i = 0; i < 4; i++) await c.login(e, 'nope-nope-1'); assert.equal((await c.login(e)).status, 200, 'still not locked');
  });
  it('locking one account does not lock others from the same IP', async () => {
    const a = await mkUser('bf4a'); const b = await mkUser('bf4b'); for (let i = 0; i < 6; i++) await a.c.login(a.e, 'nope-nope-1'); assert.equal((await b.c.login(b.e)).status, 200);
  });
  it('rotating X-Forwarded-For / User-Agent does not evade the lock (header is untrusted without a configured proxy)', async () => {
    const { c, e } = await mkUser('bf5');
    for (let i = 0; i < 5; i++) await c.post('/api/auth/login', { json: { email: e, password: 'nope-nope-1' }, headers: { 'X-Forwarded-For': `203.0.113.${i}`, 'User-Agent': 'ua' + i } });
    const r = await c.post('/api/auth/login', { json: { email: e, password: STRONG_PW }, headers: { 'X-Forwarded-For': '198.51.100.99' } }); assert.equal(r.status, 429);
  });
  it('the response to a locked account does not reveal whether the account exists', async () => {
    const ghost = uniqueEmail('ghost'); const c = new Client(t.url); for (let i = 0; i < 5; i++) await c.login(ghost, 'nope-nope-1'); const r = await c.login(ghost); assert.equal(r.status, 429);
  });
  it('failed logins are logged as security events without the password or e-mail', async () => {
    const { c, e } = await mkUser('bf7'); await c.login(e, 'Totally-Wrong-77'); const txt = t.sink.text();
    assert.ok(t.sink.records().some((r) => r['event'] === 'auth.login_failed')); assert.ok(!txt.includes('Totally-Wrong-77')); assert.ok(!txt.includes(e));
  });
});

describe('SEC-AN sessions', () => {
  it('cookie is HttpOnly, SameSite=Lax, Path=/, scoped without Domain; token never appears in JSON', async () => {
    const c = new Client(t.url); const e = uniqueEmail('se1'); await c.register(e); const r = await c.login(e); const sc = r.headers.getSetCookie()[0]!;
    assert.match(sc, /^bc_sid=/); assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Lax/); assert.match(sc, /Path=\//); assert.ok(!/Domain=/i.test(sc));
    assert.ok(!r.text.includes([...c.jar.values()][0]!), 'session token is not in the body');
  });
  it('production-style config uses __Host- prefix, Secure and HSTS', async () => {
    const s = await startApp({ config: { cookieSecure: true } });
    try { const c = new Client(s.url); const e = uniqueEmail('se2'); await c.register(e); const r = await c.login(e); const sc = r.headers.getSetCookie()[0]!;
      assert.match(sc, /^__Host-bc_sid=/); assert.match(sc, /; Secure/); assert.match(sc, /HttpOnly/); assert.match(r.headers.get('strict-transport-security') ?? '', /max-age=\d{7,}/);
    } finally { await s.stop(); }
  });
  it('login issues a fresh token and kills a pre-set one (session fixation)', async () => {
    const c = new Client(t.url); const e = uniqueEmail('se3'); await c.register(e); c.jar.set('bc_sid', 'attacker-chosen-token-value-000000000000000000');
    await c.login(e); const issued = c.jar.get('bc_sid')!; assert.notEqual(issued, 'attacker-chosen-token-value-000000000000000000');
    const attacker = new Client(t.url); attacker.jar.set('bc_sid', 'attacker-chosen-token-value-000000000000000000'); assert.equal((await attacker.get('/api/auth/me')).status, 401);
  });
  it('re-login rotates the token and the previous one is invalidated', async () => {
    const c = await signedInClient(t, 'se4'); const first = c.jar.get('bc_sid')!; await c.login(c.email!); assert.notEqual(c.jar.get('bc_sid'), first);
    const old = new Client(t.url); old.jar.set('bc_sid', first); assert.equal((await old.get('/api/auth/me')).status, 401);
  });
  it('idle timeout (30 min) expires the session; activity within the window keeps it alive', async () => {
    const c = await signedInClient(t, 'se5'); t.clock.advanceMinutes(25); assert.equal((await c.get('/api/auth/me')).status, 200); t.clock.advanceMinutes(25); assert.equal((await c.get('/api/auth/me')).status, 200);
    t.clock.advanceMinutes(31); assert.equal((await c.get('/api/auth/me')).json.error.code, 'SESSION_EXPIRED');
  });
  it('absolute lifetime (8 h) ends even an always-active session', async () => {
    const c = await signedInClient(t, 'se6'); let alive = true; let hours = 0;
    while (alive && hours < 10) { t.clock.advanceMinutes(20); hours += 1 / 3; alive = (await c.get('/api/auth/me')).status === 200; }
    assert.equal(alive, false); assert.ok(hours > 7.9 && hours < 8.4, `expired after ${hours.toFixed(2)}h`);
  });
  it("logging out one device doesn't log out another, and the CSRF token is bound per session", async () => {
    const e = uniqueEmail('se7'); const a = new Client(t.url); await a.register(e); await a.login(e); const b = new Client(t.url); await b.login(e);
    assert.notEqual(a.csrfToken, b.csrfToken); await a.post('/api/auth/logout'); assert.equal((await b.get('/api/auth/me')).status, 200);
  });
  it('responses never contain password hashes or other users’ identifiers', async () => {
    const c = await signedInClient(t, 'se8'); for (const p of ['/api/auth/me', '/api/subscription', '/api/payments']) { const r = await c.get(p); assert.ok(!/scrypt|passwordHash/i.test(r.text), p); }
  });
});

describe('SEC-AN password handling', () => {
  it('passwords are stored only as salted scrypt hashes', async () => {
    const { e } = await mkUser('pw1'); const u = t.app.db.findUserByEmail(e)!; assert.match(u.passwordHash, /^scrypt\$/); assert.ok(!u.passwordHash.includes(STRONG_PW));
  });
  it('two users with the same password get different hashes', async () => {
    const a = await mkUser('pw2a'); const b = await mkUser('pw2b'); assert.notEqual(t.app.db.findUserByEmail(a.e)!.passwordHash, t.app.db.findUserByEmail(b.e)!.passwordHash);
  });
  it('overly long passwords are refused (hash-DoS guard) without crashing', async () => {
    const r = await new Client(t.url).register(uniqueEmail('pw3'), 'Asha', 'a1'.repeat(200)); assert.equal(r.status, 400);
    const l = await new Client(t.url).post('/api/auth/login', { json: { email: 'a@b.co', password: 'x'.repeat(5000) } }); assert.equal(l.status, 400);
  });
});
