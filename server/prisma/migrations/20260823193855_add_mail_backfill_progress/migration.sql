-- CreateTable
CREATE TABLE "MailBackfill" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "mailAccountId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "cursor" TEXT,
    "scannedCount" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailBackfill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MailBackfill_mailAccountId_key" ON "MailBackfill"("mailAccountId");

-- CreateIndex
CREATE INDEX "MailBackfill_orgId_status_idx" ON "MailBackfill"("orgId", "status");

-- AddForeignKey
ALTER TABLE "MailBackfill" ADD CONSTRAINT "MailBackfill_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailBackfill" ADD CONSTRAINT "MailBackfill_mailAccountId_fkey" FOREIGN KEY ("mailAccountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
