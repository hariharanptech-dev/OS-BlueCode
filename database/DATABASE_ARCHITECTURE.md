# Database Architecture

Stack: PostgreSQL 14+ · Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`) · Node 20+/TypeScript · Zod 4 · Jest.

## Layers

```
Express routes / payment-integration module        (NOT in this repo)
        │  call
services/   createServices(prisma)                  business rules, transactions, idempotency
        │  use
repositories/ createRepositories(db | tx)           thin Prisma access, one concern each
        │
Prisma Client ──▶ PostgreSQL                         constraints + triggers are the last line of defence
```

Everything accepts a `DbClient` (a `PrismaClient` *or* a transaction client), so repositories compose inside one transaction.

## Design principles

1. **The database is the final authority.** Every invariant that matters (no duplicate activation, no overlapping subscriptions,
   immutable payment amounts, retained history) is enforced by constraints/triggers, *and* by the services. The tests attack
   the DB directly with raw SQL to prove it.
2. **Money is integer minor units** (`amount_minor`, `price_minor`, `INT`) + ISO-4217 `currency`. No floats anywhere. PayU's
   decimal string (`"499.00"`) is produced/parsed by `minorToDecimalString` / `decimalStringToMinor` (strict regex, exact).
   `INT` caps a single amount at ≈ 21.4 M major units for 2-decimal currencies; widen to `BIGINT` if ever needed.
3. **UTC everywhere.** `timestamptz(3)`; expiry is `start + N × 24h` in UTC.
4. **Server-side truth.** Price, currency and duration are read from the `plans` row and snapshotted onto the payment
   (`amount_minor`, `currency`, `plan_duration_days`). Callers cannot supply them. User identity is a parameter the
   authenticated backend supplies; request bodies must never be its source.
5. **Append-only audit.** `payment_events` and `subscription_events` are never updated/deleted (triggers). Payloads are
   sanitised by an **allow-list** (`shared/sanitize.ts`) inside the repository, so no caller can store hashes, card data, PII or secrets.

## Transactions, isolation and locking

* Default isolation: **READ COMMITTED** with explicit `SELECT … FOR UPDATE` locks (cheaper and deadlock-predictable vs SERIALIZABLE;
  correctness comes from locks + constraints rather than optimistic retries).
* **Lock order is always `payment → user → subscription rows`.** Lifecycle ops lock `user → subscription`. No cycle ⇒ no deadlocks
  by design; `runInTransaction` still retries once-in-a-blue-moon `40001/40P01`.
* Boundaries: one service call = one DB transaction. Order creation = user check + idempotency claim + payment insert + audit event
  (+ idempotency completion) atomically. Activation = payment update + subscription insert + all audit rows atomically.
* Idempotency: `INSERT … ON CONFLICT DO NOTHING` on `UNIQUE(user_id, idempotency_key)`; concurrent twins block on the unique index until the
  first commits, then replay. Because the record commits *with* the payment, there is no orphan "IN_PROGRESS" after a crash.
  A fingerprint (sha256 of the canonical request) rejects key reuse with a different request. `payments(user_id, idempotency_key)` is
  also unique, as a second, independent guard.
* Sweeps (`expireAndPromote`) use `FOR UPDATE SKIP LOCKED` ⇒ multiple workers are safe.

## Constraints Prisma cannot express (migration SQL only)

| Constraint | Purpose |
|---|---|
| CHECKs: positive price/amount/duration, `currency ~ '^[A-Z]{3}$'`, `email = lower(email)` | basic integrity |
| `payments_success_requires_verification_chk` | SUCCESS ⇒ `verified_at` and `provider_transaction_id` present |
| partial UNIQUE `subscriptions_one_active_per_user_idx` | ≤ 1 ACTIVE per user |
| `EXCLUDE USING gist` `subscriptions_no_overlap_excl` (needs `btree_gist`) | no overlapping live windows per user |
| triggers `bc_*` | no DELETE on history tables; immutable commercial columns; legal status transitions; append-only events |

**Maintenance warning:** because these live outside `schema.prisma`, when you later run `prisma migrate dev` always read the generated SQL and
make sure it does not `DROP` these objects. Keep every future change as a new migration; never edit an applied one.

## Migrations & environments

* `prisma/migrations/20261105000000_init/migration.sql` is **hand-written** (non-destructive, additive). Ordinary startup never migrates or resets anything.
  Production: `prisma migrate deploy` as an explicit deploy step.
* `scripts/apply-sql-migrations.ts` applies the same SQL with plain `pg` (used by the Jest bootstrap and offline CI). It tracks `_sql_migrations`, not
  `_prisma_migrations` — do not mix the two on one database.
* **Verification status:** the SQL was applied to a real PostgreSQL 16 and exercised by 63 tests through Prisma Client. In the build sandbox the Prisma
  *schema engine* could not be downloaded, so `prisma migrate deploy/diff` were **not** run there. Run the drift check below once in your environment.

```bash
# expected: "No difference detected" apart from the objects listed in "Constraints Prisma cannot express"
npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL" --exit-code
```

## Integration contract (for the payment-integration module)

| Topic | Agreed value |
|---|---|
| IDs | UUID v4 (`gen_random_uuid()`), `String @db.Uuid` in TS |
| Tables | `users, plans, payments, subscriptions, payment_events, subscription_events, idempotency_records` (snake_case) |
| Money | `*_minor INT` + `currency CHAR(3)`. **Proposed deviation:** brief suggested `price`/`amount`; named `price_minor`/`amount_minor` so the unit can't be misread |
| Payment status | `CREATED, PENDING, SUCCESS, FAILED, CANCELLED` |
| Subscription status | `PENDING, ACTIVE, EXPIRED, CANCELLED, SUSPENDED` |
| Timestamps | `timestamptz(3)`, UTC, JS `Date` |
| Payment→Subscription | `subscriptions.payment_id` UNIQUE NOT NULL FK |
| Order creation | `payments.createPaymentOrder({ userId, planId, idempotencyKey })` → `{ payment, replayed }`; send `payment.transactionId` as PayU `txnid`, `minorToDecimalString(payment.amountMinor, payment.currency)` as `amount` |
| After redirect | `payments.markRedirected(orderId)` |
| Callback/webhook | `payments.recordProviderEvent(...)` (audit) → verify with PayU server-to-server → `activation.activateFromVerifiedPayment(...)` on success or `payments.recordFailure(...)` |
| Idempotency | caller supplies key (16–128 chars); same key + same request = same payment |
| Reconciliation | job calls `reconciliation.findStalePayments()`, asks PayU, applies `applyVerdict(...)` |

**Additions beyond the brief (please confirm):** table `subscription_events`; payment column `plan_duration_days` (snapshot);
subscription columns `suspended_at, cancelled_at, status_reason`; payment `failure_reason`; `PaymentProvider` enum (PAYU only).
No other module's contract was available in this environment, so these are *proposals* documented here for sign-off before any conflicting structure is built.

## Operations checklist

* Schedule `services.expiry.run()` every minute; schedule `reconciliation` (stale payments, `findAnomalies()` should be empty) every 5–15 min.
* Schedule `idempotency.purgeExpired()` daily (keeps COMPLETED records).
* Alert on any non-empty list from `findAnomalies()`.
* Back up with PITR; there is deliberately no application-level hard delete of financial data.
* GDPR/DPDP-style erasure needs a legal decision (financial records must be retained); this module offers `account_status = DISABLED`, not deletion.
