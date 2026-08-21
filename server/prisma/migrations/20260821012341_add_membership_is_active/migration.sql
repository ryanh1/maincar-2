-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Membership_orgId_isActive_idx" ON "Membership"("orgId", "isActive");
