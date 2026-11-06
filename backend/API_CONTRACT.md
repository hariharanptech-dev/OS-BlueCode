# API Contract (base `/api/v1`)
Errors: `{ "error": { "code": "…", "message": "…" } }`. Session cookie `bc.sid` (HttpOnly). State-changing authenticated calls need header `X-CSRF-Token` (returned by login and `/auth/me`).

| Method & path | Auth | Notes |
|---|---|---|
| POST /auth/register | – | `{email,name,phone?,password(>=10)}` → 201 `{user}` |
| POST /auth/login | – | → `{user, csrfToken}`; rotates session |
| POST /auth/logout | session+CSRF | 204 |
| GET /auth/me | session | `{user, csrfToken}` or 401 |
| GET /plans, /plans/:planId | – | `{plans:[{id,code,name,price:"499.00",currency,durationDays}]}` |
| GET /subscriptions/me | session | `{subscription: {...}|null}` |
| POST /payments/initiate | session+CSRF+`Idempotency-Key` | `{planId}` only; extra fields → 400 |
| GET /payments/:orderId/status | session | reconciles PENDING/VERIFICATION_PENDING with PayU |
| GET /payments/history?limit&offset | session | newest first |
| POST /payments/payu/callback | none (hash-verified) | form-urlencoded from PayU |

Initiate response (201):
```json
{"orderId":"ORD-LX3K9A-1F2E3D4C","status":"PENDING","replayed":false,
 "payment":{"action":"https://test.payu.in/_payment","method":"POST",
  "fields":{"key":"<merchant key>","txnid":"BC…","amount":"499.00","productinfo":"…","firstname":"…","email":"…","phone":"…","surl":"…","furl":"…","udf1":"ORD-…","hash":"<sha512>"}}}
```
Status response: `{"orderId":"…","status":"SUCCESS","amountInPaise":49900,"currency":"INR","createdAt":"…"}`
