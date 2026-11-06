# Testing strategy

## Layers
| Layer | Folder | Runner | What it proves |
|---|---|---|---|
| Unit | `tests/unit` | `node --test` | Hashes (known-answer vectors written as literal field lists), amount arithmetic, state machine (exhaustive 5×5 table), expiry maths, validation, errors, logging, limiter, sessions, config, HTTP gateway client against a stub |
| API contract | `tests/api` | `node --test` + in-process HTTP | Protocol hygiene, error shape, auth endpoints, pagination over 1,000 orders |
| Payment | `tests/payment` | `node --test` | Success, failure, cancel, duplicates, concurrency, invalid/forged callbacks, verification failures, delayed payments |
| Subscription | `tests/subscription` | `node --test` | Activation rules, expiry, history, renewal stacking |
| Security | `tests/security` | `node --test` | AuthN, AuthZ/IDOR, CSRF/CORS/headers/CSP, injection, leakage, rate limits, logging, secret scan |
| Integration | `tests/integration` | `node --test` | Transactional rollback, outage recovery, seeded randomised event sequences (5 seeds × 150 events) |
| E2E | `tests/e2e` | Playwright (Chromium) | The seven required user journeys plus front-end security behaviours |
| Sandbox | `tests/sandbox` | `node --test` | Real PayU — **skipped without credentials; never executed here** |

## Mocked versus real gateway
The reference app uses `MockPayUGateway`, which implements PayU's *documented* request and response hashing and a
server-to-server verify call. It is deterministic, so it is suitable for repeatable regression tests. It is **not** evidence
that PayU behaves this way. Results from mocked tests must be reported as "against the mock". Real-gateway claims require
`tests/sandbox` to run against PayU's sandbox with credentials.

## Test-quality controls
- **Mutation testing** (`scripts/mutation-check.ts`): 16 injected defects spanning payment, authz, sessions, CSRF/CORS, logging
  and leakage. A control run with no defect must pass. Current score: 16/16 killed, control clean.
- **Invariant checker** (`tests/helpers/invariants.ts`): after every event, no payment activates twice, every success has exactly one subscription, no non-success order has one, and the gateway ledger agrees.
- **Seeded fuzzing**: each failing run prints its seed so it can be replayed.
- **Self-tests** for tooling: the secret scanner and SQL scanner are tested against planted positives and negatives.
- Tests that revealed defects were first observed failing, then fixed. Expected values were checked independently; two of my own
  expectations (a date-arithmetic slip and a PAN example) were corrected in the test, not the code, after verifying which was wrong.

## Running
```
npm install                      # installs zod, typescript, @types/node, @playwright/test (see package.json)
npm run typecheck
npm test                         # all non-browser suites
npm run test:e2e                 # requires Chromium (npx playwright install chromium)
npm run scan:secrets
node scripts/scan-sql.ts src
node scripts/mutation-check.ts   # ~1 minute
npm run perf                     # writes reports/perf.json
npm run gate                     # full quality gate -> reports/quality-gate.json
```

## Limitations
- The in-memory DB models transactions with snapshot/rollback and UNIQUE constraints. It does not exercise a real engine's isolation levels, locking or deadlocks.
- Concurrency is tested within one Node process. Multi-process races against a shared database are not tested.
- Playwright was run against a locally installed Chromium build; other browsers were not tested.
