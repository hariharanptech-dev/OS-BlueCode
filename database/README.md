# Blue Code OS – Database, Customers & Subscription Lifecycle

PostgreSQL + Prisma 7 + TypeScript module providing users, plans, payments, subscriptions, payment/subscription audit trails,
idempotency, activation/expiry/reconciliation services and validation. It does **not** talk to PayU; it consumes
*backend-verified* PayU results (see `DATABASE_ARCHITECTURE.md` → Integration contract).

Docs: `DATABASE_ARCHITECTURE.md` · `ENTITY_RELATIONSHIP_DESIGN.md` · `SUBSCRIPTION_LIFECYCLE.md` · `DATA_DICTIONARY.md` · `TEST_RESULTS.txt`

## Setup

Requirements: Node 20+, PostgreSQL 14+ (with the `btree_gist` contrib extension – bundled with standard PostgreSQL and available on managed services).

```bash
npm install
cp .env.example .env            # edit DATABASE_URL / TEST_DATABASE_URL
createdb bluecode && createdb bluecode_test
npm run prisma:generate         # generates src/generated/prisma (git-ignored)
npm run db:migrate:deploy       # applies prisma/migrations (non-destructive)
npm run db:seed                 # DEV ONLY: 3 plans labelled SAMPLE (refuses NODE_ENV=production)
npm test                        # runs against TEST_DATABASE_URL (wiped each run)
```

Migration commands
* Apply (all environments): `npm run db:migrate:deploy` · status: `npm run db:migrate:status`
* New migration in development: edit `schema.prisma`, `npx prisma migrate dev --name <change>`, **review the SQL** (it must not drop the custom indexes/triggers/constraints).
* Dev reset (DESTROYS DATA): `npm run db:reset:dev` (Prisma) or `npx tsx scripts/apply-sql-migrations.ts --reset` (no Prisma engine). Neither runs automatically, and the second refuses in production.
* No Prisma engine available (offline CI)? `npm run db:setup:sql` applies the same SQL with plain `pg`.
* Drift check: see `DATABASE_ARCHITECTURE.md`.

## Usage (Express-compatible)

```ts
import { createServicesFromEnv, minorToDecimalString } from './src';
const svc = createServicesFromEnv();                      // build once at startup

// POST /payments  (userId from your auth middleware, NEVER from the body)
const { payment, replayed } = await svc.payments.createPaymentOrder({
  userId: req.auth.userId, planId: req.body.planId, idempotencyKey: req.header('Idempotency-Key')!,
});
const payuFields = { txnid: payment.transactionId, amount: minorToDecimalString(payment.amountMinor, payment.currency) };
await svc.payments.markRedirected(payment.orderId);

// after YOUR code verified the transaction with PayU server-to-server:
await svc.activation.activateFromVerifiedPayment({ orderId, transactionId: txnid, providerTransactionId: mihpayid,
  amountMinor, currency, verifiedAt: new Date(), source: 'PAYU_VERIFY_API', payload: payuFields });
// or: await svc.payments.recordFailure({ orderId, status: 'FAILED', reason: 'BANK_DECLINED' });

// access check
const { active } = await svc.expiry.getCurrentEntitlement(userId);
// schedulers: svc.expiry.run()  ·  svc.reconciliation.findStalePayments(15*60_000)
```
Map `DomainError.code` (`NOT_FOUND`, `DUPLICATE_EMAIL`, `IDEMPOTENCY_KEY_REUSE`, `IDEMPOTENCY_IN_PROGRESS`, `PLAN_NOT_PURCHASABLE`, `ACCOUNT_NOT_ACTIVE`, `INVALID_TRANSITION`, `VALIDATION_ERROR`) to HTTP statuses in your error middleware.

## Test results (actual, PostgreSQL 16.15, this build)

`5 suites, 63 tests passed` (3 consecutive full runs, no flakes). Covers: user creation, duplicate email, plan retrieval, payment creation, unique orderId/txnid/idempotency key,
idempotent replay, activation, repeated activation, UTC expiry, failed & cancelled payments, late failure after success, amount/currency/txnid mismatch, payment history + ownership,
renewal stacking, suspend/resume/cancel, expiry sweep, reconciliation, secret/card-data non-persistence, transaction rollback (fault injected before commit), and DB-level guards via raw SQL.
Race tests: 15 concurrent order requests/1 key, 12 concurrent callbacks/1 payment, 2 concurrent payments/1 user, 10 concurrent users, concurrent sweeps, concurrent cancel+suspend.
Mutation check performed: removing the per-user lock makes the concurrent-payments test fail (caught by the EXCLUDE constraint); removing the payment lock makes the callback race test fail.

## Known limitations / needs your confirmation

1. `prisma migrate deploy/diff` were not executable in the build sandbox (Prisma engine host blocked); the SQL was applied and verified with the bundled `pg` runner. Run the drift check once.
2. Contract proposals (`*_minor` names, `subscription_events`, snapshot columns) need sign-off from the payment-integration owner (see architecture doc).
3. Not implemented by design: recurring billing, refunds, proration, plan-change execution, password hashing/auth (this module only stores hashes), Express routes, PayU calls/hash generation.
4. Single amounts limited to `INT` range; supported currencies: INR, USD (extend `shared/money.ts` deliberately).
5. The PayU `txnid` length limit (25) and field formats should be re-checked against current PayU documentation.
