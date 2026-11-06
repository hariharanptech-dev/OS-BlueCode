# Blue Code OS — QA, security and reliability module

**Important:** no Blue Code OS source was provided. This module contains (a) a **reference implementation** of the payment and
subscription behaviour (`src/reference`) and (b) the security, error-handling and test code that validates it. Integrate the
test suites against the real codebase before drawing conclusions about the product. See `docs/RISK_REGISTER.md` R-13.

## Contents
- `src/security/` — security middleware pieces: error catalogue, safe logger, PayU hash helpers, Zod validation, scrypt, rate limiter, sessions, HTTP guards.
- `src/reference/` — reference app: server, payment & subscription services, in-memory DB, PayU gateways (mock and HTTP), front-end pages.
- `tests/` — unit, api, payment, subscription, security, integration, e2e (Playwright), sandbox (real PayU, opt-in), helpers.
- `scripts/` — secret scanner, SQL scanner, mutation checker, performance smoke, quality gate.
- `docs/` — SECURITY_AUDIT, TESTING_STRATEGY, PAYMENT_TEST_CASES, SUBSCRIPTION_TEST_CASES, API_SECURITY_CHECKLIST, ERROR_HANDLING, E2E_TEST_REPORT, RISK_REGISTER.
- `reports/` — machine-readable results.

## Setup
```
npm install
cp .env.example .env            # fill in REAL values only in your local .env; never commit it
npm run typecheck
npm test                        # non-browser suites
npm run test:e2e                # needs Chromium: npx playwright install chromium
npm run scan:secrets
node scripts/scan-sql.ts src
node scripts/mutation-check.ts
node scripts/perf-smoke.ts
node scripts/quality-gate.ts
```
Sandbox: set `PAYU_SANDBOX_KEY`, `PAYU_SANDBOX_SALT`, `PAYU_SANDBOX_VERIFY_URL`, `PAYU_SANDBOX_PAYMENT_URL`, then `node --test tests/sandbox/*.test.ts`.

## Integration instructions (for the other modules)
1. Keep `src/security` as a shared package: error catalogue, `AppError`, logger, hash helpers, validation, rate limiter.
2. Replace `Db` with the real repository layer, keeping the same method contract, and run `tests/integration` against it.
3. Replace `MockPayUGateway` in production with `HttpPayUGateway`; verify the response shape against the sandbox first.
4. Mount the callback routes outside authentication; mount everything else behind the session and CSRF guards.
5. Run `tests/security/csrf-cors-headers.test.ts` against your real origins list, not the test origin.
6. Schedule `PaymentService.reconcilePending()` every few minutes in production.

## Status
Automated: 363 non-browser tests passing; 24 E2E tests passing; mutation score 16/16; secret and SQL scans clean.
Not yet verified: real PayU behaviour (sandbox not executed), real database, multi-instance deployment, dependency audit.
