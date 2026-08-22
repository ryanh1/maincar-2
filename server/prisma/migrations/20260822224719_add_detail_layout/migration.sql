-- CreateTable
CREATE TABLE "DetailLayout" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "sectionsJson" JSONB NOT NULL,
    "railObjectsJson" JSONB,
    "feedKindsJson" JSONB,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DetailLayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DetailLayout_orgId_idx" ON "DetailLayout"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "DetailLayout_orgId_objectId_key" ON "DetailLayout"("orgId", "objectId");

-- AddForeignKey
ALTER TABLE "DetailLayout" ADD CONSTRAINT "DetailLayout_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetailLayout" ADD CONSTRAINT "DetailLayout_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "ObjectDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;
