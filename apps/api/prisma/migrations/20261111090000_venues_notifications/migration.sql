-- DropForeignKey
ALTER TABLE "resource_bookings" DROP CONSTRAINT "resource_bookings_event_id_fkey";

-- DropIndex
DROP INDEX "notification_logs_status_created_at_idx";

-- AlterTable
ALTER TABLE "notification_logs" ADD COLUMN     "body" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "dedupe_key" VARCHAR(200),
ADD COLUMN     "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "subject" VARCHAR(300),
ADD COLUMN     "user_id" UUID;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "dedupe_key" VARCHAR(200);

-- AlterTable
ALTER TABLE "resource_bookings" ADD COLUMN     "decided_at" TIMESTAMPTZ(6),
ADD COLUMN     "decided_by_id" UUID,
ADD COLUMN     "decision_note" VARCHAR(1000),
ADD COLUMN     "purpose" VARCHAR(1000),
ADD COLUMN     "requested_by_id" UUID,
ADD COLUMN     "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "event_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "resources" ADD COLUMN     "description" VARCHAR(1000),
ADD COLUMN     "organization_id" UUID;

-- AlterTable
ALTER TABLE "venues" ADD COLUMN     "auto_approve" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "organization_id" UUID;

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "line" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "line_accounts" (
    "user_id" UUID NOT NULL,
    "line_user_id" VARCHAR(64) NOT NULL,
    "linked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "line_accounts_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "line_link_codes" (
    "code_hash" CHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "line_link_codes_pkey" PRIMARY KEY ("code_hash")
);

-- CreateTable
CREATE TABLE "notification_dispatches" (
    "audit_log_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_dispatches_pkey" PRIMARY KEY ("audit_log_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "line_accounts_line_user_id_key" ON "line_accounts"("line_user_id");

-- CreateIndex
CREATE INDEX "line_link_codes_user_id_idx" ON "line_link_codes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_logs_dedupe_key_key" ON "notification_logs"("dedupe_key");

-- CreateIndex
CREATE INDEX "notification_logs_status_next_attempt_at_idx" ON "notification_logs"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "notification_logs_user_id_created_at_idx" ON "notification_logs"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");

-- CreateIndex
CREATE INDEX "resource_bookings_event_id_idx" ON "resource_bookings"("event_id");

-- CreateIndex
CREATE INDEX "venues_organization_id_idx" ON "venues"("organization_id");

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_accounts" ADD CONSTRAINT "line_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_link_codes" ADD CONSTRAINT "line_link_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venues" ADD CONSTRAINT "venues_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_bookings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_bookings_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_bookings_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─── P5b constraints Prisma cannot express ───────────────────────────────────

ALTER TABLE "resources"
  ADD CONSTRAINT "resources_quantity_chk" CHECK ("quantity" >= 1);

ALTER TABLE "venue_bookings"
  ADD CONSTRAINT "venue_bookings_decision_chk" CHECK ("status" <> 'REJECTED' OR length(btrim(coalesce("decision_note", ''))) >= 3);

ALTER TABLE "resource_bookings"
  ADD CONSTRAINT "resource_bookings_decision_chk" CHECK ("status" <> 'REJECTED' OR length(btrim(coalesce("decision_note", ''))) >= 3);

-- Approved bookings of an item never exceed its stock at any instant. The resource row is locked so
-- two concurrent approvals are serialised; the check is the peak of overlapping approved quantities
-- within the new booking's interval (evaluated at each overlapping booking's start).
CREATE OR REPLACE FUNCTION check_resource_stock() RETURNS trigger AS $$
DECLARE
  stock int;
  peak int;
BEGIN
  IF NEW.status <> 'APPROVED' THEN
    RETURN NEW;
  END IF;
  SELECT quantity INTO stock FROM resources WHERE id = NEW.resource_id FOR UPDATE;
  SELECT coalesce(max(used), 0) INTO peak FROM (
    SELECT (
      SELECT coalesce(sum(b.quantity), 0) FROM resource_bookings b
      WHERE b.resource_id = NEW.resource_id AND b.status = 'APPROVED' AND b.id <> NEW.id
        AND b.start_at <= p.t AND b.end_at > p.t
    ) AS used
    FROM (
      SELECT NEW.start_at AS t
      UNION
      SELECT b.start_at FROM resource_bookings b
      WHERE b.resource_id = NEW.resource_id AND b.status = 'APPROVED' AND b.id <> NEW.id
        AND b.start_at > NEW.start_at AND b.start_at < NEW.end_at
    ) p
  ) s;
  IF peak + NEW.quantity > stock THEN
    RAISE EXCEPTION 'RESOURCE_STOCK: % of % already booked', peak, stock USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "resource_bookings_stock"
  BEFORE INSERT OR UPDATE OF "status", "quantity", "start_at", "end_at" ON "resource_bookings"
  FOR EACH ROW EXECUTE FUNCTION check_resource_stock();

ALTER TABLE "notification_logs"
  ADD CONSTRAINT "notification_logs_attempts_chk" CHECK ("attempts" >= 0);

-- Dispatcher scans recent audit rows by time.
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs" ("created_at");
