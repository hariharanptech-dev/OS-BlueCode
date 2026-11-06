# API security checklist

Legend: ✅ verified by automated test in this module · ⚠ partially verified · ❌ not implemented / not verified

| Area | Control | Status | Evidence |
|---|---|---|---|
| Transport | HTTPS only in production (config refuses http base URL) | ✅ config / ⚠ runtime (HTTP server itself is plain; TLS terminates at proxy) | config.test.ts |
| Transport | HSTS when Secure | ✅ | csrf-cors-headers.test.ts |
| AuthN | Passwords hashed (scrypt, per-user salt) | ✅ | password-validation.test.ts |
| AuthN | Brute-force lockout | ✅ | authn.test.ts |
| AuthN | Session fixation prevented | ✅ | authn.test.ts |
| AuthN | Idle and absolute timeouts | ✅ | authn.test.ts, limiter-session.test.ts |
| AuthN | Logout invalidates server session | ✅ | authz.test.ts, api-contract |
| AuthN | MFA | ❌ | RISK R-10 |
| AuthZ | Object-level checks on every id | ✅ | authz.test.ts |
| AuthZ | Client cannot choose user id | ✅ | authz.test.ts |
| Input | Strict schemas, unknown keys rejected | ✅ | password-validation.test.ts |
| Input | Body size limits | ✅ | api-contract.test.ts |
| Input | Content-type enforcement (blocks form CSRF on JSON APIs) | ✅ | api-contract.test.ts |
| Input | Prototype pollution / NoSQL operators | ✅ | injection-leakage.test.ts |
| Injection | SQL (no string-built SQL) | ✅ static + ⚠ reference has no SQL | scan-sql.ts |
| XSS | Output as text; CSP; no inline scripts | ✅ | csrf-cors-headers.test.ts, frontend-security.spec.ts |
| CSRF | Token plus Origin allow-list on writes | ✅ | csrf-cors-headers.test.ts |
| CSRF | Login CSRF | ⚠ Origin check only | O-6 |
| CORS | Exact allow-list, no wildcard, no credentials for foreign origins | ✅ | csrf-cors-headers.test.ts |
| Headers | nosniff, DENY framing, Referrer-Policy, Permissions-Policy, COOP/CORP | ✅ | csrf-cors-headers.test.ts |
| Errors | Stable codes, generic messages, no stacks | ✅ | logger-errors.test.ts, injection-leakage.test.ts |
| Rate limits | Auth, checkout, refresh, callback, global per IP/user | ✅ (in-memory) / ❌ distributed | rate-limit.test.ts; R-07 |
| Proxy | X-Forwarded-For only when trusted proxies configured | ✅ | limiter-session.test.ts |
| Redirects | Open-redirect blocked | ✅ | limiter-session.test.ts, frontend-security.spec.ts |
| Logging | Secrets, card numbers and cookies redacted | ✅ | logger-errors.test.ts, secrets-logging.test.ts |
| Config | Production refuses placeholders, sandbox URLs, mock UI, defects | ✅ | config.test.ts |
| Payments | Request/response hash, constant-time compare | ✅ against mock; ❌ against PayU | payu-hash.test.ts; R-01 |
| Payments | Server-to-server verification before activation | ✅ | payment-invalid.test.ts |
| Monitoring | Security events emitted (invalid hash, lockout, CSRF) | ✅ (to stdout sink) / ❌ alerting | secrets-logging.test.ts |
| Dependencies | Vulnerability scan (npm audit / SCA) | ❌ not run in this environment | R-12 |
| Dependencies | Lockfile committed | ❌ no lockfile generated here | R-12 |
