-- CreateEnum
CREATE TYPE "ParticipantOrgType" AS ENUM ('SCHOOL', 'UNIVERSITY', 'GOVERNMENT', 'LOCAL_GOVERNMENT', 'PRIVATE', 'COMMUNITY', 'OTHER');

-- CreateEnum
CREATE TYPE "RegistrationGroupStatus" AS ENUM ('DRAFT', 'PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "GroupImportStatus" AS ENUM ('VALIDATED', 'COMMITTED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "GroupImportRowStatus" AS ENUM ('VALID', 'INVALID', 'IMPORTED');

-- CreateEnum
CREATE TYPE "GroupConsentType" AS ENUM ('COORDINATOR_ATTESTATION', 'MEMBER');

-- AlterEnum
ALTER TYPE "RegistrationStatus" ADD VALUE 'DRAFT';

-- AlterTable
ALTER TABLE "payment_orders" ADD COLUMN     "group_id" UUID;

-- AlterTable
ALTER TABLE "registrations" ADD COLUMN     "group_id" UUID;

-- CreateTable
CREATE TABLE "participant_organizations" (
    "id" UUID NOT NULL,
    "name_th" VARCHAR(300) NOT NULL,
    "org_type" "ParticipantOrgType" NOT NULL,
    "tax_id" CHAR(13),
    "branch" VARCHAR(100),
    "address" VARCHAR(1000),
    "province" VARCHAR(100),
    "phone" VARCHAR(20),
    "email" VARCHAR(254),
    "verified_at" TIMESTAMPTZ(6),
    "verified_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "participant_organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_coordinators" (
    "id" UUID NOT NULL,
    "participant_organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "position" VARCHAR(200),
    "phone" VARCHAR(20),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,

    CONSTRAINT "organization_coordinators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_group_settings" (
    "event_id" UUID NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "min_members" INTEGER NOT NULL DEFAULT 2,
    "max_members" INTEGER NOT NULL DEFAULT 50,
    "max_groups_per_organization" INTEGER,
    "allow_import" BOOLEAN NOT NULL DEFAULT true,
    "allow_invite_links" BOOLEAN NOT NULL DEFAULT true,
    "member_change_close_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by_id" UUID,

    CONSTRAINT "event_group_settings_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "registration_groups" (
    "id" UUID NOT NULL,
    "group_no" VARCHAR(30) NOT NULL,
    "event_id" UUID NOT NULL,
    "participant_organization_id" UUID NOT NULL,
    "coordinator_user_id" UUID NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "contact_phone" VARCHAR(20),
    "note" VARCHAR(1000),
    "status" "RegistrationGroupStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMPTZ(6),
    "confirmed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" VARCHAR(1000),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "registration_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_member_invitations" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "registration_id" UUID,
    "token_hash" CHAR(64) NOT NULL,
    "max_uses" INTEGER NOT NULL DEFAULT 1,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,

    CONSTRAINT "group_member_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_imports" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "file_name" VARCHAR(300) NOT NULL,
    "file_sha256" CHAR(64) NOT NULL,
    "status" "GroupImportStatus" NOT NULL DEFAULT 'VALIDATED',
    "total_rows" INTEGER NOT NULL,
    "valid_rows" INTEGER NOT NULL,
    "invalid_rows" INTEGER NOT NULL,
    "committed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,

    CONSTRAINT "group_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_import_rows" (
    "id" UUID NOT NULL,
    "import_id" UUID NOT NULL,
    "row_no" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "errors" JSONB,
    "status" "GroupImportRowStatus" NOT NULL,
    "registration_id" UUID,

    CONSTRAINT "group_import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_change_logs" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "registration_id" UUID,
    "action" VARCHAR(50) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" VARCHAR(1000),
    "actor_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_consents" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "registration_id" UUID,
    "consent_type" "GroupConsentType" NOT NULL,
    "consent_version" VARCHAR(30) NOT NULL,
    "member_count" INTEGER NOT NULL DEFAULT 1,
    "user_id" UUID,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_order_lines" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "fee_rate_id" UUID,
    "fee_name" VARCHAR(200) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "participant_organizations_name_th_idx" ON "participant_organizations"("name_th");

-- CreateIndex
CREATE INDEX "organization_coordinators_user_id_idx" ON "organization_coordinators"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_coordinators_participant_organization_id_user__key" ON "organization_coordinators"("participant_organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "registration_groups_group_no_key" ON "registration_groups"("group_no");

-- CreateIndex
CREATE INDEX "registration_groups_event_id_status_idx" ON "registration_groups"("event_id", "status");

-- CreateIndex
CREATE INDEX "registration_groups_participant_organization_id_idx" ON "registration_groups"("participant_organization_id");

-- CreateIndex
CREATE INDEX "registration_groups_coordinator_user_id_idx" ON "registration_groups"("coordinator_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "group_member_invitations_token_hash_key" ON "group_member_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "group_member_invitations_group_id_idx" ON "group_member_invitations"("group_id");

-- CreateIndex
CREATE INDEX "group_imports_group_id_created_at_idx" ON "group_imports"("group_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "group_import_rows_import_id_row_no_key" ON "group_import_rows"("import_id", "row_no");

-- CreateIndex
CREATE INDEX "group_change_logs_group_id_created_at_idx" ON "group_change_logs"("group_id", "created_at");

-- CreateIndex
CREATE INDEX "group_consents_group_id_idx" ON "group_consents"("group_id");

-- CreateIndex
CREATE INDEX "payment_order_lines_registration_id_idx" ON "payment_order_lines"("registration_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_order_lines_order_id_registration_id_key" ON "payment_order_lines"("order_id", "registration_id");

-- CreateIndex
CREATE INDEX "payment_orders_group_id_idx" ON "payment_orders"("group_id");

-- CreateIndex
CREATE INDEX "registrations_group_id_status_idx" ON "registrations"("group_id", "status");

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "registration_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_coordinators" ADD CONSTRAINT "organization_coordinators_participant_organization_id_fkey" FOREIGN KEY ("participant_organization_id") REFERENCES "participant_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_coordinators" ADD CONSTRAINT "organization_coordinators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_group_settings" ADD CONSTRAINT "event_group_settings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_groups" ADD CONSTRAINT "registration_groups_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_groups" ADD CONSTRAINT "registration_groups_participant_organization_id_fkey" FOREIGN KEY ("participant_organization_id") REFERENCES "participant_organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_groups" ADD CONSTRAINT "registration_groups_coordinator_user_id_fkey" FOREIGN KEY ("coordinator_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_member_invitations" ADD CONSTRAINT "group_member_invitations_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "registration_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_member_invitations" ADD CONSTRAINT "group_member_invitations_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_imports" ADD CONSTRAINT "group_imports_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "registration_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_import_rows" ADD CONSTRAINT "group_import_rows_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "group_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_change_logs" ADD CONSTRAINT "group_change_logs_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "registration_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_consents" ADD CONSTRAINT "group_consents_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "registration_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_order_lines" ADD CONSTRAINT "payment_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "payment_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_order_lines" ADD CONSTRAINT "payment_order_lines_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_order_lines" ADD CONSTRAINT "payment_order_lines_fee_rate_id_fkey" FOREIGN KEY ("fee_rate_id") REFERENCES "event_fee_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "registration_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────── Hand-written constraints (P3 group registration) ─────────────
-- NB: the new enum value 'DRAFT' cannot be referenced in this migration (Postgres forbids using a
-- value added in the same transaction), so no constraint below mentions it.

-- An order pays for exactly one individual registration OR one group.
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_payer_xor"
  CHECK (num_nonnulls("registration_id", "group_id") = 1);

-- One live combined order per group (same live set as the per-registration index).
CREATE UNIQUE INDEX "payment_orders_one_live_per_group"
  ON "payment_orders" ("group_id")
  WHERE "group_id" IS NOT NULL AND "status" IN ('UNPAID', 'PENDING_VERIFICATION', 'PAID', 'WAIVED');

-- Order lines: fee snapshot per member, never edited or deleted.
ALTER TABLE "payment_order_lines" ADD CONSTRAINT "payment_order_lines_amount_chk" CHECK ("amount" >= 0);
CREATE TRIGGER "payment_order_lines_amount_immutable" BEFORE UPDATE OR DELETE ON "payment_order_lines"
  FOR EACH ROW EXECUTE FUNCTION forbid_amount_change();

-- Group history and consent evidence are append-only.
CREATE TRIGGER "group_change_logs_append_only" BEFORE UPDATE OR DELETE ON "group_change_logs"
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
CREATE TRIGGER "group_consents_append_only" BEFORE UPDATE OR DELETE ON "group_consents"
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

ALTER TABLE "event_group_settings" ADD CONSTRAINT "event_group_settings_members_chk"
  CHECK ("min_members" >= 1 AND "max_members" >= "min_members" AND "max_members" <= 1000);
ALTER TABLE "event_group_settings" ADD CONSTRAINT "event_group_settings_max_groups_chk"
  CHECK ("max_groups_per_organization" IS NULL OR "max_groups_per_organization" >= 1);

ALTER TABLE "group_member_invitations" ADD CONSTRAINT "group_member_invitations_uses_chk"
  CHECK ("max_uses" BETWEEN 1 AND 1000 AND "used_count" BETWEEN 0 AND "max_uses");

ALTER TABLE "participant_organizations" ADD CONSTRAINT "participant_organizations_tax_id_chk"
  CHECK ("tax_id" IS NULL OR "tax_id" ~ '^[0-9]{13}$');

-- Import rows reference the member they created (no FK: rows are evidence even if the member is removed).
CREATE INDEX "group_import_rows_registration_id_idx" ON "group_import_rows" ("registration_id");
