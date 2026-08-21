-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "dealId" TEXT,
ADD COLUMN     "personId" TEXT;

-- CreateIndex
CREATE INDEX "Call_orgId_personId_createdAt_idx" ON "Call"("orgId", "personId", "createdAt");

-- CreateIndex
CREATE INDEX "Call_orgId_companyId_createdAt_idx" ON "Call"("orgId", "companyId", "createdAt");

-- CreateIndex
CREATE INDEX "Call_orgId_dealId_createdAt_idx" ON "Call"("orgId", "dealId", "createdAt");

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
