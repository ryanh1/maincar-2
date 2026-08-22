-- AlterTable
ALTER TABLE "ActivityEntry" ADD COLUMN     "timelineDisplay" JSONB,
ADD COLUMN     "timelineIntensity" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "timelineMarker" JSONB,
ADD COLUMN     "timelineSubtype" TEXT,
ADD COLUMN     "timelineTitle" TEXT,
ADD COLUMN     "timelineVersion" INTEGER NOT NULL DEFAULT 1;

-- Existing generic feed rows already have a non-empty renderable summary. Preserve
-- that exact snapshot before requiring timeline titles for every future writer.
UPDATE "ActivityEntry" SET "timelineTitle" = "summary" WHERE "timelineTitle" IS NULL;

ALTER TABLE "ActivityEntry" ALTER COLUMN "timelineTitle" SET NOT NULL;
