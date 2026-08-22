-- Preserve put-away drafts before removing the legacy presentation-only field.
UPDATE "EmailDraft"
SET "isOpen" = false
WHERE "isMinimized" = true;

-- AlterTable
ALTER TABLE "EmailDraft" DROP COLUMN "isMinimized";
