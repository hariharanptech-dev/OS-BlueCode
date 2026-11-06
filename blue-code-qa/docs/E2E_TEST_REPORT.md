# E2E test report

Environment: Playwright on Chromium 153 (local build), Linux container, reference app on 127.0.0.1:4173 with mock PayU hosted pages
and `RELAX_RATE_LIMITS=true` (production limits are tested separately in `tests/security/rate-limit.test.ts`).

Result of the last run: **24 of 24 passed, 0 failed, 0 skipped.** Raw output: `reports/e2e-results.json`.

| Required journey | Tests | Result |
|---|---|---|
| 1. Landing → register → login → pricing → select plan → checkout | checkout-journey E2E-1 (4 tests) | Pass |
| 2. Customer details → pay → simulated success → backend status → subscription | E2E-2 | Pass |
| 3. Simulated failure → failure screen → no subscription | E2E-3 (2 tests) | Pass |
| 4. Simulated cancellation → correct handling | E2E-4 | Pass |
| 5. Refresh payment-result page → status stays correct | E2E-5 (4 tests) | Pass |
| 6. Duplicate payment attempt → idempotency | E2E-6 (2 tests) | Pass |
| 7. Access to another customer's information → rejected | E2E-7 (2 tests) | Pass |
| Front-end security (XSS, CSP, open redirect, cookie flags, secret exposure, CSP-clean HTML) | frontend-security.spec | Pass |

## Defects found by E2E and fixed
- DEF-004: a stale Idempotency-Key persisted in sessionStorage blocked a legitimate new payment after a failure. Fixed by server 409 for closed keys and an in-memory key per page load.

## Observations (not defects)
- O-1: pressing the browser Back button from the result page after a payment reaches a non-cacheable POST response and shows `ERR_CACHE_MISS`. The state is not corrupted; the page simply cannot be replayed from history. A PRG (post-redirect-get) pattern is already used, so the cause is the mock hosted page's form POST. Recommend the product confirm the real PayU return flow behaves the same.
- The mock PayU hosted page is a local stand-in. **These E2E results do not show that the real PayU checkout page behaves this way.** Real-gateway E2E requires the sandbox and a manual run.

## Not run
- Firefox and WebKit.
- Mobile viewports.
- Real PayU sandbox journeys (no credentials).
