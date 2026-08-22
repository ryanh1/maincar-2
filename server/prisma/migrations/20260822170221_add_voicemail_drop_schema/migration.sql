-- CreateTable
CREATE TABLE "VoicemailDrop" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "audioUrl" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "transcriptStatus" TEXT NOT NULL DEFAULT 'pending',
    "transcript" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoicemailDrop_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VoicemailDrop_orgId_name_idx" ON "VoicemailDrop"("orgId", "name");

-- CreateIndex
-- Prisma cannot express conditional unique indexes in schema.prisma. This index
-- is the durable concurrency guard: several library drops may be non-default,
-- but no transaction can commit a second default for the same organization.
CREATE UNIQUE INDEX "VoicemailDrop_one_default_per_org" ON "VoicemailDrop"("orgId") WHERE "isDefault";

-- AddForeignKey
ALTER TABLE "VoicemailDrop" ADD CONSTRAINT "VoicemailDrop_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
