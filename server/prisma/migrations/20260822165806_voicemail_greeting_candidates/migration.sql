-- This migration begins with Prisma's schema diff. It deliberately renames the
-- existing key column and backfills legacy rows before making the new intent
-- fields required, so a live active greeting is never dropped during upgrade.

-- DropIndex
DROP INDEX "VoicemailGreeting_orgId_key";

-- AlterTable
ALTER TABLE "VoicemailGreeting" RENAME COLUMN "audioUrl" TO "storageKey";
ALTER TABLE "VoicemailGreeting"
  ADD COLUMN "contentHash" TEXT,
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "durationSeconds" INTEGER,
  ADD COLUMN "failureReason" TEXT,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "sourceKey" TEXT,
  ALTER COLUMN "status" SET DEFAULT 'uploading';

-- Existing ready rows are the only live greeting the old singleton model had,
-- so they become active. In-flight work cannot be safely resumed because its
-- old queue payload names only an org; mark it honestly failed instead.
UPDATE "VoicemailGreeting"
SET
  "status" = CASE
    WHEN "status" = 'ready' AND "storageKey" IS NOT NULL THEN 'active'
    WHEN "status" = 'pending' THEN 'failed'
    ELSE "status"
  END,
  "failureReason" = CASE
    WHEN "status" = 'pending' THEN 'Greeting processing was interrupted by a lifecycle upgrade. Upload a new candidate.'
    ELSE NULL
  END,
  "contentHash" = 'legacy:' || "id",
  "idempotencyKey" = 'legacy:' || "id";

ALTER TABLE "VoicemailGreeting"
  ALTER COLUMN "contentHash" SET NOT NULL,
  ALTER COLUMN "idempotencyKey" SET NOT NULL;

-- CreateIndex
CREATE INDEX "VoicemailGreeting_orgId_status_idx" ON "VoicemailGreeting"("orgId", "status");
CREATE UNIQUE INDEX "VoicemailGreeting_orgId_idempotencyKey_key" ON "VoicemailGreeting"("orgId", "idempotencyKey");
-- The promotion transaction clears the old active row before activating the
-- replacement, so this database invariant also protects non-route writers.
CREATE UNIQUE INDEX "VoicemailGreeting_one_active_per_org_key"
  ON "VoicemailGreeting"("orgId")
  WHERE "status" = 'active';
