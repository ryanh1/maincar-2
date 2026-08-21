-- CreateTable
CREATE TABLE "List" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "objectSlug" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "ownerUserId" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "List_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListEntry" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "objectSlug" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "valuesJson" JSONB NOT NULL DEFAULT '{}',
    "position" INTEGER,
    "addedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "List_orgId_idx" ON "List"("orgId");

-- CreateIndex
CREATE INDEX "List_orgId_objectSlug_idx" ON "List"("orgId", "objectSlug");

-- CreateIndex
CREATE UNIQUE INDEX "List_orgId_slug_key" ON "List"("orgId", "slug");

-- CreateIndex
CREATE INDEX "ListEntry_orgId_idx" ON "ListEntry"("orgId");

-- CreateIndex
CREATE INDEX "ListEntry_orgId_listId_position_idx" ON "ListEntry"("orgId", "listId", "position");

-- CreateIndex
CREATE INDEX "ListEntry_orgId_objectSlug_targetId_idx" ON "ListEntry"("orgId", "objectSlug", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "ListEntry_listId_objectSlug_targetId_key" ON "ListEntry"("listId", "objectSlug", "targetId");

-- AddForeignKey
ALTER TABLE "List" ADD CONSTRAINT "List_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListEntry" ADD CONSTRAINT "ListEntry_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListEntry" ADD CONSTRAINT "ListEntry_listId_fkey" FOREIGN KEY ("listId") REFERENCES "List"("id") ON DELETE CASCADE ON UPDATE CASCADE;
