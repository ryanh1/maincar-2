-- CreateTable
CREATE TABLE "ObjectDef" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "namePlural" TEXT NOT NULL,
    "icon" TEXT,
    "iconColor" TEXT,
    "storage" TEXT NOT NULL DEFAULT 'record',
    "isStandard" BOOLEAN NOT NULL DEFAULT false,
    "isFirstClass" BOOLEAN NOT NULL DEFAULT true,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObjectDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttributeDef" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "type" TEXT NOT NULL,
    "optionsJson" JSONB,
    "refObjectId" TEXT,
    "formatJson" JSONB,
    "validationJson" JSONB,
    "isIdentity" BOOLEAN NOT NULL DEFAULT false,
    "storage" TEXT NOT NULL DEFAULT 'custom',
    "isMulti" BOOLEAN NOT NULL DEFAULT false,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "isUnique" BOOLEAN NOT NULL DEFAULT false,
    "isReadOnly" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "defaultJson" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttributeDef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ObjectDef_orgId_idx" ON "ObjectDef"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "ObjectDef_orgId_slug_key" ON "ObjectDef"("orgId", "slug");

-- CreateIndex
CREATE INDEX "AttributeDef_orgId_idx" ON "AttributeDef"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "AttributeDef_objectId_slug_key" ON "AttributeDef"("objectId", "slug");

-- AddForeignKey
ALTER TABLE "ObjectDef" ADD CONSTRAINT "ObjectDef_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributeDef" ADD CONSTRAINT "AttributeDef_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributeDef" ADD CONSTRAINT "AttributeDef_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "ObjectDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;
