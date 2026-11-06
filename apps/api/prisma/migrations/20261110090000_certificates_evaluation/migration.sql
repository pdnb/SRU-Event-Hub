-- CreateEnum
CREATE TYPE "CertificateAudience" AS ENUM ('PARTICIPANT', 'PERSONNEL');

-- CreateEnum
CREATE TYPE "CertificateStatus" AS ENUM ('ISSUED', 'REVOKED');

-- CreateEnum
CREATE TYPE "CertificateIssueMethod" AS ENUM ('ADMIN', 'SELF_CLAIM');

-- CreateEnum
CREATE TYPE "CertificateVerifyResult" AS ENUM ('VALID', 'REVOKED', 'NOT_FOUND');

-- CreateEnum
CREATE TYPE "EvaluationFormStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "EvaluationQuestionKind" AS ENUM ('SECTION', 'RATING', 'SINGLE', 'MULTI', 'TEXT', 'TEXTAREA');

-- CreateTable
CREATE TABLE "certificate_templates" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "name_th" VARCHAR(200) NOT NULL,
    "audience" "CertificateAudience" NOT NULL DEFAULT 'PARTICIPANT',
    "personnel_roles" "PersonnelRole"[],
    "width_mm" DOUBLE PRECISION NOT NULL DEFAULT 297,
    "height_mm" DOUBLE PRECISION NOT NULL DEFAULT 210,
    "background_color" VARCHAR(9),
    "background_file_id" UUID,
    "fields" JSONB NOT NULL,
    "require_attendance" BOOLEAN NOT NULL DEFAULT true,
    "count_late" BOOLEAN NOT NULL DEFAULT true,
    "min_session_percent" INTEGER,
    "require_evaluation" BOOLEAN NOT NULL DEFAULT false,
    "allow_self_claim" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "certificate_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" UUID NOT NULL,
    "certificate_no" VARCHAR(30) NOT NULL,
    "verify_code" CHAR(12) NOT NULL,
    "event_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "registration_id" UUID,
    "personnel_id" UUID,
    "recipient_name" VARCHAR(400) NOT NULL,
    "data" JSONB NOT NULL,
    "template_snapshot" JSONB NOT NULL,
    "status" "CertificateStatus" NOT NULL DEFAULT 'ISSUED',
    "issue_method" "CertificateIssueMethod" NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by_id" UUID,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by_id" UUID,
    "revoke_reason" VARCHAR(500),
    "download_count" INTEGER NOT NULL DEFAULT 0,
    "last_downloaded_at" TIMESTAMPTZ(6),

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificate_verifications" (
    "id" UUID NOT NULL,
    "certificate_id" UUID,
    "code_tried" VARCHAR(40) NOT NULL,
    "result" "CertificateVerifyResult" NOT NULL,
    "ip_hash" CHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificate_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_forms" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "title_th" VARCHAR(300) NOT NULL,
    "description" VARCHAR(3000),
    "status" "EvaluationFormStatus" NOT NULL DEFAULT 'DRAFT',
    "is_anonymous" BOOLEAN NOT NULL DEFAULT true,
    "require_attendance" BOOLEAN NOT NULL DEFAULT true,
    "required_for_certificate" BOOLEAN NOT NULL DEFAULT true,
    "opens_at" TIMESTAMPTZ(6),
    "closes_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "evaluation_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_questions" (
    "id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "kind" "EvaluationQuestionKind" NOT NULL,
    "label_th" VARCHAR(500) NOT NULL,
    "help_text" VARCHAR(1000),
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "scale_max" INTEGER NOT NULL DEFAULT 5,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "evaluation_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_options" (
    "id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "label_th" VARCHAR(300) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "evaluation_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_responses" (
    "id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "registration_id" UUID,
    "respondent_key" CHAR(64) NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluation_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_answers" (
    "id" UUID NOT NULL,
    "response_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "option_id" UUID,
    "value_number" INTEGER,
    "value_text" VARCHAR(5000),

    CONSTRAINT "evaluation_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "certificate_templates_event_id_idx" ON "certificate_templates"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_certificate_no_key" ON "certificates"("certificate_no");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_verify_code_key" ON "certificates"("verify_code");

-- CreateIndex
CREATE INDEX "certificates_event_id_status_idx" ON "certificates"("event_id", "status");

-- CreateIndex
CREATE INDEX "certificates_template_id_idx" ON "certificates"("template_id");

-- CreateIndex
CREATE INDEX "certificates_registration_id_idx" ON "certificates"("registration_id");

-- CreateIndex
CREATE INDEX "certificates_personnel_id_idx" ON "certificates"("personnel_id");

-- CreateIndex
CREATE INDEX "certificate_verifications_certificate_id_created_at_idx" ON "certificate_verifications"("certificate_id", "created_at");

-- CreateIndex
CREATE INDEX "certificate_verifications_created_at_idx" ON "certificate_verifications"("created_at");

-- CreateIndex
CREATE INDEX "evaluation_forms_event_id_status_idx" ON "evaluation_forms"("event_id", "status");

-- CreateIndex
CREATE INDEX "evaluation_questions_form_id_sort_order_idx" ON "evaluation_questions"("form_id", "sort_order");

-- CreateIndex
CREATE INDEX "evaluation_options_question_id_idx" ON "evaluation_options"("question_id");

-- CreateIndex
CREATE INDEX "evaluation_responses_form_id_submitted_at_idx" ON "evaluation_responses"("form_id", "submitted_at");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_responses_form_id_respondent_key_key" ON "evaluation_responses"("form_id", "respondent_key");

-- CreateIndex
CREATE INDEX "evaluation_answers_response_id_idx" ON "evaluation_answers"("response_id");

-- CreateIndex
CREATE INDEX "evaluation_answers_question_id_option_id_idx" ON "evaluation_answers"("question_id", "option_id");

-- AddForeignKey
ALTER TABLE "certificate_templates" ADD CONSTRAINT "certificate_templates_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate_templates" ADD CONSTRAINT "certificate_templates_background_file_id_fkey" FOREIGN KEY ("background_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "certificate_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_personnel_id_fkey" FOREIGN KEY ("personnel_id") REFERENCES "event_personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_revoked_by_id_fkey" FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate_verifications" ADD CONSTRAINT "certificate_verifications_certificate_id_fkey" FOREIGN KEY ("certificate_id") REFERENCES "certificates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_forms" ADD CONSTRAINT "evaluation_forms_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_questions" ADD CONSTRAINT "evaluation_questions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "evaluation_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_options" ADD CONSTRAINT "evaluation_options_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "evaluation_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_responses" ADD CONSTRAINT "evaluation_responses_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "evaluation_forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_responses" ADD CONSTRAINT "evaluation_responses_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_responses" ADD CONSTRAINT "evaluation_responses_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_answers" ADD CONSTRAINT "evaluation_answers_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "evaluation_responses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_answers" ADD CONSTRAINT "evaluation_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "evaluation_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_answers" ADD CONSTRAINT "evaluation_answers_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "evaluation_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── P5a constraints Prisma cannot express ───────────────────────────────────

ALTER TABLE "certificate_templates"
  ADD CONSTRAINT "certificate_templates_size_chk" CHECK ("width_mm" BETWEEN 50 AND 500 AND "height_mm" BETWEEN 50 AND 500),
  ADD CONSTRAINT "certificate_templates_session_pct_chk" CHECK ("min_session_percent" IS NULL OR "min_session_percent" BETWEEN 1 AND 100),
  ADD CONSTRAINT "certificate_templates_fields_chk" CHECK (jsonb_typeof("fields") = 'array');

-- A certificate belongs to a registrant or to a personnel record, never both.
ALTER TABLE "certificates"
  ADD CONSTRAINT "certificates_subject_xor" CHECK (("registration_id" IS NULL) <> ("personnel_id" IS NULL)),
  ADD CONSTRAINT "certificates_verify_code_chk" CHECK ("verify_code" ~ '^[0-9A-HJKMNP-TV-Z]{12}$'),
  ADD CONSTRAINT "certificates_revoke_chk" CHECK (
    ("status" = 'REVOKED') = ("revoked_at" IS NOT NULL)
    AND ("status" <> 'REVOKED' OR length(btrim(coalesce("revoke_reason", ''))) >= 3)
  );
-- One live certificate per template and subject (two desks / a double click cannot issue twice).
CREATE UNIQUE INDEX "certificates_one_issued_per_registration" ON "certificates" ("template_id", "registration_id")
  WHERE "status" = 'ISSUED' AND "registration_id" IS NOT NULL;
CREATE UNIQUE INDEX "certificates_one_issued_per_personnel" ON "certificates" ("template_id", "personnel_id")
  WHERE "status" = 'ISSUED' AND "personnel_id" IS NOT NULL;

-- Issued content is immutable: only the status (ISSUED → REVOKED, once) and download counters change.
CREATE OR REPLACE FUNCTION forbid_certificate_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'certificates are never deleted (revoke instead)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.certificate_no IS DISTINCT FROM OLD.certificate_no
     OR NEW.verify_code IS DISTINCT FROM OLD.verify_code
     OR NEW.event_id IS DISTINCT FROM OLD.event_id
     OR NEW.template_id IS DISTINCT FROM OLD.template_id
     OR NEW.registration_id IS DISTINCT FROM OLD.registration_id
     OR NEW.personnel_id IS DISTINCT FROM OLD.personnel_id
     OR NEW.recipient_name IS DISTINCT FROM OLD.recipient_name
     OR NEW.data IS DISTINCT FROM OLD.data
     OR NEW.template_snapshot IS DISTINCT FROM OLD.template_snapshot
     OR NEW.issue_method IS DISTINCT FROM OLD.issue_method
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
     OR NEW.issued_by_id IS DISTINCT FROM OLD.issued_by_id THEN
    RAISE EXCEPTION 'issued certificate content cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'REVOKED' AND (NEW.status <> 'REVOKED'
     OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
     OR NEW.revoked_by_id IS DISTINCT FROM OLD.revoked_by_id
     OR NEW.revoke_reason IS DISTINCT FROM OLD.revoke_reason) THEN
    RAISE EXCEPTION 'a revoked certificate stays revoked' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "certificates_immutable"
  BEFORE UPDATE OR DELETE ON "certificates"
  FOR EACH ROW EXECUTE FUNCTION forbid_certificate_change();

CREATE TRIGGER "certificate_verifications_append_only"
  BEFORE UPDATE OR DELETE ON "certificate_verifications"
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

ALTER TABLE "evaluation_forms"
  ADD CONSTRAINT "evaluation_forms_window_chk" CHECK ("opens_at" IS NULL OR "closes_at" IS NULL OR "opens_at" < "closes_at");

ALTER TABLE "evaluation_questions"
  ADD CONSTRAINT "evaluation_questions_scale_chk" CHECK ("scale_max" BETWEEN 2 AND 10);

-- A response names its registrant only on non-anonymous forms (checked again by the API).
ALTER TABLE "evaluation_responses"
  ADD CONSTRAINT "evaluation_responses_key_chk" CHECK ("respondent_key" ~ '^[0-9a-f]{64}$');

ALTER TABLE "evaluation_answers"
  ADD CONSTRAINT "evaluation_answers_value_chk" CHECK (
    num_nonnulls("option_id", "value_number", "value_text") = 1
  );

CREATE TRIGGER "evaluation_responses_append_only"
  BEFORE UPDATE OR DELETE ON "evaluation_responses"
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

CREATE TRIGGER "evaluation_answers_append_only"
  BEFORE UPDATE OR DELETE ON "evaluation_answers"
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
