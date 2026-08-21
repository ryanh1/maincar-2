-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "preferredFirstName" TEXT,
    "title" TEXT,
    "linkedinUrl" TEXT,
    "companyId" TEXT,
    "ownerUserId" TEXT,
    "timeZone" TEXT,
    "persona" TEXT,
    "attentionStatus" TEXT NOT NULL DEFAULT 'on_deck',
    "attentionReason" TEXT,
    "callbackDate" TIMESTAMP(3),
    "source" TEXT,
    "lastContactedAt" TIMESTAMP(3),
    "nameAudioUrl" TEXT,
    "customJson" JSONB NOT NULL DEFAULT '{}',
    "mergedIntoId" TEXT,
    "deletedById" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonPhone" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "e164" TEXT NOT NULL,
    "extension" TEXT,
    "label" TEXT NOT NULL DEFAULT 'other',
    "status" TEXT NOT NULL DEFAULT 'unverified',
    "reason" TEXT,
    "isDnc" BOOLEAN NOT NULL DEFAULT false,
    "dncReason" TEXT,
    "lineType" TEXT,
    "lineTypeCheckedAt" TIMESTAMP(3),
    "source" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "timesDialed" INTEGER NOT NULL DEFAULT 0,
    "lastDialedAt" TIMESTAMP(3),
    "timesConnected" INTEGER NOT NULL DEFAULT 0,
    "lastConnectedAt" TIMESTAMP(3),
    "bestTimeToCall" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonPhone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonEmail" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'work',
    "status" TEXT NOT NULL DEFAULT 'unverified',
    "reason" TEXT,
    "isDnc" BOOLEAN NOT NULL DEFAULT false,
    "dncReason" TEXT,
    "source" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Person_orgId_idx" ON "Person"("orgId");

-- CreateIndex
CREATE INDEX "Person_orgId_companyId_idx" ON "Person"("orgId", "companyId");

-- CreateIndex
CREATE INDEX "Person_orgId_ownerUserId_idx" ON "Person"("orgId", "ownerUserId");

-- CreateIndex
CREATE INDEX "Person_orgId_attentionStatus_idx" ON "Person"("orgId", "attentionStatus");

-- CreateIndex
CREATE INDEX "Person_orgId_callbackDate_idx" ON "Person"("orgId", "callbackDate");

-- CreateIndex
CREATE INDEX "PersonPhone_orgId_idx" ON "PersonPhone"("orgId");

-- CreateIndex
CREATE INDEX "PersonPhone_orgId_e164_idx" ON "PersonPhone"("orgId", "e164");

-- CreateIndex
CREATE INDEX "PersonPhone_orgId_status_idx" ON "PersonPhone"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PersonPhone_personId_e164_key" ON "PersonPhone"("personId", "e164");

-- CreateIndex
CREATE INDEX "PersonEmail_orgId_idx" ON "PersonEmail"("orgId");

-- CreateIndex
CREATE INDEX "PersonEmail_orgId_address_idx" ON "PersonEmail"("orgId", "address");

-- CreateIndex
CREATE UNIQUE INDEX "PersonEmail_personId_address_key" ON "PersonEmail"("personId", "address");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonPhone" ADD CONSTRAINT "PersonPhone_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonPhone" ADD CONSTRAINT "PersonPhone_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonEmail" ADD CONSTRAINT "PersonEmail_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonEmail" ADD CONSTRAINT "PersonEmail_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
