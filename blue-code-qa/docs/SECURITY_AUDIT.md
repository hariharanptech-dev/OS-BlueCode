# Security Audit — Blue Code OS payment & subscription module

**Scope disclaimer (read first).** No Blue Code OS source code was supplied to this module. The system under test is a
**reference implementation** (`src/reference/`) written here to represent the payment/subscription behaviour the QA
module must validate. Findings below are about that reference system and the test module's own correctness. They must be
re-run against the real Blue Code OS codebase before any claim about the product is made.

## Method
- Static review of the reference code and configuration.
- ~390 automated tests (API, payment, subscription, security, integration, E2E in Chromium).
- Defect injection (mutation testing): 16 deliberately broken variants of the app; the suites must catch each one.
- Repository secret scan and static SQL scan.

## Findings discovered and fixed during testing

| ID | Severity | Finding | Evidence | Status |
|---|---|---|---|---|
| DEF-001 | Medium | A malformed percent-encoded order id (`%E0%A4%A`) caused an unhandled exception → HTTP 500 (error-handling leak / availability). | `authz.test.ts` "malformed order ids" | Fixed: maps to 404 |
| DEF-002 | High | Secrets embedded in free-text driver/exception messages (e.g. `password=…`, `postgres://u:pw@host`) were not scrubbed from logs. | `logger-errors.test.ts` "secrets embedded in free text" | Fixed: key/value and URL-credential scrubbing added, plus literal merchant-salt scrubbing |
| DEF-003 | High | An order that failed, was then paid by the customer inside PayU, and whose success callback was lost stayed `failed` forever (customer charged, no subscription). | `payment-delayed.test.ts` DEF-003 regression | Fixed: reconciliation re-checks closed orders for 24 h; a late verified success is applied |
| DEF-004 | High | A browser-persisted Idempotency-Key could re-issue a PayU form for an already-closed order (blocked a legitimate retry, and risked a duplicate charge attempt). | `payment-duplicate.test.ts` DEF-004 | Fixed: 409 `IDEMPOTENCY_KEY_USED`; key kept in memory per page load only |
| DEF-005 | Medium | Name validation rejected Devanagari and other scripts (combining marks), locking out Indian customers. | `password-validation.test.ts` | Fixed: `\p{M}` allowed |
| DEF-006 | Medium | A transaction id of 18+ digits (`mihpayid`) lost precision through JavaScript `JSON.parse`. | `http-gateway.test.ts` | Fixed: quoted before parsing |
| DEF-007 | Low | The PAN scrubber consumed the trailing space, joining log words. | `logger-errors.test.ts` | Fixed |

Fixes DEF-001 to DEF-004 were each first observed as a failing test, then fixed, then re-verified in the full suite.

## Controls verified (in the reference system, by automated test)
- **Authentication:** scrypt password hashing (N=16384, per-user salt); generic login errors; per-(IP,email) lockout after 5 failures for 15 min; session fixation prevented by issuing a new token on login; sessions stored as SHA-256 digests; idle (30 min) and absolute (8 h) timeouts; logout invalidates the server session; cookies HttpOnly, SameSite=Lax, `__Host-` + Secure in production.
- **Authorization:** every payment/subscription read is scoped to the session user; foreign ids return the same 404 as missing ids (no existence oracle); `userId` in query/body is ignored; the checkout owner is always the session user.
- **Payment integrity:** request and response SHA-512 hashes verified with constant-time comparison; callback amount, key, plan reference and currency compared to the server-side order; a success is applied only after server-to-server verification with the gateway; client-supplied `amount`, `status`, `userId` rejected by strict schemas.
- **Replay/duplicates:** activation is idempotent per payment (DB UNIQUE on `payment_id`, application check); success is terminal; 25 concurrent identical callbacks produce one subscription and one gateway verification.
- **Web:** CSRF synchroniser token plus Origin allow-list on cookie-authenticated writes; exact-match CORS, never `*`; CSP `default-src 'self'`, no inline script/style, `frame-ancestors 'none'`, `form-action` limited to PayU; HSTS when Secure; `nosniff`, `X-Frame-Options: DENY`; open-redirect blocked on `?next=`.
- **Input:** strict Zod schemas (unknown keys rejected), body size limits, content-type enforcement, prototype-pollution and NoSQL-operator payloads rejected; no string-built SQL found (static scan).
- **Leakage:** error responses carry only a stable code, a generic message and a request id; stack traces appear only behind the defect switch `leak-stack`, which the mutation suite proves is caught; the merchant salt is absent from responses, logs and stored data (tested end to end).
- **Rate limits:** per-IP auth limit (20/min), per-user checkout (20/min) and refresh (30/min), callback per-IP limit; X-Forwarded-For ignored unless a trusted proxy count is configured.

## Open findings (not fixed; see RISK_REGISTER.md)
- **O-1 (Medium):** the reference uses in-memory session, rate-limit and lockout state. Multi-instance deployment would multiply limits and lose sessions. (R-07)
- **O-2 (High, unverified):** the PayU hash field ordering and the `verify_payment` response shape are implemented from PayU's documented format and have **not** been checked against the live sandbox. The sandbox tests exist but were not executed. (R-01)
- **O-3 (Medium):** registration returns 409 for an existing e-mail, which is an enumeration signal. Acceptable only if the product accepts that trade-off; the alternative is a verification e-mail flow, which is not implemented. (R-09)
- **O-4 (Medium):** no e-mail verification, password reset, MFA or account recovery is implemented in the reference. These are out of the payment scope but must exist in the product. (R-10)
- **O-5 (Low):** the webhook endpoint relies solely on the PayU hash for authentication. This is the documented PayU model but depends on the salt staying secret. (R-02)
- **O-6 (Low):** CSRF is not enforced on the login endpoint; login CSRF is blocked by the Origin check only.
- **O-7 (Info):** the production configuration loader refuses sandbox URLs, placeholder salts and mock UI. It cannot detect a real but wrong salt.

## Secrets
- No `.env` file is present; `.env.example` contains placeholders only; `.gitignore` excludes `.env*` except the example.
- `scan-secrets.ts` reports zero findings for this repository (tested, including a self-test that it detects planted secrets).
- The sandbox tests read credentials from environment variables only and skip when absent.
- The e2e salt `fake-e2e-salt-not-a-real-credential` is an obviously fake test value.
