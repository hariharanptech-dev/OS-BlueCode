# Payment Flow

1. `POST /payments/initiate` (session + CSRF + `Idempotency-Key`, body `{planId}`) → price read from DB → Payment CREATED→PENDING → response contains `{action, method, fields}` (incl. server-computed hash; never the salt).
2. Frontend builds a hidden form from `fields` and POSTs it to `action` (PayU).
3. Customer pays on PayU. PayU POSTs the result to `surl`/`furl` (browser) and, if configured, to the webhook (S2S).
4. Callback handler: hash check → merchant key → txnid lookup → `udf1 == orderId` → amount match → idempotent event insert → (status=success) **Verify Payment API** → atomic SUCCESS + subscription.
5. Browser is 303-redirected to the frontend result page, which calls `GET /payments/:orderId/status` and shows what the server says.

Failure paths: bad hash/unknown txn/amount mismatch → rejected, no state change; PayU unreachable → VERIFICATION_PENDING; duplicate callback → no-op; conflicting callback → CONFLICT event.
