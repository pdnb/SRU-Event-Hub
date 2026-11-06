-- CreateEnum
CREATE TYPE "CheckinAction" AS ENUM ('CHECK_IN', 'CHECK_OUT', 'UNDO');

-- CreateEnum
CREATE TYPE "CheckinMethod" AS ENUM ('QR', 'MANUAL', 'GROUP', 'OFFLINE');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT', 'EXCUSED');

-- CreateEnum
CREATE TYPE "PersonnelRole" AS ENUM ('SPEAKER', 'STAFF', 'VIP', 'ORGANIZER', 'VOLUNTEER', 'MEDIA', 'OTHER');

-- CreateEnum
CREATE TYPE "BadgePaper" AS ENUM ('A4_SHEET', 'LABEL');

-- CreateEnum
CREATE TYPE "BadgePrintMode" AS ENUM ('BATCH', 'INSTANT', 'REPRINT');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "checkin_late_after_minutes" INTEGER,
ADD COLUMN     "checkin_opens_before_minutes" INTEGER NOT NULL DEFAULT 120;

-- CreateTable
CREATE TABLE "checkin_locations" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "name_th" VARCHAR(200) NOT NULL,
    "schedule_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,

    CONSTRAINT "checkin_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkin_tokens" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "registration_id" UUID,
    "group_id" UUID,
    "token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by_id" UUID,
    "revoke_reason" VARCHAR(500),

    CONSTRAINT "checkin_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkin_records" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "location_id" UUID,
    "schedule_id" UUID,
    "action" "CheckinAction" NOT NULL,
    "method" "CheckinMethod" NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_id" UUID,
    "client_key" VARCHAR(64),
    "undoes_id" UUID,
    "note" VARCHAR(500),

    CONSTRAINT "checkin_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "schedule_id" UUID,
    "status" "AttendanceStatus" NOT NULL,
    "first_checkin_at" TIMESTAMPTZ(6),
    "last_checkout_at" TIMESTAMPTZ(6),
    "is_manual" BOOLEAN NOT NULL DEFAULT false,
    "note" VARCHAR(500),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by_id" UUID,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_personnel" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "user_id" UUID,
    "role" "PersonnelRole" NOT NULL,
    "prefix" VARCHAR(50),
    "first_name" VARCHAR(150) NOT NULL,
    "last_name" VARCHAR(150) NOT NULL,
    "position" VARCHAR(300),
    "affiliation" VARCHAR(300),
    "email" VARCHAR(254),
    "phone" VARCHAR(20),
    "can_checkin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "event_personnel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "badge_templates" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "name_th" VARCHAR(200) NOT NULL,
    "paper" "BadgePaper" NOT NULL DEFAULT 'A4_SHEET',
    "width_mm" DOUBLE PRECISION NOT NULL,
    "height_mm" DOUBLE PRECISION NOT NULL,
    "background_color" VARCHAR(9),
    "background_file_id" UUID,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "badge_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "badge_template_fields" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "content" VARCHAR(500),
    "x_mm" DOUBLE PRECISION NOT NULL,
    "y_mm" DOUBLE PRECISION NOT NULL,
    "w_mm" DOUBLE PRECISION NOT NULL,
    "h_mm" DOUBLE PRECISION NOT NULL,
    "font_size" DOUBLE PRECISION NOT NULL DEFAULT 12,
    "bold" BOOLEAN NOT NULL DEFAULT false,
    "align" VARCHAR(10) NOT NULL DEFAULT 'center',
    "color" VARCHAR(9),
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "badge_template_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "badge_color_rules" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "match_type" VARCHAR(30) NOT NULL,
    "match_value" VARCHAR(50),
    "color" VARCHAR(9) NOT NULL,
    "label" VARCHAR(100),
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "badge_color_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "badge_print_jobs" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "template_snapshot" JSONB NOT NULL,
    "mode" "BadgePrintMode" NOT NULL,
    "item_count" INTEGER NOT NULL,
    "reason" VARCHAR(500),
    "requested_by_id" UUID NOT NULL,
    "download_count" INTEGER NOT NULL DEFAULT 0,
    "last_downloaded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "badge_print_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "badge_prints" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "registration_id" UUID,
    "personnel_id" UUID,
    "print_no" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "badge_prints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "checkin_locations_event_id_name_th_key" ON "checkin_locations"("event_id", "name_th");

