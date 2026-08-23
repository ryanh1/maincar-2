-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "activityCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "activityCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Email" ADD COLUMN     "manualAttach" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "manualAttach" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "activityCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ActivityLink" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "manualAttach" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityLink_orgId_targetType_targetId_idx" ON "ActivityLink"("orgId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "ActivityLink_orgId_sourceType_sourceId_idx" ON "ActivityLink"("orgId", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityLink_orgId_sourceType_sourceId_targetType_targetId_key" ON "ActivityLink"("orgId", "sourceType", "sourceId", "targetType", "targetId");

-- AddForeignKey
ALTER TABLE "ActivityLink" ADD CONSTRAINT "ActivityLink_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
