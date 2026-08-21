-- CreateTable
CREATE TABLE "Email" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "companyId" TEXT,
    "dealId" TEXT,
    "mailAccountId" TEXT,
    "direction" TEXT NOT NULL,
    "subject" TEXT,
    "bodyHtml" TEXT,
    "bodyText" TEXT,
    "snippet" TEXT,
    "internetMessageId" TEXT,
    "conversationId" TEXT,
    "inReplyTo" TEXT,
    "references" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "importance" TEXT NOT NULL DEFAULT 'normal',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "hasAttachments" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT,
    "providerMessageId" TEXT,
    "providerThreadId" TEXT,
    "folderOrLabels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "webLink" TEXT,
    "syncCursor" TEXT,
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Email_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailParticipant" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "name" TEXT,
    "address" TEXT NOT NULL,
    "personId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailAttachment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "filename" TEXT,
    "contentType" TEXT,
    "sizeBytes" INTEGER,
    "isInline" BOOLEAN NOT NULL DEFAULT false,
    "contentId" TEXT,
    "storageUrl" TEXT,
    "providerAttachmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Email_orgId_idx" ON "Email"("orgId");

-- CreateIndex
CREATE INDEX "Email_orgId_sentAt_idx" ON "Email"("orgId", "sentAt");

-- CreateIndex
CREATE INDEX "Email_orgId_companyId_sentAt_idx" ON "Email"("orgId", "companyId", "sentAt");

-- CreateIndex
CREATE INDEX "Email_orgId_dealId_sentAt_idx" ON "Email"("orgId", "dealId", "sentAt");

-- CreateIndex
CREATE INDEX "Email_orgId_conversationId_idx" ON "Email"("orgId", "conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "Email_orgId_mailAccountId_internetMessageId_key" ON "Email"("orgId", "mailAccountId", "internetMessageId");

-- CreateIndex
CREATE INDEX "EmailParticipant_orgId_emailId_idx" ON "EmailParticipant"("orgId", "emailId");

-- CreateIndex
CREATE INDEX "EmailParticipant_orgId_address_idx" ON "EmailParticipant"("orgId", "address");

-- CreateIndex
CREATE INDEX "EmailParticipant_personId_idx" ON "EmailParticipant"("personId");

-- CreateIndex
CREATE INDEX "EmailAttachment_orgId_emailId_idx" ON "EmailAttachment"("orgId", "emailId");

-- AddForeignKey
ALTER TABLE "Email" ADD CONSTRAINT "Email_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Email" ADD CONSTRAINT "Email_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Email" ADD CONSTRAINT "Email_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Email" ADD CONSTRAINT "Email_mailAccountId_fkey" FOREIGN KEY ("mailAccountId") REFERENCES "MailAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailParticipant" ADD CONSTRAINT "EmailParticipant_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailParticipant" ADD CONSTRAINT "EmailParticipant_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "Email"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailParticipant" ADD CONSTRAINT "EmailParticipant_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAttachment" ADD CONSTRAINT "EmailAttachment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAttachment" ADD CONSTRAINT "EmailAttachment_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "Email"("id") ON DELETE CASCADE ON UPDATE CASCADE;
