import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signedInClient, completePayment, startPayment, postCallback, subsOf, type TestApp } from '../helpers/harness.ts';
import { UniqueViolation } from '../../src/reference/db.ts';
import { assertInvariants } from '../helpers/invariants.ts';

let t: TestApp;
before(async () => { t = await startApp(); });
after(async () => { await t.stop(); });
const mine = (uid: string) => subsOf(t).filter((s) => s.userId === uid);

describe('S-01 activation rules', () => {
  it('activates after verified success with the right plan, user and expiry', async () => {
    const c = await signedInClient(t, 's01'); const now = t.clock.now();
    await completePayment(t, c, 'success', 'pro_monthly');
    const [s] = mine(c.userId!); assert.ok(s);
    assert.equal(s.userId, c.userId); assert.equal(s.planId, 'pro_monthly');
    assert.equal(s.startsAt, now.toISOString()); assert.equal(s.expiresAt, '2026-02-15T10:00:00.000Z');
  });
  it('yearly plan expires one calendar year later', async () => {
    const c = await signedInClient(t, 's01b'); await completePayment(t, c, 'success', 'pro_yearly'); assert.equal(mine(c.userId!)[0]!.expiresAt, '2027-01-15T10:00:00.000Z');
  });
  it('does not activate after failure or cancellation', async () => {
    const c = await signedInClient(t, 's01c'); await completePayment(t, c, 'failure'); await completePayment(t, c, 'cancel', 'pro_monthly');
    assert.equal(mine(c.userId!).length, 0); const sub = (await c.get('/api/subscription')).json; assert.equal(sub.current, null); assert.deepEqual(sub.history, []);
  });
  it('activation is assigned to the user who started checkout, not to identities inside the callback', async () => {
    const a = await signedInClient(t, 's01d'); const b = await signedInClient(t, 's01e');
    const r = await completePayment(t, a, 'success', 'starter_monthly', { resign: { email: b.email!, firstname: 'Mallory' } });
    assert.equal(r.cb.status, 303); assert.equal(mine(a.userId!).length, 1); assert.equal(mine(b.userId!).length, 0);
  });
  it('end-of-month purchase clamps correctly (Jan 31 → Feb 28)', async () => {
    const t2 = await startApp({ start: '2026-01-31T09:00:00.000Z' });
    try { const c = await signedInClient(t2, 's01f'); await completePayment(t2, c, 'success', 'starter_monthly'); assert.equal(subsOf(t2)[0]!.expiresAt, '2026-02-28T09:00:00.000Z'); } finally { await t2.stop(); }
  });
  it('one payment → one subscription even if activation is attempted again at the DB layer (UNIQUE backstop)', async () => {
    const c = await signedInClient(t, 's01g'); const r = await completePayment(t, c, 'success');
    assert.throws(() => t.app.db.insertSubscription({ userId: c.userId!, planId: 'starter_monthly', paymentId: r.orderId, startsAt: 'x', expiresAt: 'y', createdAt: 'z' }), UniqueViolation);
    assert.equal(mine(c.userId!).length, 1);
  });
});

describe('S-02 expiry & history', () => {
  it('reports active before expiry, nothing current after, and keeps the record as history', async () => {
    const c = await signedInClient(t, 's02'); await completePayment(t, c, 'success', 'starter_monthly');
    t.clock.advanceDays(29); await c.relogin(); let sub = (await c.get('/api/subscription')).json;
    assert.equal(sub.current.status, 'active');
    t.clock.advanceDays(2); await c.relogin(); sub = (await c.get('/api/subscription')).json;
    assert.equal(sub.current, null); assert.equal(sub.history.length, 1); assert.equal(sub.history[0].status, 'expired');
  });
  it('expiry boundary is exclusive: at exactly expiresAt the subscription is expired', async () => {
    const c = await signedInClient(t, 's02b'); await completePayment(t, c, 'success', 'starter_monthly');
    t.clock.set(mine(c.userId!)[0]!.expiresAt); await c.relogin(); assert.equal((await c.get('/api/subscription')).json.current, null);
    t.clock.set('2026-01-15T10:00:00.000Z');
  });
  it('after expiry the customer can buy again, and history keeps both records', async () => {
    const c = await signedInClient(t, 's02c'); await completePayment(t, c, 'success', 'starter_monthly'); t.clock.advanceDays(40); await c.relogin();
    const r = await c.checkout('pro_monthly'); assert.equal(r.status, 201);
    t.gateway.registerInitiation(r.json.payu.fields); t.gateway.settle(r.json.txnid, 'success'); await postCallback(t, t.gateway.callbackFor(r.json.txnid, 'success'));
    const sub = (await c.get('/api/subscription')).json; assert.equal(sub.history.length, 2); assert.equal(sub.current.planId, 'pro_monthly');
    assert.equal(sub.current.startsAt, t.clock.now().toISOString(), 'new period starts now when nothing is running');
    t.clock.set('2026-01-15T10:00:00.000Z');
  });
  it('subscriptions of different users are isolated', async () => {
    const a = await signedInClient(t, 's02d'); const b = await signedInClient(t, 's02e'); await completePayment(t, a, 'success');
    assert.equal((await b.get('/api/subscription')).json.history.length, 0); assert.equal((await a.get('/api/subscription')).json.history.length, 1);
  });
  it('a ?userId= query cannot be used to read someone else’s subscription', async () => {
    const a = await signedInClient(t, 's02f'); const b = await signedInClient(t, 's02g'); await completePayment(t, a, 'success');
    const r = await b.get(`/api/subscription?userId=${a.userId}`); assert.equal(r.json.history.length, 0); assert.equal(r.json.current, null);
  });
});

