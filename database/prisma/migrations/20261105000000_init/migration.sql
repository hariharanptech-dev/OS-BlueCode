-- Blue Code OS: initial schema (additive, non-destructive).
-- Hand-written to include constraints/triggers Prisma cannot express. Applied with `prisma migrate deploy`.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ============================================================ ENUMS
CREATE TYPE "account_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'DISABLED');
CREATE TYPE "billing_interval" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY', 'CUSTOM');
CREATE TYPE "payment_provider" AS ENUM ('PAYU');
CREATE TYPE "payment_status" AS ENUM ('CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'CANCELLED');
CREATE TYPE "subscription_status" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'SUSPENDED');
CREATE TYPE "payment_event_type" AS ENUM (
  'PAYMENT_CREATED', 'REDIRECTED_TO_PROVIDER', 'CALLBACK_RECEIVED', 'WEBHOOK_RECEIVED',
  'VERIFICATION_SUCCEEDED', 'VERIFICATION_FAILED', 'VERIFICATION_MISMATCH',
  'PAYMENT_STATUS_CHANGED', 'SUBSCRIPTION_ACTIVATED', 'RECONCILIATION_CHECKED');
CREATE TYPE "event_processing_status" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');
CREATE TYPE "idempotency_status" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- ============================================================ TABLES
CREATE TABLE "users" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "name"           VARCHAR(200) NOT NULL,
  "email"          VARCHAR(320) NOT NULL,
  "password_hash"  TEXT NOT NULL,
  "account_status" "account_status" NOT NULL DEFAULT 'ACTIVE',
  "created_at"     TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "users_email_lowercase_chk" CHECK ("email" = lower("email")),
  CONSTRAINT "users_name_not_blank_chk" CHECK (char_length(btrim("name")) > 0),
  CONSTRAINT "users_password_hash_not_blank_chk" CHECK (char_length("password_hash") >= 20)
);

