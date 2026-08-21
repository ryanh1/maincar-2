-- CreateTable
CREATE TABLE "ActivityEntry" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "preview" TEXT,
    "direction" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "companyId" TEXT,
    "personId" TEXT,
    "dealId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityEntry_orgId_companyId_occurredAt_idx" ON "ActivityEntry"("orgId", "companyId", "occurredAt");

-- CreateIndex
CREATE INDEX "ActivityEntry_orgId_personId_occurredAt_idx" ON "ActivityEntry"("orgId", "personId", "occurredAt");

-- CreateIndex
CREATE INDEX "ActivityEntry_orgId_dealId_occurredAt_idx" ON "ActivityEntry"("orgId", "dealId", "occurredAt");

-- CreateIndex
CREATE INDEX "ActivityEntry_orgId_createdByUserId_occurredAt_idx" ON "ActivityEntry"("orgId", "createdByUserId", "occurredAt");

-- CreateIndex
CREATE INDEX "ActivityEntry_orgId_occurredAt_idx" ON "ActivityEntry"("orgId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityEntry_orgId_sourceType_sourceId_key" ON "ActivityEntry"("orgId", "sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "ActivityEntry" ADD CONSTRAINT "ActivityEntry_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEntry" ADD CONSTRAINT "ActivityEntry_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEntry" ADD CONSTRAINT "ActivityEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEntry" ADD CONSTRAINT "ActivityEntry_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEntry" ADD CONSTRAINT "ActivityEntry_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