describe('S-03 renewal and checkout rules while subscribed', () => {
  it('buying a DIFFERENT plan while active is refused (409) and creates no order', async () => {
    const c = await signedInClient(t, 's03'); await completePayment(t, c, 'success', 'starter_monthly');
    const n = t.app.db.allOrders().length; const r = await c.checkout('pro_monthly'); assert.equal(r.status, 409); assert.equal(r.json.error.code, 'SUBSCRIPTION_ACTIVE'); assert.equal(t.app.db.allOrders().length, n);
  });
  it('same-plan purchase far from expiry is refused (prevents accidental double charge)', async () => {
    const c = await signedInClient(t, 's03b'); await completePayment(t, c, 'success', 'starter_monthly'); t.clock.advanceDays(5);
    await c.relogin(); assert.equal((await c.checkout('starter_monthly')).status, 409); t.clock.set('2026-01-15T10:00:00.000Z');
  });
  it('same-plan renewal within 7 days of expiry is allowed and STACKS after the current period (no lost days)', async () => {
    const c = await signedInClient(t, 's03c'); await completePayment(t, c, 'success', 'starter_monthly'); const firstExpiry = mine(c.userId!)[0]!.expiresAt;
    t.clock.advanceDays(25); await c.relogin(); const r = await c.checkout('starter_monthly'); assert.equal(r.status, 201);
    t.gateway.registerInitiation(r.json.payu.fields); t.gateway.settle(r.json.txnid, 'success'); await postCallback(t, t.gateway.callbackFor(r.json.txnid, 'success'));
    const sub = (await c.get('/api/subscription')).json;
    assert.equal(sub.history.length, 2); assert.equal(sub.current.expiresAt, firstExpiry, 'current period untouched');
    assert.equal(sub.upcoming.length, 1); assert.equal(sub.upcoming[0].startsAt, firstExpiry); assert.equal(sub.upcoming[0].status, 'scheduled'); assert.equal(sub.upcoming[0].expiresAt, '2026-03-15T10:00:00.000Z');
    t.clock.set('2026-01-15T10:00:00.000Z'); assertInvariants(t);
  });
  it('after the first period ends, the queued renewal becomes current', async () => {
    const c = await signedInClient(t, 's03d'); await completePayment(t, c, 'success', 'starter_monthly'); t.clock.advanceDays(25); await c.relogin();
    const r = await c.checkout('starter_monthly'); t.gateway.registerInitiation(r.json.payu.fields); t.gateway.settle(r.json.txnid, 'success'); await postCallback(t, t.gateway.callbackFor(r.json.txnid, 'success'));
    t.clock.advanceDays(10); await c.relogin(); const sub = (await c.get('/api/subscription')).json;
    assert.equal(sub.current.status, 'active'); assert.equal(sub.current.startsAt, '2026-02-15T10:00:00.000Z'); assert.equal(sub.history.length, 2); t.clock.set('2026-01-15T10:00:00.000Z');
  });
  it('a verified payment for a different plan that was already in flight is honoured (money taken ⇒ entitlement), queued after the current plan', async () => {
    const c = await signedInClient(t, 's03e'); const pending = await startPayment(t, c, 'pro_monthly'); // started BEFORE buying starter
    await completePayment(t, c, 'success', 'starter_monthly');
    t.gateway.settle(pending.txnid, 'success'); await postCallback(t, t.gateway.callbackFor(pending.txnid, 'success'));
    const sub = mine(c.userId!).sort((a, b) => a.startsAt.localeCompare(b.startsAt)); assert.equal(sub.length, 2); assert.equal(sub[1]!.startsAt, sub[0]!.expiresAt); assertInvariants(t);
  });
  it('a failed or cancelled attempt does not block a later purchase', async () => {
    const c = await signedInClient(t, 's03f'); await completePayment(t, c, 'failure', 'pro_monthly'); await completePayment(t, c, 'cancel', 'pro_monthly');
    const r = await completePayment(t, c, 'success', 'pro_monthly'); assert.equal(r.cb.status, 303); assert.equal(mine(c.userId!).length, 1);
  });
});