CREATE TABLE "plans" (
  "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
  "code"             VARCHAR(64) NOT NULL,
  "name"             VARCHAR(200) NOT NULL,
  "description"      TEXT,
  "price_minor"      INTEGER NOT NULL,
  "currency"         CHAR(3) NOT NULL,
  "billing_interval" "billing_interval" NOT NULL,
  "duration_days"    INTEGER NOT NULL,
  "features"         JSONB NOT NULL DEFAULT '{}',
  "is_active"        BOOLEAN NOT NULL DEFAULT true,
  "created_at"       TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plans_price_positive_chk" CHECK ("price_minor" > 0),
  CONSTRAINT "plans_duration_positive_chk" CHECK ("duration_days" > 0),
  CONSTRAINT "plans_currency_format_chk" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE TABLE "payments" (
  "id"                      UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id"                 UUID NOT NULL,
  "plan_id"                 UUID NOT NULL,
  "order_id"                VARCHAR(64) NOT NULL,
  "transaction_id"          VARCHAR(64) NOT NULL,
  "provider"                "payment_provider" NOT NULL DEFAULT 'PAYU',
  "provider_transaction_id" VARCHAR(128),
  "amount_minor"            INTEGER NOT NULL,
  "currency"                CHAR(3) NOT NULL,
  "plan_duration_days"      INTEGER NOT NULL,
  "status"                  "payment_status" NOT NULL DEFAULT 'CREATED',
  "failure_reason"          VARCHAR(255),
  "idempotency_key"         VARCHAR(128) NOT NULL,
  "initiated_at"            TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verified_at"             TIMESTAMPTZ(3),
  "created_at"              TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"              TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payments_amount_positive_chk" CHECK ("amount_minor" > 0),
  CONSTRAINT "payments_duration_positive_chk" CHECK ("plan_duration_days" > 0),
  CONSTRAINT "payments_currency_format_chk" CHECK ("currency" ~ '^[A-Z]{3}$'),
  -- A SUCCESS payment must carry proof of server-side verification.
  CONSTRAINT "payments_success_requires_verification_chk"
    CHECK ("status" <> 'SUCCESS' OR ("verified_at" IS NOT NULL AND "provider_transaction_id" IS NOT NULL))
);

CREATE TABLE "subscriptions" (
  "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id"       UUID NOT NULL,
  "plan_id"       UUID NOT NULL,
  "payment_id"    UUID NOT NULL,
  "status"        "subscription_status" NOT NULL DEFAULT 'PENDING',
  "start_date"    TIMESTAMPTZ(3) NOT NULL,
  "end_date"      TIMESTAMPTZ(3) NOT NULL,
  "activated_at"  TIMESTAMPTZ(3),
  "suspended_at"  TIMESTAMPTZ(3),
  "cancelled_at"  TIMESTAMPTZ(3),
  "status_reason" VARCHAR(255),
  "created_at"    TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subscriptions_window_chk" CHECK ("end_date" > "start_date"),
  CONSTRAINT "subscriptions_active_has_activated_at_chk" CHECK ("status" <> 'ACTIVE' OR "activated_at" IS NOT NULL),
  -- No two live (ACTIVE/PENDING/SUSPENDED) windows of one user may overlap. Concurrency-proof, DB-enforced.
  CONSTRAINT "subscriptions_no_overlap_excl" EXCLUDE USING gist (
    "user_id" WITH =,
    tstzrange("start_date", "end_date", '[)') WITH &&
  ) WHERE ("status" IN ('ACTIVE', 'PENDING', 'SUSPENDED'))
);

CREATE TABLE "subscription_events" (
  "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
  "subscription_id" UUID NOT NULL,
  "from_status"     "subscription_status",
  "to_status"       "subscription_status" NOT NULL,
  "reason"          VARCHAR(255),
  "actor"           VARCHAR(64) NOT NULL,
  "created_at"      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_events" (
  "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
  "payment_id"         UUID NOT NULL,
  "event_type"         "payment_event_type" NOT NULL,
  "provider_reference" VARCHAR(128),
  "payload"            JSONB NOT NULL DEFAULT '{}',
  "processing_status"  "event_processing_status" NOT NULL DEFAULT 'RECEIVED',
  "received_at"        TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at"       TIMESTAMPTZ(3),
  CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "idempotency_records" (
  "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id"             UUID NOT NULL,
  "idempotency_key"     VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "response_reference"  VARCHAR(128),
  "status"              "idempotency_status" NOT NULL DEFAULT 'IN_PROGRESS',
  "created_at"          TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at"          TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- ============================================================ UNIQUE INDEXES
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");
CREATE UNIQUE INDEX "payments_order_id_key" ON "payments"("order_id");
CREATE UNIQUE INDEX "payments_provider_transaction_id_key" ON "payments"("provider", "transaction_id");
CREATE UNIQUE INDEX "payments_provider_provider_transaction_id_key" ON "payments"("provider", "provider_transaction_id");
CREATE UNIQUE INDEX "payments_user_idempotency_key_key" ON "payments"("user_id", "idempotency_key");
CREATE UNIQUE INDEX "subscriptions_payment_id_key" ON "subscriptions"("payment_id");
CREATE UNIQUE INDEX "idempotency_user_key_key" ON "idempotency_records"("user_id", "idempotency_key");
-- At most ONE active subscription per user (partial unique index; not expressible in Prisma).
CREATE UNIQUE INDEX "subscriptions_one_active_per_user_idx" ON "subscriptions"("user_id") WHERE "status" = 'ACTIVE';

-- ============================================================ INDEXES
CREATE INDEX "payments_user_created_idx" ON "payments"("user_id", "created_at" DESC);
CREATE INDEX "payments_status_initiated_idx" ON "payments"("status", "initiated_at");
CREATE INDEX "payments_plan_idx" ON "payments"("plan_id");
CREATE INDEX "subscriptions_user_status_idx" ON "subscriptions"("user_id", "status");
CREATE INDEX "subscriptions_status_end_idx" ON "subscriptions"("status", "end_date");
CREATE INDEX "subscriptions_plan_idx" ON "subscriptions"("plan_id");
CREATE INDEX "subscription_events_sub_created_idx" ON "subscription_events"("subscription_id", "created_at");
CREATE INDEX "payment_events_payment_received_idx" ON "payment_events"("payment_id", "received_at");
CREATE INDEX "payment_events_provider_ref_idx" ON "payment_events"("provider_reference");
CREATE INDEX "idempotency_expires_idx" ON "idempotency_records"("expires_at");

-- ============================================================ FOREIGN KEYS (all RESTRICT: history is never cascaded away)
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================ INTEGRITY TRIGGERS
-- History is retained: financial/audit rows can never be deleted.
CREATE FUNCTION bc_forbid_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'BC_RETENTION: DELETE is not allowed on %', TG_TABLE_NAME;
END $$;
CREATE TRIGGER payments_no_delete BEFORE DELETE ON "payments" FOR EACH ROW EXECUTE FUNCTION bc_forbid_delete();
CREATE TRIGGER subscriptions_no_delete BEFORE DELETE ON "subscriptions" FOR EACH ROW EXECUTE FUNCTION bc_forbid_delete();
CREATE TRIGGER payment_events_no_delete BEFORE DELETE ON "payment_events" FOR EACH ROW EXECUTE FUNCTION bc_forbid_delete();
CREATE TRIGGER subscription_events_no_delete BEFORE DELETE ON "subscription_events" FOR EACH ROW EXECUTE FUNCTION bc_forbid_delete();

-- Payments: commercial facts are immutable; status may only follow the permitted state machine.
CREATE FUNCTION bc_payments_guard_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id <> OLD.user_id OR NEW.plan_id <> OLD.plan_id OR NEW.order_id <> OLD.order_id
     OR NEW.transaction_id <> OLD.transaction_id OR NEW.provider <> OLD.provider
     OR NEW.amount_minor <> OLD.amount_minor OR NEW.currency <> OLD.currency
     OR NEW.plan_duration_days <> OLD.plan_duration_days OR NEW.idempotency_key <> OLD.idempotency_key
     OR NEW.initiated_at <> OLD.initiated_at OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'BC_IMMUTABLE: immutable payment column modified (payment %)', OLD.id;
  END IF;
  IF OLD.provider_transaction_id IS NOT NULL AND NEW.provider_transaction_id IS DISTINCT FROM OLD.provider_transaction_id THEN
    RAISE EXCEPTION 'BC_IMMUTABLE: provider_transaction_id cannot be changed once set (payment %)', OLD.id;
  END IF;
  IF OLD.verified_at IS NOT NULL AND NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN
    RAISE EXCEPTION 'BC_IMMUTABLE: verified_at cannot be changed once set (payment %)', OLD.id;
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'CREATED' AND NEW.status IN ('PENDING','SUCCESS','FAILED','CANCELLED'))
    OR (OLD.status = 'PENDING' AND NEW.status IN ('SUCCESS','FAILED','CANCELLED'))
    OR (OLD.status IN ('FAILED','CANCELLED') AND NEW.status = 'SUCCESS')   -- reconciliation only (enforced in app layer)
  ) THEN
    RAISE EXCEPTION 'BC_TRANSITION: payment status % -> % not permitted (payment %)', OLD.status, NEW.status, OLD.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_guard_update BEFORE UPDATE ON "payments" FOR EACH ROW EXECUTE FUNCTION bc_payments_guard_update();

-- Subscriptions: window/ownership immutable; EXPIRED and CANCELLED are terminal.
CREATE FUNCTION bc_subscriptions_guard_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id <> OLD.user_id OR NEW.plan_id <> OLD.plan_id OR NEW.payment_id <> OLD.payment_id
     OR NEW.start_date <> OLD.start_date OR NEW.end_date <> OLD.end_date THEN
    RAISE EXCEPTION 'BC_IMMUTABLE: immutable subscription column modified (subscription %)', OLD.id;
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'PENDING'   AND NEW.status IN ('ACTIVE','CANCELLED','EXPIRED'))
    OR (OLD.status = 'ACTIVE'    AND NEW.status IN ('EXPIRED','CANCELLED','SUSPENDED'))
    OR (OLD.status = 'SUSPENDED' AND NEW.status IN ('ACTIVE','CANCELLED','EXPIRED'))
  ) THEN
    RAISE EXCEPTION 'BC_TRANSITION: subscription status % -> % not permitted (subscription %)', OLD.status, NEW.status, OLD.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER subscriptions_guard_update BEFORE UPDATE ON "subscriptions" FOR EACH ROW EXECUTE FUNCTION bc_subscriptions_guard_update();

-- Payment events: append-only except the processing outcome fields.
CREATE FUNCTION bc_payment_events_guard_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payment_id <> OLD.payment_id OR NEW.event_type <> OLD.event_type
     OR NEW.provider_reference IS DISTINCT FROM OLD.provider_reference
     OR NEW.payload <> OLD.payload OR NEW.received_at <> OLD.received_at THEN
    RAISE EXCEPTION 'BC_IMMUTABLE: payment_events are append-only (event %)', OLD.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_events_guard_update BEFORE UPDATE ON "payment_events" FOR EACH ROW EXECUTE FUNCTION bc_payment_events_guard_update();

CREATE FUNCTION bc_forbid_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'BC_IMMUTABLE: % is append-only', TG_TABLE_NAME;
END $$;
CREATE TRIGGER subscription_events_no_update BEFORE UPDATE ON "subscription_events" FOR EACH ROW EXECUTE FUNCTION bc_forbid_update();