-- CreateIndex
CREATE UNIQUE INDEX "checkin_tokens_token_hash_key" ON "checkin_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "checkin_tokens_registration_id_idx" ON "checkin_tokens"("registration_id");

-- CreateIndex
CREATE INDEX "checkin_tokens_group_id_idx" ON "checkin_tokens"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "checkin_records_client_key_key" ON "checkin_records"("client_key");

-- CreateIndex
CREATE UNIQUE INDEX "checkin_records_undoes_id_key" ON "checkin_records"("undoes_id");

-- CreateIndex
CREATE INDEX "checkin_records_event_id_created_at_idx" ON "checkin_records"("event_id", "created_at");

-- CreateIndex
CREATE INDEX "checkin_records_registration_id_occurred_at_idx" ON "checkin_records"("registration_id", "occurred_at");

-- CreateIndex
CREATE INDEX "attendance_records_event_id_schedule_id_status_idx" ON "attendance_records"("event_id", "schedule_id", "status");

-- CreateIndex
-- NULLS NOT DISTINCT: one whole-event row (schedule_id NULL) per registration. Same name as the schema @@unique map,
-- so `prisma migrate dev` never generates a DROP for it.
CREATE UNIQUE INDEX "attendance_records_registration_schedule_key" ON "attendance_records"("registration_id", "schedule_id") NULLS NOT DISTINCT;

-- CreateIndex
CREATE INDEX "event_personnel_event_id_idx" ON "event_personnel"("event_id");

-- CreateIndex
CREATE INDEX "event_personnel_user_id_idx" ON "event_personnel"("user_id");

-- CreateIndex
CREATE INDEX "badge_templates_event_id_idx" ON "badge_templates"("event_id");

-- CreateIndex
CREATE INDEX "badge_template_fields_template_id_idx" ON "badge_template_fields"("template_id");

-- CreateIndex
CREATE INDEX "badge_color_rules_template_id_idx" ON "badge_color_rules"("template_id");

-- CreateIndex
CREATE INDEX "badge_print_jobs_event_id_created_at_idx" ON "badge_print_jobs"("event_id", "created_at");

-- CreateIndex
CREATE INDEX "badge_prints_job_id_sort_order_idx" ON "badge_prints"("job_id", "sort_order");

-- CreateIndex
CREATE INDEX "badge_prints_event_id_idx" ON "badge_prints"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "badge_prints_registration_id_print_no_key" ON "badge_prints"("registration_id", "print_no");

-- CreateIndex
CREATE UNIQUE INDEX "badge_prints_personnel_id_print_no_key" ON "badge_prints"("personnel_id", "print_no");

-- AddForeignKey
ALTER TABLE "checkin_locations" ADD CONSTRAINT "checkin_locations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_locations" ADD CONSTRAINT "checkin_locations_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "event_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_tokens" ADD CONSTRAINT "checkin_tokens_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_tokens" ADD CONSTRAINT "checkin_tokens_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_tokens" ADD CONSTRAINT "checkin_tokens_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "registration_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_records" ADD CONSTRAINT "checkin_records_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_records" ADD CONSTRAINT "checkin_records_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_records" ADD CONSTRAINT "checkin_records_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "checkin_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_records" ADD CONSTRAINT "checkin_records_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "event_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_records" ADD CONSTRAINT "checkin_records_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_records" ADD CONSTRAINT "checkin_records_undoes_id_fkey" FOREIGN KEY ("undoes_id") REFERENCES "checkin_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "event_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_personnel" ADD CONSTRAINT "event_personnel_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_personnel" ADD CONSTRAINT "event_personnel_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "badge_templates" ADD CONSTRAINT "badge_templates_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "badge_templates" ADD CONSTRAINT "badge_templates_background_file_id_fkey" FOREIGN KEY ("background_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "badge_template_fields" ADD CONSTRAINT "badge_template_fields_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "badge_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "badge_color_rules" ADD CONSTRAINT "badge_color_rules_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "badge_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "badge_print_jobs" ADD CONSTRAINT "badge_print_jobs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "badge_print_jobs" ADD CONSTRAINT "badge_print_jobs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "badge_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "badge_print_jobs" ADD CONSTRAINT "badge_print_jobs_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "badge_prints" ADD CONSTRAINT "badge_prints_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "badge_print_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "badge_prints" ADD CONSTRAINT "badge_prints_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "badge_prints" ADD CONSTRAINT "badge_prints_personnel_id_fkey" FOREIGN KEY ("personnel_id") REFERENCES "event_personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── P4 constraints Prisma cannot express ───────────────────────────────────

