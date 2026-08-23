-- AlterTable
ALTER TABLE "DispositionDef" ADD COLUMN     "isPinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pinOrder" INTEGER;

-- CreateIndex
CREATE INDEX "DispositionDef_orgId_isArchived_isPinned_pinOrder_idx" ON "DispositionDef"("orgId", "isArchived", "isPinned", "pinOrder");

-- Existing organizations receive the seven seeded dispositions in the bar in
-- their established catalog order. Custom dispositions remain unpinned.
WITH ranked_standard_dispositions AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (PARTITION BY "orgId" ORDER BY "sortOrder" ASC, "id" ASC) - 1 AS "pinOrder"
    FROM "DispositionDef"
    WHERE "isStandard" = true AND "isArchived" = false
)
UPDATE "DispositionDef" AS disposition
SET
    "isPinned" = true,
    "pinOrder" = ranked."pinOrder"
FROM ranked_standard_dispositions AS ranked
WHERE disposition."id" = ranked."id"
  AND ranked."pinOrder" < 7;
