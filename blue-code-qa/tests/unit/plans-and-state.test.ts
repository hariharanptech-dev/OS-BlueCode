import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addInterval, PLANS, getPlan } from '../../src/reference/plans.ts';
import { ALLOWED_TRANSITIONS, canTransition } from '../../src/reference/payments.ts';
import type { PaymentStatus } from '../../src/reference/types.ts';

const d = (s: string) => new Date(s);
const iso = (x: Date) => x.toISOString();

describe('expiry calculation (UTC, end-of-month clamping)', () => {
  it('adds one month on a normal day', () => assert.equal(iso(addInterval(d('2026-01-15T10:00:00Z'), 'month', 1)), '2026-02-15T10:00:00.000Z'));
  it('clamps Jan 31 → Feb 28 in a non-leap year', () => assert.equal(iso(addInterval(d('2026-01-31T00:00:00Z'), 'month', 1)), '2026-02-28T00:00:00.000Z'));
  it('clamps Jan 31 → Feb 29 in a leap year', () => assert.equal(iso(addInterval(d('2028-01-31T00:00:00Z'), 'month', 1)), '2028-02-29T00:00:00.000Z'));
  it('rolls Dec 31 → Jan 31 of next year', () => assert.equal(iso(addInterval(d('2026-12-31T23:59:59Z'), 'month', 1)), '2027-01-31T23:59:59.000Z'));
  it('adds one year; Feb 29 → Feb 28 next year', () => assert.equal(iso(addInterval(d('2028-02-29T12:00:00Z'), 'year', 1)), '2029-02-28T12:00:00.000Z'));
  it('adds one year on a normal date', () => assert.equal(iso(addInterval(d('2026-03-10T08:30:00Z'), 'year', 1)), '2027-03-10T08:30:00.000Z'));
  it('does not mutate the input date', () => { const x = d('2026-01-31T00:00:00Z'); addInterval(x, 'month', 1); assert.equal(iso(x), '2026-01-31T00:00:00.000Z'); });
  it('is always strictly in the future', () => { for (const p of PLANS) assert.ok(addInterval(d('2026-05-31T00:00:00Z'), p.interval, p.count) > d('2026-05-31T00:00:00Z')); });
});

describe('plan catalogue', () => {
  it('amounts are canonical 2-decimal strings in INR', () => { for (const p of PLANS) { assert.match(p.amount, /^\d+\.\d{2}$/); assert.equal(p.currency, 'INR'); } });
  it('ids are unique and look-up works', () => { assert.equal(new Set(PLANS.map((p) => p.id)).size, PLANS.length); assert.equal(getPlan('pro_monthly')?.amount, '1499.00'); assert.equal(getPlan('nope'), undefined); assert.equal(getPlan('__proto__'), undefined); });
});

describe('payment state machine: exhaustive 5x5 transition table', () => {
  const all: PaymentStatus[] = ['pending', 'success', 'failed', 'cancelled', 'expired'];
  const legal = new Set(['pending>success', 'pending>failed', 'pending>cancelled', 'pending>expired', 'failed>success', 'cancelled>success', 'expired>success']);
  for (const from of all) for (const to of all) {
    const expected = legal.has(`${from}>${to}`);
    it(`${from} → ${to} is ${expected ? 'ALLOWED' : 'FORBIDDEN'}`, () => assert.equal(canTransition(from, to), expected));
  }
  it('success is terminal', () => assert.deepEqual(ALLOWED_TRANSITIONS.success, []));
  it('only success can be reached from a closed (failed/cancelled/expired) state', () => { for (const s of ['failed', 'cancelled', 'expired'] as const) assert.deepEqual(ALLOWED_TRANSITIONS[s], ['success']); });
});
