# Error handling

## Strategy
1. Every failure is either an `AppError` with a stable `code` from a single catalogue (`src/security/errors.ts`), or it is unexpected.
2. Only the catalogue message goes to the client. Internal detail goes to structured logs, scrubbed of secrets and card numbers.
3. Unexpected errors become `INTERNAL_ERROR` (HTTP 500) with no message, stack or path.
4. Every response carries `X-Request-Id`, which also appears in the server log line, so support can correlate.

## Response shape
```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Some of the information provided is not valid. Please check the highlighted fields.", "requestId": "…", "fields": [{ "path": "email", "reason": "invalid value" }] } }
```
Field reasons are generic (`wrong type or missing`, `invalid value`, `unexpected field`) and never echo the submitted value.

## Catalogue (summary)
| Code | HTTP | User-facing meaning |
|---|---|---|
| VALIDATION_FAILED | 400 | Input invalid |
| INVALID_CREDENTIALS | 401 | Email or password incorrect (identical for unknown email) |
| AUTH_REQUIRED / SESSION_EXPIRED | 401 | Sign in again |
| ACCOUNT_THROTTLED / RATE_LIMITED | 429 | Wait; `Retry-After` set |
| CSRF_FAILED / FORBIDDEN_ORIGIN | 403 | Refresh the page |
| EMAIL_UNAVAILABLE | 409 | Could not create account with these details |
| PLAN_INVALID | 400 | Plan not available |
| SUBSCRIPTION_ACTIVE | 409 | Already subscribed; renew near expiry |
| IDEMPOTENCY_KEY_USED | 409 | That attempt is complete; start a new payment |
| PAYMENT_INIT_FAILED | 502 | Could not start payment; not charged |
| INVALID_CALLBACK | 400 | Payment response could not be verified (no reason given) |
| GATEWAY_UNAVAILABLE | 503 | Payment service unavailable; activation will follow once confirmed |
| DB_UNAVAILABLE | 503 | Try again shortly |
| INTERNAL_ERROR | 500 | Something went wrong on our side |

## Payment-specific behaviour
- A callback that fails verification because PayU is unreachable is stored as `verify_unavailable` in the audit trail. The customer is still redirected to the result page, which shows **pending**, not failure or success. Reconciliation completes it later.
- A database failure during callback processing returns 503 so PayU retries. The transaction rolls back, so the retry is clean (tested: no partial activation).
- A callback that is rejected returns 400 with the same message whatever the reason, so an attacker learns nothing.

## Known gaps
- The user-facing copy has not been reviewed by a content designer or translated.
- `GATEWAY_UNAVAILABLE` is defined but the reference returns the result page rather than this code for callbacks; it is intended for API clients.
- No retry-with-backoff on the client side beyond the single gateway retry.
