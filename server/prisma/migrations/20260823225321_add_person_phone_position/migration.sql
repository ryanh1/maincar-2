-- AlterTable
ALTER TABLE "PersonPhone" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- Existing rows all receive the database default above. Backfill a stable order
-- before constraining it: primary first, then oldest creation time, then id.
WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "personId"
    ORDER BY "isPrimary" DESC, "createdAt" ASC, "id" ASC
  ) - 1 AS "position"
  FROM "PersonPhone"
)
UPDATE "PersonPhone" AS phone
SET "position" = ranked."position"
FROM ranked
WHERE phone."id" = ranked."id";

CREATE UNIQUE INDEX "PersonPhone_personId_position_key"
ON "PersonPhone"("personId", "position");
