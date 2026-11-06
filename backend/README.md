# Blue Code OS – Backend (PayU payments)

Node.js + Express + TypeScript + PostgreSQL + Prisma. See `BACKEND_ARCHITECTURE.md`, `PAYU_INTEGRATION.md`, `PAYMENT_FLOW.md`, `API_CONTRACT.md`, `SECURITY_DOCUMENTATION.md`, `PAYMENT_STATE_MACHINE.md`.

## Run
```bash
npm install
cp .env.example .env            # fill DATABASE_URL, SESSION_SECRET (>=32 chars), PayU TEST key/salt
npx prisma migrate dev --name init
npm run seed                    # placeholder plans - set real prices
npm run dev
```
PayU test credentials come from your PayU dashboard; switch the two URLs in `.env` to production values only when going live. Register the webhook URL (`BACKEND_URL/api/v1/payments/payu/callback`) in the PayU dashboard.

## Tests
- `npm run test:core` – 30 tests (hashing, state machine, initiation, callbacks, idempotency, conflicts) using an in-memory repository and a **mocked** PayU gateway. Needs only Node + tsx.
- `npm test` – Jest/supertest HTTP-layer tests (`tests/api.test.ts`).

## Verified vs. not verified (honest status)
- Run and passing in the authoring sandbox: `test:core` (30/30) and a strict `tsc` typecheck of the payment core.
- **Never run**: `npm install`, Prisma client generation/migrations, Express app boot, Jest/supertest suite, `PrismaPaymentRepository`, `AuthService`, session store, and any call to real PayU (the sandbox had no network). Expect to fix small compile/runtime issues on first `npm run build`.
- Mocked tests are not gateway tests: do a sandbox end-to-end payment before trusting the integration. See "Not verified" in `PAYU_INTEGRATION.md`.

## Known limitations
No refunds, no email verification, no subscription-expiry job (expiry is checked on read), in-memory rate limiting, no webhook IP allow-list.

## Integration notes for the frontend (account 5)
1. `GET /auth/me` → keep `csrfToken`; send `X-CSRF-Token` on POSTs and `credentials: 'include'`.
2. `POST /payments/initiate` with `Idempotency-Key` (uuid per click), body `{planId}`.
3. Build a hidden `<form method="POST" action={payment.action}>` from `payment.fields` and submit it.
4. Serve `/payment/result?orderId=…`; poll `GET /payments/:orderId/status`; treat only the server's status as truth.
