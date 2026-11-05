-- CreateEnum
CREATE TYPE "CashierSessionStatus" AS ENUM ('OPEN', 'CLOSED', 'REMITTED', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED');

-- DropIndex

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "cashier_session_id" UUID;

-- CreateTable
CREATE TABLE "cashier_sessions" (
    "id" UUID NOT NULL,
    "session_no" VARCHAR(30) NOT NULL,
    "event_id" UUID NOT NULL,
    "cashier_id" UUID NOT NULL,
    "status" "CashierSessionStatus" NOT NULL DEFAULT 'OPEN',
    "opening_float" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expected_amount" DECIMAL(12,2),
    "counted_amount" DECIMAL(12,2),
    "closed_at" TIMESTAMPTZ(6),
    "close_note" VARCHAR(1000),
    "remittance_no" VARCHAR(50),
    "remitted_at" TIMESTAMPTZ(6),
    "confirmed_by_id" UUID,
    "confirmed_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cashier_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "refund_no" VARCHAR(30) NOT NULL,
    "order_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "payee_name" VARCHAR(300) NOT NULL,
    "bank_name" VARCHAR(150) NOT NULL,
    "account_no_enc" VARCHAR(500) NOT NULL,
    "account_no_masked" VARCHAR(30) NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "reject_reason" VARCHAR(1000),
    "paid_by_id" UUID,
    "paid_at" TIMESTAMPTZ(6),
    "paid_ref" VARCHAR(100),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cashier_sessions_session_no_key" ON "cashier_sessions"("session_no");

-- CreateIndex
CREATE INDEX "cashier_sessions_event_id_status_idx" ON "cashier_sessions"("event_id", "status");

-- CreateIndex
CREATE INDEX "cashier_sessions_cashier_id_status_idx" ON "cashier_sessions"("cashier_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_refund_no_key" ON "refunds"("refund_no");

-- CreateIndex
CREATE INDEX "refunds_order_id_idx" ON "refunds"("order_id");

-- CreateIndex
CREATE INDEX "refunds_status_created_at_idx" ON "refunds"("status", "created_at");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_cashier_session_id_fkey" FOREIGN KEY ("cashier_session_id") REFERENCES "cashier_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashier_sessions" ADD CONSTRAINT "cashier_sessions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashier_sessions" ADD CONSTRAINT "cashier_sessions_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashier_sessions" ADD CONSTRAINT "cashier_sessions_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "payment_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ───────────── Hand-written constraints ─────────────
CREATE UNIQUE INDEX "cashier_sessions_one_open_per_cashier_event"
  ON "cashier_sessions" ("event_id", "cashier_id") WHERE "status" = 'OPEN';
ALTER TABLE "cashier_sessions" ADD CONSTRAINT "cashier_sessions_amounts_chk"
  CHECK ("opening_float" >= 0 AND ("counted_amount" IS NULL OR "counted_amount" >= 0));
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_chk" CHECK ("amount" > 0);

-- Refund amount is write-once and refunds are never deleted.
CREATE TRIGGER "refunds_amount_immutable" BEFORE UPDATE OR DELETE ON "refunds"
  FOR EACH ROW EXECUTE FUNCTION forbid_amount_change();

-- Expected/counted cash is frozen once set (close of session).
CREATE OR REPLACE FUNCTION forbid_cashier_total_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'cashier_sessions cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (OLD."expected_amount" IS NOT NULL AND NEW."expected_amount" IS DISTINCT FROM OLD."expected_amount")
     OR (OLD."counted_amount" IS NOT NULL AND NEW."counted_amount" IS DISTINCT FROM OLD."counted_amount")
     OR NEW."opening_float" IS DISTINCT FROM OLD."opening_float" THEN
    RAISE EXCEPTION 'cashier_sessions amounts are immutable once recorded' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "cashier_sessions_totals_immutable" BEFORE UPDATE OR DELETE ON "cashier_sessions"
  FOR EACH ROW EXECUTE FUNCTION forbid_cashier_total_change();
