# Payment test cases

Status key: **P** passed (automated), **S** skipped (needs credentials), **M** manual only.
IDs map to the suites in `tests/payment` and `tests/e2e`.

## Successful payment
| ID | Case | Where | Status |
|---|---|---|---|
| P-01 | Select plan → order → signed PayU form → pay → verified → one subscription → dashboard | payment-flow.test.ts | P |
| P-01b | Audit event recorded without hash or salt | payment-flow.test.ts | P |
| P-01c | Webhook path and JSON body behave identically | payment-flow.test.ts | P |
| P-01f | Unsigned extra PayU fields ignored; owner taken from our order | payment-flow.test.ts | P |
| E2E-2 | Full browser journey; backend status and dashboard verified | checkout-journey.spec.ts | P |

## Failed payment
| P-02 | Failure recorded, no subscription, retry creates a new order | payment-flow.test.ts | P |
| E2E-3 | Failure screen, no activation, retry succeeds | checkout-journey.spec.ts | P |

## Cancelled payment
| P-03 | Recorded as cancelled, no verification call, no subscription | payment-flow.test.ts | P |
| P-03b | A "pending" callback leaves the order pending | payment-flow.test.ts | P |
| E2E-4 | Cancel screen and dashboard history | checkout-journey.spec.ts | P |

## Duplicates and repeats
| P-08 | Sequential and 10 concurrent checkouts → one order | payment-duplicate.test.ts | P |
| P-08 | Idempotency-Key replay returns the same open order; closed key refused (DEF-004) | payment-duplicate.test.ts | P |
| P-09 | 3 sequential and 25 concurrent identical callbacks → one subscription | payment-duplicate.test.ts | P |
| P-09 | Redirect + webhook + JSON racing → one subscription | payment-duplicate.test.ts | P |
| P-09 | Replay after expiry does not resurrect | payment-duplicate.test.ts | P |
| P-09 | Callback for order A cannot be replayed onto order B | payment-duplicate.test.ts | P |
| P-09 | Stale failure after success ignored; success terminal | payment-duplicate.test.ts | P |
| P-09 | Failure then verified success (retry inside PayU) → rescued once | payment-duplicate.test.ts | P |
| P-09 | Success/cancel race, 8 rounds → converges to gateway truth | payment-duplicate.test.ts | P |
| E2E-6 | Double-click + 8 parallel API checkouts + 10 replayed callbacks | result-page-and-duplicates.spec.ts | P |

## Invalid and forged
| P-05 | Invalid hash, flipped hash, wrong salt, tampered amount/status, amount/key/udf1/currency mismatch, unknown txn, cross-order hash replay, unknown status, each required field missing, empty body, 40 KB body | payment-invalid.test.ts | P |
| P-05 | All rejections return an identical message (no oracle) | payment-invalid.test.ts | P |
| P-07 | No endpoint accepts a client-asserted status; query strings ignored | payment-invalid.test.ts | P |
| E2E-5 | Forged `?status=success` on a failed or pending order changes nothing | result-page-and-duplicates.spec.ts | P |

## Verification failures
| P-06 | Gateway outage on a valid callback: stays pending, refresh completes later | payment-invalid.test.ts | P |
| P-06 | Timeout treated as outage | payment-invalid.test.ts | P |
| P-06 | Gateway says not paid although callback says success → not activated | payment-invalid.test.ts | P |
| P-06 | Gateway says failed/different amount/different mihpayid → not activated and flagged for review | payment-invalid.test.ts | P |

## Delayed payment
| P-10 | Customer closes browser; reconcile job settles a paid order | payment-delayed.test.ts | P |
| P-10 | Browser returns mid-verification: UI shows pending, then success | payment-delayed.test.ts | P |
| P-10 | Refresh settles paid-but-uncallbacked orders; refresh during outage degrades gracefully | payment-delayed.test.ts | P |
| P-10 | Abandoned checkout expires after 30 min; late verified success still applies | payment-delayed.test.ts | P |
| DEF-003 | Failure callback, retry paid, success lost → rescued | payment-delayed.test.ts | P |

## Real PayU sandbox
| S-01 | Verify-payment call authenticates and reports unknown txnid as not found | tests/sandbox | S |
| S-02 | Sandbox accepts our request-hash format | tests/sandbox | S |
| S-03 | Complete a payment on the hosted page; surl hash validates | tests/sandbox | M |

Sandbox cases were **not executed** in this module. Nothing here establishes that PayU accepts our hash format.
