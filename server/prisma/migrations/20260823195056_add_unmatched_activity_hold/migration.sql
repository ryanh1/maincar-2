-- CreateTable
CREATE TABLE "UnmatchedActivity" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "participantAddresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "participantDomainCandidates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnmatchedActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UnmatchedActivity_orgId_sourceType_occurredAt_idx" ON "UnmatchedActivity"("orgId", "sourceType", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "UnmatchedActivity_orgId_sourceType_sourceKey_key" ON "UnmatchedActivity"("orgId", "sourceType", "sourceKey");

-- AddForeignKey
ALTER TABLE "UnmatchedActivity" ADD CONSTRAINT "UnmatchedActivity_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
