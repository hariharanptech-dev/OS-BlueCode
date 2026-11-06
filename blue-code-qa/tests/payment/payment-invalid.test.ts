import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signedInClient, startPayment, postCallback, subsOf, orderOf, type TestApp, type Client } from '../helpers/harness.ts';
import { assertInvariants } from '../helpers/invariants.ts';

let t: TestApp;
before(async () => { t = await startApp(); });
after(async () => { await t.stop(); });

async function pendingOrder(tag: string): Promise<{ c: Client; txnid: string; orderId: string }> {
  const c = await signedInClient(t, tag);
  const s = await startPayment(t, c);
  t.gateway.settle(s.txnid, 'success'); // customer really paid at the gateway; we test how the callback is treated
  return { c, txnid: s.txnid, orderId: s.orderId };
}
const untouched = (orderId: string) => { assert.equal(orderOf(t, orderId).status, 'pending', 'order must remain pending'); assert.equal(subsOf(t).filter((s) => s.paymentId === orderId).length, 0, 'no subscription'); };
const rejected = (r: { status: number; json: any }) => { assert.equal(r.status, 400); assert.equal(r.json.error.code, 'INVALID_CALLBACK'); assert.equal(r.json.error.message, 'The payment response could not be verified.'); };

describe('P-05 invalid / forged callbacks are rejected and change nothing', () => {
  it('invalid hash (single character flipped)', async () => {
    const o = await pendingOrder('inv1'); const p = t.gateway.callbackFor(o.txnid, 'success');
    p['hash'] = p['hash']!.slice(0, -1) + (p['hash']!.endsWith('0') ? '1' : '0');
    rejected(await postCallback(t, p)); untouched(o.orderId);
    assert.ok(t.sink.records().some((r) => r['event'] === 'callback.invalid_hash'), 'security event logged');
  });
  it('completely forged success with a made-up hash', async () => {
    const o = await pendingOrder('inv2'); const p = t.gateway.callbackFor(o.txnid, 'success'); p['hash'] = 'f'.repeat(128);
    rejected(await postCallback(t, p)); untouched(o.orderId);
  });
  it('signed with the wrong salt (attacker without the merchant salt)', async () => {
    const o = await pendingOrder('inv3'); rejected(await postCallback(t, t.gateway.callbackFor(o.txnid, 'success', { wrongSalt: true }))); untouched(o.orderId);
  });
  it('amount modified AFTER signing (hash no longer matches)', async () => {
    const o = await pendingOrder('inv4'); rejected(await postCallback(t, t.gateway.callbackFor(o.txnid, 'success', { tamper: { amount: '1.00' } }))); untouched(o.orderId);
  });
  it('status flipped AFTER signing: a failure cannot be turned into a success', async () => {
    const o = await pendingOrder('inv5'); rejected(await postCallback(t, t.gateway.callbackFor(o.txnid, 'failure', { tamper: { status: 'success' } }))); untouched(o.orderId);
  });
  it('wrong amount WITH a valid hash is still rejected (defence in depth against upstream error)', async () => {
    const o = await pendingOrder('inv6'); rejected(await postCallback(t, t.gateway.callbackFor(o.txnid, 'success', { resign: { amount: '1.00' } }))); untouched(o.orderId);
    assert.ok(t.sink.records().some((r) => r['event'] === 'callback.mismatch'));
  });
  it('amount formatting variants are fine only if numerically equal (499 vs 499.00)', async () => {
    const o = await pendingOrder('inv6b'); assert.equal((await postCallback(t, t.gateway.callbackFor(o.txnid, 'success', { resign: { amount: '499' } }))).status, 303); assert.equal(orderOf(t, o.orderId).status, 'success');
  });
  it('wrong merchant key (valid hash for the substituted key)', async () => {
    const o = await pendingOrder('inv7'); rejected(await postCallback(t, t.gateway.callbackFor(o.txnid, 'success', { resign: { key: 'OTHERKEY1' } }))); untouched(o.orderId);
  });
  it('wrong merchant reference udf1 (plan) with valid hash', async () => {
    const o = await pendingOrder('inv8'); rejected(await postCallback(t, t.gateway.callbackFor(o.txnid, 'success', { resign: { udf1: 'pro_yearly' } }))); untouched(o.orderId);
  });
  it('wrong currency with valid hash', async () => {
    const o = await pendingOrder('inv9'); rejected(await postCallback(t, t.gateway.callbackFor(o.txnid, 'success', { resign: { currency: 'USD' } }))); untouched(o.orderId);
  });
  it('unknown transaction reference (valid hash, no such order)', async () => {
    const o = await pendingOrder('inv10'); const r = await postCallback(t, t.gateway.callbackFor(o.txnid, 'success', { resign: { txnid: 'BCdoesnotexist000001' } })); rejected(r); untouched(o.orderId);
  });
  it('hash of order A replayed against order B', async () => {
    const a = await pendingOrder('inv11a'); const b = await pendingOrder('inv11b');
    const pa = t.gateway.callbackFor(a.txnid, 'success'); const pb = { ...t.gateway.callbackFor(b.txnid, 'success'), hash: pa['hash']! };
    rejected(await postCallback(t, pb)); untouched(b.orderId);
  });
  it('unknown status value, even when correctly signed', async () => {
    const o = await pendingOrder('inv12'); rejected(await postCallback(t, t.gateway.callbackFor(o.txnid, 'success', { statusOverride: 'refunded-lol' }))); untouched(o.orderId);
  });
  for (const field of ['key', 'txnid', 'amount', 'productinfo', 'firstname', 'email', 'status', 'hash']) {
    it(`missing required field "${field}"`, async () => {
      const o = await pendingOrder('inv13'); rejected(await postCallback(t, t.gateway.callbackFor(o.txnid, 'success', { omit: [field] }))); untouched(o.orderId);
    });
  }
  it('empty body and garbage JSON', async () => {
    rejected(await postCallback(t, {})); 
    const r = await postCallback(t, { json: 'x' } as any, { json: true }); assert.equal(r.status, 400);
  });
  it('oversized callback body is refused before processing', async () => {
    const o = await pendingOrder('inv14'); const r = await postCallback(t, { ...t.gateway.callbackFor(o.txnid, 'success'), junk: 'x'.repeat(40_000) });
    assert.equal(r.status, 413); untouched(o.orderId);
  });
  it('rejections never reveal WHY (no hash/amount/key hints) to the caller', async () => {
    const o = await pendingOrder('inv15');
    const bodies = [await postCallback(t, t.gateway.callbackFor(o.txnid, 'success', { wrongSalt: true })), await postCallback(t, t.gateway.callbackFor(o.txnid, 'success', { resign: { amount: '2.00' } })), await postCallback(t, t.gateway.callbackFor(o.txnid, 'success', { resign: { txnid: 'BCnope' } }))];
    const msgs = new Set(bodies.map((b) => b.json.error.message)); assert.equal(msgs.size, 1, 'all failure reasons look identical');
  });
});

