# Subscription test cases (tests/subscription, plus related payment tests)

| ID | Case | Status |
|---|---|---|
| S-01a | Activates after verified success with correct user, plan, start and expiry | P |
| S-01b | Yearly plan expires one calendar year later | P |
| S-01c | No subscription after failure or cancellation; history empty | P |
| S-01d | Subscription bound to the checkout user even if callback names another user | P |
| S-01e | Jan 31 purchase expires Feb 28 | P |
| S-01f | DB UNIQUE on payment id blocks second activation | P |
| S-02a | Active → expired transition; record kept in history | P |
| S-02b | Expiry boundary is exclusive | P |
| S-02c | New purchase after expiry starts a new period from now; history keeps both | P |
| S-02d | Other users' subscriptions isolated; `?userId=` ignored | P |
| S-03a | Different plan while active → 409, no order created | P |
| S-03b | Same plan far from expiry → 409 (prevents accidental double charge) | P |
| S-03c | Same plan within 7 days of expiry → allowed; new period starts after current one (no lost days) | P |
| S-03d | Queued renewal becomes current when the first period ends | P |
| S-03e | Payment already in flight for another plan, later verified, is queued after the current period | P |
| S-03f | Failed/cancelled attempts do not block a later purchase | P |
| E2E | Dashboard shows active plan, expiry, history | P |

## Renewal behaviour: decisions to confirm with the product owner
- Renewal is **manual** in the reference (customer buys again). No automatic recurring billing is implemented. PayU mandate/eNACH flows were out of scope.
- Renewal inside a 7-day window stacks after the current period. Outside the window it is refused, which may frustrate users who want to pay early. This is a product decision recorded in RISK_REGISTER R-11.
- Grace period after expiry: **none** is implemented. Access ends at `expiresAt`.
