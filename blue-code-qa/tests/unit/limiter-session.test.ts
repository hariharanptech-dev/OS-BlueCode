import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { SlidingWindowLimiter, FailureThrottle, clientIp, SessionStore, FakeClock, serializeCookie, parseCookies, safeRelativePath, escapeHtml } from '../../src/security/index.ts';

describe('SlidingWindowLimiter', () => {
  it('allows `limit` hits per window, then blocks with a Retry-After', () => {
    const clock = new FakeClock(); const l = new SlidingWindowLimiter({ limit: 3, windowMs: 60_000, clock });
    assert.ok(l.hit('a').allowed && l.hit('a').allowed && l.hit('a').allowed);
    const r = l.hit('a');
    assert.equal(r.allowed, false); assert.ok(r.retryAfterSec >= 1 && r.retryAfterSec <= 60);
  });
  it('window slides: capacity returns after the window passes', () => {
    const clock = new FakeClock(); const l = new SlidingWindowLimiter({ limit: 2, windowMs: 1000, clock });
    l.hit('k'); l.hit('k'); assert.equal(l.hit('k').allowed, false);
    clock.advance(1001); assert.equal(l.hit('k').allowed, true);
  });
  it('keys are independent', () => { const l = new SlidingWindowLimiter({ limit: 1, windowMs: 1000, clock: new FakeClock() }); assert.ok(l.hit('a').allowed); assert.ok(l.hit('b').allowed); assert.equal(l.hit('a').allowed, false); });
  it('memory is bounded under a key-flooding attack', () => {
    const l = new SlidingWindowLimiter({ limit: 1, windowMs: 60_000, clock: new FakeClock(), maxKeys: 100 });
    for (let i = 0; i < 1000; i++) l.hit('k' + i);
    assert.ok((l as any).hits.size <= 100);
  });
});

describe('FailureThrottle (brute-force lockout)', () => {
  it('locks after N failures, stays locked, unlocks after lock period', () => {
    const clock = new FakeClock(); const t = new FailureThrottle({ maxFailures: 3, lockMs: 900_000, clock });
    t.recordFailure('k'); t.recordFailure('k'); assert.equal(t.lockedFor('k'), 0);
    t.recordFailure('k'); assert.ok(t.lockedFor('k') > 0 && t.lockedFor('k') <= 900);
    clock.advance(899_000); assert.ok(t.lockedFor('k') > 0);
    clock.advance(2_000); assert.equal(t.lockedFor('k'), 0);
    t.recordFailure('k'); assert.equal(t.lockedFor('k'), 0, 'counter restarts after lock elapses');
  });
  it('success resets the counter', () => {
    const t = new FailureThrottle({ maxFailures: 2, lockMs: 1000, clock: new FakeClock() });
    t.recordFailure('k'); t.recordSuccess('k'); t.recordFailure('k'); assert.equal(t.lockedFor('k'), 0);
  });
});

describe('clientIp (X-Forwarded-For spoofing)', () => {
  const req = (xff: string | undefined, remote = '10.0.0.9') => ({ headers: xff ? { 'x-forwarded-for': xff } : {}, socket: { remoteAddress: remote } }) as unknown as IncomingMessage;
  it('ignores X-Forwarded-For entirely when no trusted proxy is configured', () => assert.equal(clientIp(req('1.2.3.4'), 0), '10.0.0.9'));
  it('with one trusted proxy uses the LAST hop (the one our proxy appended), not attacker-supplied prefix', () => assert.equal(clientIp(req('6.6.6.6, 203.0.113.7'), 1), '203.0.113.7'));
  it('falls back to the socket address when the header is absent or too short', () => { assert.equal(clientIp(req(undefined), 1), '10.0.0.9'); assert.equal(clientIp(req('1.1.1.1'), 3), '10.0.0.9'); });
});

