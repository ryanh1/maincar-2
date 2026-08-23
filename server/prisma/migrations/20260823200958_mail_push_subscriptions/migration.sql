-- CreateTable
CREATE TABLE "MailPushSubscription" (
    "id" TEXT NOT NULL,
    "mailAccountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "verificationToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailPushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MailPushSubscription_remoteId_key" ON "MailPushSubscription"("remoteId");

-- CreateIndex
CREATE INDEX "MailPushSubscription_expiresAt_idx" ON "MailPushSubscription"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "MailPushSubscription_mailAccountId_kind_key" ON "MailPushSubscription"("mailAccountId", "kind");

-- AddForeignKey
ALTER TABLE "MailPushSubscription" ADD CONSTRAINT "MailPushSubscription_mailAccountId_fkey" FOREIGN KEY ("mailAccountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
