-- CreateEnum
CREATE TYPE "PaymentOrderStatus" AS ENUM ('UNPAID', 'PENDING_VERIFICATION', 'PAID', 'EXPIRED', 'CANCELLED', 'WAIVED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('SUBMITTED', 'VERIFIED', 'REJECTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PaymentChannel" AS ENUM ('TRANSFER', 'ONSITE');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('CHARGE', 'PAYMENT', 'WAIVER', 'REVERSAL', 'REFUND');

-- CreateEnum
CREATE TYPE "FinanceBatchStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'RETURNED', 'RECEIVED', 'RECEIPTS_ISSUED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('ISSUED', 'DELIVERED', 'VOIDED', 'RETURNED_UNUSED');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "bank_account_id" UUID,
ADD COLUMN     "income_code_id" UUID,
ADD COLUMN     "payment_window_hours" INTEGER NOT NULL DEFAULT 72;

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "bank_name" VARCHAR(150) NOT NULL,
    "branch" VARCHAR(150),
    "account_no" VARCHAR(20) NOT NULL,
    "account_name" VARCHAR(300) NOT NULL,
    "promptpay_id" VARCHAR(20),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "income_codes" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name_th" VARCHAR(300) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "income_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_fee_rates" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "participant_type_id" UUID,
    "name_th" VARCHAR(200) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "valid_from" TIMESTAMPTZ(6),
    "valid_until" TIMESTAMPTZ(6),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_fee_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" UUID NOT NULL,
    "order_no" VARCHAR(30) NOT NULL,
    "event_id" UUID NOT NULL,
    "registration_id" UUID,
    "payer_name" VARCHAR(300) NOT NULL,
    "payer_email" VARCHAR(254) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "fee_rate_id" UUID,
    "fee_snapshot" JSONB NOT NULL,
    "bank_account_snapshot" JSONB,
    "income_code" VARCHAR(30),
    "status" "PaymentOrderStatus" NOT NULL DEFAULT 'UNPAID',
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "paid_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "close_reason" VARCHAR(1000),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "payment_no" VARCHAR(30) NOT NULL,
    "order_id" UUID NOT NULL,
    "channel" "PaymentChannel" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'SUBMITTED',
    "slip_file_id" UUID,
    "slip_sha256" CHAR(64),
    "transferred_at" TIMESTAMPTZ(6),
    "payer_note" VARCHAR(500),
    "submitted_by_id" UUID,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_by_id" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "reject_reason" VARCHAR(1000),
    "voided_by_id" UUID,
    "voided_at" TIMESTAMPTZ(6),
    "void_reason" VARCHAR(1000),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_ledger_entries" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "payment_id" UUID,
    "entry_type" "LedgerEntryType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" VARCHAR(1000),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_batches" (
    "id" UUID NOT NULL,
    "batch_no" VARCHAR(30) NOT NULL,
    "organization_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "status" "FinanceBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "total_amount" DECIMAL(12,2) NOT NULL,
    "item_count" INTEGER NOT NULL,
    "snapshot" JSONB,
    "note" VARCHAR(1000),
    "created_by_id" UUID NOT NULL,
    "submitted_by_id" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "received_by_id" UUID,
    "received_at" TIMESTAMPTZ(6),
    "returned_by_id" UUID,
    "returned_at" TIMESTAMPTZ(6),
    "return_reason" VARCHAR(1000),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "finance_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_batch_items" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_batch_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_records" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "batch_id" UUID,
    "fiscal_year" INTEGER NOT NULL,
    "book_no" VARCHAR(20) NOT NULL,
    "receipt_no" VARCHAR(30) NOT NULL,
    "issued_at" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'ISSUED',
    "recorded_by_id" UUID NOT NULL,
    "voided_at" TIMESTAMPTZ(6),
    "void_reason" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "receipt_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_accounts_organization_id_idx" ON "bank_accounts"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "income_codes_code_key" ON "income_codes"("code");

-- CreateIndex
CREATE INDEX "event_fee_rates_event_id_is_active_idx" ON "event_fee_rates"("event_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_order_no_key" ON "payment_orders"("order_no");

-- CreateIndex
CREATE INDEX "payment_orders_event_id_status_idx" ON "payment_orders"("event_id", "status");

-- CreateIndex
CREATE INDEX "payment_orders_registration_id_idx" ON "payment_orders"("registration_id");

-- CreateIndex
CREATE INDEX "payment_orders_status_due_at_idx" ON "payment_orders"("status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_payment_no_key" ON "payments"("payment_no");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "payments_status_submitted_at_idx" ON "payments"("status", "submitted_at");

-- CreateIndex
CREATE INDEX "payment_ledger_entries_order_id_created_at_idx" ON "payment_ledger_entries"("order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "finance_batches_batch_no_key" ON "finance_batches"("batch_no");

-- CreateIndex
CREATE INDEX "finance_batches_organization_id_status_idx" ON "finance_batches"("organization_id", "status");

-- CreateIndex
CREATE INDEX "finance_batches_event_id_idx" ON "finance_batches"("event_id");

-- CreateIndex
CREATE INDEX "finance_batches_status_created_at_idx" ON "finance_batches"("status", "created_at");

-- CreateIndex
CREATE INDEX "finance_batch_items_batch_id_idx" ON "finance_batch_items"("batch_id");

-- CreateIndex
CREATE INDEX "receipt_records_payment_id_idx" ON "receipt_records"("payment_id");

-- CreateIndex
CREATE INDEX "receipt_records_batch_id_idx" ON "receipt_records"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_records_fiscal_year_book_no_receipt_no_key" ON "receipt_records"("fiscal_year", "book_no", "receipt_no");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_income_code_id_fkey" FOREIGN KEY ("income_code_id") REFERENCES "income_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_fee_rates" ADD CONSTRAINT "event_fee_rates_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_fee_rates" ADD CONSTRAINT "event_fee_rates_participant_type_id_fkey" FOREIGN KEY ("participant_type_id") REFERENCES "participant_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_fee_rate_id_fkey" FOREIGN KEY ("fee_rate_id") REFERENCES "event_fee_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "payment_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_slip_file_id_fkey" FOREIGN KEY ("slip_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_ledger_entries" ADD CONSTRAINT "payment_ledger_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "payment_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_ledger_entries" ADD CONSTRAINT "payment_ledger_entries_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_ledger_entries" ADD CONSTRAINT "payment_ledger_entries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_batches" ADD CONSTRAINT "finance_batches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_batches" ADD CONSTRAINT "finance_batches_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_batches" ADD CONSTRAINT "finance_batches_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_batches" ADD CONSTRAINT "finance_batches_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_batch_items" ADD CONSTRAINT "finance_batch_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "finance_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_batch_items" ADD CONSTRAINT "finance_batch_items_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_records" ADD CONSTRAINT "receipt_records_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_records" ADD CONSTRAINT "receipt_records_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "finance_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_records" ADD CONSTRAINT "receipt_records_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───────────── Hand-written constraints (not expressible in Prisma) ─────────────

-- Money sanity
ALTER TABLE "event_fee_rates" ADD CONSTRAINT "event_fee_rates_amount_chk" CHECK ("amount" >= 0);
ALTER TABLE "event_fee_rates" ADD CONSTRAINT "event_fee_rates_window_chk"
  CHECK ("valid_from" IS NULL OR "valid_until" IS NULL OR "valid_until" > "valid_from");
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_amount_chk" CHECK ("amount" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_chk" CHECK ("amount" > 0);
ALTER TABLE "finance_batch_items" ADD CONSTRAINT "finance_batch_items_amount_chk" CHECK ("amount" > 0);
ALTER TABLE "receipt_records" ADD CONSTRAINT "receipt_records_amount_chk" CHECK ("amount" > 0);
ALTER TABLE "events" ADD CONSTRAINT "events_payment_window_chk" CHECK ("payment_window_hours" BETWEEN 1 AND 720);

-- One live payment order per registration.
CREATE UNIQUE INDEX "payment_orders_one_live_per_registration"
  ON "payment_orders" ("registration_id")
  WHERE "status" IN ('UNPAID', 'PENDING_VERIFICATION', 'PAID', 'WAIVED');

-- At most one payment awaiting verification per order.
CREATE UNIQUE INDEX "payments_one_pending_per_order"
  ON "payments" ("order_id") WHERE "status" = 'SUBMITTED';

-- The same slip image cannot back two live payments.
CREATE UNIQUE INDEX "payments_slip_sha256_live"
  ON "payments" ("slip_sha256") WHERE "slip_sha256" IS NOT NULL AND "status" IN ('SUBMITTED', 'VERIFIED');

-- A payment belongs to at most one live batch.
CREATE UNIQUE INDEX "finance_batch_items_payment_live"
  ON "finance_batch_items" ("payment_id") WHERE "is_active";

-- One valid receipt per payment.
CREATE UNIQUE INDEX "receipt_records_payment_live"
  ON "receipt_records" ("payment_id") WHERE "status" <> 'VOIDED';

-- Ledger is append-only.
CREATE TRIGGER "payment_ledger_entries_append_only"
  BEFORE UPDATE OR DELETE ON "payment_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

-- Money columns are write-once; rows themselves are never deleted.
CREATE OR REPLACE FUNCTION forbid_amount_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Rows in % cannot be deleted', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."amount" IS DISTINCT FROM OLD."amount" THEN
    RAISE EXCEPTION '%.amount is immutable – record a reversal instead', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payment_orders_amount_immutable" BEFORE UPDATE OR DELETE ON "payment_orders"
  FOR EACH ROW EXECUTE FUNCTION forbid_amount_change();
CREATE TRIGGER "payments_amount_immutable" BEFORE UPDATE OR DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION forbid_amount_change();
CREATE TRIGGER "finance_batch_items_amount_immutable" BEFORE UPDATE OR DELETE ON "finance_batch_items"
  FOR EACH ROW EXECUTE FUNCTION forbid_amount_change();
CREATE TRIGGER "receipt_records_amount_immutable" BEFORE UPDATE OR DELETE ON "receipt_records"
  FOR EACH ROW EXECUTE FUNCTION forbid_amount_change();

-- Batch totals are fixed at creation.
CREATE OR REPLACE FUNCTION forbid_batch_total_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'finance_batches cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."total_amount" IS DISTINCT FROM OLD."total_amount" OR NEW."item_count" IS DISTINCT FROM OLD."item_count" THEN
    RAISE EXCEPTION 'finance_batches totals are immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "finance_batches_totals_immutable" BEFORE UPDATE OR DELETE ON "finance_batches"
  FOR EACH ROW EXECUTE FUNCTION forbid_batch_total_change();
