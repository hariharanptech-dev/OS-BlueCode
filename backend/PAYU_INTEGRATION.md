# PayU Integration (India, PayU Hosted Checkout)

Method used: **PayU Hosted Checkout** — browser auto-POSTs a server-signed form to PayU's `_payment` endpoint; PayU collects the payment and POSTs the result to `surl`/`furl`; the backend then confirms with the **Verify Payment API**. Source: docs.payu.in (Hosted Checkout, Authentication with PayU APIs, Verify Payment API, Transaction Callback), read 6 Nov 2026.

## Endpoints
| Purpose | Test | Production |
|---|---|---|
| Payment (`_payment`) | `https://test.payu.in/_payment` | `https://secure.payu.in/_payment` |
| Verify Payment | `https://test.payu.in/merchant/postservice?form=2` | `https://info.payu.in/merchant/postservice.php?form=2` |

`config/index.ts` refuses to start in production with test URLs. Note PayU's docs show both `postservice` and `postservice.php` spellings for the verify path; the code uses whatever is in `PAYU_VERIFY_URL`.

## Hash rules (all SHA-512, lowercase hex) — `src/integrations/payu/hash.ts`
- Request: `sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||SALT)`
- Response (reverse): `sha512(SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)`; if PayU posts `additionalCharges`, it is **prepended** (`additionalCharges|SALT|...`).
- General APIs (verify_payment): `sha512(key|command|var1|SALT)`.
- Empty optional fields stay as empty strings so the pipe count never changes.
- Comparison uses `timingSafeEqual`.

## Request fields sent
`key, txnid, amount (rupees, 2dp), productinfo (plan name), firstname, email, phone, surl, furl, udf1 (= our orderId), hash`. `surl` and `furl` both point to `/api/v1/payments/payu/callback?src=browser`.

## Callback / webhook
One endpoint handles both. `?src=browser` → 303 redirect to `FRONTEND_URL/payment/result?orderId=…` (display hint only; the page must call `/status`). No `src` → JSON 200/400 for S2S webhooks.

## Not verified against a live PayU account (you must check in sandbox)
1. **Cancellation mapping.** Code treats `status=failure` with `unmappedstatus=userCancelled` as CANCELLED. That literal value is my assumption, not read from the docs.
2. **Webhook configuration.** Webhook URL/events are set in the PayU dashboard; I did not verify that the S2S payload uses the same reverse-hash fields as the browser response. The shared handler assumes it does and rejects otherwise.
3. **Verify response amount field** (`amt` vs `amount`) — both accepted.
4. **txnid charset/length.** Generated as `BC` + 20 hex chars (22 chars, alphanumeric).
5. Real gateway tests: **none were run.** All automated tests use a mocked gateway.
