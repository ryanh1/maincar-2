-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT,
    "legalName" TEXT,
    "companyType" TEXT,
    "domain" TEXT,
    "alternateDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "linkedinUrl" TEXT,
    "industry" TEXT,
    "sizeEmployees" INTEGER,
    "logoUrl" TEXT,
    "mergedIntoId" TEXT,
    "deletedById" TEXT,
    "parentCompanyId" TEXT,
    "ownerUserId" TEXT,
    "attentionStatus" TEXT NOT NULL DEFAULT 'on_deck',
    "attentionReason" TEXT,
    "callbackDate" TIMESTAMP(3),
    "source" TEXT,
    "customJson" JSONB NOT NULL DEFAULT '{}',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Company_orgId_idx" ON "Company"("orgId");

-- CreateIndex
CREATE INDEX "Company_orgId_parentCompanyId_idx" ON "Company"("orgId", "parentCompanyId");

-- CreateIndex
CREATE INDEX "Company_orgId_ownerUserId_idx" ON "Company"("orgId", "ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Company_orgId_domain_key" ON "Company"("orgId", "domain");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_parentCompanyId_fkey" FOREIGN KEY ("parentCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
