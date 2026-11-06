# Subscription Lifecycle

## Payment states

```
CREATED ──redirect──▶ PENDING ──verified success──▶ SUCCESS (terminal, immutable)
   │                     │
   └──── failure/cancel ─┴──▶ FAILED | CANCELLED ──(reconciliation re-verified success only)──▶ SUCCESS
```

| From | To | Allowed by |
|---|---|---|
| CREATED | PENDING | `markRedirected` |
| CREATED / PENDING | SUCCESS | `activateFromVerifiedPayment` (backend-verified) |
| CREATED / PENDING | FAILED / CANCELLED | `recordFailure` |
| FAILED / CANCELLED | SUCCESS | **only** `source: 'RECONCILIATION'` (re-verified with PayU) |
| SUCCESS | anything | never (service + DB trigger) |

A late failure callback after SUCCESS is ignored and audited. A `SUCCESS` row must have `verified_at` and
`provider_transaction_id` (CHECK constraint).

## Subscription states

| Status | Meaning |
|---|---|
| PENDING | Paid, queued; `start_date` is in the future (renewal bought while another term is live) |
| ACTIVE | Window open; grants access |
| SUSPENDED | Administratively paused; **dates do not move** (time keeps running; no compensation implied) |
| EXPIRED | `end_date` reached (terminal) |
| CANCELLED | Administratively ended (terminal); no refund/proration is implied |

Permitted transitions (service-enforced and DB-trigger-enforced):

| From | To |
|---|---|
| PENDING | ACTIVE (start reached), CANCELLED, EXPIRED (window passed while unprocessed) |
| ACTIVE | SUSPENDED, CANCELLED, EXPIRED |
| SUSPENDED | ACTIVE (resume, only if window still open, else EXPIRED), CANCELLED, EXPIRED |
| EXPIRED, CANCELLED | — (terminal) |

Every transition writes an append-only `subscription_events` row (`from`, `to`, `reason`, `actor`, time).

## Activation (the only way a subscription is created)

Input: a `VerifiedPayUTransaction` produced by the payment-integration module from PayU's server-to-server
verification. **This module does not and cannot contact PayU**; it refuses to activate unless the verified
`transactionId`, `amountMinor` and `currency` equal what was stored at order time.

Single transaction, lock order `payment → user → subscriptions`:

1. `SELECT … FOR UPDATE` the payment. If a subscription already exists → `ALREADY_ACTIVATED` (no-op, audited).
2. Validate txnid / currency / amount / PayU-id consistency; otherwise `REJECTED` + `VERIFICATION_MISMATCH` event, nothing activated.
3. Payment → `SUCCESS` (+ `verified_at`, `provider_transaction_id`), event written.
4. Lock the user; expire this user's ended subscriptions.
5. `start = max(now, latest live end_date)`; `end = start + plan_duration_days × 24h` (UTC, duration snapshotted at order time).
6. Insert subscription: `ACTIVE` if `start <= now`, else `PENDING`; audit events.
7. Commit. Any exception rolls back **all** of it.

Duplicate protection is layered: row locks (serialise) → `UNIQUE(payment_id)` → one-ACTIVE index → overlap EXCLUDE.

## Expiry

* `end_date = start_date + durationDays × 24h`, UTC. `MONTHLY` etc. are labels; the day count is the truth.
* `end_date` is **exclusive**: at exactly `end_date` access is over.
* Entitlement checks use dates, so a delayed sweep never extends access.
* `SubscriptionExpiryService.run()` (schedule ~every minute): expire ended → promote due `PENDING`. Idempotent;
  `FOR UPDATE SKIP LOCKED` lets several workers run safely.

## Renewal (implemented: manual, purchase-based)

Renewal = buying a plan again through the normal order → verify → activate flow. The new term is appended after the
user's latest live window (`PENDING` until it starts). **No automatic recurring billing** is implemented: it needs
explicit business sign-off and a PayU recurring-payment setup, neither of which is specified.

## Upgrade / downgrade (DESIGN ONLY – not implemented)

Current behaviour: buying a *different* plan while one is live simply queues it after the current term; nothing is
changed, refunded or prorated. Proposed future design, pending business rules:

1. Add `plan_change_requests(id, user_id, from_subscription_id, to_plan_id, mode, status, payment_id)`.
2. `mode = AT_PERIOD_END` (no money movement; queue the new term — already supported by stacking) or
   `mode = IMMEDIATE` (cancel/supersede the current term and price the difference).
3. `IMMEDIATE` requires a **business-defined** proration/credit/refund policy. None is invented here; until it
   exists, IMMEDIATE changes must not be offered.
4. A superseded subscription would move to `CANCELLED` with `status_reason='PLAN_CHANGE'`; the new one references its own payment.
