-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "layout" TEXT NOT NULL DEFAULT 'grid',
    "configJson" JSONB NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedView_orgId_objectId_sortOrder_idx" ON "SavedView"("orgId", "objectId", "sortOrder");

-- CreateIndex
CREATE INDEX "SavedView_orgId_objectId_isShared_idx" ON "SavedView"("orgId", "objectId", "isShared");

-- CreateIndex
CREATE INDEX "SavedView_orgId_objectId_ownerUserId_idx" ON "SavedView"("orgId", "objectId", "ownerUserId");

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "ObjectDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;
