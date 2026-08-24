-- AlterTable
ALTER TABLE "MailAccount" ADD COLUMN     "gmailWatchExpiresAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MailSyncHealthSample" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "mailAccountId" TEXT NOT NULL,
    "messagesScanned" INTEGER NOT NULL DEFAULT 0,
    "messagesMatched" INTEGER NOT NULL DEFAULT 0,
    "fullResync" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailSyncHealthSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MailSyncHealthSample_orgId_createdAt_idx" ON "MailSyncHealthSample"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "MailSyncHealthSample_mailAccountId_createdAt_idx" ON "MailSyncHealthSample"("mailAccountId", "createdAt");

-- AddForeignKey
ALTER TABLE "MailSyncHealthSample" ADD CONSTRAINT "MailSyncHealthSample_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailSyncHealthSample" ADD CONSTRAINT "MailSyncHealthSample_mailAccountId_fkey" FOREIGN KEY ("mailAccountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
