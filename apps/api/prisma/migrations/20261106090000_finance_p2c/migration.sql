
-- CreateEnum
CREATE TYPE "BillingType" AS ENUM ('INDIVIDUAL', 'JURISTIC');

-- CreateEnum
CREATE TYPE "StatementMatchStatus" AS ENUM ('UNMATCHED', 'AUTO', 'MANUAL', 'IGNORED');

-- AlterEnum
ALTER TYPE "ApprovalStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "approval_requests" ADD COLUMN     "payload" JSONB,
ADD COLUMN     "reason" VARCHAR(1000);

-- AlterTable
ALTER TABLE "payment_orders" ADD COLUMN     "billing_address" VARCHAR(1000),
ADD COLUMN     "billing_branch" VARCHAR(100),
ADD COLUMN     "billing_name" VARCHAR(300),
ADD COLUMN     "billing_tax_id" CHAR(13),
ADD COLUMN     "billing_type" "BillingType" NOT NULL DEFAULT 'INDIVIDUAL';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "captured_offline_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "bank_statements" (
    "id" UUID NOT NULL,
    "statement_no" VARCHAR(30) NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "file_name" VARCHAR(300) NOT NULL,
    "file_sha256" CHAR(64) NOT NULL,
    "period_from" TIMESTAMPTZ(6) NOT NULL,
    "period_to" TIMESTAMPTZ(6) NOT NULL,
    "line_count" INTEGER NOT NULL,
    "duplicate_count" INTEGER NOT NULL DEFAULT 0,
    "total_credit" DECIMAL(12,2) NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_lines" (
    "id" UUID NOT NULL,
    "statement_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "txn_at" TIMESTAMPTZ(6) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "description" VARCHAR(500),
    "reference" VARCHAR(100),
    "fingerprint" CHAR(64) NOT NULL,
    "match_status" "StatementMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "payment_id" UUID,
    "matched_by_id" UUID,
    "matched_at" TIMESTAMPTZ(6),
    "note" VARCHAR(1000),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_statements_statement_no_key" ON "bank_statements"("statement_no");

-- CreateIndex
CREATE INDEX "bank_statements_bank_account_id_period_from_idx" ON "bank_statements"("bank_account_id", "period_from");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statements_bank_account_id_file_sha256_key" ON "bank_statements"("bank_account_id", "file_sha256");

-- CreateIndex
CREATE INDEX "bank_statement_lines_bank_account_id_match_status_txn_at_idx" ON "bank_statement_lines"("bank_account_id", "match_status", "txn_at");

-- CreateIndex
CREATE INDEX "bank_statement_lines_payment_id_idx" ON "bank_statement_lines"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_lines_statement_id_line_no_key" ON "bank_statement_lines"("statement_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_lines_bank_account_id_fingerprint_key" ON "bank_statement_lines"("bank_account_id", "fingerprint");

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "bank_statements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_matched_by_id_fkey" FOREIGN KEY ("matched_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ───────────── Hand-written constraints (P2c) ─────────────

-- At most one pending approval request per event (initial or FEE_CHANGE).
CREATE UNIQUE INDEX "approval_requests_one_pending_per_event"
  ON "approval_requests" ("event_id") WHERE "status" = 'PENDING';

-- FIN-9: a juristic-person receipt needs a name and a 13-digit tax id.
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_billing_chk" CHECK (
  "billing_type" = 'INDIVIDUAL'
  OR ("billing_name" IS NOT NULL AND "billing_tax_id" ~ '^[0-9]{13}$')
);

-- Statement lines: positive credits, amount immutable, never deleted.
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_amount_chk" CHECK ("amount" > 0);
CREATE TRIGGER "bank_statement_lines_amount_immutable" BEFORE UPDATE OR DELETE ON "bank_statement_lines"
  FOR EACH ROW EXECUTE FUNCTION forbid_amount_change();
-- A matched line points at a payment; an unmatched/ignored line does not.
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_match_chk" CHECK (
  ("match_status" IN ('AUTO', 'MANUAL')) = ("payment_id" IS NOT NULL)
);
-- One live match per payment.
CREATE UNIQUE INDEX "bank_statement_lines_one_match_per_payment"
  ON "bank_statement_lines" ("payment_id") WHERE "match_status" IN ('AUTO', 'MANUAL');

-- Uploaded statements are an immutable record.
CREATE TRIGGER "bank_statements_append_only" BEFORE UPDATE OR DELETE ON "bank_statements"
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
