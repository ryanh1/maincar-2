-- CreateTable
CREATE TABLE "FieldHistory" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "objectSlug" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "attribute" TEXT NOT NULL,
    "oldJson" JSONB,
    "newJson" JSONB,
    "changedByUserId" TEXT,
    "changeSource" TEXT NOT NULL DEFAULT 'user',
    "reason" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Provenance" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "objectSlug" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "attribute" TEXT NOT NULL,
    "value" JSONB,
    "previousValue" JSONB,
    "source" TEXT NOT NULL,
    "sourceRef" JSONB,
    "evidenceSnippet" TEXT,
    "confidence" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'unverified',
    "statusBy" TEXT,
    "statusAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Provenance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FieldHistory_orgId_objectSlug_recordId_changedAt_idx" ON "FieldHistory"("orgId", "objectSlug", "recordId", "changedAt");

-- CreateIndex
CREATE INDEX "Provenance_orgId_objectSlug_recordId_attribute_idx" ON "Provenance"("orgId", "objectSlug", "recordId", "attribute");

-- AddForeignKey
ALTER TABLE "FieldHistory" ADD CONSTRAINT "FieldHistory_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Provenance" ADD CONSTRAINT "Provenance_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
