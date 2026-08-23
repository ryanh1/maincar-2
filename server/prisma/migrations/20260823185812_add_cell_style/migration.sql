-- CreateTable
CREATE TABLE "CellStyle" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "viewId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "backgroundToken" TEXT,
    "textToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CellStyle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CellStyle_orgId_viewId_idx" ON "CellStyle"("orgId", "viewId");

-- CreateIndex
CREATE UNIQUE INDEX "CellStyle_viewId_recordId_fieldId_key" ON "CellStyle"("viewId", "recordId", "fieldId");

-- AddForeignKey
ALTER TABLE "CellStyle" ADD CONSTRAINT "CellStyle_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CellStyle" ADD CONSTRAINT "CellStyle_viewId_fkey" FOREIGN KEY ("viewId") REFERENCES "SavedView"("id") ON DELETE CASCADE ON UPDATE CASCADE;
