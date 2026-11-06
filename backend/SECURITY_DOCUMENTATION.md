# Security
- Secrets only from env (validated by Zod at boot; production rejects test PayU URLs / non-HTTPS backend). Logger redacts password/hash/salt/card fields; callbacks are stored without `hash` or card fields. No card data is ever received or stored.
- Amount, user, plan price never read from the browser; strict Zod schema rejects extra fields.
- Auth: bcrypt (cost 12), constant-time unknown-user path, session regenerated on login, HttpOnly + SameSite=Lax (+Secure in prod) cookie, Postgres session store.
- CSRF: synchronizer token on authenticated POSTs. The PayU callback is intentionally session-less and protected by reverse-hash + server-side verification.
- Helmet, CORS limited to `FRONTEND_URL`, 10 kb JSON / 32 kb form limits, rate limits (global, auth, payments, callback), Prisma parameterised queries, generic 500 messages.
- Money integrity: integer paise, amount checked on callback and again on verify; unique constraints on `txnid`, `orderId`, `Subscription.paymentId`, `(txnid,payloadHash)`, `(userId,key)`.
- Known gaps: no account lockout/email verification; no webhook IP allow-listing (confirm PayU's IPs); no automated refund handling; rate limiter is in-memory (use a shared store behind multiple instances).
