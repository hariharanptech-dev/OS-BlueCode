# Payment State Machine (`services/paymentStateMachine.ts`)

States: CREATED, PENDING, VERIFICATION_PENDING, SUCCESS, FAILED, CANCELLED, EXPIRED.

| From | Allowed to |
|---|---|
| CREATED | PENDING, FAILED, CANCELLED, EXPIRED, VERIFICATION_PENDING, SUCCESS |
| PENDING | SUCCESS, FAILED, CANCELLED, EXPIRED, VERIFICATION_PENDING |
| VERIFICATION_PENDING | SUCCESS, FAILED, CANCELLED, EXPIRED |
| SUCCESS / FAILED / CANCELLED / EXPIRED | none (terminal) |

Rules
- SUCCESS is reachable **only** through `succeedAndActivate`, after PayU's Verify Payment API returned success with a matching amount.
- Every change is a compare-and-set (`UPDATE … WHERE id=? AND status IN (allowed-from)`); 0 rows updated means another request won.
- A callback that disagrees with a terminal state is never applied: a `CONFLICT` PaymentEvent is written, an error is logged, and the order needs manual reconciliation.
- VERIFICATION_PENDING (PayU unreachable / not found yet / pending) is resolved by `GET /payments/:orderId/status`, which re-queries PayU. A "not found" record older than 30 min becomes EXPIRED.
- FAILED is terminal by design; a later verified success after FAILED is flagged as a conflict rather than silently flipped.
