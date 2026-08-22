-- AlterTable
ALTER TABLE "List" ADD COLUMN     "isShared" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "List_orgId_objectSlug_isShared_sortOrder_idx" ON "List"("orgId", "objectSlug", "isShared", "sortOrder");
