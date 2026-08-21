-- CreateTable
CREATE TABLE "Record" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "valuesJson" JSONB NOT NULL DEFAULT '{}',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordLink" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "fromObject" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "attribute" TEXT,
    "toObject" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "noteId" TEXT,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecordLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Record_orgId_objectId_idx" ON "Record"("orgId", "objectId");

-- CreateIndex
CREATE INDEX "Record_valuesJson_idx" ON "Record" USING GIN ("valuesJson" jsonb_path_ops);

-- CreateIndex
CREATE INDEX "RecordLink_orgId_fromObject_fromId_idx" ON "RecordLink"("orgId", "fromObject", "fromId");

-- CreateIndex
CREATE INDEX "RecordLink_orgId_toObject_toId_idx" ON "RecordLink"("orgId", "toObject", "toId");

-- AddForeignKey
ALTER TABLE "Record" ADD CONSTRAINT "Record_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordLink" ADD CONSTRAINT "RecordLink_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
