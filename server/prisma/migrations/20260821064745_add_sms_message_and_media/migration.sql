-- CreateTable
CREATE TABLE "SmsMessage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "personId" TEXT,
    "companyId" TEXT,
    "dealId" TEXT,
    "mailboxUserId" TEXT,
    "phoneNumberId" TEXT,
    "fromE164" TEXT NOT NULL,
    "toE164" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "body" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "numSegments" INTEGER,
    "numMedia" INTEGER NOT NULL DEFAULT 0,
    "channel" TEXT NOT NULL DEFAULT 'sms',
    "twilioSid" TEXT,
    "messagingServiceSid" TEXT,
    "price" TEXT,
    "priceUnit" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageMedia" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "smsMessageId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "storageUrl" TEXT,
    "twilioMediaSid" TEXT,
    "sizeBytes" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageMedia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SmsMessage_twilioSid_key" ON "SmsMessage"("twilioSid");

-- CreateIndex
CREATE INDEX "SmsMessage_orgId_idx" ON "SmsMessage"("orgId");

-- CreateIndex
CREATE INDEX "SmsMessage_orgId_personId_sentAt_idx" ON "SmsMessage"("orgId", "personId", "sentAt");

-- CreateIndex
CREATE INDEX "SmsMessage_orgId_companyId_sentAt_idx" ON "SmsMessage"("orgId", "companyId", "sentAt");

-- CreateIndex
CREATE INDEX "SmsMessage_orgId_dealId_sentAt_idx" ON "SmsMessage"("orgId", "dealId", "sentAt");

-- CreateIndex
CREATE INDEX "SmsMessage_orgId_toE164_idx" ON "SmsMessage"("orgId", "toE164");

-- CreateIndex
CREATE INDEX "MessageMedia_orgId_smsMessageId_idx" ON "MessageMedia"("orgId", "smsMessageId");

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_mailboxUserId_fkey" FOREIGN KEY ("mailboxUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageMedia" ADD CONSTRAINT "MessageMedia_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageMedia" ADD CONSTRAINT "MessageMedia_smsMessageId_fkey" FOREIGN KEY ("smsMessageId") REFERENCES "SmsMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
