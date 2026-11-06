# Risk register

Likelihood (L) and impact (I): H / M / L. Owner: to be assigned by the product team.

| ID | Risk | L | I | Current control | Residual action |
|---|---|---|---|---|---|
| R-01 | PayU hash format or verify response shape differs from what is implemented; payments fail or, worse, are trusted incorrectly | M | H | Implemented from PayU's documented format; mock tests; sandbox tests written | Run tests/sandbox against PayU test merchant before launch; treat as blocking |
| R-02 | Merchant salt leaks; attacker forges success callbacks | L | H | Salt only from env; literal-scrub in logs; never in responses; server verify before activation | Secrets manager; rotate salt; restrict log access |
| R-03 | Gateway verify outage leaves paid customers without access for long periods | M | M | Pending state, reconcile job, refresh endpoint, 24 h closed-order look-back | Alert on `verify_unavailable` volume; define an operations runbook |
| R-04 | Reconcile job not scheduled in production | M | H | Logic tested; scheduling not part of module | Deploy job with monitoring; alert on orders pending > 1 h |
| R-05 | Duplicate charges from customer retries at PayU | M | M | Open-order reuse, idempotency keys, verified-once activation | Refund process for double payments; reconcile against PayU settlement report |
| R-06 | Brute-force or credential stuffing from distributed IPs | M | M | Per-IP and per-(IP,email) limits | WAF / bot protection; distributed limiter (R-07) |
| R-07 | In-memory sessions, limits and lockouts lose state or multiply across instances | H (if scaled) | M | Documented | Move to Redis or DB before running more than one instance |
| R-08 | Plaintext PII in logs (names, e-mail, phone) | L | M | Key-based redaction; e-mail is hashed in login-failure logs | Review all log statements; PII policy |
| R-09 | Registration 409 enumerates accounts | M | L | Documented trade-off (O-3) | Product decision; consider verification-e-mail flow |
| R-10 | No e-mail verification, password reset or MFA | H | M | Not implemented in reference | Build before launch; outside payment scope but needed |
| R-11 | Renewal rules and no grace period frustrate customers | M | M | Documented in SUBSCRIPTION_TEST_CASES | Confirm product rules |
| R-12 | Vulnerable dependencies; no lockfile or SCA run here | M | M | None run | Commit lockfile; run `npm audit` and an SCA tool in CI |
| R-13 | Real Blue Code OS code differs from the reference; findings do not transfer | H | H | None | Integrate this module against the real codebase (Claude account 5 step) |
| R-14 | Callback replay after long delay | L | M | Success terminal, one subscription per payment | Covered by tests |
| R-15 | Time-zone / expiry edge cases (server runs in non-UTC, month ends) | L | L | UTC arithmetic, clamping tested | Confirm server clock sync (NTP) |