ALTER TABLE "events"
  ADD CONSTRAINT "events_checkin_window_chk" CHECK ("checkin_opens_before_minutes" BETWEEN 0 AND 10080),
  ADD CONSTRAINT "events_checkin_late_chk" CHECK ("checkin_late_after_minutes" IS NULL OR "checkin_late_after_minutes" BETWEEN 0 AND 1440);

-- A QR belongs to one registration or one group, and each has at most one live QR.
ALTER TABLE "checkin_tokens"
  ADD CONSTRAINT "checkin_tokens_subject_xor" CHECK (("registration_id" IS NULL) <> ("group_id" IS NULL));
CREATE UNIQUE INDEX "checkin_tokens_one_live_per_registration" ON "checkin_tokens" ("registration_id")
  WHERE "revoked_at" IS NULL AND "registration_id" IS NOT NULL;
CREATE UNIQUE INDEX "checkin_tokens_one_live_per_group" ON "checkin_tokens" ("group_id")
  WHERE "revoked_at" IS NULL AND "group_id" IS NOT NULL;

-- UNDO rows must reference what they reverse; other rows must not.
ALTER TABLE "checkin_records"
  ADD CONSTRAINT "checkin_records_undo_chk" CHECK (("action" = 'UNDO') = ("undoes_id" IS NOT NULL));

CREATE TRIGGER "checkin_records_append_only"
  BEFORE UPDATE OR DELETE ON "checkin_records"
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

ALTER TABLE "badge_templates"
  ADD CONSTRAINT "badge_templates_size_chk" CHECK ("width_mm" BETWEEN 20 AND 300 AND "height_mm" BETWEEN 20 AND 300);
-- One default template per event.
CREATE UNIQUE INDEX "badge_templates_one_default_per_event" ON "badge_templates" ("event_id")
  WHERE "is_default" AND "is_active";

ALTER TABLE "badge_template_fields"
  ADD CONSTRAINT "badge_template_fields_kind_chk" CHECK ("kind" IN ('TEXT', 'QR', 'BAND')),
  ADD CONSTRAINT "badge_template_fields_align_chk" CHECK ("align" IN ('left', 'center', 'right')),
  ADD CONSTRAINT "badge_template_fields_box_chk" CHECK ("w_mm" > 0 AND "h_mm" > 0 AND "font_size" BETWEEN 4 AND 96);

ALTER TABLE "badge_color_rules"
  ADD CONSTRAINT "badge_color_rules_type_chk" CHECK ("match_type" IN ('PARTICIPANT_TYPE', 'PERSONNEL_ROLE', 'ANY'));

ALTER TABLE "badge_print_jobs"
  ADD CONSTRAINT "badge_print_jobs_count_chk" CHECK ("item_count" > 0),
  ADD CONSTRAINT "badge_print_jobs_reprint_reason_chk" CHECK ("mode" <> 'REPRINT' OR length(btrim(coalesce("reason", ''))) >= 3);

-- A badge is printed for a registrant or for a staff/speaker record, never both.
ALTER TABLE "badge_prints"
  ADD CONSTRAINT "badge_prints_subject_xor" CHECK (("registration_id" IS NULL) <> ("personnel_id" IS NULL)),
  ADD CONSTRAINT "badge_prints_print_no_chk" CHECK ("print_no" >= 1);

CREATE TRIGGER "badge_prints_append_only"
  BEFORE UPDATE OR DELETE ON "badge_prints"
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