describe('P-06 verification API (server-to-server) is the source of truth', () => {
  it('valid hash + gateway outage: nothing activates, order stays pending, later refresh completes it', async () => {
    const o = await pendingOrder('ver1');
    t.gateway.verifyBehaviour = 'throw';
    const r = await postCallback(t, t.gateway.callbackFor(o.txnid, 'success'));
    assert.equal(r.status, 303, 'customer is still sent to the result page'); untouched(o.orderId);
    assert.equal(t.app.db.eventsFor(o.txnid)[0]!.outcome, 'verify_unavailable');
    assert.equal((await o.c.get(`/api/payments/${o.orderId}`)).json.order.status, 'pending');
    t.gateway.verifyBehaviour = 'ok';
    const rf = await o.c.post(`/api/payments/${o.orderId}/refresh`); assert.equal(rf.json.order.status, 'success');
    assert.equal(subsOf(t).filter((s) => s.paymentId === o.orderId).length, 1); assertInvariants(t);
  });
  it('gateway timeout behaves like an outage', async () => {
    const o = await pendingOrder('ver1b'); t.gateway.verifyBehaviour = 'timeout';
    try { assert.equal((await postCallback(t, t.gateway.callbackFor(o.txnid, 'success'))).status, 303); untouched(o.orderId); } finally { t.gateway.verifyBehaviour = 'ok'; }
  });
  it('valid-hash "success" callback but the gateway says the customer never paid → not activated', async () => {
    const c = await signedInClient(t, 'ver2'); const s = await startPayment(t, c); // ledger stays "initiated"
    assert.equal((await postCallback(t, t.gateway.callbackFor(s.txnid, 'success'))).status, 303); untouched(s.orderId);
    assert.equal(t.app.db.eventsFor(s.txnid)[0]!.outcome, 'verification_not_confirmed');
  });
  it('gateway says FAILED while callback claims success → not activated and flagged for review', async () => {
    const c = await signedInClient(t, 'ver3'); const s = await startPayment(t, c); t.gateway.settle(s.txnid, 'failure');
    await postCallback(t, t.gateway.callbackFor(s.txnid, 'success')); untouched(s.orderId);
    assert.equal(orderOf(t, s.orderId).needsReview, true); assert.equal(t.app.db.eventsFor(s.txnid)[0]!.outcome, 'verification_disagrees');
    assert.ok(t.sink.records().some((r) => r['event'] === 'payment.verification_rejected'));
  });
  it('gateway reports a different amount than the order → not activated and flagged', async () => {
    const o = await pendingOrder('ver4'); t.gateway.verifyAmountOverride = '1.00';
    try { await postCallback(t, t.gateway.callbackFor(o.txnid, 'success')); untouched(o.orderId); assert.equal(orderOf(t, o.orderId).needsReview, true); } finally { t.gateway.verifyAmountOverride = null; }
  });
  it('gateway reports a different mihpayid than the callback → not activated', async () => {
    const o = await pendingOrder('ver5');
    await postCallback(t, t.gateway.callbackFor(o.txnid, 'success', { resign: { mihpayid: '999999999999999999' } })); untouched(o.orderId);
  });
  it('the gateway is consulted for every distinct success (not cached across orders)', async () => {
    const o1 = await pendingOrder('ver6a'); const o2 = await pendingOrder('ver6b'); const n = t.gateway.verifyCalls;
    await postCallback(t, t.gateway.callbackFor(o1.txnid, 'success')); await postCallback(t, t.gateway.callbackFor(o2.txnid, 'success'));
    assert.equal(t.gateway.verifyCalls, n + 2);
  });
});

