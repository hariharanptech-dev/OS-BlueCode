# Data Dictionary

Types: `uuid`, `text`, `varchar(n)`, `int`, `bool`, `timestamptz` (UTC), `jsonb`. All PKs are `uuid DEFAULT gen_random_uuid()`.
`created_at/updated_at` exist on every mutable table (`timestamptz(3)`, default `now()`; `updated_at` maintained by Prisma/SQL).

## users
| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid | no | PK |
| name | varchar(200) | no | non-blank |
| email | varchar(320) | no | UNIQUE, stored lower-case (CHECK) |
| password_hash | text | no | argon2/bcrypt hash only (validated by Zod; ≥20 chars CHECK). Never plain text |
| account_status | enum | no | `ACTIVE` (default), `SUSPENDED`, `DISABLED`. Only ACTIVE users can create orders |

## plans
| Column | Type | Null | Notes |
|---|---|---|---|
| code | varchar(64) | no | UNIQUE, `[A-Z0-9_]` |
| name, description | varchar/text | no / yes | |
| price_minor | int | no | > 0, minor units. **Authoritative price** |
| currency | char(3) | no | ISO-4217 upper-case; supported set in `shared/money.ts` (INR, USD) |
| billing_interval | enum | no | `MONTHLY, QUARTERLY, YEARLY, CUSTOM` — label only |
| duration_days | int | no | > 0. **Authoritative entitlement length** |
| features | jsonb | no | default `{}`; free-form, business-defined |
| is_active | bool | no | inactive plans cannot be purchased; history unaffected |

## payments
| Column | Type | Null | Notes |
|---|---|---|---|
| user_id, plan_id | uuid | no | FK RESTRICT; **immutable** |
| order_id | varchar(64) | no | UNIQUE; internal order ref; immutable |
| transaction_id | varchar(64) | no | merchant `txnid` for PayU; UNIQUE(provider, transaction_id); immutable |
| provider | enum | no | `PAYU` |
| provider_transaction_id | varchar(128) | yes | PayU `mihpayid`; UNIQUE(provider, …); write-once |
| amount_minor / currency | int / char(3) | no | snapshot of plan price at order time; immutable; amount > 0 |
| plan_duration_days | int | no | snapshot used to compute expiry; immutable |
| status | enum | no | `CREATED, PENDING, SUCCESS, FAILED, CANCELLED` (state machine in trigger) |
| failure_reason | varchar(255) | yes | |
| idempotency_key | varchar(128) | no | UNIQUE(user_id, idempotency_key); immutable |
| initiated_at | timestamptz | no | |
| verified_at | timestamptz | yes | set with SUCCESS (CHECK); write-once |

## subscriptions
| Column | Type | Null | Notes |
|---|---|---|---|
| user_id, plan_id | uuid | no | FK RESTRICT; immutable |
| payment_id | uuid | no | **UNIQUE** FK → payments; the originating payment; immutable |
| status | enum | no | `PENDING, ACTIVE, EXPIRED, CANCELLED, SUSPENDED` |
| start_date / end_date | timestamptz | no | `end > start`; immutable; window is `[start, end)` |
| activated_at | timestamptz | yes | required when ACTIVE (CHECK) |
| suspended_at, cancelled_at | timestamptz | yes | |
| status_reason | varchar(255) | yes | |

## subscription_events (append-only)
`subscription_id`, `from_status` (null on creation), `to_status`, `reason`, `actor` (`PAYMENT_ACTIVATION`, `EXPIRY_JOB`, `ADMIN:<id>`, `SYSTEM`…), `created_at`.

## payment_events (append-only except `processing_status`, `processed_at`)
| Column | Notes |
|---|---|
| payment_id | FK |
| event_type | `PAYMENT_CREATED, REDIRECTED_TO_PROVIDER, CALLBACK_RECEIVED, WEBHOOK_RECEIVED, VERIFICATION_SUCCEEDED, VERIFICATION_FAILED, VERIFICATION_MISMATCH, PAYMENT_STATUS_CHANGED, SUBSCRIPTION_ACTIVATED, RECONCILIATION_CHECKED` |
| provider_reference | PayU reference, if any |
| payload | jsonb, **allow-list sanitised** (see `shared/sanitize.ts`); never hashes/keys/card data/PII |
| processing_status | `RECEIVED, PROCESSED, IGNORED, FAILED` |
| received_at / processed_at | |

## idempotency_records
`user_id`, `idempotency_key` (UNIQUE together), `request_fingerprint` (sha256 hex of canonical request), `response_reference` (payment id), `status` (`IN_PROGRESS, COMPLETED, FAILED`), `created_at`, `expires_at`.
Non-COMPLETED records expire and may be re-claimed/purged; COMPLETED ones are retained while their payment exists.
