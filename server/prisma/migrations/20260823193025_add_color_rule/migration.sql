-- CreateTable
CREATE TABLE "ColorRule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "viewId" TEXT NOT NULL,
    "attribute" TEXT NOT NULL,
    "predicate" JSONB NOT NULL,
    "target" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'cell',
    "color" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ColorRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ColorRule_orgId_viewId_idx" ON "ColorRule"("orgId", "viewId");

-- CreateIndex
CREATE INDEX "ColorRule_viewId_sortOrder_idx" ON "ColorRule"("viewId", "sortOrder");

-- AddForeignKey
ALTER TABLE "ColorRule" ADD CONSTRAINT "ColorRule_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ColorRule" ADD CONSTRAINT "ColorRule_viewId_fkey" FOREIGN KEY ("viewId") REFERENCES "SavedView"("id") ON DELETE CASCADE ON UPDATE CASCADE;