describe('P-07 client-side "success" can never activate anything', () => {
  it('no API accepts a client-asserted payment status', async () => {
    const o = await pendingOrder('fake1');
    for (const [m, body] of [['POST', { status: 'success' }], ['PUT', { status: 'success' }], ['PATCH', { status: 'success' }]] as const) {
      const r = await o.c.request(m, `/api/payments/${o.orderId}`, { json: body }); assert.ok([404, 405].includes(r.status), `${m} → ${r.status}`);
    }
    const r2 = await o.c.get(`/api/payments/${o.orderId}?status=success&payment=success`); assert.equal(r2.json.order.status, 'pending');
    const r3 = await o.c.post(`/api/payments/${o.orderId}/refresh?status=success`, { json: undefined }); assert.equal(r3.status === 200 ? r3.json.order.status : 'n/a', 'success', 'refresh asks the GATEWAY, which really was paid in this fixture');
  });
  it('refresh does NOT activate when the gateway has no successful payment, whatever the query string says', async () => {
    const c = await signedInClient(t, 'fake2'); const s = await startPayment(t, c); // not paid
    const r = await c.post(`/api/payments/${s.orderId}/refresh?status=success&result=paid`); assert.equal(r.json.order.status, 'pending'); untouched(s.orderId);
  });
  it('the redirect target carries only an order id, never a status', async () => {
    const o = await pendingOrder('fake3'); const r = await postCallback(t, t.gateway.callbackFor(o.txnid, 'success'));
    assert.match(r.location!, /^\/payment\/result\?order=[0-9a-f-]{36}$/); assert.ok(!/status|success/i.test(r.location!));
  });
});
