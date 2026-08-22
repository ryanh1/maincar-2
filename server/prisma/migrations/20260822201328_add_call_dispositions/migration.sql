-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "dispositionId" TEXT,
ADD COLUMN     "noteText" TEXT;

-- CreateTable
CREATE TABLE "DispositionDef" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'option-1',
    "icon" TEXT,
    "category" TEXT NOT NULL DEFAULT 'not_connected',
    "isStandard" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispositionDef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DispositionDef_orgId_isArchived_sortOrder_idx" ON "DispositionDef"("orgId", "isArchived", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "DispositionDef_orgId_value_key" ON "DispositionDef"("orgId", "value");

-- CreateIndex
CREATE INDEX "Call_orgId_dispositionId_idx" ON "Call"("orgId", "dispositionId");

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_dispositionId_fkey" FOREIGN KEY ("dispositionId") REFERENCES "DispositionDef"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispositionDef" ADD CONSTRAINT "DispositionDef_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing organizations need the same default catalog as newly created ones.
-- The deterministic ids make this safe to replay, and the unique org/value key
-- preserves any row an organization already created for the same stable value.
INSERT INTO "DispositionDef" ("id", "orgId", "value", "label", "color", "category", "isStandard", "sortOrder", "isArchived", "createdAt", "updatedAt")
SELECT
    'seed-disposition-' || "Org"."id" || '-' || defaults."value",
    "Org"."id",
    defaults."value",
    defaults."label",
    defaults."color",
    defaults."category",
    true,
    defaults."sortOrder",
    false,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Org"
CROSS JOIN (
    VALUES
      ('connected', 'Connected', 'option-1', 'connected', 0),
      ('voicemail', 'Left voicemail', 'option-2', 'not_connected', 1),
      ('no_answer', 'No answer', 'option-3', 'not_connected', 2),
      ('busy', 'Busy', 'option-4', 'not_connected', 3),
      ('wrong_number', 'Wrong number', 'option-5', 'not_connected', 4),
      ('not_interested', 'Not interested', 'option-6', 'connected', 5),
      ('callback', 'Call back', 'option-7', 'connected', 6)
) AS defaults("value", "label", "color", "category", "sortOrder")
ON CONFLICT ("orgId", "value") DO NOTHING;
