-- CreateTable
CREATE TABLE "CaptureSettings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "internalDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludeDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludeAddresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludeRoleAddresses" BOOLEAN NOT NULL DEFAULT true,
    "dropBulkInbound" BOOLEAN NOT NULL DEFAULT true,
    "bulkInboundMax" INTEGER NOT NULL DEFAULT 15,
    "subjectExcludes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "logActivityTypes" TEXT NOT NULL DEFAULT 'both',
    "backfillMonths" INTEGER NOT NULL DEFAULT 12,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaptureSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailCaptureOptOut" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailCaptureOptOut_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CaptureSettings_orgId_key" ON "CaptureSettings"("orgId");

-- CreateIndex
CREATE INDEX "MailCaptureOptOut_orgId_idx" ON "MailCaptureOptOut"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "MailCaptureOptOut_orgId_userId_key" ON "MailCaptureOptOut"("orgId", "userId");

-- AddForeignKey
ALTER TABLE "CaptureSettings" ADD CONSTRAINT "CaptureSettings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailCaptureOptOut" ADD CONSTRAINT "MailCaptureOptOut_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailCaptureOptOut" ADD CONSTRAINT "MailCaptureOptOut_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