describe('SessionStore', () => {
  const mk = (clock: FakeClock) => new SessionStore({ clock, idleMs: 30 * 60_000, absoluteMs: 8 * 3_600_000 });
  it('stores only a hash of the token', () => {
    const s = mk(new FakeClock()); const { token } = s.create('u1');
    assert.ok(!s._keysForTest().includes(token)); assert.equal(s._keysForTest()[0]!.length, 64);
    assert.ok(token.length >= 43, 'at least 256 bits of entropy');
  });
  it('tokens are unique and unpredictable-looking', () => { const s = mk(new FakeClock()); const set = new Set(Array.from({ length: 500 }, () => s.create('u').token)); assert.equal(set.size, 500); });
  it('idle timeout expires the session; activity extends it', () => {
    const c = new FakeClock(); const s = mk(c); const { token } = s.create('u');
    c.advanceMinutes(20); assert.equal(s.lookup(token).kind, 'ok');
    c.advanceMinutes(20); assert.equal(s.lookup(token).kind, 'ok', 'activity at +20 extended the idle window');
    c.advanceMinutes(31); assert.equal(s.lookup(token).kind, 'expired');
    assert.equal(s.lookup(token).kind, 'none', 'expired session is purged');
  });
  it('absolute lifetime applies even with constant activity', () => {
    const c = new FakeClock(); const s = mk(c); const { token } = s.create('u');
    for (let i = 0; i < 17; i++) { c.advanceMinutes(29); assert.equal(s.lookup(token).kind === 'expired', c.now().getTime() - new Date('2026-01-15T10:00:00Z').getTime() > 8 * 3_600_000); }
  });
  it('destroy and destroyAllForUser invalidate', () => {
    const s = mk(new FakeClock()); const a = s.create('u1'); const b = s.create('u1'); const c2 = s.create('u2');
    s.destroy(a.token); assert.equal(s.lookup(a.token).kind, 'none');
    s.destroyAllForUser('u1'); assert.equal(s.lookup(b.token).kind, 'none'); assert.equal(s.lookup(c2.token).kind, 'ok');
  });
  it('rejects missing / forged tokens', () => { const s = mk(new FakeClock()); assert.equal(s.lookup(undefined).kind, 'none'); assert.equal(s.lookup('forged').kind, 'none'); });
});

describe('cookies & output helpers', () => {
  it('serialises security attributes', () => {
    const c = serializeCookie('__Host-sid', 'a b', { secure: true, httpOnly: true, sameSite: 'Strict', maxAgeSec: 60 });
    assert.match(c, /HttpOnly/); assert.match(c, /Secure/); assert.match(c, /SameSite=Strict/); assert.match(c, /Path=\//); assert.match(c, /Max-Age=60/); assert.ok(!/Domain=/.test(c));
    assert.ok(c.startsWith('__Host-sid=a%20b'));
  });
  it('defaults to HttpOnly + SameSite=Lax', () => { const c = serializeCookie('x', 'y'); assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Lax/); });
  it('parses cookies defensively', () => {
    assert.deepEqual({ ...parseCookies('a=1; b=2') }, { a: '1', b: '2' });
    assert.deepEqual({ ...parseCookies('=bad; ok=1; %=%E0%A4%A') }, { ok: '1' });
    assert.deepEqual({ ...parseCookies('x'.repeat(5000)) }, {});
    assert.equal(parseCookies('__proto__=x')['__proto__'], 'x'); // null-prototype object: no pollution
    assert.equal(({} as any).x, undefined);
  });
  it('escapeHtml neutralises markup and attribute breaks', () => assert.equal(escapeHtml(`<img src="x" onerror='a'>&\``), '&lt;img src=&quot;x&quot; onerror=&#39;a&#39;&gt;&amp;&#96;'));
  it('safeRelativePath blocks open redirects', () => {
    assert.equal(safeRelativePath('/checkout?plan=pro_monthly'), '/checkout?plan=pro_monthly');
    for (const bad of ['//evil.com', 'https://evil.com', 'javascript:alert(1)', '/\\evil.com', '\\\\evil.com', 'evil.com', '/a b', '/<script>']) assert.equal(safeRelativePath(bad), '/pricing', bad);
    assert.equal(safeRelativePath(null), '/pricing');
  });
});
